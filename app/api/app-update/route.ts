import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "@/lib/guest/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stateDir = join(DATA_DIR, "app-updater");

function configuration() {
  try {
    const config = JSON.parse(readFileSync(join(process.cwd(), "local-updater.json"), "utf8"));
    return process.platform === "darwin" && existsSync(join(config.root, "scripts/desktop/update-app.mjs"))
      ? config as { root: string; revision: string } : null;
  } catch { return null; }
}

function status() {
  try {
    const state = JSON.parse(readFileSync(join(stateDir, "status.json"), "utf8"));
    if (state.running) {
      try { process.kill(state.pid, 0); }
      catch { return { running: false, message: "The update was interrupted. You can retry; backups are kept in app-updater.", error: true }; }
    }
    return state;
  } catch { return { running: false, message: "Check for a release and install it here." }; }
}

export function GET() {
  const config = configuration();
  return Response.json({ available: !!config, revision: config?.revision, ...status() });
}

export async function POST(request: Request) {
  // No cross-origin web page may trigger local code execution / installation.
  const host = request.headers.get("host");
  if (!host || !/^127\.0\.0\.1:\d+$/.test(host) ||
      request.headers.get("origin") !== `http://${host}` ||
      request.headers.get("x-helios-update") !== "1") {
    return Response.json({ error: "Update must be started inside HeliosGen." }, { status: 403 });
  }
  const config = configuration();
  if (!config) return Response.json({ error: "Local source checkout is missing. Restore it before updating." }, { status: 409 });
  if (status().running) return Response.json({ error: "An update is already running." }, { status: 409 });
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const log = openSync(join(stateDir, "update.log"), "a", 0o600);
  try {
    const child = spawn(process.execPath, [join(config.root, "scripts/desktop/update-app.mjs"),
      config.revision, String(process.ppid), String(process.pid)], {
      cwd: config.root,
      env: { ...process.env, HELIOS_DATA_DIR: DATA_DIR },
      detached: true,
      stdio: ["ignore", log, log],
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return Response.json({ running: true, message: "Checking for updates…" }, { status: 202 });
  } catch {
    return Response.json({ error: "Could not start the updater. See app-updater/update.log." }, { status: 500 });
  } finally { closeSync(log); }
}
