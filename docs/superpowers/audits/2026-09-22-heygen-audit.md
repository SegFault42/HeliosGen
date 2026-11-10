# HeyGen Provider Audit

Date: 2026-09-22 (UTC 2026-09-22/23). Branch: `solstice`, HEAD `8c0e5c0`. Scope: the HeyGen Video Agent path, from the canvas node and the workflow runtime to the finished video on the node and in the gallery.

Method (read-only on source, no dev-server restart, no generation POST):

- Code read: `lib/heygenMcp.ts`, `lib/heygenJobPoller.ts`, `app/api/heygen/*`, the HeyGen branch of `app/api/generate-video/route.ts`, `app/api/job-status`, `app/api/job-stream`, `lib/jobStore.ts`, `lib/jobEvents.ts`, `lib/guest/db.ts`, `lib/guest/localStorage.ts`, `lib/modelConfig.ts`, `components/nodes/VideoGeneratorNode.tsx`, `components/nodes/GenerateNode.tsx`, `components/WorkflowCanvas.tsx`, `lib/workflow-runtime/*`, `lib/executor.ts`, `lib/mentions.ts`, `lib/kieJobPoller.ts`, `lib/flowJobPoller.ts`, `src-tauri/src/lib.rs`.
- `npx tsc --noEmit -p .`: one error in the whole project (`app/gallery/page.tsx:3004`, unrelated). None in HeyGen-related files.
- HeyGen tool schemas: Hermes' cached `tools/list` (`F:/CLAUDE/hermes/cache/mcp_schema_cache.json`, 114 tools, written 2026-09-16) plus HeyGen's v3 reference (get session, list session videos, get video, create video agent, create/complete asset upload, "Prompt to Video" guide).
- Live, allowed: `GET /api/heygen/status`.
- Live, read-only MCP probe from a `node -e` one-liner reusing the current access token (no refresh): `list_video_agent_sessions`, `get_video_agent_session`, `list_video_agent_session_videos`, `get_video`, `list_videos`. No generation, no credits; only shapes, statuses and timings were printed.
- Harness: the real `lib/heygenJobPoller.ts` executed in `node -e` with `heygenMcp`, `jobStore` and `guest/db` replaced through `require.cache` (same transpile pattern as `scripts/*.test.cjs`), fed with fixtures in HeyGen's documented `VideoDetail` shape.

Side effects: `GET /api/heygen/status` found `F:/CLAUDE/hermes/mcp-tokens/heygen.json` expired since 2026-09-16 00:27 UTC, so the app refreshed it and rewrote the file (new expiry +60 min). That file is shared with Hermes. Nothing else was written besides this report (a tsc log in `%TEMP%` was deleted).

Concurrency note: another session changed the repo while this audit ran. Commit `9e62bc4` ("share the Flow engine and job pollers per process") moved the HeyGen/Kie/Flow poller `active` sets to `globalThis` (relevant to H5). Commit `8c0e5c0` added a `Content-Type: application/json` guard at the top of `POST /api/generate-video` (the HeyGen branch moved from `:68-95` to `:72-99`) and hardened `lib/guest/media.ts`. Still uncommitted at the time of writing: SSRF blocking plus a 256 MB cap in `mirrorToStorage` and a veto check at `lib/workflow-runtime/compiler.ts:65`. Line numbers below are for HEAD `8c0e5c0` plus that working tree.

---

## 1. Bottom line

The core path works in `next dev` for a short, text-only prompt. Verified: OAuth refresh, MCP handshake, tool names and argument names, `create_video_agent` arguments, session/video parsing on the happy path, settlement into jobStore, SQLite and the job event.

What stops it, in order of impact:

1. Desktop build: any connected image/video/audio makes submit fail (H1).
2. Renders that need more than about 12 minutes are reported as timed out and, past about 15 to 18 minutes, lost for good. This account's own history has 2 of 13 renders above 18 minutes (H2).
3. The stored result is HeyGen's signed CDN URL, which dies about 5 days later: node previews and gallery items rot (H3).
4. The canvas node waits on an SSE stream that it abandons on the first network error (H4) and that may never receive the event at all now that `9e62bc4` stopped job-stream from spawning its own poller while `jobEvents` is still per module (H5). Either way the node sits on "Generating…".
5. Fatal provider errors are retried silently for the whole window (H6), and the URL heuristic can report a failed video as done with the HeyGen web page URL (H7).

H4 and H5 share one fix: make the video node poll `/api/job-status` exactly like `GenerateNode` already does.

---

## 2. How HeyGen is reached

| Item | Value |
|---|---|
| Transport | HeyGen Remote MCP over Streamable HTTP, `https://mcp.heygen.com/mcp/v1/` (`HEYGEN_MCP_URL`). Probe: stateless (no `Mcp-Session-Id` header), negotiates protocol `2025-06-18`, tool results arrive as `result.content[0].text` JSON, objects are flat snake_case (no `data` wrapper), lists come under `items`. |
| Auth | OAuth token file shared with Hermes: `F:/CLAUDE/hermes/mcp-tokens/heygen.json` (`HERMES_HOME`, `HEYGEN_MCP_TOKEN_FILE`). Client id from `heygen.client.json` (`HEYGEN_MCP_CLIENT_FILE`, fallback `HEYGEN_MCP_CLIENT_ID`), public client (`token_endpoint_auth_method: none`). Refresh at `https://api2.heygen.com/v1/oauth/token` (`HEYGEN_MCP_TOKEN_URL`). Access token lifetime 3600 s. |
| Other env | `ANVIL_URL` (origin used to read `/generated/*` media), `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID` (fallbacks). No HeyGen REST API key is used. |
| `.env.local` | Defines only `FLOW_PROJECT_URL` (names checked, values not read), so every HeyGen default above applies. |
| Account (live) | `GET /api/heygen/status` returned 200 `ok:true` in 1.8 s; plan `creator`, 1200 premium credits. MCP usage bills the web plan's premium credits. |

