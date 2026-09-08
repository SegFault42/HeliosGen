import { db } from "./sqlite";

/**
 * Local persistence for workflow "spaces" (node canvases). SQLite-backed
 * (see ./sqlite).
 */
export interface GuestSpace {
  id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  nodeCounters: Record<string, number>;
  createdAt: number;
  updatedAt?: number;
  viewport?: { x: number; y: number; zoom: number };
}

export function getSpaces(): GuestSpace[] {
  const rows = db().prepare("SELECT data FROM spaces ORDER BY updated_at ASC").all() as {
    data: string;
  }[];
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.data) as GuestSpace;
      } catch {
        return null;
      }
    })
    .filter((s): s is GuestSpace => s !== null);
}

/**
 * `partial: true` upserts only the given spaces and leaves the rest alone —
 * the client sends just the spaces that changed. A full save (default) also
 * deletes every space not in the list, which is how deletions propagate.
 */
export function saveSpaces(spaces: GuestSpace[], opts: { partial?: boolean } = {}): void {
  const d = db();
  d.exec("BEGIN");
  const keep = new Set(spaces.map((s) => s.id));
  const upsert = d.prepare(`
    INSERT INTO spaces (id, name, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at
  `);
  for (const s of spaces) {
    upsert.run(s.id, s.name ?? "Untitled", JSON.stringify(s), Number(s.updatedAt ?? s.createdAt ?? Date.now()));
  }
  if (!opts.partial) {
    const existing = d.prepare("SELECT id FROM spaces").all() as { id: string }[];
    const del = d.prepare("DELETE FROM spaces WHERE id = ?");
    for (const { id } of existing) if (!keep.has(id)) del.run(id);
  }
  d.exec("COMMIT");
}
