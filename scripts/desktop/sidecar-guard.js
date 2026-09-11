// Preloaded before the Next.js server (node -r) in the packaged desktop app.
//
// If the Tauri shell that spawned us dies without killing us (a crash, a
// force-quit, SIGKILL), macOS reparents this process to launchd (pid 1). Watch
// for that and exit, so we don't leave an orphaned server holding the port.
const parentAtStart = process.ppid;

setInterval(() => {
  let parentGone = process.ppid !== parentAtStart || process.ppid === 1;
  // Windows retains the original parent PID after exit instead of reparenting.
  if (!parentGone && process.platform === "win32") {
    try {
      process.kill(parentAtStart, 0);
    } catch (error) {
      parentGone = error.code === "ESRCH";
    }
  }
  if (parentGone) {
    console.error("[sidecar-guard] parent process gone — shutting down");
    process.exit(0);
  }
}, 2000).unref();