---

## 3. End-to-end trace

1. **Canvas.** `VideoGeneratorNode.generate()` (`components/nodes/VideoGeneratorNode.tsx:706-980`) validates handles, builds the body with `buildVideoPayload` (`lib/workflow-runtime/generationPayloads.ts:13-35`), shows "Pending" for 3 s (cancellable), sets `status:"running"`, POSTs `/api/generate-video`, stores `taskId`, then waits on `EventSource('/api/job-stream?taskId=…')` (`:405-434`).
2. **Workflow runtime.** Same `buildVideoPayload` body through `productionTransport.submit`, then polls `/api/job-status` (`lib/workflow-runtime/productionTransport.ts:4`). The compiler tags HeyGen steps `provider:"heygen"` (`compiler.ts:60-63`) so the Kie balance gate (`runner.ts:27`) is skipped.
3. **Route** (`app/api/generate-video/route.ts:72-99`). `submitHeyGenVideo` (`lib/heygenMcp.ts:337-358`) uploads every referenced URL (fetch media, `create_asset_upload`, PUT with `upload_headers`, `complete_asset_upload`), then calls `create_video_agent` with `mode:"generate"`, `visibility:"private"`, `incognitoMode:true`, and returns `heygen-agent:<session_id>`. The route then writes `jobStore` pending, inserts the SQLite row and calls `resumeHeyGenJob`.
4. **Poller** (`lib/heygenJobPoller.ts:69-104`). Every 5 s: `get_video_agent_session`; once `video_id` or a "complete" state shows up, `list_video_agent_session_videos`, then `get_video`. The first http URL found settles `done`; a failure-like state settles `error`; exceptions are swallowed until the last of 144 attempts.
5. **Settle** (`:59-67`). `jobStore.set` (file `data/.job-store.json`), `guestDb.updateGeneration` (SQLite `generations.video_url`), `jobEvents.emit('job:<taskId>')`.
6. **Delivery.** job-stream forwards the event; the node writes `videoUrl` and `generations[slot]`. The gallery lists `status='done'` rows with a `video_url` (`lib/guest/db.ts:139-151`, `app/api/gallery/route.ts:29-44`). The URL is HeyGen's signed CDN URL, never a local file.
7. **Restart.** Only a GET on `/api/job-status` or `/api/job-stream` for that task re-arms the poller (`job-status/route.ts:24,43`, `job-stream/route.ts:57`), with a fresh 144-attempt budget and no absolute deadline.

Payload mapping:

| Field sent by canvas/runtime | Route | MCP `create_video_agent` | Note |
|---|---|---|---|
| `videoModel: "heygen-video-agent"` | `cfg.apiInput.useHeyGenMcp` | n/a | ok |
| `prompt` (after `resolveMentions`) | `String(prompt ?? "")` | `prompt` (1 to 10000 chars) | H10, H12 |
| `aspectRatio` | `String(aspectRatio)` | `orientation` landscape or portrait | H9 |
| `avatarId` (`data.heygenAvatarId`, UI field) | kept if string | `avatarId` | ok |
| `voiceId` (`data.heygenVoiceId`, no UI) | kept if string | `voiceId` | env fallback `HEYGEN_VOICE_ID` |
| `resources`, `referenceImageUrls`, `referenceVideoUrls`, `referenceAudioUrls`, `startFrameUrl`, `endFrameUrl` | passed through | `files: [{type:"asset_id", asset_id}]`, max 20 | H1, H13 |
| `duration`, `mode`, `resolution`, `sound`, `videoRefUrl` | ignored | n/a | `duration` still drives the runtime approval gate (H16) |

All MCP argument names used by ANVIL match the cached schemas: `create_video_agent`, `create_asset_upload`, `complete_asset_upload`, `get_video_agent_session`, `list_video_agent_session_videos`, `get_video`, `create_photo_avatar`, `get_current_user`.

---

## 4. Findings

