import { VIDEO_MODELS } from "./modelConfig";

/**
 * Flow will not edit an uploaded video until the account owner declares the
 * rights to use it (its "Rights to use this video" dialog). The app never
 * answers that for the user: the declaration is an explicit switch in the UI,
 * and it is stored against the exact clip(s) it was made for, so attaching a
 * different video asks again instead of inheriting an earlier yes.
 */

/** True when this model and these inputs need the declaration. */
export function needsVideoRights(videoModel: string, referenceVideoUrls: readonly string[]): boolean {
  const config = VIDEO_MODELS.find((m) => m.id === videoModel);
  return !!config && "useFlow" in config.apiInput && config.apiInput.useFlow === true && referenceVideoUrls.length > 0;
}

/** What a declaration is stored against. */
export function videoRightsKey(referenceVideoUrls: readonly string[]): string {
  return referenceVideoUrls.join("\n");
}

/** True when `affirmedFor` is a declaration made for exactly these clips. */
export function videoRightsAffirmed(affirmedFor: unknown, referenceVideoUrls: readonly string[]): boolean {
  return referenceVideoUrls.length > 0 && affirmedFor === videoRightsKey(referenceVideoUrls);
}
