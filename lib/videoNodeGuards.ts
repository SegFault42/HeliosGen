// Pure helpers for VideoGeneratorNode (kept free of React so node --test can load them).

/** Flow renders to 20 min server-side, HeyGen up to ~22 min: give up client-side only after 25. */
export const VIDEO_JOB_DEADLINE_MS = 25 * 60 * 1000;

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
