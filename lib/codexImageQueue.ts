// One slot per server process, including development module reloads. Jobs retain
// their own result; a rejected job must not poison the FIFO tail.
const state = globalThis as typeof globalThis & { heliosCodexImageTail?: Promise<void> };

export function enqueueCodexImage<T>(work: () => Promise<T>): Promise<T> {
  const result = (state.heliosCodexImageTail ?? Promise.resolve()).then(work);
  state.heliosCodexImageTail = result.then(() => {}, () => {});
  return result;
}
