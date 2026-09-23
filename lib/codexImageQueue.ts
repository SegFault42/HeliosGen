import { spawn } from "node:child_process";

// One slot per server process, including development module reloads. Jobs retain
// their own result; a rejected job must not poison the FIFO tail.
const state = globalThis as typeof globalThis & { heliosCodexImageTail?: Promise<void> };

export function enqueueCodexImage<T>(work: () => Promise<T>): Promise<T> {
  const result = (state.heliosCodexImageTail ?? Promise.resolve()).then(work);
  state.heliosCodexImageTail = result.then(() => {}, () => {});
  return result;
}

export function runCodexImageCommand(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    let err = "";
    let timedOut = false;
    let spawnError: Error | undefined;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const proc = spawn("codex-imagegen", args, { stdio: ["ignore", "ignore", "pipe"] });
    const deadline = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      forceKill = setTimeout(() => proc.kill("SIGKILL"), 2_000);
    }, 10 * 60_000);
    proc.stderr.on("data", (d: Buffer) => err += d.toString());
    proc.on("error", (e) => { spawnError = e; });
    // Settle only after close, never release the slot with the old CLI alive.
    proc.on("close", (code) => {
      clearTimeout(deadline);
      clearTimeout(forceKill);
      if (timedOut) reject(new Error("Codex image generation timed out after 10 minutes."));
      else if (spawnError) reject(new Error(`codex-imagegen spawn failed: ${spawnError.message} — is it installed and on PATH?`));
      else resolve({ exitCode: code ?? -1, stderr: err });
    });
  });
}
