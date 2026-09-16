// Preloaded before the Next.js server (node -r) in the packaged desktop app.
//
// If the Tauri shell that spawned us dies without killing us (a crash, a
// force-quit, SIGKILL), macOS reparents this process to launchd (pid 1). Watch
// for that and exit, so we don't leave an orphaned server holding the port.
// Windows never reparents, so there we probe the processes directly: the
// parent (the helios-node shim, which Tauri kills on a clean exit) and the
// Tauri app itself (HELIOS_APP_PID), which covers a crash or force-kill that
// leaves the shim running.
const parentAtStart = process.ppid;
const appPid = Number(process.env.HELIOS_APP_PID) || null;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

setInterval(() => {
  if (
    process.ppid !== parentAtStart ||
    process.ppid === 1 ||
    !alive(parentAtStart) ||
    (appPid && !alive(appPid))
  ) {
    console.error("[sidecar-guard] parent process gone — shutting down");
    process.exit(0);
  }
}, 2000).unref();
