-- Run this in your Supabase SQL editor after supabase-setup.sql

-- ── Folders ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.folders (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  parent_id  UUID        REFERENCES public.folders(id) ON DELETE CASCADE,
  order_index INTEGER    NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER folders_updated_at
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own folders"
  ON public.folders FOR ALL
  TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Folder items ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.folder_items (
  folder_id  UUID        NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  item_id    TEXT        NOT NULL,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, item_id)
);

ALTER TABLE public.folder_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own folder items"
  ON public.folder_items FOR ALL
  TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