| ID | Sev | Location | Summary |
|---|---|---|---|
| H1 | blocker (desktop build) | `lib/heygenMcp.ts:11,268` | `/generated/*` references fetched from hard-coded port 3000; desktop server runs on 41730+ |
| H2 | major | `lib/heygenJobPoller.ts:9-10,72,103`; `app/api/job-stream/route.ts:15,86-89` | 12 min attempt budget and SSE cap vs HeyGen renders of up to ~22 min |
| H3 | major | `lib/heygenJobPoller.ts:62,86-88` | Signed CDN URL stored as the result, no local download; dies in ~5 days |
| H4 | major | `components/nodes/VideoGeneratorNode.tsx:431` (+`:366`) | `es.onerror = () => es.close()` kills reconnects; node hangs on "Generating…" |
| H5 | major (conditional regression) | `lib/jobEvents.ts:6` vs `lib/heygenJobPoller.ts:6-8` | `9e62bc4` made `active` process-wide but not `jobEvents`; SSE can miss the event entirely |
| H6 | major | `lib/heygenJobPoller.ts:94-100` | Every error treated as transient, nothing logged; fatal auth errors surface after 12+ min |
| H7 | major (latent) | `lib/heygenJobPoller.ts:44,86-93` | Any http string under a "video" key counts; failed/processing video can settle done with `app.heygen.com` page URL |
| H8 | minor | `lib/heygenJobPoller.ts:90-91` | HeyGen's failure reason dropped; `waiting_for_input`/`reviewing` unhandled |
| H9 | minor | `lib/modelConfig.ts:1169`; `lib/heygenMcp.ts:330-334` | Offers 1:1, 4:5, 5:4; HeyGen only does landscape/portrait |
| H10 | minor | `lib/modelConfig.ts:1182` | `promptMaxLength: 20000`, HeyGen limit is 10000 |
| H11 | minor | `components/nodes/VideoGeneratorNode.tsx:1916` | Generate disabled without a Kie key although HeyGen does not use Kie |
| H12 | minor | `lib/workflow-runtime/generationPayloads.ts:16,30-31` | Kie `@mention` rewriting mangles the HeyGen prompt and drops unmentioned files |
| H13 | minor | `app/api/generate-video/route.ts:74-98` (`:95`) | Post-submit bookkeeping can throw after credits are spent: orphaned paid job |
| H14 | minor | `lib/heygenMcp.ts:161,194-215` | 3 HTTPS round trips per tool call, 5 s interval, no fetch timeout |
| H15 | minor | `lib/heygenMcp.ts:124,130-134,163` | No 401 recovery; a failed token write after refresh loses the new tokens |
| H16 | minor | `lib/workflow-runtime/generationPayloads.ts:21`; `lib/workflow-runtime/store.ts:23` | Approval cap uses a fake `duration` for HeyGen |
| H17 | minor | `lib/heygenMcp.ts:52` | `sanitizeError` prints a literal `$1` |
| H18 | minor | `app/api/heygen/avatar/route.ts:7-10`; `lib/heygenMcp.ts:251-262` | Avatar route pinned to two local folders; common image types sent as octet-stream |

### H1 · blocker (desktop build only) · `lib/heygenMcp.ts:11`, `:268`

**Symptom.** In the packaged app, any HeyGen generation with a connected image, video or audio fails at submit with `fetch failed` (HTTP 500 on the node). Text-only prompts work. `next dev` on port 3000 is not affected.

**Root cause.**
```ts
// lib/heygenMcp.ts:11
const LOCAL_ORIGIN = process.env.ANVIL_URL ?? "http://127.0.0.1:3000";
// lib/heygenMcp.ts:268
const requestUrl = url.startsWith("/") ? new URL(url, LOCAL_ORIGIN).toString() : url;
```
The desktop shell starts the server on 41730+ (`src-tauri/src/lib.rs:21-39`, `.env("PORT", port.to_string())` at `:137`) and never sets `ANVIL_URL`. `lib/workflow-runtime/bootstrap.ts:12` has the same default, which breaks every workflow-runtime step in the desktop app, HeyGen or not.

**Fix.** One line in each file:
```ts
const LOCAL_ORIGIN = process.env.ANVIL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
```
Alternative without the HTTP self-call: in `readMedia`, `const file = mediaPathFor(toMediaUrl(url) ?? "")` (both helpers already exist in `lib/guest/media.ts`, with traversal and symlink guards) and `readFile(file)` when it is non-null.

**Verify.** Unit: set `process.env.PORT = "41730"` before requiring `lib/heygenMcp.ts`, replace `global.fetch` with a recorder that throws, call `submitHeyGenVideo({ prompt: "x", referenceImageUrls: ["/generated/images/a.png"] })`, assert the first fetched URL starts with `http://127.0.0.1:41730/`. Live: desktop build, HeyGen node with one image connected.

### H2 · major · `lib/heygenJobPoller.ts:9-10,72,103`, `app/api/job-stream/route.ts:15,86-89`

**Symptom.** A render still running about 12 minutes after the SSE opened makes the node show "Generation timed out". The poller keeps going for roughly 15 to 18 minutes of wall clock (5 s sleep plus about 1.3 s per MCP call, two calls per loop once `video_id` exists). If HeyGen finishes inside that gap, SQLite and the gallery say done while the node stays in error with `taskId` cleared, and it never recovers, not even after a reload. If HeyGen finishes later, the row is permanently `error: HeyGen video generation timed out` and the paid video never reaches ANVIL.

**How often.** HeyGen documents processing at 5x to 10x the output length (a 1 minute video takes about 5 to 10 minutes) and recommends 10 to 30 s polling. This account's history (read-only probe, 13 completed videos): renders of 0.6 to 3.7 min plus two outliers of 18.8 and 21.6 min. The only Video Agent session took 3.7 min end to end for a 5 s clip (0.8 min agent, 2.9 min render).

