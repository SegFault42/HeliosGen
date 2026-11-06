// Runs `tauri build` with CI=true (keeps the Tauri CLI non-interactive).
//
// This exists because `CI=true tauri build` is a POSIX shell idiom: npm runs
// package scripts through cmd.exe on Windows, where that line fails with
// "'CI' is not recognized as an internal or external command". Setting the
// variable here keeps one `desktop:build` script working on every platform.
//
// Extra arguments are forwarded, so `npm run desktop:build -- --verbose` works.

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

execFileSync("tauri", ["build", ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, CI: "true" },
  // npm puts node_modules/.bin on PATH; on Windows the entry is tauri.cmd,
  // which needs a shell to be executable.
  shell: process.platform === "win32",
});
