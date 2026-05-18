# HeliosGen

<p align="center">
  <img src="./public/cover.png" alt="HeliosGen Banner" />
</p>

<p align="center">
  <strong>Build AI image & video pipelines visually.</strong><br/>
  Chain prompts, models, reference images, and automations on an infinite canvas.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Supabase-Backend-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Cloudflare-R2-orange?style=for-the-badge" />
  <img src="https://img.shields.io/badge/AI-Kie.ai-purple?style=for-the-badge" />
</p>

---

# 📸 Screenshots

<p align="center">
  <img src="./public/screenshot-1.png" width="100%" />
</p>

---

# ✨ Why HeliosGen Exists

Most AI generation platforms today lock creators into expensive monthly subscriptions.

You pay every month for credits that:
- expire,
- reset,
- or disappear if unused.

Platforms like Higgsfield, OpenArt, Freepik AI, and others optimize for recurring subscriptions.

**HeliosGen takes the opposite approach.**

---

# 🔓 A Free & Open Source Alternative

HeliosGen is a **free and open source** visual AI workflow builder designed for creators who want:

- Full ownership
- No vendor lock-in
- No forced subscriptions
- No disappearing credits
- Self-hosted freedom

Instead of renting access to a closed platform, you own the entire system.

---

# 💸 Credits That Never Expire

With most AI platforms:

> "Use your credits before the end of the month or lose them."

HeliosGen is different.

You connect your own AI provider accounts (like Kie.ai), meaning:

- Your credits stay on your own account
- Unused credits remain yours
- No monthly reset
- No hidden subscription trap
- No artificial limits imposed by the platform

You only pay for what you actually generate.

---

# 🖥️ Fully Self-Hostable

HeliosGen can run entirely on your own infrastructure.

That means you can:

- Self-host the app
- Control your storage
- Manage your own API keys
- Keep your workflows private
- Customize the platform freely
- Extend it however you want

No dependency on a centralized SaaS.

---

# 🧠 Built for Power Users

HeliosGen is not just another "prompt box."

It's designed for creators building:
- automated pipelines,
- reusable workflows,
- generation systems,
- AI production chains,
- and scalable creative tooling.

Think:
- ComfyUI flexibility
- Modern SaaS UX
- Open ecosystem
- Creator ownership

---

# 🚀 The Goal

Make AI generation:
- more open,
- more composable,
- more affordable,
- and more creator-owned.

No subscriptions.
No locked ecosystem.
No disappearing credits.
Just workflows.

---

# 🧩 Features

- Infinite node-based canvas
- AI image generation
- AI video generation
- Drag & connect workflow system
- Reference image support
- Multi-model pipelines
- Wave-based pipeline runner (parallel + sequential execution)
- Node groups with scoped pipeline execution and color coding
- Missing-input warnings on nodes
- In-app AI assistant (QuickAssist)
- Persistent cloud storage
- Per-user API keys
- Real-time generation history
- Modern responsive UI

---

# ⚡ Supported Models

## Images

- GPT Image 2 (OpenAI)
- Nano Banana / Nano Banana 2 / Nano Banana Pro (Google)
- Seedream 5.0 Lite
- Z-Image
- Grok Imagine
- More via Kie.ai

## Videos

- Veo 3.1 Lite / Fast / Quality (Google)
- Kling 3.0
- Seedance 2.0 / 2.0 Fast
- Grok Imagine Video

---

# 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + React + TypeScript |
| Backend | Next.js API Routes |
| Database | Supabase |
| Storage | Cloudflare R2 |
| AI Backend | Kie.ai |
| Deployment | Vercel / Railway / Render |

---

# 🚀 Getting Started

## 1. Clone the repository

```bash
git clone https://github.com/SegFault42/HeliosGen
cd HeliosGen
```

---

## 2. Install dependencies

```bash
pnpm install
```

---

## 3. Configure environment variables

Create a `.env.local` file:

```env
# ─────────────────────────────────────────────────────────────
# Supabase
# ─────────────────────────────────────────────────────────────

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# ─────────────────────────────────────────────────────────────
# Cloudflare R2
# ─────────────────────────────────────────────────────────────

R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your_bucket_name

# Public CDN URL
R2_PUBLIC_URL=https://pub-xxxxxxxxxxxx.r2.dev

# ─────────────────────────────────────────────────────────────
# Kie.ai
# ─────────────────────────────────────────────────────────────

# Public webhook URL
CALLBACK_BASE_URL=https://your-public-url.com

# Optional shared fallback key
KIE_API_TOKEN=your_kie_api_token

# ─────────────────────────────────────────────────────────────
# Azure OpenAI (Optional)
# ─────────────────────────────────────────────────────────────

AZURE_API_KEY=your_azure_api_key
```

---

# 🗄️ Supabase Setup

## Create a project

Create a new Supabase project and copy:

- Project URL
- Anon Key
- Service Role Key

Into your `.env.local`.

---

## Enable email authentication

Go to:

```txt
Authentication → Providers → Email
```

And enable Email Auth.

---

## Run the SQL schema

Open the SQL editor and run:

```txt
supabase-setup.sql
```

### Tables created

| Table | Description |
|---|---|
| `spaces` | Stores workflow canvases |
| `generations` | Image/video generation history |
| `user_uploads` | Uploaded assets |
| `user_settings` | Secure user API keys |
| `asset_cache` | Deduplication cache for uploaded assets |

---

# ☁️ Cloudflare R2 Setup

HeliosGen stores uploads, generations, references, and videos inside R2 using the S3-compatible API.

## Setup steps

1. Create a bucket
2. Enable public access
3. Create R2 API tokens
4. Copy your Account ID
5. Add credentials to `.env.local`

---

## Storage structure

| Path | Purpose |
|---|---|
| `uploads/` | User uploads |
| `references/` | Reference images |
| `generated/` | Generated images |
| `videos/` | Generated videos |

---

# 🤖 Kie.ai Setup

Kie.ai powers all AI generations.

Users can either:

- Use their own API key (recommended)
- Or fallback to your shared server key

---

## Webhook Configuration

Kie.ai sends completed generations to:

```txt
/api/callback
```

### Local development

```bash
ngrok http 3000
```

Then set:

```env
CALLBACK_BASE_URL=https://your-ngrok-url.ngrok-free.app
```

---

## Production

```env
CALLBACK_BASE_URL=https://your-domain.com
```

---

# ▶️ Run the project

## Development

```bash
pnpm run dev
```

## Production

```bash
pnpm run build
pnpm start
```

App runs on:

```txt
http://localhost:3000
```

---

# 🌍 Deployment

HeliosGen can be deployed anywhere that supports Node.js.

## Recommended: Vercel

1. Import the repository
2. Add environment variables
3. Deploy

Set:

```env
CALLBACK_BASE_URL=https://your-vercel-domain.vercel.app
```

---

## Other platforms

- Railway
- Render
- Fly.io

Use:

```bash
npm run build && npm start
```

---

# 🧠 Vision

HeliosGen is designed to make AI generation composable.

Not just prompting.

But building reusable creative systems visually.

---

# 📄 License

MIT License

---

<p align="center">
  Built for creators building the future of AI workflows.
</p>