**Root cause.**
```ts
// lib/heygenJobPoller.ts:9-10, 103
const POLL_MS = 5_000;
const MAX_POLLS = 144; // 12 minutes, aligned with job-stream's hard cap
...
settle(taskId, { status: "error", error: "HeyGen video generation timed out" });
```
```ts
// app/api/job-stream/route.ts:15, 86-89
const TIMEOUT_MS = 12 * 60 * 1000; // 12 min hard cap
const timeout = setTimeout(() => {
  send({ status: "error", error: "Generation timed out" });
}, TIMEOUT_MS);
```
The budget is an attempt count (it drifts with latency and restarts from 0 on every resume) and the SSE cap reports an error without settling anything. Flow already moved to a wall-clock deadline from `created_at` (`lib/flowJobPoller.ts:45-50`, `lib/flowPollPolicy.ts`).

**Fix.**
```ts
// lib/heygenJobPoller.ts
const POLL_MS = 15_000;                        // HeyGen asks for 10 to 30 s
export const HEYGEN_DEADLINE_MS = 60 * 60_000; // observed max ~22 min; HeyGen support threshold is 24 h
...
const createdAt = Date.parse(guestDb.recoverJob(taskId)?.created_at ?? "") || Date.now();
while (Date.now() < createdAt + HEYGEN_DEADLINE_MS) { /* same body */ }
settle(taskId, { status: "error", error: `HeyGen still rendering after 60 min (session ${sessionId})` });
```
With H4's fix the node no longer uses job-stream, so its 12 min cap stops mattering. If job-stream stays in use, compute the cap per task inside `GET` (`(taskId.startsWith("heygen-agent:") ? 65 : 12) * 60_000`) and call `jobEvents.off` in `close()`, because the timeout path leaks the `once` listener today.

**Verify.** Unit with the harness in section 5: `recoverJob` returns `created_at` 61 minutes ago and the session is `generating`; the poller must settle `error` on its first check. Live: the recipe in section 6 with a prompt asking for 60 to 90 s of video; nothing may report a timeout before HeyGen finishes.

### H3 · major · `lib/heygenJobPoller.ts:62`, `:86-88`

**Symptom.** Node preview, gallery item, frame extraction and any downstream reuse of a HeyGen result start failing with HTTP 403 a few days after generation.

**Root cause.** The poller settles with HeyGen's CDN URL as is:
```ts
if (url) {
  settle(taskId, { status: "done", videoUrl: url });
```
```ts
guestDb.updateGeneration(taskId, { status: "done", video_url: result.videoUrl });
```
The probe shows `video_url` is a CloudFront signed URL on `files2.heygen.ai` with query keys `Expires,Signature,Key-Pair-Id`; the sample's `Expires` was about 5 days after the call. HeyGen's guidance is to download the file rather than store the URL. The Kie poller already mirrors (`lib/kieJobPoller.ts:152-160`).

**Fix.**
```ts
import { mirrorToR2 } from "./storage";
...
if (url) {
  const stored = await mirrorToR2(url, "videos").catch((e) => {
    console.error(`[heygen-poller] ${taskId} mirror failed, keeping remote URL:`, (e as Error).message);
    return url;
  });
  settle(taskId, { status: "done", videoUrl: stored });
  return;
}
```
`mirrorToStorage` writes `public/generated/videos/<uuid>.mp4` and strips metadata with ffmpeg, like the Kie path. Note the new 256 MB cap in the working tree: longer 1080p renders above it fall back to the remote URL through the `catch`.

**Verify.** Unit: stub `lib/storage.ts` with `mirrorToR2: async () => "/generated/videos/local.mp4"`; a completed fixture must settle `videoUrl === "/generated/videos/local.mp4"`. Live: `job-status` returns `/generated/videos/…mp4` and the file exists.

### H4 · major · `components/nodes/VideoGeneratorNode.tsx:431` (also `:362-366`)

**Symptom.** If the SSE connection drops once during a render (dev-server restart, network change, sleep), the node stays on "Generating…" forever in that tab and a Run Pipeline wave never advances (`lib/usePipelineRunner.ts:78-80` waits on `status`). After a server restart nobody asks for the task, so the server poller is not re-armed either; the job only resumes on a page reload.

**Root cause.**
```tsx
es.onerror = () => es.close();
```
This disables EventSource's built-in reconnect, which would have hit `/api/job-stream` and re-armed the poller.
Related: `goToGen` sets `status: "done"` when the user browses to an older generation while a job runs (`:366`), which tears the stream down; the result lands only after navigating back to the empty slot, and generating again in that state overwrites `taskId`, so the first result never reaches the node.

**Fix.** Replace the EventSource effect (`:405-434`) with the polling effect `GenerateNode` already uses (`components/nodes/GenerateNode.tsx:408-462`: `setInterval` on `/api/job-status`, immediate poll on `visibilitychange`, network errors ignored), reading `json.videoUrl` instead of `json.imageUrl`. `job-status` reads the file-backed jobStore and re-arms the poller on every call, so this also removes H5 and the SSE part of H2. For the history case, remember the slot at submit (for example `pendingSlot`) and write the result there instead of `currentGenIdx`.

**Verify.** Live: start a HeyGen job, then (only when no other test is using the server) restart the dev server; the node must finish without a reload. Cheaper: DevTools "Block request URL" on the status endpoint for a few seconds, then unblock.

### H5 · major (conditional regression) · `lib/jobEvents.ts:6` vs `lib/heygenJobPoller.ts:6-8`

