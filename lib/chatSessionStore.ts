import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createClient } from "@/lib/supabase/client";

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: StoredMessage[];
  model: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatSessionState {
  sessions: ChatSession[];
  preferredModel: string;
  setPreferredModel: (model: string) => void;
  createSession: (model: string, title: string) => string;
  upsertSession: (id: string, messages: StoredMessage[], model: string) => void;
  deleteSession: (id: string) => void;
  loadFromSupabase: () => Promise<void>;
  clearSessions: () => void;
}

async function getAuthenticatedUser() {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export const useChatSessionStore = create<ChatSessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      preferredModel: "claude-sonnet-4-6",

      setPreferredModel: (model) => set({ preferredModel: model }),

      createSession: (model, title) => {
        const id = crypto.randomUUID();
        const now = Date.now();
        set(s => ({
          sessions: [
            { id, title, messages: [], model, createdAt: now, updatedAt: now },
            ...s.sessions,
          ],
        }));

        getAuthenticatedUser().then(({ supabase, user }) => {
          if (!user) return;
          supabase.from("chat_sessions").insert({
            id,
            user_id: user.id,
            title,
            messages: [],
            model,
            created_at: new Date(now).toISOString(),
            updated_at: new Date(now).toISOString(),
          }).then(({ error }) => { if (error) console.error("[chat] insert:", error.message); });
        });

        return id;
      },

      upsertSession: (id, messages, model) => {
        const updatedAt = Date.now();
        set(s => ({
          sessions: s.sessions.map(sess =>
            sess.id === id ? { ...sess, messages, model, updatedAt } : sess
          ),
        }));

        getAuthenticatedUser().then(({ supabase, user }) => {
          if (!user) return;
          supabase.from("chat_sessions").upsert({
            id,
            user_id: user.id,
            title: get().sessions.find(s => s.id === id)?.title ?? "Chat",
            messages,
            model,
            updated_at: new Date(updatedAt).toISOString(),
          }).then(({ error }) => { if (error) console.error("[chat] upsert:", error.message); });
        });
      },

      deleteSession: (id) => {
        set(s => ({ sessions: s.sessions.filter(sess => sess.id !== id) }));

        getAuthenticatedUser().then(({ supabase, user }) => {
          if (!user) return;
          supabase.from("chat_sessions").delete().eq("id", id)
            .then(({ error }) => { if (error) console.error("[chat] delete:", error.message); });
        });
      },

      clearSessions: () => set({ sessions: [] }),

      loadFromSupabase: async () => {
        const { supabase, user } = await getAuthenticatedUser();
        if (!user) return;

        // Upload any local sessions with messages that aren't in Supabase yet
        const local = get().sessions.filter(s => s.messages.length > 0);
        if (local.length > 0) {
          const { data: existing } = await supabase
            .from("chat_sessions")
            .select("id")
            .in("id", local.map(s => s.id));
          const existingIds = new Set((existing ?? []).map((r: { id: string }) => r.id));
          const toUpload = local.filter(s => !existingIds.has(s.id));
          if (toUpload.length > 0) {
            await supabase.from("chat_sessions").insert(
              toUpload.map(s => ({
                id: s.id,
                user_id: user.id,
                title: s.title,
                messages: s.messages,
                model: s.model,
                created_at: new Date(s.createdAt).toISOString(),
                updated_at: new Date(s.updatedAt).toISOString(),
              }))
            );
          }
        }

        // Fetch all sessions from Supabase
        const { data, error } = await supabase
          .from("chat_sessions")
          .select("*")
          .order("updated_at", { ascending: false });

        if (error) { console.error("[chat] load:", error.message); return; }

        set({
          sessions: (data ?? []).map((row: {
            id: string; title: string; messages: StoredMessage[];
            model: string; created_at: string; updated_at: string;
          }) => ({
            id: row.id,
            title: row.title,
            messages: row.messages,
            model: row.model,
            createdAt: new Date(row.created_at).getTime(),
            updatedAt: new Date(row.updated_at).getTime(),
          })),
        });
      },
    }),
    {
      name: process.env.NEXT_PUBLIC_GUEST_MODE === "true" ? "heliosgen-chats-guest" : "heliosgen-chats",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
