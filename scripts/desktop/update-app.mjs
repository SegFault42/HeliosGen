// Opt-in macOS source updater. Runs outside the bundle to survive app restart.
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, openSync, closeSync,
  readFileSync, writeFileSync, renameSync, unlinkSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = "/Applications/HeliosGen.app";
const data = join(homedir(), "Library/Application Support/cash.sdd.helios.desktop");
const stateDir = join(data, "app-updater");
const lock = join(stateDir, "lock");
const [revision, appPid, serverPid] = process.argv.slice(2);
const installBuilt = revision === "--install-built";
let phase = "Checking for updates";
let backup;
let staged;
let movedOld = false;
let installed = false;
let stopped = false;

function run(command, args, capture = false) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8",
    timeout: 30 * 60 * 1000, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, CI: "true", GIT_TERMINAL_PROMPT: "0", HELIOS_LOCAL_UPDATER: "1" } })?.trim();
}
function report(message, running = true, error = false) {
  console.log(`[update] ${message}`);
  const temp = join(stateDir, `status-${process.pid}.json`);
  writeFileSync(temp, JSON.stringify({ message, running, error, pid: process.pid,
    backup, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  renameSync(temp, join(stateDir, "status.json"));
}
function alive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}
function plist(bundle, key) {
  return run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(bundle, "Contents/Info.plist")], true);
}
async function stopApp() {
  // Refuse to signal anything other than the exact app/server that requested it.
  if (!/^\d+$/.test(appPid ?? "") || !/^\d+$/.test(serverPid ?? "")) throw new Error("Missing app process IDs.");
  if (alive(appPid)) {
    const command = run("/bin/ps", ["-p", appPid, "-o", "comm="], true);
    if (command !== `${app}/Contents/MacOS/heliosgen-desktop`) throw new Error("Run the installed app in /Applications before updating.");
    process.kill(Number(appPid), "SIGTERM");
    stopped = true;
  }
  for (let i = 0; i < 150 && (alive(appPid) || alive(serverPid)); i++) await delay(200);
  if (alive(appPid) || alive(serverPid)) throw new Error("App did not quit. Close HeliosGen and retry.");
}

mkdirSync(stateDir, { recursive: true, mode: 0o700 });
try {
  if (existsSync(lock)) {
    const owner = Number(readFileSync(lock, "utf8"));
    if (!owner || alive(owner)) throw new Error("Another updater is running.");
    unlinkSync(lock);
  }
  const fd = openSync(lock, "wx", 0o600);
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
} catch (error) { console.error(error.message); process.exit(1); }