**Symptom.** Every canvas video generation (HeyGen, Flow, Kie) can sit on "Generating…" until the 12 min SSE cap and then show "Generation timed out", while `job-status`, SQLite and the gallery already say done.

**Root cause.** `9e62bc4` states that in this dev setup "module-level singletons gave the submit route and job-status their own … poller active sets" and pinned the three `active` sets on `globalThis`:
```ts
// lib/heygenJobPoller.ts:6-8
const ACTIVE_KEY = Symbol.for("heliosgen.heygen-poller.active");
const active = ((globalThis as ...)[ACTIVE_KEY] ??= new Set<string>());
```
The event bus is still a plain module singleton:
```ts
// lib/jobEvents.ts:6
const jobEvents = new EventEmitter();
```
Before `9e62bc4`, a job-stream route with its own module copy also had its own `active` set, so `resumeHeyGenJob` (`job-stream/route.ts:57`) started a second poller that emitted on job-stream's own emitter; the duplicate poll hid the split. Now `active.has(taskId)` is true, no second poller starts, and the only `emit` happens on the submit route's emitter. The SSE listener (`job-stream/route.ts:91`) waits on another instance. Conditional: this bites only when the module copies really diverge, which is what that commit reports. Not reproduced live (it needs a paid canvas run).

**Fix.** H4's fix removes the dependency. If job-stream stays, pin the emitter the same way:
```ts
// lib/jobEvents.ts
const g = globalThis as typeof globalThis & { __heliosJobEvents?: EventEmitter };
const jobEvents = (g.__heliosJobEvents ??= new EventEmitter());
```
and make job-stream re-check `jobStore.get(taskId)` every few seconds as a safety net.

**Verify.** Live, after the fix: edit any file under `lib/` while a canvas video job runs; the node must complete without waiting for the cap. Unit: require `lib/jobEvents.ts` twice with `delete require.cache[...]` in between and assert both exports are the same object.

### H6 · major · `lib/heygenJobPoller.ts:94-100`

**Symptom.** A fatal problem during polling (token refresh rejected, 401/403, malformed session id) keeps the node on "Generating…" for the whole window and nothing reaches the server log. Harness run: stubbed `getHeyGenAgentSession` throwing `HeyGen MCP token refresh failed (400)` produced 3 calls in 11 s, no settle, 0 log lines.

**Root cause.**
```ts
} catch (error) {
  // A transient MCP/network failure should not turn a still-running HeyGen job into a false failure.
  if (attempt === MAX_POLLS - 1) {
    settle(taskId, { status: "error", error: error instanceof Error ? error.message : "HeyGen polling failed" });
```

**Fix.** Same shape as `isFatalFlowError` and Kie's `MAX_TRANSIENT_ERRORS = 20` (`lib/kieJobPoller.ts:27`):
```ts
const FATAL = /token file|no access token|no refresh token|token refresh failed \((400|401)\)|MCP HTTP (401|403)\b/i;
let errors = 0;
...
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[heygen-poller] ${taskId} poll error: ${message}`);
  if (FATAL.test(message) || ++errors >= 20) { settle(taskId, { status: "error", error: message }); return; }
}
// reset errors = 0 after every successful MCP read
```
Keep "session not found" transient: HeyGen's status page recorded an outage on 2026-09-09 where `GET /v3/video-agents/{session_id}` returned 404 for all new sessions.

**Verify.** Unit (section 5): a thrown `HeyGen MCP token refresh failed (400)` must settle `error` within 1 s; a thrown `HeyGen MCP HTTP 503` must not.

### H7 · major (latent) · `lib/heygenJobPoller.ts:44`, `:86-93`

**Symptom.** A video that failed, or that is still processing, can be settled as done with `https://app.heygen.com/videos/<id>` (an HTML page) as `videoUrl`. Node and gallery then show an unplayable video for good, and a failure is reported as success. Harness with HeyGen's documented `VideoDetail` shape: a `failed` item with `video_page_url` set settled `{"status":"done","videoUrl":"https://app.heygen.com/videos/v_1"}`; same for `processing` with `video_page_url` set.

**Why latent.** The probe saw `video_page_url` null on `pending` videos and set on `completed` ones. `processing` and `failed` items did not exist on this account, so how often it fires is unknown.

**Root cause.** Any http string under any key that contains "video" counts, and the URL check runs before the failure check:
```ts
// :44
if (key.toLowerCase().includes("video") && typeof item === "string" && item.startsWith("http")) return item;
// :86-90
if (url) { settle(taskId, { status: "done", videoUrl: url }); return; }
if (state.includes("error") || state.includes("fail") || state.includes("cancel") || state === "stopped") {
```
The video item's own `status` and `failure_message` are never read.

**Fix.** Follow HeyGen's documented flow (session until `video_id`, then only the video) with typed reads:
```ts
type Session = { status?: string; video_id?: string | null; error?: { message?: string } | null };
type Video = { status?: string; video_url?: string | null; failure_message?: string | null };
let videoId: string | undefined;
...
if (!videoId) {
  const s = await getHeyGenAgentSession(sessionId) as Session;
  if (s.status === "failed") return settle(taskId, { status: "error", error: s.error?.message ?? "HeyGen video agent failed" });
  videoId = s.video_id ?? undefined;
}
if (videoId) {
  const v = await getHeyGenVideo(videoId) as Video;
  if (v.status === "completed" && v.video_url) { /* mirror (H3), then settle done */ }
  if (v.status === "failed") return settle(taskId, { status: "error", error: v.failure_message ?? "HeyGen render failed" });
}
```
This removes `videoUrlOf`/`stringAt`/`statusOf`, halves MCP traffic (H14) and sidesteps session-endpoint outages once the video id is known.

