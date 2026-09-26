<p align="center">
  <img
    src="https://raw.githubusercontent.com/SegFault42/HeliosGen/main/public/HG.svg"
    alt="HeliosGen"
    width="64"
  />
</p>

<p align="center">
  <strong>Build AI image & video pipelines visually.</strong><br/>
  Chain prompts, models, reference images, and automations on an infinite canvas.
</p>

---

For Higgsfield Seedance 2.0 text-to-video setup and MVP limits, see [docs/HIGGSFIELD.md](docs/HIGGSFIELD.md).

# ⬇️ Download

**HeliosGen is a desktop app.** Grab the latest build for your OS from the
releases page — no account, no server, no cloud setup:

### 👉 **[Download from the Releases page](https://github.com/SegFault42/HeliosGen/releases)**

| OS | File |
| --- | --- |
| **macOS** (Apple Silicon) | `HeliosGen_<version>_aarch64.dmg` |
| **Windows** | 🙋 **looking for a contributor to build & submit** — see below |
| **Linux** | 🙋 **looking for a contributor to build & submit** — see below |

> Only the builds actually attached to the latest release are available. macOS
> is published today. **Tauri can't cross-compile, so Windows and Linux builds
> need someone on those platforms** — if you can run `npm run desktop:build` on
> Windows or Linux (see the **Build from source** section below), please open a
> PR or attach the artifacts to an issue and we'll add them to the release.

The app is **not code-signed** yet:

- **macOS** — right-click the app → **Open** (once), or run
  `xattr -cr /Applications/HeliosGen.app`.
- **Windows** — SmartScreen: **More info → Run anyway**.

---

## 🚀 First run

1. Launch HeliosGen.
2. Open **Settings → API Keys** and paste your **[kie.ai](https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec) API key**.
3. Start generating.

Everything stays on your machine. Generations, uploads, folders, workflows and
settings live in a local database; media is saved to a local folder:

| OS | Data location |
| --- | --- |
| macOS | `~/Library/Application Support/cash.sdd.helios.desktop/` |
| Windows | `%APPDATA%\cash.sdd.helios.desktop\` |
| Linux | `~/.local/share/cash.sdd.helios.desktop/` |

Delete that folder to reset the app.

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
  <img width="886" alt="JSON prompt preview" src="https://github.com/user-attachments/assets/dedbdf4f-9d52-4e29-ad6e-a2e67e341a73" />
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
- all running 100% locally on your machine.

No subscriptions.  
No disappearing credits.  
No vendor lock-in.  
No cloud, no accounts — just a local app and your own kie.ai key.

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
- Real-time generation history
- 100% local — your data never leaves your machine
- Bring your own kie.ai key
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
| Desktop shell | Tauri 2 (Rust) |
| App | Next.js + React + TypeScript (bundled Node sidecar) |
| Database | SQLite (local) |
| Storage | Local disk |
| AI Backend | kie.ai |

---

# 🤖 Codex CLI (optional — alternate GPT Image 2 backend)

Instead of routing GPT Image 2 through kie.ai credits, HeliosGen can generate through your own ChatGPT Codex subscription via [`codex-imagegen-cli`](https://github.com/jdmnk/codex-imagegen-cli). The desktop app picks up `codex` from your `PATH` automatically; if it's missing, the feature just shows **NOT CONFIGURED** and everything else keeps working.

Requirements:
- A ChatGPT Plus/Pro/Team/Enterprise account with Codex access
- [`codex`](https://github.com/openai/codex) CLI installed on your machine
- [`uv`](https://docs.astral.sh/uv/) (Python package manager)

### 1. Install the Codex CLI

```bash
# macOS
brew install codex

# or, cross-platform
npm install -g @openai/codex
```

### 2. Install codex-imagegen-cli

```bash
git clone https://github.com/jdmnk/codex-imagegen-cli.git
cd codex-imagegen-cli
uv sync --dev
uv tool install -e .
```

This installs the `codex-imagegen` binary — make sure it's on your `PATH`.

### 3. Log in

Either:
- run `codex login` in a terminal (opens a browser to sign in), **or**
- open the app → **Settings → API Keys → Codex CLI → Connect Codex**, which walks you through a device-code login — visit the printed URL and enter the code, no terminal needed.

> ⚠️ Starting a new login (either way) immediately invalidates any existing session on that machine — the CLI clears old credentials the moment a login attempt begins, whether or not it's ever completed. Only start one when the status badge below shows **NOT CONFIGURED**.

### 4. Enable it for GPT Image 2

In **Settings → Image Models**, set GPT Image 2's provider toggle to **Codex CLI**. The status badge in **Settings → API Keys** shows **READY** once both the CLI and login are in place.

---

# 🛠️ Build from source

Prefer to build it yourself, or need a platform that isn't on the releases page
yet? The whole app builds from this repo.

Tauri does **not** cross-compile — build on the OS you want to target. Run
`npm run desktop:build` on a Mac for the macOS build, on Windows for Windows,
on Linux for Linux.

> **Want to help ship Windows / Linux builds?** Build on that OS and send the
> artifacts (PR or issue attachment) — they'll be added to the next release,
> with credit.

## Prerequisites (one-time, all platforms)

| Tool | Notes |
| --- | --- |
| **Node 22+** | The bundled server uses `node:sqlite`. `nvm use 22`. |
| **Rust** | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Tauri system deps** | See <https://v2.tauri.app/start/prerequisites/> |

Platform-specific system deps:

- **macOS** — Xcode Command Line Tools: `xcode-select --install`
- **Windows** — [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  (Desktop development with C++) and [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
  (preinstalled on Windows 11)
- **Linux** — `webkit2gtk-4.1`, `librsvg2`, `build-essential`, `curl`, `wget`,
  `file`, `libssl-dev`, `libayatana-appindicator3-dev` (Debian/Ubuntu package
  names; see the Tauri prerequisites page for other distros)

## Build

```bash
git clone https://github.com/SegFault42/HeliosGen
cd HeliosGen
npm install
npm run desktop:build
```

Artifacts land in `src-tauri/target/release/bundle/`:

| OS | Output |
| --- | --- |
| macOS | `macos/HeliosGen.app`, `dmg/HeliosGen_<ver>_<arch>.dmg` |
| Windows | `msi/HeliosGen_<ver>_x64_en-US.msi`, `nsis/HeliosGen_<ver>_x64-setup.exe` |
| Linux | `deb/`, `rpm/`, `appimage/HeliosGen_<ver>_amd64.AppImage` |

The macOS build is **unsigned** — on first launch Gatekeeper blocks it.
Right-click → Open, or `xattr -cr "src-tauri/target/release/bundle/macos/HeliosGen.app"`.

## Develop (hot reload)

```bash
npm run desktop:dev
```

Runs `next dev` and `tauri dev` together. The first run compiles the Rust shell
(~1–2 min).

See [`DESKTOP.md`](DESKTOP.md) for architecture, data locations, and signing &
notarization.

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
