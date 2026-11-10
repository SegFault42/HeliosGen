// Pure decisions for canvas copy/paste. Nodes travel through the native
// clipboard event under a custom MIME type, never as text/plain, so nothing
// special ever leaks into text fields or other apps.
export const NODES_MIME = "application/x-anvil-nodes";

/** Copy handler takes over only when the user is not copying text. */
export function shouldHandleCopy(o: { typing: boolean; hasTextSelection: boolean; hasSelectedNodes: boolean }): boolean {
  return !o.typing && !o.hasTextSelection && o.hasSelectedNodes;
}

export type PasteIntent = "nodes" | "text" | "none";

export function resolvePasteIntent(o: { types: readonly string[]; text: string; hasNodes: boolean }): PasteIntent {
  if (o.hasNodes && o.types.includes(NODES_MIME)) return "nodes";
  if (o.text.trim()) return "text";
  return "none";
}