**Verify.** Unit (section 5): `processing` plus page URL gives no settle; `failed` plus page URL gives `error` carrying `failure_message`; `completed` gives done with `video_url`.

### H8 · minor · `lib/heygenJobPoller.ts:90-91`

Failures only say `HeyGen video agent ended with status: failed`; HeyGen's reason (`session.error.message`, `failure_message`) is dropped (harness: "Prompt rejected by content policy" was lost). `waiting_for_input` and `reviewing` are not handled, so a session that pauses spins until the deadline (should not happen in `generate` mode, but nothing guards it). **Fix:** H7's typed reads carry the reason; add `if (s.status === "waiting_for_input" || s.status === "reviewing")` then settle `error` with the last `model` message from `s.messages`. **Verify:** one unit fixture per status.

### H9 · minor · `lib/modelConfig.ts:1169`, `lib/heygenMcp.ts:330-334`

HeyGen accepts only `orientation: landscape | portrait`. The node offers `1:1`, `4:5`, `5:4`, silently mapped (`1:1` yields a landscape video). **Fix:** `ratios: ["9:16", "16:9"]`. **Verify:** config assertion in the style of `scripts/kling-veto.test.cjs`.

### H10 · minor · `lib/modelConfig.ts:1182`

`promptMaxLength: 20000`, but `create_video_agent.prompt` is 1 to 10000 characters. A 10,001 to 20,000 character prompt passes the node check and fails at submit, after all uploads. **Fix:** `promptMaxLength: 10000`. **Verify:** config assertion.

### H11 · minor · `components/nodes/VideoGeneratorNode.tsx:1916`

`disabled={promptOverLimit || kieKeySet === false || …}` blocks HeyGen (and Flow) when no Kie key is saved, although neither uses Kie. `GenerateNode.tsx:1338` already exempts Codex. **Fix:** `const needsKie = !cfg.apiInput.useHeyGenMcp && !cfg.apiInput.useFlow;` then `(needsKie && kieKeySet === false)`. **Verify:** live, delete the Kie key in Settings; the HeyGen node's Generate button stays enabled.

### H12 · minor · `lib/workflow-runtime/generationPayloads.ts:16`, `:30-31`

`resolveMentions` exists for Kie's positional tags and rewrites the HeyGen prompt: `@Label` becomes `<<<image N>>>`, any other `@word` (for example a social handle inside the script) is replaced too when resources are connected, and connected images that are not mentioned are dropped from `files`. **Fix:**
```ts
const heygen = VIDEO_MODELS.find((m) => m.id === model)?.apiInput.useHeyGenMcp;
const raw = String(inputs.prompt ?? data.prompt ?? "");
const { resolvedPrompt, orderedUrls } = heygen
  ? { resolvedPrompt: raw, orderedUrls: resources.map((r) => r.url) }
  : resolveMentions(raw, resources.map((r) => r.label), resources.map((r) => r.url));
```
**Verify:** unit on `buildVideoPayload` with two resources and the prompt `"Follow @rafa.lima"`: prompt unchanged, both URLs present.

### H13 · minor · `app/api/generate-video/route.ts:74-98` (`:95`)

Anything that throws after `submitHeyGenVideo` resolves leaves a paid HeyGen session with no SQLite row and no poller, while the caller gets 500. Reproducible with a body carrying `"referenceImageUrls": null` (destructuring defaults only apply to `undefined`): `uniqueUrls` tolerates null so the submit succeeds, then `[...(rawRefImages as string[]), …]` at `:95` throws. **Fix:** normalize before submitting, `const list = (v: unknown) => Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : [];`, use it for both calls, and wrap `jobStore.set`/`insertGeneration` in a try/catch that logs but still starts the poller and returns the `taskId`. **Verify:** unit on `POST` with `lib/heygenMcp.ts` stubbed (`submitHeyGenVideo` resolves) and `referenceImageUrls: null`: expect 200 with `taskId`.

### H14 · minor · `lib/heygenMcp.ts:161`, `:194-215`

Each `heygenMcpCall` costs 3 HTTPS round trips (`initialize`, `notifications/initialized` answered 202, `tools/call`). The poller makes one or two calls per 5 s loop, about 30 to 50 requests per minute, against HeyGen's 10 to 30 s recommendation. `fetch` has no timeout, so one stalled request freezes the loop until undici's 300 s default. **Fix:** H2's 15 s interval, H7's single `get_video` per loop, and `signal: AbortSignal.timeout(30_000)` on the MCP, refresh and media fetches. **Verify:** unit with a `fetch` that never resolves: `heygenMcpCall` rejects after the timeout (fake timers or a small injected value).

### H15 · minor · `lib/heygenMcp.ts:124`, `:130-134`, `:163`

