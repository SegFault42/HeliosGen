-- Run this in your Supabase SQL editor

-- ── User uploads ──────────────────────────────────────────────────────────────

create table public.user_uploads (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete set null,
  r2_url     text        not null,
  mime_type  text,
  source     text        not null default 'user_upload',
  created_at timestamptz not null default now()
);

alter table public.user_uploads enable row level security;

create policy "users read own uploads"
  on public.user_uploads for select
  using (auth.uid() = user_id);

create policy "users insert own uploads"
  on public.user_uploads for insert
  with check (auth.uid() = user_id);

-- ── Spaces ─────────────────────────────────────────────────────────────────────

create table public.spaces (
  id         text        primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  data       jsonb       not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger spaces_updated_at
  before update on public.spaces
  for each row execute procedure public.touch_updated_at();

alter table public.spaces enable row level security;

create policy "users manage own spaces"
  on public.spaces for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.generations (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  user_id              uuid references auth.users(id) on delete set null,
  task_id              text not null unique,

  generation_type      text not null check (generation_type in ('image', 'video')),
  status               text not null default 'pending',

  prompt               text,
  model                text,
  aspect_ratio         text,
  quality              text,
  duration             int,
  kling_mode           text,
  sound                boolean,

  reference_image_urls text[]   default '{}',
  image_url            text,
  image_urls           jsonb,
  video_url            text,
  error_msg            text
);

-- Auto-bump updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger generations_updated_at
  before update on public.generations
  for each row execute procedure public.touch_updated_at();

-- Row-level security (service role bypasses RLS automatically)
alter table public.generations enable row level security;

create policy "users read own generations"
  on public.generations for select
  using (auth.uid() = user_id);

-- ── User settings (per-user API keys) ─────────────────────────────────────────

create table public.user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  kie_api_token text,
  updated_at timestamptz not null default now()
);

-- Only the service role accesses this table (from API routes).
-- No user-facing RLS policies needed — the server never exposes the token to the client.
alter table public.user_settings enable row level security;
