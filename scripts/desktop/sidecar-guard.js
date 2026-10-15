// Preloaded before the Next.js server (node -r) in the packaged desktop app.
//
// If the Tauri shell that spawned us dies without killing us (a crash, a
// force-quit, SIGKILL), macOS reparents this process to launchd (pid 1). Watch
// for that and exit, so we don't leave an orphaned server holding the port.
//
// Windows never reparents, and there Node is a child of the shim rather than
// exec'd in its place, so killing the shim leaves us running. The Tauri shell
// passes its own pid in HELIOS_APP_PID; exit once that process is gone too.
const parentAtStart = process.ppid;
const appPid = Number(process.env.HELIOS_APP_PID) || 0;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists, just not ours to signal
  }
}

setInterval(() => {
  if (process.ppid !== parentAtStart || process.ppid === 1 || (appPid && !isAlive(appPid))) {
    console.error("[sidecar-guard] parent process gone — shutting down");
    process.exit(0);
  }
}, 2000).unref();
