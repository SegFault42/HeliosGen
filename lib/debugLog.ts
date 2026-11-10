/** Verbose server logging, on only with ANVIL_DEBUG=1 (request bodies, raw provider responses). */
export const DEBUG = process.env.ANVIL_DEBUG === "1";
export function dlog(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}
