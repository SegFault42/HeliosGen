// Pure helpers for VideoGeneratorNode (kept free of React so node --test can load them).

/** Server deadlines: Flow 20 min, HeyGen 30 min (heygenPollPolicy) plus last iteration and mirror. Give up client-side only after 36. */
export const VIDEO_JOB_DEADLINE_MS = 36 * 60 * 1000;

/** Only Kie-backed models need the Kie key; Flow and HeyGen do not. */
export function needsKieKey(provider: string | undefined): boolean {
  return provider !== "Google Flow" && provider !== "HeyGen";
}

/** Flow/HeyGen failures do not refund Kie credits, so the badge must not claim it. */
export function showsCreditsRefunded(provider: string | undefined): boolean {
  return needsKieKey(provider);
}

/** First blob:/data: URL (upload still running or failed), else undefined. */
export function findLocalFrameUrl(urls: (string | undefined)[]): string | undefined {
  return urls.find((u) => typeof u === "string" && (u.startsWith("blob:") || u.startsWith("data:")));
}

/** A submit marker older than this (or missing) with no taskId means the POST was lost (reload/remount). */
export const SUBMIT_STALE_MS = 3 * 60 * 1000;
export function isStaleSubmit(pendingSubmitAt: number | undefined, now: number): boolean {
  return pendingSubmitAt === undefined || now - pendingSubmitAt > SUBMIT_STALE_MS;
}

/** Drops `null` placeholders (in-flight slots) from generations/meta and recomputes the current index. */
export function dropNullGenerations<G, M>(rawGens: (G | null)[], rawMeta: (M | null)[]) {
  const generations = rawGens.filter((g): g is G => g !== null);
  const generationsMeta = rawMeta.filter((_, i) => rawGens[i] !== null);
  const currentGenIdx = Math.max(0, generations.length - 1);
  return { generations, generationsMeta, currentGenIdx, lastEntry: generations[currentGenIdx] as G | undefined };
}