Refresh happens only when `expires_at` says so. A 401 (token revoked, rotated by Hermes, or a file without `expires_at`) becomes `HeyGen MCP HTTP 401` with the body thrown away and no retry. If `persistToken` fails after HeyGen already issued new tokens (for example `rename` EPERM on Windows while Hermes holds the file), the refresh rejects and the new tokens are lost; if HeyGen rotates refresh tokens, that forces a new `hermes mcp login heygen`. **Fix:** keep `sanitizeError(text.slice(0, 300))` in the `rpc` error; on 401 in `heygenMcpCall`, `refreshAccessToken(await readTokenFile())` once and retry; in the refresh, `await persistToken(merged).catch((e) => console.error("[heygen] token persist failed", e))` and still return the new access token. **Verify:** unit with `HEYGEN_MCP_TOKEN_FILE` pointing to a temp file and a fake `fetch` answering 401, then the refresh, then 200.

### H16 · minor · `lib/workflow-runtime/generationPayloads.ts:21`, `lib/workflow-runtime/store.ts:23`

HeyGen steps carry `duration: Number(data.duration ?? 5)` (a leftover from whatever model the node used before, or 5) and the approval gate compares it with `maxVideoSeconds`. HeyGen's agent picks the length, so the cap does not bound spend, and a stale duration can reject a valid run with `approval_limits_exceeded`. **Fix:** omit `duration` for HeyGen in `buildVideoPayload`; in `createRun`, require an explicit flag (for example `approval.allowPremium`) for `provider === "heygen"` steps. **Verify:** unit on `compilePlan` plus `createRun` with a HeyGen node carrying `duration: 15` and `maxVideoSeconds: 10`.

### H17 · minor · `lib/heygenMcp.ts:52`

```ts
.replace(/(?:access_token|refresh_token|token|api[_-]?key|secret)=[^\s&]+/gi, "$1=[redacted]");
```
There is no capture group, so errors show a literal `$1=[redacted]` (the secret is still removed). **Fix:** drop the `?:`. **Verify:** `"token=abc".replace(re, "$1=[redacted]") === "token=[redacted]"`.

### H18 · minor · `app/api/heygen/avatar/route.ts:7-10`, `lib/heygenMcp.ts:251-262`

The avatar route only accepts two folders that exist on this machine and has no caller in the app. `defaultContentType` maps `.heic`, `.avif`, `.gif`, `.webm`, `.m4a` to `application/octet-stream`, which HeyGen checks against the bytes at `complete_asset_upload`. **Fix:** roots from an env var (for example `HEYGEN_AVATAR_ROOTS`, `;`-separated, defaulting to the current two) and the missing extensions in `defaultContentType`. **Verify:** unit on `defaultContentType` once exported, or a live POST with a file inside an allowed root.

---

## 5. Test harness for the poller findings

The repo's transpile pattern plus `require.cache` stubs reaches the real poller without network, disk or credits, as long as each case ends on its first poll. This is the harness used for this audit, as a proposed `scripts/heygen-poller.test.cjs`. Today H2, H3, H6 and H7 fail; after the fixes all pass. Run with `node --test --test-force-exit scripts/heygen-poller.test.cjs` (the unfixed poller keeps 5 s timers alive).

```js
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const stub = (rel, exports) => {
  const file = require.resolve(path.join(ROOT, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

let fx = {};
let createdAt = new Date().toISOString();
stub("lib/jobStore.ts", { jobStore: { set() {}, get() {} } });
stub("lib/guest/db.ts", { updateGeneration() {}, recoverJob: () => ({ status: "pending", generation_type: "video", created_at: createdAt }) });
stub("lib/storage.ts", { mirrorToR2: async () => "/generated/videos/local.mp4" });
const read = async (key) => { if (fx.throws) throw new Error(fx.throws); return fx[key]; };
stub("lib/heygenMcp.ts", {
  getHeyGenAgentSession: () => read("session"),
  listHeyGenAgentVideos: async () => ({ items: fx.video ? [fx.video] : [] }),
  getHeyGenVideo: () => read("video"),
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { jobEvents } = require("../lib/jobEvents.ts");
const { resumeHeyGenJob } = require("../lib/heygenJobPoller.ts");

let n = 0;
function run(fixture) {
  fx = fixture;
  const id = `heygen-agent:t${n++}`;
  const settled = new Promise((resolve) => {
    jobEvents.once(`job:${id}`, resolve);
    setTimeout(() => resolve(null), 1000).unref();
  });
  resumeHeyGenJob(id);
  return settled;
}
const video = (o) => ({ id: "v_1", status: "processing", video_url: null, video_page_url: null, failure_message: null, ...o });
const PAGE = "https://app.heygen.com/videos/v_1";
const MP4 = "https://files2.heygen.ai/v.mp4?Expires=1&Signature=s&Key-Pair-Id=k";

test("H3: a completed video is stored locally", async () => {
  const r = await run({ session: { status: "completed", video_id: "v_1" }, video: video({ status: "completed", video_url: MP4, video_page_url: PAGE }) });
  assert.equal(r?.videoUrl, "/generated/videos/local.mp4");
});
test("H7: a processing video with a page URL is not done", async () => {
  const r = await run({ session: { status: "generating", video_id: "v_1" }, video: video({ video_page_url: PAGE }) });
  assert.equal(r, null);
});
test("H7/H8: a failed video is an error carrying HeyGen's reason", async () => {
  const r = await run({ session: { status: "failed", video_id: "v_1", error: { message: "Avatar look is not available" } }, video: video({ status: "failed", failure_message: "Avatar look is not available", video_page_url: PAGE }) });
  assert.equal(r?.status, "error");
  assert.match(r.error, /Avatar look/);
});
test("H6: a fatal auth error settles at once", async () => {
  const r = await run({ throws: "HeyGen MCP token refresh failed (400)" });
  assert.equal(r?.status, "error");
});
test("H2: the deadline counts from created_at", async () => {
  createdAt = new Date(Date.now() - 61 * 60_000).toISOString();
  const r = await run({ session: { status: "generating", video_id: null } });
  createdAt = new Date().toISOString();
  assert.equal(r?.status, "error");
});
```

