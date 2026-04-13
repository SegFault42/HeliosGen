"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkflowStore, Space } from "./store";
import { createClient } from "./supabase/client";

const DEBOUNCE_MS  = 10_000; // wait 10s of inactivity before syncing
const MIN_INTERVAL = 60_000; // never sync more than once per 60s

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export function useSpaceSync() {
  const spaces          = useWorkflowStore((s) => s.spaces);
  const loadSpacesFromDB = useWorkflowStore((s) => s.loadSpacesFromDB);

  const [status,       setStatus]       = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedRef  = useRef<number>(0); // epoch ms of last successful save
  const spacesRef      = useRef(spaces);
  spacesRef.current    = spaces;

  // ── Load from DB on mount ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from("spaces")
        .select("id, name, data, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });

      if (error || !data?.length) return;

      const dbSpaces: Space[] = data.map((row) => ({
        id:           row.id,
        name:         row.name,
        nodes:        row.data?.nodes        ?? [],
        edges:        row.data?.edges        ?? [],
        nodeCounters: row.data?.nodeCounters ?? {},
        createdAt:    row.data?.createdAt    ?? Date.parse(row.created_at),
      }));

      loadSpacesFromDB(dbSpaces);
      const now = new Date();
      lastSyncedRef.current = now.getTime();
      setLastSyncedAt(now);
      setStatus("synced");
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ── Core save (no rate-limit checks) ────────────────────────────────────────
  const save = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setStatus("syncing");
    try {
      const rows = spacesRef.current.map((sp) => ({
        id:      sp.id,
        user_id: session.user.id,
        name:    sp.name,
        data:    {
          nodes: sp.nodes.map((n) => ({
            ...n,
            data: { ...n.data, inputImage: undefined },
          })),
          edges:        sp.edges,
          nodeCounters: sp.nodeCounters,
          createdAt:    sp.createdAt,
        },
      }));

      const { error } = await supabase
        .from("spaces")
        .upsert(rows, { onConflict: "id" });

      if (error) throw error;

      // Remove any DB rows that no longer exist locally
      const currentIds = spacesRef.current.map((sp) => sp.id);
      await supabase
        .from("spaces")
        .delete()
        .eq("user_id", session.user.id)
        .not("id", "in", `(${currentIds.join(",")})`);

      const now = new Date();
      lastSyncedRef.current = now.getTime();
      setLastSyncedAt(now);
      setStatus("synced");
    } catch {
      setStatus("error");
    }
  }, []);

  // ── Immediate sync (bypasses debounce + rate-limit) ──────────────────────────
  const syncNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    save();
  }, [save]);

  // ── Debounced + rate-limited sync for regular edits ──────────────────────────
  const syncDebounced = useCallback(() => {
    if (Date.now() - lastSyncedRef.current < MIN_INTERVAL) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, DEBOUNCE_MS);
  }, [save]);

  useEffect(() => {
    syncDebounced();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [spaces, syncDebounced]);

  return { status, lastSyncedAt, syncNow };
}

// ── Time-ago helper ───────────────────────────────────────────────────────────

export function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 10)  return "just now";
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
