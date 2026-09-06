/** Best-effort content-type detection for prompt text, used to auto-switch a
 * text node's JSON/YAML mode when pasted content is clearly structured data.
 * Deliberately conservative — plain prose (even with an occasional "label:")
 * should stay "text" rather than flip into a formatting mode on its own. */
export function detectTextMode(text: string): "text" | "json" | "yaml" {
  const trimmed = text.trim();
  if (!trimmed) return "text";

  // JSON: only a clearly object/array-shaped, fully-parseable document counts —
  // a bare quoted string or number pasted as plain text shouldn't reclassify.
  if (/^[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // fall through to the YAML check
    }
  }

  // YAML: an explicit document marker, or most non-empty lines reading as
  // "key: value" / "- item" — require more than one such line so a single
  // sentence with a colon in it ("Note: check this") doesn't count.
  if (/^---\s*$/m.test(trimmed)) return "yaml";
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const yamlLine = /^(-\s|[\w.\-/]+\s*:(\s|$))/;
    const matches = lines.filter((l) => yamlLine.test(l)).length;
    if (matches / lines.length >= 0.6) return "yaml";
  }

  return "text";
}