Once H2, H6, H7 and H8 land, the lazier long-term shape is the Flow precedent: move the decisions into a pure `lib/heygenPollPolicy.ts` (`heygenDeadlineMs`, `isFatalHeyGenError`, `outcome(session, video)`) and assert on it synchronously, as `scripts/flow-reliability.test.cjs` does for `lib/flowPollPolicy.ts`.

---

## 6. Live test: one real HeyGen generation through the API (not run)

Pre-flight (free):
```bash
curl -s http://127.0.0.1:3000/api/heygen/status
# expect {"ok":true,"provider":"heygen-mcp","account":{...}}

curl -s -X POST http://127.0.0.1:3000/api/generate-video -H "Content-Type: application/json" \
  -d '{"videoModel":"heygen-video-agent","prompt":"test","aspectRatio":"9:16","debugOnly":true}'
# expect {"debugProvider":"heygen-mcp","videoModel":"heygen-video-agent","prompt":"test","aspectRatio":"9:16"}; nothing reaches HeyGen
```

Real run (spends HeyGen premium credits):
```bash
curl -s -X POST http://127.0.0.1:3000/api/generate-video -H "Content-Type: application/json" \
  -d '{"videoModel":"heygen-video-agent","aspectRatio":"9:16","prompt":"Vertical video, about 8 seconds, no background music. One friendly presenter looks into the camera and says: This is ANVIL, the night forge for AI video."}'
# -> {"taskId":"heygen-agent:<session_id>","provider":"heygen"}

T='heygen-agent:<session_id>'
until r=$(curl -s "http://127.0.0.1:3000/api/job-status?taskId=$T"); echo "$(date +%T) $r"; echo "$r" | grep -q '"status":"\(done\|error\)"'; do sleep 20; done
```

What finished looks like:

- `job-status`: `{"status":"done","videoUrl":"https://files2.heygen.ai/...mp4?Expires=...&Signature=...&Key-Pair-Id=...","ts":...}` today; after H3, `"videoUrl":"/generated/videos/<uuid>.mp4"`.
- `GET /api/gallery?type=video` lists it first with `"model":"heygen-video-agent"`.
- In the HeyGen app: a private Video Agent session with one completed video.
- Expected time: about 4 minutes for a clip this short (this account: 0.8 min agent plus 2.9 min render). While pending, `job-status` returns `{"status":"pending","type":"video",...}`. Past about 15 to 18 minutes the current poller gives up (H2).
- Failure: `{"status":"error","error":"HeyGen video agent ended with status: failed"}`. A submit-time problem (bad `avatarId`, expired OAuth) comes back as HTTP 500 `{"error":"..."}` from the POST.
- To also exercise the asset upload path (not verified live), add `"referenceImageUrls":["/generated/<an existing image>"]` (dev only; the desktop build hits H1).

---

## 7. Verified vs not verified

Verified:
- Tool and argument names against HeyGen's schemas (Hermes cache plus HeyGen v3 reference).
- Token refresh, MCP handshake, `tools/call` decoding through the app's own code (`GET /api/heygen/status`).
- Response shapes from the probe: flat snake_case objects, `items` lists, session statuses `thinking | waiting_for_input | reviewing | generating | completed | failed`, `video_page_url` null on `pending` and set on `completed`, signed `video_url` lifetime about 5 days, render times quoted in H2.
- Poller behavior on documented shapes and on a fatal error (harness runs quoted in H6, H7, H8; H3 shows the remote URL being stored).
- `tsc`: no HeyGen-related type errors.

Not verified (needs one paid run with a reference image):
- `create_asset_upload`, PUT with `upload_headers`, `complete_asset_upload`, and whether `create_video_agent` accepts assets still in `status: "processing"` (that is what `complete_asset_upload` returns).
- `create_video_agent`'s live response (assumed flat `{session_id, status, video_id, created_at}` like the other tools; `findString` finds `session_id` in either shape).
- `video_page_url` on `processing` and `failed` videos (decides how often H7 fires).
- Whether `jobEvents` actually diverges between routes in the running dev server (H5).

---

## 8. Noted, out of scope

- `runAll` in `components/WorkflowCanvas.tsx:1151` has no caller. If it is ever revived it marks video nodes done with `videoUrl: undefined` (`:1381`), because `/api/generate-video` returns only a `taskId`.
- `/api/heygen/avatar` still parses any `Content-Type`, so a cross-site page can reach it without a CORS preflight; `/api/generate-video` gained a JSON-only guard in `8c0e5c0`. Low risk here (source path must sit inside the two allowed folders).
- The status route refreshes and rewrites the shared Hermes token file as a side effect of a GET. Fine, but worth knowing before wiring it into Settings.
