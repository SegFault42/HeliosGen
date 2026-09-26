# Higgsfield MVP

## Current architecture

`lib/modelConfig.ts` defines the image and video model catalog and Kie payload fields. `lib/providers.ts` stores each model's manually selected backend in browser localStorage. API keys are saved in the local SQLite `settings` table through server routes. `/api/generate-video` creates a Kie job and returns a `taskId`; `lib/kieJobPoller.ts` stores the result and emits an event consumed by `/api/job-stream` and the Video Generator node. `lib/kieUpload.ts` moves local media to Kie's temporary store before submission.

The Higgsfield path branches before the existing Kie route, leaving Kie's payload and polling intact. The same logical `seedance-2` model uses `bytedance/seedance-2` at Kie and `bytedance/seedance-2.0/text-to-video` at Higgsfield. Only text-to-video is mapped for Higgsfield.

## Configure and run

Use Settings → API Keys to save **Higgsfield API Key ID** and **Higgsfield API Key Secret**. Alternatively, set `HF_API_KEY_ID` and `HF_API_KEY_SECRET` server-side. The SDK receives the combined `KEY_ID:KEY_SECRET` credential. These values are never returned to the browser or committed. Like the existing Kie key, the Settings value is stored in the local SQLite database; it is not encrypted with the macOS Keychain.

Run `corepack pnpm install` then `corepack pnpm dev`. In Video Generator, choose **Seedance 2.0** and choose **Kie.ai** or **Higgsfield** in the provider pill. A missing Higgsfield key shows **Not configured** and blocks the Generate button. The selection takes effect immediately and persists per model.

For Kie, configure the Kie key and use the existing Seedance inputs. For Higgsfield, use a prompt only; duration 4–15 seconds, a fixed aspect ratio, 480p/720p/1080p, and optional sound. The server validates these values before submission.

Run `corepack pnpm test:higgsfield` for a no-credit mock integration test. It covers saved key status, the request payload, queued/in-progress/completed polling, failed and rate-limited requests, and Kie route selection. Run `corepack pnpm exec tsc --noEmit`, `corepack pnpm lint`, and `corepack pnpm build` for project checks.

## Current limits

- Higgsfield accepts prompt-only Seedance 2.0. Image, video and audio references need provider-specific upload and model mappings.
- The TypeScript SDK v2 exposes automatic polling through `subscribe`, but no explicit TypeScript resume method. If the local server restarts during a Higgsfield job, the in-memory poll ends and the local job eventually times out. Preserve the upstream `request_id` and add a resumable status route in a later PR.
- No live paid Higgsfield or Kie generation was run without user credentials. The integration test uses a local API simulator.
- No webhook, automatic retry of generation submission, cost routing or fallback is included.

## Next PR plan

1. Add Higgsfield Seedance reference-to-video and image-to-video with signed reference uploads, input validation and provider-specific handle availability.
2. Add documented mappings for Kling and Wan, one operation at a time, without changing the Kie catalog.
3. Add Soul / Soul ID image flows and Cinema Studio as separate adapters.
4. Expose estimated cost before submission using current provider pricing and selected duration/resolution; mark estimates clearly.
5. Persist Higgsfield `request_id` and resume polling after server restart, then consider manual Kie → Higgsfield fallback with explicit user confirmation to avoid duplicate charges.

Model schemas and prices should be reverified against the official Higgsfield model pages for each later operation.
