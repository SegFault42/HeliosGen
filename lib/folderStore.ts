import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  orderIndex: number;
  createdAt: string;
}

interface FolderState {
  folders: Folder[];
  selectedFolderId: string | null;
  itemFolderMap: Record<string, string[]>;

  loadFromServer: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<Folder>;
  deleteFolder: (id: string) => Promise<void>;
  updateFolder: (id: string, updates: Partial<Pick<Folder, "name">>) => Promise<void>;
  moveFolder: (id: string, newParentId: string | null, newOrderIndex: number) => Promise<void>;
  reorderFolder: (id: string, newOrderIndex: number) => void;
  selectFolder: (id: string | null) => void;
  assignItemsToFolder: (itemIds: string[], folderId: string) => Promise<void>;
  removeItemsFromFolder: (itemIds: string[], folderId: string) => Promise<void>;
  folderItemCount: (folderId: string) => number;
  galleryImageCount: number;
  galleryVideoCount: number;
  setGalleryCount: (tab: "images" | "videos", count: number) => void;
}

async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (process.env.NEXT_PUBLIC_GUEST_MODE === "true") return "guest";
  const { createClient } = await import("./supabase/client");
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token ?? null;
}

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };
  return fetch(url, { ...options, headers });
}

export const useFolderStore = create<FolderState>()(
  persist(
    (set, get) => ({
      folders: [],
      selectedFolderId: null,
      itemFolderMap: {},

      loadFromServer: async () => {
        try {
          const res = await apiFetch("/api/folders");
          if (!res.ok) return;
          const data = await res.json() as {
            folders: Array<{
              id: string; name: string; parent_id: string | null;
              order_index: number; created_at: string;
            }>;
            folderItems: Array<{ folder_id: string; item_id: string }>;
          };

          const folders: Folder[] = (data.folders ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            parentId: f.parent_id,
            orderIndex: f.order_index,
            createdAt: f.created_at,
          }));

          const itemFolderMap: Record<string, string[]> = {};
          for (const fi of data.folderItems ?? []) {
            if (!itemFolderMap[fi.item_id]) itemFolderMap[fi.item_id] = [];
            if (!itemFolderMap[fi.item_id].includes(fi.folder_id)) {
              itemFolderMap[fi.item_id].push(fi.folder_id);
            }
          }

          set({ folders, itemFolderMap });
        } catch {
          // silently ignore network errors
        }
      },

      createFolder: async (name, parentId = null) => {
        // Compute orderIndex: one more than the max sibling's orderIndex
        const siblings = get().folders.filter((f) => f.parentId === (parentId ?? null));
        const orderIndex = siblings.length > 0
          ? Math.max(...siblings.map((f) => f.orderIndex)) + 1
          : 0;

        const optimistic: Folder = {
          id: typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2),
          name,
          parentId: parentId ?? null,
          orderIndex,
          createdAt: new Date().toISOString(),
        };

        // Optimistic update
        set((s) => ({ folders: [...s.folders, optimistic] }));

        try {
          const res = await apiFetch("/api/folders", {
            method: "POST",
            body: JSON.stringify({ name, parentId: parentId ?? null, orderIndex }),
          });
          if (res.ok) {
            const { folder: serverFolder } = await res.json() as {
              folder: { id: string; name: string; parent_id: string | null; order_index: number; created_at: string };
            };
            const real: Folder = {
              id: serverFolder.id,
              name: serverFolder.name,
              parentId: serverFolder.parent_id,
              orderIndex: serverFolder.order_index,
              createdAt: serverFolder.created_at,
            };
            // Replace optimistic entry with server one
            set((s) => ({
              folders: s.folders.map((f) => (f.id === optimistic.id ? real : f)),
              // Also fix itemFolderMap keys if anything referenced the optimistic id
              itemFolderMap: Object.fromEntries(
                Object.entries(s.itemFolderMap).map(([itemId, fids]) => [
                  itemId,
                  fids.map((fid) => (fid === optimistic.id ? real.id : fid)),
                ]),
              ),
            }));
            return real;
          }
        } catch {
          // keep optimistic on network error
        }
        return optimistic;
      },

      deleteFolder: async (id) => {
        // Optimistic
        set((s) => {
          const next: Record<string, string[]> = {};
          for (const [itemId, folderIds] of Object.entries(s.itemFolderMap)) {
            const filtered = folderIds.filter((fid) => fid !== id);
            if (filtered.length > 0) next[itemId] = filtered;
          }
          return {
            folders: s.folders.filter((f) => f.id !== id),
            selectedFolderId: s.selectedFolderId === id ? null : s.selectedFolderId,
            itemFolderMap: next,
          };
        });

        try {
          await apiFetch(`/api/folders/${id}`, { method: "DELETE" });
        } catch {
          // silently ignore
        }
      },

      updateFolder: async (id, updates) => {
        // Optimistic
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, ...updates } : f)),
        }));

        try {
          await apiFetch(`/api/folders/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ name: updates.name }),
          });
        } catch {
          // silently ignore
        }
      },

      moveFolder: async (id, newParentId, newOrderIndex) => {
        // Optimistic
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, parentId: newParentId, orderIndex: newOrderIndex } : f,
          ),
        }));

        try {
          await apiFetch(`/api/folders/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ parentId: newParentId, orderIndex: newOrderIndex }),
          });
        } catch {
          // silently ignore
        }
      },

      reorderFolder: (id, newOrderIndex) => {
        set((s) => {
          const folder = s.folders.find((f) => f.id === id);
          if (!folder) return s;
          // Recompute siblings' orderIndex
          const siblings = s.folders
            .filter((f) => f.parentId === folder.parentId && f.id !== id)
            .sort((a, b) => a.orderIndex - b.orderIndex);

          siblings.splice(newOrderIndex, 0, { ...folder, orderIndex: newOrderIndex });
          const reindexed = siblings.map((f, i) => ({ ...f, orderIndex: i }));
          const reindexedMap = new Map(reindexed.map((f) => [f.id, f]));

          return {
            folders: s.folders.map((f) => {
              if (f.id === id) return { ...f, orderIndex: newOrderIndex };
              return reindexedMap.get(f.id) ?? f;
            }),
          };
        });
      },

      selectFolder: (id) => set({ selectedFolderId: id }),

      assignItemsToFolder: async (itemIds, folderId) => {
        // Optimistic
        set((s) => {
          const next = { ...s.itemFolderMap };
          for (const id of itemIds) {
            const existing = next[id] ?? [];
            if (!existing.includes(folderId)) next[id] = [...existing, folderId];
          }
          return { itemFolderMap: next };
        });

        try {
          await apiFetch("/api/folder-items", {
            method: "POST",
            body: JSON.stringify({ folderId, itemIds }),
          });
        } catch {
          // silently ignore
        }
      },

      removeItemsFromFolder: async (itemIds, folderId) => {
        // Optimistic
        set((s) => {
          const next = { ...s.itemFolderMap };
          for (const id of itemIds) {
            const existing = next[id];
            if (!existing) continue;
            const filtered = existing.filter((fid) => fid !== folderId);
            if (filtered.length > 0) next[id] = filtered;
            else delete next[id];
          }
          return { itemFolderMap: next };
        });

        try {
          await apiFetch("/api/folder-items", {
            method: "DELETE",
            body: JSON.stringify({ folderId, itemIds }),
          });
        } catch {
          // silently ignore
        }
      },

      folderItemCount: (folderId) => {
        const map = get().itemFolderMap;
        let count = 0;
        for (const folderIds of Object.values(map)) {
          if (folderIds.includes(folderId)) count++;
        }
        return count;
      },

      galleryImageCount: 0,
      galleryVideoCount: 0,
      setGalleryCount: (tab, count) =>
        set(tab === "videos" ? { galleryVideoCount: count } : { galleryImageCount: count }),
    }),
    {
      name: "aiui-folders-v2",
      partialize: (state) => ({
        folders: state.folders,
        selectedFolderId: state.selectedFolderId,
        itemFolderMap: state.itemFolderMap,
      }),
    },
  ),
);
