# AIUI — AI Workflow Builder

A visual workflow builder for AI image and video generation. Connect nodes on a canvas to chain prompts, reference images, and generation models into automated pipelines.

---

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/)
- A [Supabase](https://supabase.com/) project (free tier works)
- A [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) bucket
- A [kie.ai](https://kie.ai) account with API access

---

## 1. Clone & Install

```bash
git clone <your-repo-url>
cd AIUI
pnpm install
```

---

## 2. Environment Variables

Create a `.env.local` file at the project root with the following variables:

```env
# ── Kie.ai ────────────────────────────────────────────────────────────────────
# No shared key needed — each user enters their own key via the Settings UI.

# Public URL where kie.ai will POST generation results (webhook).
# Must be reachable from the internet. Use ngrok or similar for local dev.
# Example: https://your-app.vercel.app  or  https://abc123.ngrok.io
CALLBACK_BASE_URL=https://your-public-url.com

# ── Supabase ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# ── Cloudflare R2 ─────────────────────────────────────────────────────────────
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your_bucket_name
# Public CDN URL for the bucket (enable public access in R2 dashboard)
R2_PUBLIC_URL=https://pub-xxxxxxxxxxxx.r2.dev
```

---

## 3. Supabase Setup

### 3.1 Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project, and copy the **Project URL**, **anon key**, and **service role key** from **Settings → API** into your `.env.local`.

### 3.2 Enable Email Auth

In your Supabase dashboard go to **Authentication → Providers → Email** and make sure it is enabled.

### 3.3 Run the SQL schema

Open the **SQL Editor** in your Supabase dashboard and run the following in order:

```sql
-- ── Shared trigger function ───────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

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

-- ── Spaces (workflow canvases) ─────────────────────────────────────────────────
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

-- ── Generations (job history) ──────────────────────────────────────────────────
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

create trigger generations_updated_at
  before update on public.generations
  for each row execute procedure public.touch_updated_at();

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

alter table public.user_settings enable row level security;
```

---

## 4. Cloudflare R2 Setup

R2 stores all uploaded and generated assets (images, videos, reference frames). The app uses the S3-compatible API.

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com) and open **R2 Object Storage**.
2. Create a new bucket (e.g. `aiui-assets`).
3. **Enable public access**: open the bucket → **Settings** → **Public Access** → allow public access. Copy the public URL (looks like `https://pub-xxxx.r2.dev`) into `R2_PUBLIC_URL`.
4. Create an **API token**: go to **R2 → Manage R2 API Tokens** → **Create API Token**. Grant **Object Read & Write** on your bucket. Copy the **Access Key ID** and **Secret Access Key**.
5. Find your **Account ID** in the Cloudflare dashboard sidebar.

The app organises objects under these prefixes automatically:

| Prefix | Contents |
|---|---|
| `uploads/` | User-uploaded files |
| `references/` | Reference images mirrored before sending to the API |
| `generated/` | Generated images |
| `videos/` | Generated videos |

---

## 5. Kie.ai Setup

[Kie.ai](https://kie.ai) is the primary backend for all AI generation (images and videos) and also proxies the Claude assistant.

There is **no shared API key** — each user brings their own:

1. Each user creates an account at [kie.ai](https://kie.ai) and generates an API token at [kie.ai/api-key](https://kie.ai/api-key).
2. After signing in to the app, they open **Settings → API Keys** and paste their token. It is saved server-side in Supabase and never exposed to the browser.
3. Set `CALLBACK_BASE_URL` to the **public root URL** of your deployment (no trailing slash). Kie.ai will POST job results to `{CALLBACK_BASE_URL}/api/callback` when a generation finishes.
   - **Local dev:** expose your machine with [ngrok](https://ngrok.com) (`ngrok http 3000`) and use the HTTPS URL it gives you.
   - **Production:** use your deployed domain (e.g. `https://your-app.vercel.app`).

**Supported generation models via Kie.ai:**
- **Images:** Seedream, Z-Image, Grok Imagine (X), GPT-4o, Nano Banana, and more
- **Videos:** Kling 3.0, Kling 2.6 (motion-control), Seedance 2, Grok Imagine (X)

Credits are consumed per generation from each user's own Kie.ai balance. Users can check their balance inside the app via the credit indicator in the top bar.

---

## 6. Run the Project

```bash
# Development
pnpm dev

# Production build
pnpm build
pnpm start
```

The app runs on [http://localhost:3000](http://localhost:3000) by default.

---

## 7. Optional: Azure OpenAI

If you want to route specific image models through Azure AI Foundry instead of Kie.ai, add:

```env
AZURE_API_KEY=your_azure_openai_api_key
```

Then configure the per-model provider and endpoint inside the app under **Settings** (gear icon in the top bar).

---

## Deployment

The app is a standard Next.js app and can be deployed to any Node.js-capable platform:

- **Vercel** (recommended): import the repo, add all env vars in project settings, and deploy. Set `CALLBACK_BASE_URL` to your Vercel deployment URL.
- **Railway / Render / Fly.io**: set the same env vars and run `pnpm build && pnpm start`.

Make sure `CALLBACK_BASE_URL` always points to the live public URL so kie.ai webhooks reach your `/api/callback` route.
