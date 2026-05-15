"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkflowStore, Space } from "./store";
import { createClient } from "./supabase/client";

const DEBOUNCE_MS = 1_500; // wait 1.5s of inactivity before syncing

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export function useSpaceSync() {
  const spaces          = useWorkflowStore((s) => s.spaces);
  const loadSpacesFromDB = useWorkflowStore((s) => s.loadSpacesFromDB);

  const [status,       setStatus]       = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  // Block all Supabase writes until localStorage has fully rehydrated.
  // In Zustand v5, persist rehydration is async — if we save before it
  // completes, we'd write the default empty state and delete all real spaces.
  const [hydrated, setHydrated] = useState(
    () => useWorkflowStore.persist.hasHydrated()
  );

  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedRef  = useRef<number>(0); // epoch ms of last successful save
  const spacesRef      = useRef(spaces);
  spacesRef.current    = spaces;

  useEffect(() => {
    if (hydrated) return;
    // If hydration already finished before this effect ran (common in Next.js
    // where SSR renders hasHydrated()=false but client is already hydrated)
    if (useWorkflowStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkflowStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, [hydrated]);

  // ── Load from DB on mount (after hydration) ──────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from("spaces")
        .select("id, name, data, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });

      console.log("[SpaceSync] DB load:", { error, rows: data?.length, data, session: session.user.id });
      if (error || !data?.length) return;

      const dbSpaces: Space[] = data.map((row) => ({
        id:           row.id,
        name:         row.name,
        nodes:        row.data?.nodes        ?? [],
        edges:        row.data?.edges        ?? [],
        nodeCounters: row.data?.nodeCounters ?? {},
        viewport:     row.data?.viewport,
        createdAt:    row.data?.createdAt    ?? Date.parse(row.created_at),
        updatedAt:    row.data?.updatedAt    ?? row.data?.createdAt ?? Date.parse(row.created_at),
      }));

      loadSpacesFromDB(dbSpaces);
      const now = new Date();
      lastSyncedRef.current = now.getTime();
      setLastSyncedAt(now);
      setStatus("synced");
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]); // run once after hydration

  // ── Core save (no rate-limit checks) ────────────────────────────────────────
  const save = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setStatus("syncing");
    try {
      // Only persist spaces that have at least one node
      const spacesToSave = spacesRef.current.filter((sp) => sp.nodes.length > 0);

      if (spacesToSave.length > 0) {
        const rows = spacesToSave.map((sp) => ({
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
            viewport:     sp.viewport,
            createdAt:    sp.createdAt,
            updatedAt:    sp.updatedAt ?? sp.createdAt,
          },
        }));

        const { error } = await supabase
          .from("spaces")
          .upsert(rows, { onConflict: "id" });

        if (error) throw error;
      }

      // Only count non-empty spaces as "existing" — empty ones are local-only
      const currentIds = spacesToSave.map((sp) => sp.id);
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

  // ── Debounced sync — fires 1.5s after the last change ────────────────────────
  const syncDebounced = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, DEBOUNCE_MS);
  }, [save]);

  useEffect(() => {
    if (!hydrated) return;
    syncDebounced();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [spaces, syncDebounced, hydrated]);

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
