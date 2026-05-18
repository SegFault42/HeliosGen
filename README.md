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
| Database | Supabase (cloud) / JSON file (guest) |
| Storage | Cloudflare R2 (cloud) / Local disk (guest) |
| AI Backend | Kie.ai |
| Deployment | Vercel / Railway / Render |

---

# 🚀 Getting Started

HeliosGen supports two setup modes depending on your needs.

| | Guest Mode | Cloud Mode |
|---|---|---|
| **Setup time** | ~2 minutes | ~20 minutes |
| **Kie.ai API key** | ✅ Required | ✅ Required |
| **ngrok** | ✅ Required | Not needed |
| **Supabase** | ❌ Not needed | ✅ Required |
| **Cloudflare R2** | ❌ Not needed | ✅ Required |
| **Multi-user** | ❌ Single guest user | ✅ Full auth |
| **Persistence** | Local disk + JSON | Cloud DB + CDN |
| **Best for** | Local dev & testing | Production & sharing |

---

## Step 1 — Clone & install

```bash
git clone https://github.com/SegFault42/HeliosGen
cd HeliosGen
npm install
```

---

## Step 2 — Choose your setup

---

### 🏠 Guest Mode (local, no cloud accounts needed)

**Requirements:** a [Kie.ai](https://kie.ai) API key and [ngrok](https://ngrok.com).

Generated files are saved to `public/generated/` and served as static assets.
History is stored in `data/guest-db.json` and survives server restarts.

**1. Copy the guest environment template**

```bash
cp .env.guest .env.local
```

**2. Fill in your values**

```env
GUEST_MODE=true
KIE_API_KEY=your_kie_api_key_here
CALLBACK_BASE_URL=https://xxxx.ngrok-free.app
```

**3. Start ngrok** (in a separate terminal)

```bash
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL into `CALLBACK_BASE_URL`.

**4. Run the app**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — no login required, gallery persists automatically.

---

### ☁️ Cloud Mode (Supabase + R2, for production or multi-user)

**Requirements:** [Kie.ai](https://kie.ai) API key, [Supabase](https://supabase.com) project, and [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket.

#### Supabase setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Settings → API** and copy your Project URL, Anon Key, and Service Role Key
3. Go to **Authentication → Providers → Email** and enable Email Auth
4. Open the **SQL Editor** and run the contents of `supabase-setup.sql`

Tables created:

| Table | Description |
|---|---|
| `spaces` | Workflow canvases |
| `generations` | Image/video generation history |
| `user_uploads` | Uploaded assets |
| `user_settings` | Per-user API keys |
| `asset_cache` | Deduplication cache |

#### Cloudflare R2 setup

1. Create a bucket in the Cloudflare dashboard
2. Enable **Public Access** on the bucket
3. Go to **R2 → Manage R2 API Tokens** and create a token with Object Read & Write
4. Copy your Account ID, Access Key, Secret Key, Bucket Name, and Public CDN URL

#### Environment variables

Create a `.env.local` file:

```env
# Kie.ai
CALLBACK_BASE_URL=https://your-domain.com

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Cloudflare R2
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://pub-xxxxxxxxxxxx.r2.dev

# Azure OpenAI (optional — for GPT Image 2 and similar models)
AZURE_API_KEY=your_azure_api_key
```

#### Local development with ngrok

```bash
ngrok http 3000
```

Set `CALLBACK_BASE_URL` to your ngrok URL during local dev.

#### Run the app

```bash
npm run dev
```

Users sign in with email/password, enter their own Kie.ai API key in Settings, and generations are stored in Supabase + R2.

---

# 🌍 Deployment (Cloud Mode)

HeliosGen can be deployed anywhere that supports Node.js.

## Recommended: Vercel

1. Import the repository into Vercel
2. Add all environment variables from your `.env.local`
3. Set `CALLBACK_BASE_URL=https://your-vercel-domain.vercel.app`
4. Deploy

## Other platforms

- Railway
- Render
- Fly.io

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
