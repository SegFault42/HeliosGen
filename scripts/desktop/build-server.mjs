// Stages a self-contained Next.js server + a Node runtime for the Tauri bundle.
//
//   node scripts/desktop/build-server.mjs          # full production build + stage
//   node scripts/desktop/build-server.mjs --dev     # just build the sidecar shim
//
// Invoked automatically by `tauri build` / `tauri dev` via the before* commands.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  chmodSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_TAURI = join(ROOT, "src-tauri");
const STAGE = join(SRC_TAURI, "server");
const BIN_DIR = join(SRC_TAURI, "binaries");

const EXE = process.platform === "win32" ? ".exe" : "";

// Baked into the client bundle so the in-app update check
// (`app/api/update-check`) knows what version is running.
const APP_VERSION = JSON.parse(
  readFileSync(join(SRC_TAURI, "tauri.conf.json"), "utf8"),
).version;

/**
 * Stage the Tauri `externalBin`: Node itself on Windows, or the Rust loader
 * on Unix. Needed even for `tauri dev`, which checks the sidecar exists.
 */
function stageShim(triple) {
  // Killing a forwarding shim on Windows would leave its Node child running.
  // Launch Node directly so Tauri owns the server process it needs to stop.
  if (process.platform === "win32") {
    const dest = join(BIN_DIR, `helios-node-${triple}${EXE}`);
    mkdirSync(BIN_DIR, { recursive: true });
    copyFileSync(process.execPath, dest);
    return dest;
  }
  const manifest = join(SRC_TAURI, "loader", "Cargo.toml");
  console.log("[desktop] building sidecar shim (helios-node)…");
  run("cargo", ["build", "--release", "--manifest-path", manifest]);
  const src = join(SRC_TAURI, "loader", "target", "release", `helios-node${EXE}`);
  const dest = join(BIN_DIR, `helios-node-${triple}${EXE}`);
  mkdirSync(BIN_DIR, { recursive: true });
  copyFileSync(src, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);
  return dest;
}

if (process.argv.includes("--dev")) {
  console.log("[desktop] dev mode — run `next dev` yourself (pnpm desktop:dev does both)");
  stageShim(targetTriple());
  process.exit(0);
}

const nodeMajor = Number(process.version.slice(1).split(".")[0]);
if (nodeMajor < 22) {
  throw new Error(
    `desktop build needs Node >= 22 (running ${process.version}) — the bundled server uses node:sqlite. Try \`nvm use 22\`.`,
  );
}

function run(cmd, args, env = {}, cwd = ROOT) {
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    // npm is a command shim on Windows. Other executables must bypass the
    // shell so paths with spaces are passed as single arguments.
    shell: process.platform === "win32" && cmd === "npm",
  });
}

/** Rust target triple used to name the sidecar binary (Tauri convention). */
function targetTriple() {
  try {
    const out = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
    const m = out.match(/host:\s*(\S+)/);
    if (m) return m[1];
  } catch {
    /* rustc not on PATH — fall back to a platform guess */
  }
  const map = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const key = `${process.platform}-${process.arch}`;
  if (!map[key]) throw new Error(`unsupported platform for desktop build: ${key}`);
  return map[key];
}

// Clear last run's staging *before* the build — otherwise the file tracer sweeps
// the previous ~900 MB server tree into .next/standalone/src-tauri and each build
// compounds. (next.config.ts also excludes src-tauri from tracing.)
rmSync(STAGE, { recursive: true, force: true });
rmSync(BIN_DIR, { recursive: true, force: true });
rmSync(join(ROOT, ".next", "standalone"), { recursive: true, force: true });

console.log("[desktop] next build (standalone)…");
run("node", [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
  DESKTOP_BUILD: "1",
  // Baked into the client bundle — NEXT_PUBLIC_* vars can't be set at runtime
  // by the Tauri shell.
  NEXT_PUBLIC_APP_VERSION: APP_VERSION,
});

const STANDALONE = join(ROOT, ".next", "standalone");
if (!existsSync(join(STANDALONE, "server.js"))) {
  throw new Error(".next/standalone/server.js missing — is `output: \"standalone\"` active?");
}

console.log("[desktop] staging server →", STAGE);
cpSync(STANDALONE, STAGE, { recursive: true });
rmSync(join(STAGE, "src-tauri"), { recursive: true, force: true }); // never nest ourselves
cpSync(join(ROOT, ".next", "static"), join(STAGE, ".next", "static"), { recursive: true });
copyFileSync(join(ROOT, "scripts", "desktop", "sidecar-guard.js"), join(STAGE, "sidecar-guard.js"));
if (existsSync(join(ROOT, "public"))) {
  cpSync(join(ROOT, "public"), join(STAGE, "public"), {
    recursive: true,
    filter: (src) => !src.includes(`${sep}public${sep}generated`), // runtime data, not an asset
  });
}

