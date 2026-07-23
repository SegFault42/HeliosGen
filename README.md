<p align="center">
  <img 
    src="https://helios.sdd.cash/HG.svg" 
    alt="HeliosGen Banner" 
    width="64"
  />
</p>

<p align="center">
  <strong>Build AI image & video pipelines visually.</strong><br/>
  Chain prompts, models, reference images, and automations on an infinite canvas.
</p>

---

# Demo

You can check the demo here: https://demo.sdd.cash/
And create an account and use it here : https://helios.sdd.cash/

---

# 📸 Screenshots
## ✨ Simple Image & Video Generation

<p align="center">
  <img width="2912" height="2292" alt="Image generation example" src="https://github.com/user-attachments/assets/8263b83d-addb-4af8-99d1-d8406c52be2c" />
</p>

---

## 🔄 Workflow Generation

<p align="center">
  <img width="1459" height="1146" alt="Workflow generation example" src="https://github.com/user-attachments/assets/fc7f1109-76d1-4af0-b91d-0e915bcf5461" />
</p>

---

## 🧠 Native JSON Prompt Preview

<p align="center">
  <img width="886" height="463" alt="JSON prompt preview" src="https://github.com/user-attachments/assets/dedbdf4f-9d52-4e29-ad6e-a2e67e341a73" />
</p>

---

## 💬 AI Prompt Improvement Assistant

<p align="center">
  <img width="872" height="502" alt="Prompt assistant interface" src="https://github.com/user-attachments/assets/17ba972c-bd8a-49a7-b367-4ef906fe3e17" />
</p>

# ✨ HeliosGen

HeliosGen is a free & open source visual AI workflow builder for image and video generation.

Build reusable AI pipelines with:
- infinite node-based workflows,
- multi-model generation,
- reference images,
- automation chains,
- and self-hosted infrastructure.

No subscriptions.  
No disappearing credits.  
No vendor lock-in.

---

# 💳 Credits

HeliosGen now works with <a href="https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec" target="_blank">kie.ai</a>.

All credits are purchased directly on your own account and never expire.

That means:
- no monthly reset,
- no lost credits,
- no subscription lock-in,
- and full ownership of your usage.

You only pay for what you generate.

---

# 🚀 Features

- Infinite node-based canvas
- AI image & video generation
- Drag-and-connect workflow system
- Multi-model pipelines
- Reference image support
- Parallel & sequential pipeline execution
- Shareable public workflows
- Per-user API keys
- Real-time generation history
- Self-hostable architecture
- Modern responsive UI

---

# ⚡ Supported Models

## Images
- GPT Image 2 (OpenAI)
- Nano Banana / Nano Banana 2 / Nano Banana 2 Lite / Nano Banana Pro (Google)
- Seedream 5.0 Lite / Pro (Seedream)
- Z-Image (Z-AI)
- Grok Imagine (X)

## Videos
- Veo 3.1 Lite / Fast / Quality, Gemini Omni Video (Google)
- Kling 3.0, Kling 3.0 Turbo, Motion Control 2.6 / 3.0 (Kling)
- Seedance 2.0 / Fast / Mini (Bytedance)
- Grok Imagine, Grok Imagine 1.5 preview (X)
- HappyHorse (Alibaba)

More models are coming.

---

# 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + React + TypeScript |
| Backend | Next.js API Routes |
| Database | Supabase / JSON |
| Storage | Cloudflare R2 / Local disk |
| AI Backend | Kie.ai |
| Deployment | Vercel / Railway / Render |

---

# 🚀 Getting Started

## 1. Clone the repository

```bash
git clone https://github.com/SegFault42/HeliosGen
cd HeliosGen
npm install
```

---

## 2. Guest Mode (quick setup)

Requirements:
- Kie.ai API key
- ngrok

```bash
cp .env.guest .env.local
```

Fill your `.env.local`:

```env
GUEST_MODE=true
KIE_API_KEY=your_key
CALLBACK_BASE_URL=https://xxxx.ngrok-free.app
```

Start ngrok:

```bash
ngrok http 3000
```

Run the app:

```bash
npm run dev
```

---

## 3. Cloud Mode (production)

Requirements:
- Supabase
- Cloudflare R2
- Kie.ai API key

### 3a. Database setup

Open the **SQL Editor** in your Supabase project and run the two migration files in order:

1. **`supabase-setup.sql`** — core tables (generations, uploads, spaces, settings)
2. **`supabase-folders.sql`** — gallery folders & folder items

### 3b. Environment variables

Create `.env.local`:

```env
CALLBACK_BASE_URL=https://your-domain.com

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=
```

### 3c. Run

```bash
npm run dev
```

---

# 🌍 Deployment

Recommended platforms:
- Vercel
- Railway
- Render
- Fly.io

```bash
npm run build && npm start
```

---

# 🤝 Contributions

Contributions are welcome.

If you find a bug, have an idea, or want to improve HeliosGen:
- Open an issue
- Submit a pull request
- Share feedback or feature requests

All contributions are appreciated.

---

# 📄 License

MIT License

---

<p align="center">
  Built for creators building the future of AI workflows.
</p>

