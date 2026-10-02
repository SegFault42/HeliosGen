export const FLOW_IMAGE_DEADLINE_MS = 5 * 60_000;
export const FLOW_VIDEO_DEADLINE_MS = 20 * 60_000;

const FATAL_CODES = new Set([
  "generated_asset_not_found",
  "job_asset_identity_missing",
  "ui_changed",
  "login_required",
  "download_failed",
  "download_type_mismatch",
  "generation_failed",
]);

export function flowDeadlineMs(isVideo: boolean): number {
  return isVideo ? FLOW_VIDEO_DEADLINE_MS : FLOW_IMAGE_DEADLINE_MS;
}

export function isFatalFlowError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && FATAL_CODES.has(code);
}

export function flowErrorMessage(error: string, screenshot?: string): string {
  return screenshot ? `${error} (screenshot: ${screenshot})` : error;
}
