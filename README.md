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

# 📸 Screenshots

<p align="center">
  <img width="2912" height="2292" alt="Image" src="https://github.com/user-attachments/assets/f9bd5a48-3a3d-4b1a-a6d9-2e5f359c8b95" />

  <img width="1459" height="1146" alt="Image" src="https://github.com/user-attachments/assets/1e6e6b2d-672d-4307-9db6-d8a3f29beee7" />
</p>

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
- GPT Image 2
- Nano Banana / Pro
- Seedream 5.0 Lite
- Z-Image
- Grok Imagine

## Videos
- Veo 3.1
- Kling 3.0
- Seedance 2.0
- Grok Imagine Video

More models available via Kie.ai.

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

Run:

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