// The Next.js file tracer (nft) is unreliable with pnpm's symlinked store — it
// leaves many packages as a bare package.json. Rather than chase truncations,
// throw away the traced node_modules and do a clean production install from the
// app's own manifest, giving a flat, symlink-free, self-contained tree.
// nft is unreliable with pnpm (leaves packages truncated), so install the prod
// tree cleanly with npm instead. The repo is pnpm-managed with a stale
// package-lock.json, and `next build` output is tied to the EXACT `next` version
// that produced it — so pin every prod dep to the version actually installed in
// the repo before installing, rather than letting npm re-resolve `^` ranges.
console.log("[desktop] clean production install into stage…");
rmSync(join(STAGE, "node_modules"), { recursive: true, force: true });

const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const pinned = {};
for (const name of Object.keys(rootPkg.dependencies ?? {})) {
  try {
    const v = JSON.parse(
      readFileSync(join(ROOT, "node_modules", ...name.split("/"), "package.json"), "utf8"),
    ).version;
    pinned[name] = v;
  } catch {
    pinned[name] = rootPkg.dependencies[name]; // fall back to the range
  }
}
writeFileSync(
  join(STAGE, "package.json"),
  JSON.stringify({ ...rootPkg, dependencies: pinned, devDependencies: {} }, null, 2),
);
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], {}, STAGE);

// Sanity check: the standalone server's own entry deps must be intact.
for (const probe of ["next/package.json", "@next/env/package.json", "react/package.json"]) {
  if (!existsSync(join(STAGE, "node_modules", ...probe.split("/")))) {
    throw new Error(`staged install is missing ${probe}`);
  }
}

// Prune what a prebuilt standalone server never loads at runtime:
//  - @next/swc-* : the SWC compiler, build-time only (~95 MB)
//  - sharp/@img native packages for other platforms (~15 MB)
const platformTriple = `${process.platform}-${process.arch}`; // e.g. darwin-arm64
const nmScoped = (scope) => join(STAGE, "node_modules", scope);
for (const [dir, keepIf] of [
  [nmScoped("@next"), (n) => !n.startsWith("swc-")],
  [nmScoped("@img"), (n) => n.includes(platformTriple) || !/-(darwin|linux|linuxmusl|win32|wasm32)/.test(n)],
]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (!keepIf(name)) rmSync(join(dir, name), { recursive: true, force: true });
  }
}

const triple = targetTriple();

// On Unix, the loader execs this separate resource (and hides the macOS Dock
// tile). Windows runs Node directly as the sidecar, so needs no second copy.
const nodeDest = join(STAGE, "node-bin", `node${EXE}`);
if (process.platform !== "win32") {
  mkdirSync(dirname(nodeDest), { recursive: true });
  console.log(`[desktop] bundling node runtime → ${nodeDest}`);
  copyFileSync(portableNodeBinary(), nodeDest);
  chmodSync(nodeDest, 0o755);
}

stageShim(triple);

/**
 * `process.execPath` is only safe to bundle if it's a self-contained binary.
 * Homebrew's node splits off `libnode.*.dylib`, which would break outside this
 * machine — detect that and fall back to a cached official nodejs.org build.
 */
function portableNodeBinary() {
  const exe = process.execPath;
  if (process.platform === "darwin") {
    try {
      const libs = execFileSync("otool", ["-L", exe], { encoding: "utf8" });
      if (!/libnode\.\S+\.dylib/.test(libs)) return exe; // static — good
    } catch {
      return exe;
    }
    console.log("[desktop] running under a non-portable node — fetching official build");
  } else {
    return exe;
  }

  const ver = process.version; // e.g. v22.23.2
  const arch = process.arch === "x64" ? "x64" : process.arch; // arm64 stays arm64
  const name = `node-${ver}-darwin-${arch}`;
  const cacheDir = join(SRC_TAURI, ".node-cache");
  const cached = join(cacheDir, name, "bin", "node");
  if (!existsSync(cached)) {
    mkdirSync(cacheDir, { recursive: true });
    const tgz = join(cacheDir, `${name}.tar.gz`);
    run("curl", ["-fsSL", "-o", tgz, `https://nodejs.org/dist/${ver}/${name}.tar.gz`]);
    run("tar", ["-xzf", tgz, "-C", cacheDir, `${name}/bin/node`]);
  }
  return cached;
}

// Tauri signs the app shell + the sidecar shim but not Mach-O buried in
// resources — the Node runtime itself and sharp's .node / .dylib. Sign those
// now, inside-out, so notarization passes. Node runs V8 (JIT), so it needs the
// same entitlements as the shim. Skipped unless APPLE_SIGNING_IDENTITY is set.
if (process.platform === "darwin" && process.env.APPLE_SIGNING_IDENTITY) {
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  const ents = join(SRC_TAURI, "entitlements.plist");
  const macho = execFileSync(
    "sh",
    ["-c", `find '${STAGE}/node_modules' -type f \\( -name '*.node' -o -name '*.dylib' -o -name '*.so' \\)`],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  macho.push(nodeDest); // the bundled Node runtime
  console.log(`[desktop] codesigning ${macho.length} Mach-O files…`);
  for (const f of macho) {
    run("codesign", [
      "--force", "--timestamp", "--options", "runtime",
      "--entitlements", ents, "-s", identity, f,
    ]);
  }
}

console.log("[desktop] done.");
