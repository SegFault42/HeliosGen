import { EventEmitter } from "events";

// In-process event bus: callback route emits, job-stream route listens.
// Next bundles each route separately, so a plain module-level emitter would be
// one copy per route; pin it on globalThis (same pattern as flowJobPoller).
const EVENTS_KEY = Symbol.for("heliosgen.job-events");
type G = typeof globalThis & { [EVENTS_KEY]?: EventEmitter };
const g = globalThis as G;
const jobEvents = (g[EVENTS_KEY] ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(500);
  return e;
})());

// Longest provider budget: Flow video 20 min, HeyGen 30 min (heygenPollPolicy); stream outlives both.
const JOB_STREAM_BUDGET_MS = 36 * 60 * 1000;

export { jobEvents, JOB_STREAM_BUDGET_MS };