try {
  if (process.platform !== "darwin") throw new Error("This updater is macOS-only.");
  if (process.env.HELIOS_DATA_DIR && process.env.HELIOS_DATA_DIR !== data) throw new Error("Unexpected app data location; refusing to update.");
  accessSync("/Applications", constants.W_OK);
  if (plist(app, "CFBundleIdentifier") !== "cash.sdd.helios.desktop") throw new Error("Unexpected installed application.");
  report(phase);
  if (!installBuilt) {
    if (!run("git", ["branch", "--show-current"], true) ||
        run("git", ["status", "--porcelain"], true) ||
        existsSync(join(root, ".git/MERGE_HEAD"))) {
      throw new Error("Check out a branch and commit or resolve local changes before updating.");
    }
    const response = await fetch("https://api.github.com/repos/SegFault42/HeliosGen/releases/latest", {
      headers: { "User-Agent": "HeliosGen-Local-Updater", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub update check failed (${response.status}).`);
    const release = await response.json();
    if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error("No supported stable release found.");
    run("git", ["fetch", "--no-tags", "https://github.com/SegFault42/HeliosGen.git", `refs/tags/${release.tag_name}`]);
    const target = run("git", ["rev-parse", "FETCH_HEAD^{commit}"], true);
    let alreadyInstalled = false;
    try { run("git", ["merge-base", "--is-ancestor", target, revision], true); alreadyInstalled = true; }
    catch { /* A newer release needs merging and building. */ }
    if (alreadyInstalled) {
      report("HeliosGen is up to date. Your data is unchanged.", false);
      process.exitCode = 0;
    } else {
      phase = "Preserving local changes and updating source";
      report(phase);
      // Worktree was checked clean: preserve committed customizations in a
      // regular merge, and return to the original branch on any conflict.
      try {
        run("git", ["-c", "merge.autoStash=false", "merge", "--no-edit", target]);
      } catch (error) {
        if (existsSync(join(root, ".git/MERGE_HEAD"))) run("git", ["merge", "--abort"]);
        throw error;
      }
      phase = "Building update — this can take several minutes";
      report(phase);
      run("pnpm", ["install", "--frozen-lockfile"]);
      run("pnpm", ["desktop:build", "--bundles", "app"]);
      await install();
    }
  } else { await install(); }
} catch (error) {
  console.error(error);
  if (movedOld && !installed && !existsSync(app)) renameSync(backup, app);
  if (stopped && !installed && existsSync(app)) {
    try { run("/usr/bin/open", ["-n", app]); } catch { /* details in log */ }
  }
  report(`${phase} failed: ${error.message}. ${installed ? "Previous app and database backups were retained." : "The installed app and your data were preserved."} See app-updater/update.log.`, false, true);
  process.exitCode = 1;
} finally { unlinkSync(lock); }

async function install() {
  phase = "Validating and staging the new app";
  report(phase);
  const built = join(root, "src-tauri/target/release/bundle/macos/HeliosGen.app");
  if (plist(built, "CFBundleIdentifier") !== "cash.sdd.helios.desktop") throw new Error("New app has the wrong data identity.");
  const config = JSON.parse(readFileSync(join(built, "Contents/Resources/server/local-updater.json"), "utf8"));
  if (config.root !== root || !/^[a-f0-9]{40}$/.test(config.revision)) throw new Error("New app is missing its local updater configuration.");
  if (!existsSync(join(built, "Contents/Resources/server/.next/server/app/api/app-update/route.js"))) throw new Error("New app is missing the update button backend.");
  const stamp = `${Date.now()}-${process.pid}`;
  const backupDir = join("/Applications/.HeliosGen-backups", stamp);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  backup = join(backupDir, "HeliosGen.app");
  staged = join(backupDir, "New-HeliosGen.app");
  run("/usr/bin/ditto", [built, staged]);
  // Next's image/fetch caches must not mutate the signed application bundle.
  const cache = join(staged, "Contents/Resources/server/.next/cache");
  const writableCache = join(data, "next-cache");
  mkdirSync(writableCache, { recursive: true });
  if (existsSync(cache)) renameSync(cache, join(backupDir, "build-cache"));
  symlinkSync(writableCache, cache, "dir");
  // Tauri's unsigned local build has only a linker signature. Seal the local
  // bundle (including nested code) before validating it; no Gatekeeper bypass.
  run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--entitlements", join(root, "src-tauri/entitlements.plist"), staged]);
  run("/usr/bin/codesign", ["--verify", "--deep", staged]);
  phase = "Restarting HeliosGen — please wait";
  report(phase);
  await stopApp();
  // Snapshot SQLite after all writers stop. Media and WebKit storage are never
  // moved/deleted; the bundle ID and localhost port remain the same.
  const dbBackup = join(stateDir, `guest-${stamp}.db`);
  if (existsSync(join(data, "guest.db"))) {
    run("/usr/bin/sqlite3", [join(data, "guest.db"), `.backup '${dbBackup.replaceAll("'", "''")}'`]);
    if (run("/usr/bin/sqlite3", [dbBackup, "PRAGMA quick_check;"], true) !== "ok") throw new Error("Database backup validation failed.");
  }
  renameSync(app, backup);
  movedOld = true;
  renameSync(staged, app);
  installed = true;
  run("/usr/bin/open", ["-n", app]);
  for (let i = 0; i < 90; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${process.env.PORT || "41730"}/api/app-update`, { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      if (response.ok && health.available && health.revision === config.revision) {
        report("Update installed. Previous app and database backups are saved; your media and settings remain in place.", false);
        return;
      }
    } catch { /* Waiting for the new sidecar. */ }
    await delay(1000);
  }
  throw new Error(`Could not verify the restarted app. Previous app: ${backup}`);
}
