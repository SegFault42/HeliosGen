/**
 * Parse a single HTTP `Range: bytes=...` header against a resource of `size`
 * bytes. Returns the inclusive byte span to serve, "unsatisfiable" when the
 * range lies outside the resource (answer 416), or null when there is no
 * usable range (answer 200 with the whole body). Multi-range requests are
 * treated as no range, which the spec allows.
 */
export function parseByteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;

  if (m[1] === "") {
    // suffix form: the last N bytes
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
