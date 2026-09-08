"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkflowStore, Space } from "./store";
import { SYNC_NOW_EVENT, requestWorkflowSync } from "./workflowSyncBus";

const DEBOUNCE_MS  = 1_500; // continuous edits (drag frames, typing): coalesce
const IMMEDIATE_MS = 250;   // discrete edits (add/delete/connect/resize-end): near-instant, still coalesces a burst

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export { requestWorkflowSync };

export function useSpaceSync() {
  const spaces          = useWorkflowStore((s) => s.spaces);
  const loadSpacesFromDB = useWorkflowStore((s) => s.loadSpacesFromDB);

  const [status,       setStatus]       = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  // Block all writes until localStorage has fully rehydrated. In Zustand v5,
  // persist rehydration is async — if we save before it completes, we'd write
  // the default empty state and delete all real spaces.
  const [hydrated, setHydrated] = useState(
    () => typeof window !== "undefined" && (useWorkflowStore.persist?.hasHydrated() ?? false)
  );

  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedRef  = useRef<number>(0); // epoch ms of last successful save
  // True when there's an edit that hasn't been flushed to the DB yet. The
  // debounce only writes 1.5s after the last change, so a quick reload / app
  // quit right after (e.g. a node resize) would otherwise lose it — the
  // pagehide/visibilitychange handler below flushes it immediately.
  const dirtyRef       = useRef(false);
  // Set by requestWorkflowSync(); makes the next debounce-arm use IMMEDIATE_MS.
  const immediateRef   = useRef(false);
  // updatedAt of each space as last written to the DB. Lets `save` send only
  // the spaces that changed since (previously every edit re-sent every space).
  const savedStampRef  = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (hydrated) return;
    // If hydration already finished before this effect ran (common in Next.js
    // where SSR renders hasHydrated()=false but client is already hydrated)
    if (useWorkflowStore.persist?.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useWorkflowStore.persist?.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, [hydrated]);

  // ── Load from DB on mount (after hydration) ──────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const res = await fetch("/api/workflows");
        if (!res.ok) return;
        const { spaces: dbSpaces } = (await res.json()) as { spaces: Space[] };
        if (!dbSpaces?.length) return;
        loadSpacesFromDB(dbSpaces);
        savedStampRef.current = new Map(
          useWorkflowStore.getState().spaces.map((sp) => [sp.id, sp.updatedAt ?? sp.createdAt ?? 0]),
        );
        const now = new Date();
        lastSyncedRef.current = now.getTime();
        setLastSyncedAt(now);
        setStatus("synced");
      } catch {
        /* keep local state */
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]); // run once after hydration

  // ── Core save (no rate-limit checks) ────────────────────────────────────────
  // `keepalive` lets the request outlive the page during an unload/pagehide
  // flush (capped at ~64KB of body by the browser — fine for the stripped
  // spaces payload; a normal fetch is used for the regular debounced path).
  const save = useCallback(async ({ keepalive = false }: { keepalive?: boolean } = {}) => {
    dirtyRef.current = false;
    immediateRef.current = false;
    setStatus("syncing");
    try {
      const all = useWorkflowStore.getState().spaces.filter((sp) => sp.nodes.length > 0);
      const stamps = savedStampRef.current;
      const stamp = (sp: Space) => sp.updatedAt ?? sp.createdAt ?? 0;
      // A space we saved before is gone → full save so the server drops it too.
      const deleted = [...stamps.keys()].some((id) => !all.some((sp) => sp.id === id));
      const partial = !deleted && stamps.size > 0;
      const spacesToSave = partial ? all.filter((sp) => stamps.get(sp.id) !== stamp(sp)) : all;
      if (spacesToSave.length > 0 || !partial) {
        const res = await fetch("/api/workflows", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          keepalive,
          body: JSON.stringify({
            partial,
            spaces: spacesToSave.map((sp) => ({
              ...sp,
              nodes: sp.nodes.map((n) => ({ ...n, data: { ...n.data, inputImage: undefined } })),
            })),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
      }
      savedStampRef.current = new Map(all.map((sp) => [sp.id, stamp(sp)]));
      const now = new Date();
      lastSyncedRef.current = now.getTime();
      setLastSyncedAt(now);
      setStatus("synced");
    } catch {
      dirtyRef.current = true;
      setStatus("error");
    }
  }, []);

  // ── Immediate sync (bypasses debounce + rate-limit) ──────────────────────────
  const syncNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    save();
  }, [save]);

  // ── Debounced sync ─────────────────────────────────────────────────────────
  // IMMEDIATE_MS (~instant) after a discrete edit, else DEBOUNCE_MS.
  const syncDebounced = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // `immediateRef` stays sticky until `save` runs, so churn right after a
    // discrete edit (e.g. React Flow auto-measuring a just-added node) can't
    // bump the pending write back out to the full debounce.
    const delay = immediateRef.current ? IMMEDIATE_MS : DEBOUNCE_MS;
    timerRef.current = setTimeout(save, delay);
  }, [save]);

  useEffect(() => {
    if (!hydrated) return;
    dirtyRef.current = true;
    syncDebounced();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [spaces, syncDebounced, hydrated]);

  // ── Flush a pending edit early instead of waiting out the debounce ──────────
  //  • discrete edits (requestWorkflowSync): drop/delete a node, finish a
  //    resize, connect an edge — the next debounce-arm uses IMMEDIATE_MS
  //  • page teardown: resize/edit then immediately reload or quit the app —
  //    `pagehide` fires on reload, navigation and tab/app close; a hidden
  //    `visibilitychange` catches app backgrounding while the page is alive
  useEffect(() => {
    if (!hydrated) return;
    const flush = (keepalive: boolean) => {
      if (!dirtyRef.current) return;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      save({ keepalive });
    };
    // Fires synchronously right after a store mutation — before the [spaces]
    // effect re-arms the debounce — so just flag it; that effect then arms a
    // short timer. Also arm one here in case no [spaces] change follows.
    const onSyncNow = () => {
      immediateRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(save, IMMEDIATE_MS);
    };
    const onPageHide = () => flush(true);
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(false); };
    window.addEventListener(SYNC_NOW_EVENT, onSyncNow);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener(SYNC_NOW_EVENT, onSyncNow);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrated, save]);

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
