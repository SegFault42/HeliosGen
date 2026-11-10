# Canvas → Google Flow audit (UI + workflow runtime)

Scope: the path from the canvas nodes and the durable workflow runtime to the Flow provider, for four flows: image via Flow, text to video, start frame to video, frame A to B. The live API smoke (`scripts/flow-smoke.mjs`) covers direct API calls only; this audit covers what it does not.

Base: `HEAD 8c0e5c0` (a parallel session landed `9e62bc4` and `8c0e5c0` while this audit ran) plus that session's still uncommitted edits in `app/api/generate/route.ts`, `lib/guest/localStorage.ts`, `lib/kieUpload.ts`, `lib/workflow-runtime/compiler.ts` (state at 2026-09-23 ~00:30). All `path:line` references are to that working tree. Nothing in `app/`, `lib/`, `components/`, `scripts/` was modified by this audit.

Method: end to end code trace of the four flows; read-only queries on `data/guest.db` (tables `spaces`, `generations`, `uploads`, `asset_cache`) and on `%LOCALAPPDATA%/flow-mcp/jobs/*.json`; `ffprobe` of files in `public/generated/flow`; throwaway proof tests (repo transpile pattern, run from the OS temp dir, 4/4 pass); `npx tsc --noEmit -p .`; the existing offline tests.

---

## 1. Verdict on "it did NOT USE THE FRAME I put"

1. In every recorded Flow video that had a frame, the UI sent a resolvable `/generated/...` path as `startFrameUrl`, and the file exists on disk:
   - `flow-video:35d9ee75` (the only canvas-originated start frame run, space "Space 9", 2026-09-16): `/generated/flow/flow-828ebf0a.jpeg`, coming from a Reference Image node whose `r2Url` held that path.
   - `flow-video:7accee0d`, `5aaa968f`, `93cdaf25` (2026-09-21): `/generated/flow/flow-090e8b7b.jpeg`.
   - `flow-video:a6d2b2e7`: `/generated/images/76c00027-23fc-4ca7-bb14-d8f5175e2486.jpg`.
   So for the recorded runs the frame reached `submitFlowVideo` and was pushed into `referenceFiles`. The loss happened after that, on the MCP side: `a6d2b2e7` finished in 12 s and `5aaa968f` in 36 s (not a real generation, consistent with the echo/old-asset bug being fixed separately), and `flow-35d9ee75.mp4` is not a playable file (`ffprobe`: "moov atom not found"). See section 5.
2. The UI side still has deterministic ways to lose the frame with the exact same symptom, and none of them is visible: `dlog` prints only with `ANVIL_DEBUG=1` (`lib/debugLog.ts:2`), the MCP job record does not store `referenceFiles`, and the DB column `reference_image_urls` stores the raw URL even when it was dropped. The two that matter most are **F1** (the Flow path silently drops any URL form it cannot map into `MEDIA_DIR`) and **F2** (the UGC Template image nodes keep a stale `r2Url` that wins over the image the node displays).

---

## 2. How the frame travels

| Step | Code | Field / value |
|---|---|---|
| 1. Pick the URL from the source node | `lib/executor.ts:147-152` via `resolveImageUrl` `lib/executor.ts:81-90` | `capturedFrameUrl ?? r2Url ?? inputImage ?? imageUrl`; for video sources wired from `startFrameOut` / `endFrameOut` / `imagePickOut` only `eagerStartFrameUrl` / `eagerEndFrameUrl` / `capturedFrameUrl` (`lib/executor.ts:82-84`) |
| 2. Build the payload | `buildVideoPayload` `lib/workflow-runtime/generationPayloads.ts:13-34` | `startFrameUrl`, `endFrameUrl` (lines 27-28). Same builder for the manual node (`components/nodes/VideoGeneratorNode.tsx:909-918`), the durable runner (`lib/workflow-runtime/runner.ts:36`) and the plan preview (`lib/workflow-runtime/compiler.ts`). The gallery builds its own (`app/gallery/page.tsx:1672-1673`, `1756-1757`) |
| 3. Route | `app/api/generate-video/route.ts:101-129` | raw strings passed as `startFrame` / `endFrame` / `referenceImages` (lines 107-109). No normalization, while every other provider branch runs `ensureR2` first (lines 158, 174, 218, 250, 288, 314, 404) |
| 4. Adapter | `lib/flowAdapter.ts:175-198` | `resolveLocalPath` (151-155) → `referenceFiles = [start, end, ...refs, read-this.png]` → `flow.generate({ referenceFiles, prompt, aspectRatio, upscale })` |
| 5. MCP | `F:/CLAUDE/AGENT_AI/google-flow-mcp/dist/flow-adapter.js:358-361` | `attachReferences` (sidebar upload, no frame slot) then `fillPrompt("Create exactly one video: <prompt>")` |

URL forms that reach step 4, and what happens to them today (proved by a throwaway test calling the exported `resolveLocalPath`):

| Form | Where the UI produces it | Result in the Flow path |
|---|---|---|
| `/generated/<folder>/<file>` | finished uploads (`/generated/uploads/...`), Flow and kie outputs (`/generated/flow/...`, `/generated/images/...`), extracted frames (`/generated/references/...`) | resolved (if the file exists) |
| `http://localhost:<port>/generated/...` | anvil / CLI callers | resolved (added in 8c0e5c0, `lib/guest/media.ts` `toMediaUrl`) |
| `blob:http://localhost:3000/<uuid>` | Reference Image right after a drop or file pick, and forever if the upload failed | **dropped silently** |
| `data:image/...;base64,...` | Reference Image via paste/URL until `/api/upload` returns, or if it fails | **dropped silently** |
| `https://pub-...r2.dev/...` | UGC Template image nodes (stale `r2Url`, F2) and the template "Avatar" Reference Image | **dropped silently** |
| `/generated/...` whose file is gone | deleted media | **dropped silently** |
| Windows path `D:\...` | not produced by the UI; CLI callers | **dropped silently** (rejected on purpose by 8c0e5c0) |

---

## 3. Summary

| ID | Sev | Where | One line |
|---|---|---|---|
| F1 | High | `lib/flowAdapter.ts:151-179`, `app/api/generate-video/route.ts:107-108` | Unresolvable frame URLs are dropped without error; the Flow branch skips the `ensureR2` normalization every other provider gets |
| F2 | High | `lib/executor.ts:85-89`, `lib/templates.ts:195-196` | Stale `r2Url` on image generator nodes beats the `imageUrl` the node displays (UGC Template) |
| F3 | High | `lib/jobEvents.ts:6`, `lib/flowJobPoller.ts:11-12,106`, `app/api/job-stream/route.ts:58,91` | After 9e62bc4 the SSE bus is still per bundle while pollers are per process: the canvas video node can miss completion for every provider |
| F4 | High | `app/api/job-stream/route.ts:15,87-89`, `lib/flowPollPolicy.ts:2`, `components/nodes/VideoGeneratorNode.tsx:425-431` | Canvas video node reports "Generation timed out" at 12 min; Flow keeps running to 20 min |
| F5 | Medium | `app/api/generate-video/route.ts:110` | Resolution picker ignored: every Flow video requests the 1080p upscale |
| F6 | Medium | `lib/modelConfig.ts:620-643` | "Veo Frame A->B" is Veo Fast plus images: no required frames, `isInterpolation` read nowhere, no first/last role |
| F7 | Medium | `lib/flowAdapter.ts:14-18,194-198` | Omni Flash prompts over 200 chars silently become a PNG + "read this", appended after the start frame; never run live |
| F8 | Medium | `app/api/extract-frame/route.ts:30` | Frame extraction from any local video fails (server fetch of a relative URL); frame-out chains lose the frame |
| F9 | Medium | `components/nodes/VideoGeneratorNode.tsx:806`, `components/WorkflowCanvas.tsx:517,533`, `components/nodes/ImageInputNode.tsx:131,141-143` | A `blob:` frame (upload in flight or failed) passes the node guard and is sent |
| F10 | Medium | `app/gallery/page.tsx:1786-1793` | Gallery gives up on a Flow job after 7.5 min |
| F11 | Low | `lib/workflow-runtime/generationPayloads.ts:10`, `components/WorkflowCanvas.tsx:1030` | Flow image prompts carry kie `<<<image N>>>` tags; `maxImages: 1` not enforced |
| F12 | Low | `components/nodes/VideoGeneratorNode.tsx:1916`, `components/nodes/GenerateNode.tsx:1338`, `app/gallery/page.tsx:1797,2218` | Flow generation disabled when no Kie key is set |
| F13 | Low | `components/nodes/VideoGeneratorNode.tsx:1292`, `components/nodes/GenerateNode.tsx:933` | Error overlay says "Credits refunded" on Flow errors; screenshot path is plain text |
| F14 | Low | `components/nodes/GenerateNode.tsx:322`, `lib/workflow-runtime/generationPayloads.ts:11,21`, `lib/modelConfig.ts:561,584,607,630` | UI vs payload defaults: ratio 9:16 shown but 1:1 sent when unset; duration 5 sent for Flow; Sound toggle is a no-op |
| F15 | Low | `lib/workflow-runtime/runner.ts:33`, `lib/usePipelineRunner.ts:85`, `lib/workflow-runtime/productionTransport.ts:4`, `components/nodes/VideoGeneratorNode.tsx:957-969` | Durable/pipeline edges: stale eager frames, pipeline hang, 300 s fetch limit vs blocking submit, reload mid-submit strands the node |
| F16 | Low | `components/WorkflowCanvas.tsx:1151-1393` (1381) | Dead `runAll` marks a video "done" from the POST response |

---

## 4. Findings

### F1 (High) Flow path drops unresolvable frames without an error

- **Where:** `lib/flowAdapter.ts:151-155` (`resolveLocalPath`), `lib/flowAdapter.ts:175-179` (start/end), `:183` (video refs), `:246` (image refs); `app/api/generate-video/route.ts:107-108`; `app/api/generate/route.ts:184` and `:352`.
- **Symptom:** the video is generated as text to video; the node shows success; the DB lists the frame in `reference_image_urls`; nothing is logged unless `ANVIL_DEBUG=1`.
- **Root cause:**

```ts
// lib/flowAdapter.ts:151-155
export function resolveLocalPath(url?: string): string | null {
  const media = typeof url === "string" ? toMediaUrl(url.trim()) : null;
  const abs = media && mediaPathFor(media);
  return abs && fs.existsSync(abs) ? abs : null;
}
// lib/flowAdapter.ts:175-179
  const startAbs = resolveLocalPath(params.startFrame);
  if (startAbs) referenceFiles.push(startAbs);

  const endAbs = resolveLocalPath(params.endFrame);
  if (endAbs) referenceFiles.push(endAbs);
```

```ts
// app/api/generate-video/route.ts:107-108 (raw strings, no ensureR2 unlike lines 158/174/218/250/288/314/404)
      startFrame: typeof rawStartFrame === "string" ? rawStartFrame : undefined,
      endFrame: typeof rawEndFrame === "string" ? rawEndFrame : undefined,
```

  The image route normalizes (`ensureR2`) but swallows failures, then falls back to the raw list: `app/api/generate/route.ts:184` `ensureR2(u, "references").catch(() => null)` and `:352` `referenceImages: r2ImageUrls.length > 0 ? r2ImageUrls : (imageUrls as string[])`. A partial failure drops one reference silently; a total failure sends raw URLs that `resolveLocalPath` then drops.
- **Fix (one place, all callers go through it):** in `lib/flowAdapter.ts`, normalize with the existing `ensureStorage` (`lib/guest/localStorage.ts:142-147`, re-exported by `lib/storage.ts:11`: decodes `data:`, passes local `/generated` URLs through, mirrors remote http(s) into `MEDIA_DIR` behind the new SSRF guard, rejects `blob:` and filesystem paths) and throw instead of skipping. This keeps the 8c0e5c0 invariant "only files inside MEDIA_DIR are uploaded to Google".

```ts
import { ensureStorage } from "@/lib/storage";

/** MEDIA_DIR file for a frame/reference URL. Throws instead of silently dropping it. */
export async function flowFile(url: string): Promise<string> {
  const local = await ensureStorage(url.trim(), "references").catch(() => null);
  const abs = local && resolveLocalPath(local);
  if (!abs) throw new Error(`Flow could not use the connected image (${url.slice(0, 60)}). If it was just added, wait for the upload to finish and retry.`);
  return abs;
}

// submitFlowVideo: replaces lines 175-188 (order kept: start, end, refs; also dedupes start === end)
for (const url of [params.startFrame, params.endFrame, ...(params.referenceImages ?? [])]) {
  if (!url) continue;
  const abs = await flowFile(url);
  if (!referenceFiles.includes(abs)) referenceFiles.push(abs);
}
// submitFlowImage: same loop over params.referenceImages
```

  and `app/api/generate/route.ts:352` becomes `referenceImages: imageUrls as string[]` for the Flow branch (the adapter normalizes). The route's outer catch already turns the throw into a 500 that the node shows.
- **Verify:** unit test next to `scripts/flow-local-path.test.cjs` (same `HELIOS_MEDIA_DIR` / `HELIOS_DATA_DIR` temp setup): `flowFile("data:image/png;base64,<1x1 png>")` resolves to a path inside the temp media dir; `flowFile("blob:http://localhost:3000/x")` and `flowFile("/generated/missing.png")` reject. Live: drop a large PNG on the canvas, wire it to Start frame and click Generate immediately; the node must show the error instead of producing a text-only video.

### F2 (High) Stale `r2Url` on image generator nodes overrides the displayed image

- **Where:** `lib/executor.ts:85-89`; `lib/templates.ts:195-196`; writers that only set `imageUrl`: `components/nodes/GenerateNode.tsx:426` (completion) and `:372` (carousel `goToGen`).
- **Symptom:** in any "UGC Template" space (6 copies in the DB), regenerate "Image Generator #N" with any model, then generate "Video Generator #N": the start frame sent is the old template image. With a Flow video model it is a remote R2 URL, so F1 drops it (text only); with kie the old image is animated.
- **Root cause:**

```ts
// lib/templates.ts:195-196 (generateNode seeded as "done")
        imageUrl: REF_IMAGES[i],
        r2Url: REF_IMAGES[i],
// lib/executor.ts:85-89 (r2Url checked before imageUrl for every node type)
  return (resolveVideoNodeFrameUrl(src, sourceHandle)
    ?? src.data.capturedFrameUrl
    ?? src.data.r2Url
    ?? src.data.inputImage
    ?? src.data.imageUrl) as string | undefined;
```

  Proved with `resolveInputs`: a generateNode with `imageUrl: "/generated/flow/NEW.jpeg"` and `r2Url: "https://pub-x.r2.dev/.../1.png"` yields `startFrameUrl = "https://pub-x.r2.dev/.../1.png"`. The durable runner is immune because it overwrites `r2Url` with the step output (`lib/workflow-runtime/runner.ts:33`).
- **Fix:** in `resolveImageUrl`, right after the frame-out branch: `if (src.type === "generateNode") return src.data.imageUrl as string | undefined;`. Optionally drop `r2Url: REF_IMAGES[i]` from `lib/templates.ts:196`.
- **Verify:** transpile-pattern test on `resolveInputs` with the graph above expecting `/generated/flow/NEW.jpeg`. Live: open a UGC Template space, set Image Generator #1 to "Nano Banana 2 (Flow)", generate, set Video Generator #1 to "Omni Flash 1.1 (Flow)", generate, and check in DevTools that `startFrameUrl` is the new `/generated/flow/...` path.

### F3 (High) SSE completion bus is not process-global, and 9e62bc4 removed the accidental workaround

- **Where:** `lib/jobEvents.ts:6`; `lib/flowJobPoller.ts:11-12` and `:106`; `app/api/job-stream/route.ts:58` and `:91`. Same pattern for `lib/kieJobPoller.ts` and `lib/heygenJobPoller.ts` (their active sets also moved to `globalThis` in 9e62bc4).
- **Symptom (expected when route bundles hold separate module instances, which the 9e62bc4 commit message reports was observed):** a canvas video node keeps spinning after the job is done (the gallery already shows it) and flips to "Generation timed out" at 12 min. Affects every video provider on the canvas, because only `VideoGeneratorNode` uses SSE. Image nodes, the gallery and durable runs poll the file-backed `jobStore` and are not affected.
- **Root cause:** the poller started by `/api/generate-video` emits on its bundle's `jobEvents`; `/api/job-stream` listens on its own. Before 9e62bc4 the per-bundle `active` set made `job-stream` start a second poller that emitted on the right bus; now the shared set makes that call a no-op.

```ts
// lib/jobEvents.ts:6
const jobEvents = new EventEmitter();
// lib/flowJobPoller.ts:106 (active is now global)
  if ((!taskId.startsWith("flow-video:") && !taskId.startsWith("flow-image:")) || active.has(taskId)) {
// app/api/job-stream/route.ts:91
      jobEvents.once(`job:${taskId}`, send);
```

  Proved: evaluating `lib/jobEvents.ts` twice gives two emitters, and an emit on one is not heard on the other.
- **Fix (same pattern as 9e62bc4):**

```ts
const KEY = Symbol.for("heliosgen.job-events");
const g = globalThis as typeof globalThis & { [KEY]?: EventEmitter };
const jobEvents = (g[KEY] ??= new EventEmitter());
jobEvents.setMaxListeners(500);
```

- **Verify:** transpile-pattern test that requires `lib/jobEvents.ts`, deletes it from `require.cache`, requires it again and asserts the same instance. Live: Omni Flash text to video on the canvas; the node must turn "done" within a few seconds of the gallery showing the video.

### F4 (High) Canvas video node gives up at 12 min, Flow deadline is 20 min

- **Where:** `app/api/job-stream/route.ts:15` and `:87-89`; `lib/flowPollPolicy.ts:2`; `components/nodes/VideoGeneratorNode.tsx:425-427` and `:431`.
- **Symptom:** "Generation timed out" on the node after 12 min; the poller messages "Flow timed out after 20 min" and "... (screenshot: path)" never reach a video node for jobs over 12 min; a late success appears only in the gallery. Recorded Flow video jobs took 21.6, 26.8 and 35.3 min.
- **Root cause:**

```ts
// app/api/job-stream/route.ts:15, 87-89
const TIMEOUT_MS = 12 * 60 * 1000; // 12 min hard cap
      const timeout = setTimeout(() => {
        send({ status: "error", error: "Generation timed out" });
      }, TIMEOUT_MS);
// lib/flowPollPolicy.ts:2
export const FLOW_VIDEO_DEADLINE_MS = 20 * 60_000;
// components/nodes/VideoGeneratorNode.tsx:431 (no reconnect, node stays "running")
    es.onerror = () => es.close();
```

- **Fix:** move the cap next to the deadline, `export const SSE_TIMEOUT_MS = FLOW_VIDEO_DEADLINE_MS + 2 * 60_000;` in `lib/flowPollPolicy.ts`, import it in `job-stream` (route files should only export handlers). In `VideoGeneratorNode.tsx:431` drop `es.close()` from `onerror` so EventSource auto-reconnects; `job-stream` answers already-settled jobs immediately (`route.ts:40-43`).
- **Verify:** add to `scripts/flow-reliability.test.cjs`: `assert.ok(SSE_TIMEOUT_MS > flowDeadlineMs(true))`. Live: a Veo 3.1 Quality job; the node keeps waiting past 12 min.

### F5 (Medium) 720p is ignored; every Flow video asks for the 1080p upscale

- **Where:** `app/api/generate-video/route.ts:110`; defaults `lib/modelConfig.ts:563,586,609,632`.
- **Symptom:** the resolution pill has no effect; each job adds the upscale step (longer, more exposure to F4). Evidence: every MCP job record checked (`128e17c6` from the smoke with no resolution sent, plus `5aaa968f`, `7accee0d`, `a6d2b2e7`, `24949909`, `35d9ee75`) is stored with `"upscale": "1080p"`, including `35d9ee75` whose canvas node ("Space 9") had `grokResolution: "720p"`.
- **Root cause:** `upscale: rawResolution === "1080p" || cfg.defaultResolution === "1080p" ? "1080p" : "none",` is always true for Flow models.
- **Fix:** `upscale: (rawResolution || cfg.defaultResolution) === "1080p" ? "1080p" : "none",`
- **Verify:** extract a pure `flowUpscale(raw, cfg)` and test 720p → "none", undefined → "1080p". Live: pick 720p, then read `%LOCALAPPDATA%\flow-mcp\jobs\<uuid>.json` (uuid = taskId without `flow-video:`), expect `"upscale": "none"`.

### F6 (Medium) Frame A to B has no interpolation semantics and no frame guard

- **Where:** `lib/modelConfig.ts:620-643` (entry), `:545` (declaration); `lib/flowAdapter.ts:175-179`.
- **Symptom:** with zero or one frame connected the node still submits; with two frames the request is identical to "Veo 3.1 Fast (Flow)" plus two images; the Flow agent is never told which image is first and which is last.
- **Root cause:** the entry has no `requiredHandles`, uses `flowModel: "Veo 3.1 - Fast"` (same as `flow-veo-3.1-fast`) and `isInterpolation: true`, which no code reads (only lines 545 and 641 match). The adapter flattens frames into an unlabeled `referenceFiles` list and the MCP prompt is `Create exactly one video: <prompt>`.
- **Fix:** add `requiredHandles: ["startFrame", "endFrame"]` to the entry (the node, `VideoGeneratorNode.tsx:735-744`, and the gallery, `page.tsx:1806-1831`, already enforce it); in the route return 400 when `cfg.apiInput.isInterpolation && !(rawStartFrame && rawEndFrame)`; in `submitFlowVideo` prepend a role line when frames resolved, for example start only: `Use the attached image as the first frame.`; both: `Use attached image 1 as the first frame and image 2 as the last frame, and animate from one to the other.`
- **Verify:** unit test for a pure `framePrompt(prompt, hasStart, hasEnd)`; config assertion that the interpolation entry requires both handles. Live: connect only Start frame, expect the "Connect all required inputs" toast.

### F7 (Medium) Automatic "read this" bypass changes Omni Flash requests without telling the user

- **Where:** `lib/flowAdapter.ts:14-18` and `:194-198`; nothing in `buildVideoPayload` (`lib/workflow-runtime/generationPayloads.ts:13-34`) or the node sends `readThis`; `components/nodes/PromptNode.tsx:162-177` shows only `N/20000`.
- **Symptom:** any Omni Flash prompt over 200 characters (typical UGC copy, and Omni Flash is `DEFAULT_VIDEO_MODEL`) is rendered to a PNG and replaced by "read this". With a start frame, Flow receives `[frame, text PNG]` and the prompt "Create exactly one video: read this". Never exercised live: no `read-this-*.png` exists in `public/generated/flow`, and the smoke prompts are 53 and 63 characters.
- **Root cause:**

```ts
// lib/flowAdapter.ts:16-18
export function shouldUseReadThis(model: string, prompt: string, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return model === "Omni Flash" && prompt.trim().length > READ_THIS_MIN_CHARS;
```

- **Fix:** default the bypass off when frames are attached: add `hasFrames` to `shouldUseReadThis` and return `false` when it is true and `explicit` is undefined; pass `referenceFiles.length > 0` from `submitFlowVideo`. Later, a node toggle can set `data.readThis`, passed through `buildVideoPayload`.
- **Verify:** extend `scripts/flow-read-this.test.cjs`: `shouldUseReadThis("Omni Flash", LONG_PROMPT, undefined, true) === false`.

### F8 (Medium) Frame extraction from local videos always fails

- **Where:** `app/api/extract-frame/route.ts:30`; callers that swallow the failure: `components/nodes/VideoGeneratorNode.tsx:608-625` (catch at 621) and `:880-906`, `components/nodes/VideoInputNode.tsx:321-346` (catch at 342), `components/WorkflowCanvas.tsx:861-872` (`.catch(() => { })` at 872), `components/nodes/GenerateNode.tsx:494-505`.
- **Symptom:** wiring a video's Start/End frame output into a Video node's Start frame shows "Extracting frame…" and then nothing; the video is generated without the frame, or blocked, depending on stale fields. Every local video is affected because uploads and outputs are stored as relative `/generated/...` URLs.
- **Root cause:** `const res = await fetch(videoUrl);` on the server with `videoUrl = "/generated/..."`. Proved: Node 24 fetch throws `TypeError: Failed to parse URL from /generated/flow/flow-5aaa968f.mp4` (Next's patched fetch passes malformed URLs to native fetch). Second problem: the node guard `components/nodes/VideoGeneratorNode.tsx:806` accepts `r2Url`/`capturedFrameUrl` as "content", while `lib/executor.ts:82-84` returns only the eager frame for frame-out handles, so the guard can pass with `startFrameUrl` undefined. The fallback at `VideoGeneratorNode.tsx:890` only handles `videoInputNode` sources.
- **Fix:** `const res = await fetch(new URL(videoUrl, req.nextUrl.origin));` (or read `mediaPathFor(videoUrl)` from disk, no self request). Make the guard use the resolved inputs: block when a Start/End frame edge exists and `upstream.startFrameUrl` / `upstream.endFrameUrl` is empty.
- **Verify:** `curl -X POST http://localhost:3000/api/extract-frame -H "content-type: application/json" -d "{\"videoUrl\":\"/generated/flow/flow-5aaa968f.mp4\"}"` returns 500 today and `{ cdnUrl }` after the fix (not a generation endpoint, but it writes a file).

### F9 (Medium) A `blob:` frame passes the node guard

- **Where:** `components/WorkflowCanvas.tsx:517` (drop creates the node with `inputImage: blobUrl`) and `:533` (`} catch { /* blob URL stays as fallback */ }`); `components/nodes/ImageInputNode.tsx:131` and `:141-143` (same for file pick); guard `components/nodes/VideoGeneratorNode.tsx:806`.
- **Symptom:** clicking Generate right after dropping an image, or after an upload that failed (`stripMetadata` uses `sharp(buffer).toBuffer()`, `lib/mediaMetadata.ts:13`, which throws on formats it cannot decode), sends `blob:...`, which F1 drops. The upload failure is invisible; after a reload the persisted `blob:` URL is dead.
- **Fix:** in the guard treat `blob:` as empty with a dedicated toast (`Image still uploading`); on upload failure set `hasError: true` and toast instead of keeping the blob. After F1, `data:` URLs are normalized server side, so only `blob:` needs the client guard.
- **Verify:** live, DevTools network throttling "Slow 3G", drop an image, wire it, click Generate: expect the toast and no request.

### F10 (Medium) Gallery abandons Flow jobs after 7.5 min

- **Where:** `app/gallery/page.tsx:1786-1793`.
- **Root cause:** `for (let i = 0; i < 150; i++) {` with 3 s waits, then `throw new Error("Timed out");`. The Flow poller runs to 20 min.
- **Fix:** loop until a terminal status (the server guarantees one) or raise to 500 iterations.
- **Verify:** live with a long Veo Quality job from the gallery.

### F11 (Low) Flow image prompts carry kie mention tags; `maxImages: 1` not enforced

- **Where:** `lib/workflow-runtime/generationPayloads.ts:10` (`resolveMentions` with the default tag format, `lib/mentions.ts:79`); `lib/modelConfig.ts:160,176` (`maxImages: 1`); `components/WorkflowCanvas.tsx:1030` (`if (count >= 14) return false;`).
- **Symptom:** `@Avatar` becomes `<<<image 1>>>` in the text Flow receives; with one mention, unmentioned images are dropped (`lib/mentions.ts:71`); the UI accepts up to 14 references for a model declared as 1.
- **Fix:** in `submitFlowImage`: `prompt.replace(/<<<image (\d+)>>>/g, "image $1")`; cap the `image` handle with `MODEL_CAPS[model].maxImages` in `isValidConnection`.

### F12 (Low) Kie key gates Flow

- **Where:** `components/nodes/VideoGeneratorNode.tsx:1916`, `components/nodes/GenerateNode.tsx:1338`, `app/gallery/page.tsx:1797,2218`.
- **Fix:** `(kieKeySet === false && !cfg.apiInput.useFlow)`.

### F13 (Low) Error overlay text on Flow failures

- **Where:** `components/nodes/VideoGeneratorNode.tsx:1291-1293`, `components/nodes/GenerateNode.tsx:932-934`.
- **Symptom:** every error shows a "Credits refunded" badge (a kie concept); the poller's `(screenshot: C:\...png)` suffix is shown as plain text.
- **Fix:** show the badge only for kie models; optionally render the screenshot path as a button that calls the existing `/api/open-external` route.

### F14 (Low) UI and payload defaults disagree

- **Where:** `components/nodes/GenerateNode.tsx:322` (`?? "9:16"`) vs `lib/workflow-runtime/generationPayloads.ts:11` (`aspectRatio: String(data.aspectRatio ?? "1:1")`); `generationPayloads.ts:21` (`duration: Number(data.duration ?? 5)`); `lib/modelConfig.ts:561,584,607,630` (`sound: true`).
- **Symptom:** an image node created without `aspectRatio` (for example by an API/MCP-built space) shows 9:16 but sends 1:1; Flow video payloads carry `duration: 5` (the durable approval check `lib/workflow-runtime/store.ts:23` counts 5 s, real clips are 8 to 10 s: `flow-a6d2b2e7.mp4` is 10.0 s); the Sound toggle does nothing for Flow.
- **Fix:** payload default `"9:16"` (or pass the node's resolved ratio); `sound: false` on the four Flow video entries.

### F15 (Low) Durable run and pipeline edges

- `lib/workflow-runtime/runner.ts:33` patches only `r2Url`/`imageUrl`/`videoUrl` of finished steps, so a video → frame-out → video chain in a durable run reads `eagerStartFrameUrl` from the canvas snapshot (stale or missing).
- `lib/usePipelineRunner.ts:85` `if (!waveEverActive.current) return;`: if the upstream Flow image failed, the video node refuses to start (toast), no node of the wave ever becomes active and "Run pipeline" stays running until reload.
- `lib/workflow-runtime/productionTransport.ts:4` uses `fetch` without a timeout; Node's undici waits at most 300 s for response headers, and the Flow submit blocks for the whole browser automation (the smoke image POST took about 77 s: MCP job created 21:47:55, ANVIL row 21:49:12). Under queueing the run step becomes `reconciliation_required` while the route still submits the job.
- `components/nodes/VideoGeneratorNode.tsx:957-969`: `taskId` is stored only when the blocking POST returns; a reload in that window leaves the node "running" without a `taskId`.

### F16 (Low) Dead `runAll` with wrong completion semantics

- **Where:** `components/WorkflowCanvas.tsx:1151-1393`, line 1381 `updateNodeData(nodeId, { status: "done", videoUrl: data.videoUrl });` while the route returns `{ taskId, provider }`. `runAll` and `canRun` (`:1503`) are referenced nowhere (the latter is already listed in `2026-09-22-typecheck-lint-audit.md`).
- **Fix:** delete both.

---

## 5. MCP-side observations (out of scope, for the owner of the separate fix)

- **X1:** `flow-adapter.js:358-359` calls `attachReferences` and then `fillPrompt`, which starts by clicking cancel on every `.chip-container, button[aria-label*='Ingredient' i]` (`:909-916`). If the uploaded frame renders as a chip, it is removed right after being attached. The upload goes through the sidebar button (`:843`), so the file lands in the project library, not in a first-frame slot. Code-level risk; I did not touch the browser.
- **X2 (orientation and upscale not honored, files on disk):** 9:16 video requests (MCP records say `aspectRatio: "9:16"`) saved 1280x720 (`flow-5aaa968f.mp4`, `flow-7accee0d.mp4`, `flow-a6d2b2e7.mp4`, `flow-24949909.mp4`); 1:1 image requests saved 1376x768 (`flow-090e8b7b.jpeg`, `flow-828ebf0a.jpeg`); no output is 1080p although every video record says `upscale: "1080p"`; `flow-35d9ee75.mp4` is not a valid MP4.
- **X3:** start-frame runs `a6d2b2e7` and `5aaa968f` were "done" after 12 s and 36 s. The smoke's current text to video job `128e17c6` stayed `processing` in the MCP record (last update 21:49:39) and ended with "Flow timed out after 20 min".
- **Smoke gaps:** `expectVideo` checks codec and duration only (add orientation vs requested ratio); no prompt over 200 chars (F7 untested); it polls `job-status`, so it cannot see F3/F4; no canvas path (F1/F2/F8/F9).

---

## 6. Answers to the specific checks

- **Handle names:** consistent end to end. Model handles `startFrame`/`endFrame` (`lib/modelConfig.ts:560,583,606,629`) = node handle ids (`VideoGeneratorNode.tsx:30-31`) = `targetHandle` read by `resolveInputs` (`lib/executor.ts:147-151`) = payload `startFrameUrl`/`endFrameUrl` (`generationPayloads.ts:27-28`) = route fields (`generate-video/route.ts:36-37`) = adapter `startFrame`/`endFrame`. Omni Flash exposes only `prompt` + `startFrame`; `isValidConnection` rejects other handles (`WorkflowCanvas.tsx:1050`); switching model kills edges of removed handles (`VideoGeneratorNode.tsx:1701-1718`).
- **Frame from an upstream node generated in the same run:** manual click reads fresh store state (`VideoGeneratorNode.tsx:709`) and blocks while the upstream is empty (the image node clears `imageUrl` at start, `GenerateNode.tsx:599`); "Run pipeline" starts the video wave after the image wave settles; the durable runner patches the finished output in (`runner.ts:29-34`). All three pass the fresh frame, except F2 (manual and pipeline only) and the pipeline hang in F15.
- **Aspect ratio:** video offers only 16:9/9:16 and the node normalizes on model switch (`VideoGeneratorNode.tsx:1695-1700`); the adapter clamps anything else to 9:16 (`flowAdapter.ts:191`); X2 shows the MCP does not apply it. Image: F14. **Resolution:** F5.
- **Image node Flow branch:** `/api/generate` returns `{ taskId: "flow-image:<uuid>", provider: "flow" }` (`app/api/generate/route.ts:346-366`); the node ignores `provider` and polls `/api/job-status` every 3 s without a cap (`GenerateNode.tsx:409-462`); `job-status` re-arms `resumeFlowJob` for both prefixes (`app/api/job-status/route.ts:25,44`). Correct. The video node uses SSE (`VideoGeneratorNode.tsx:406-434`): F3, F4.
- **Poller errors on the node:** image node shows the poller text verbatim, including "Flow timed out after 5 min" and "(screenshot: ...)". Video node: failures before 12 min show verbatim; the 20 min timeout message can never arrive (F4); overlay wording F13. Submit-time MCP errors come back as the POST 500 body without the screenshot path.
- **Durable runs vs manual runs:**

| Aspect | Manual node | Durable run |
|---|---|---|
| Payload builder | `buildVideoPayload` / `buildImagePayload` | same |
| Completion | video SSE (F3, F4), image polling | polls `job-status` on each tick, no cap |
| Upstream frame | store precedence (F2 applies) | runner overwrites `r2Url`/`imageUrl` (F2 immune) |
| Client guards (empty edge, blob) | yes (F8, F9 gaps) | none; sends whatever the snapshot holds |
| Writes result back to the canvas node | yes | no (run JSON and gallery only) |
| Kie balance gate | n/a | skipped for provider `flow` (`runner.ts:27`) |

---

## 7. Type check and tests

- `npx tsc --noEmit -p .`: 1 error, `app/gallery/page.tsx:3004:25` (`onDownload` returns `void`, prop expects `Promise<void>`), unrelated to Flow and already covered by `2026-09-22-typecheck-lint-audit.md`; the parallel session has since widened the prop type to `void | Promise<void>` (uncommitted), which should clear it. No errors in the audited files.
- `node --test scripts/flow-read-this.test.cjs scripts/flow-reliability.test.cjs scripts/workflow-behavior.test.cjs`: 14/14 pass.
- Throwaway proofs (OS temp dir, not in the repo): F1 URL forms, F2 precedence, F3 duplicated bus, F8 relative fetch: 4/4 confirm the findings.

---

## 8. UI recipes (canvas)

Node picker names: "Text" (promptNode), "Image" (generateNode), "Video" (videoGeneratorNode), "Reference Image" (imageInputNode). Keep prompts at 200 characters or less unless you want to exercise F7. Every Generate has a 3 s cancel window before the POST.

1. **Image via Flow:** Text (prompt, no `@` mentions) → Image handle "Text prompt". Image: model pill "Nano Banana 2 (Flow)" or "Nano Banana Pro (Flow)"; ratio pill set explicitly (1:1, 16:9, 9:16, 4:3, 3:4). Optional: one Reference Image (drop a JPG/PNG, wait until the uploading overlay clears) → handle "Reference image (up to 1)". Generate. Expect `POST /api/generate` `{ model: "flow-nano-banana-2", prompt, aspectRatio, imageUrls }` → `{ taskId: "flow-image:<uuid>", provider: "flow" }`, then `GET /api/job-status` every 3 s, then `imageUrl = /generated/flow/<slug>-<id8>.jpg` (about 1.5 min).
2. **Text to video:** Text → Video handle "Text prompt". Video model "Omni Flash 1.1 (Flow)", "Veo 3.1 Fast (Flow)" or "Veo 3.1 Quality (Flow)"; ratio 9:16 or 16:9; resolution pill (no effect today, F5); no frames. Generate. Expect `POST /api/generate-video` `{ videoModel, prompt, aspectRatio, duration, resolution? }` → `{ taskId: "flow-video:<uuid>", provider: "flow" }`, then an open `GET /api/job-stream?taskId=...` (watch F3/F4).
3. **Start frame to video:** source = a Reference Image whose upload finished, or an Image node that already finished a Flow generation (not a UGC Template node, F2). Wire source output → Video handle "Start frame" (second handle, image icon). Video model "Omni Flash 1.1 (Flow)"; ratio = the frame's orientation (the MCP follows the frame, X2). Text → "Text prompt". Generate. In DevTools check the POST body: `startFrameUrl` must start with `/generated/` (any other form is dropped today, F1). With `ANVIL_DEBUG=1` the server logs `[Flow] Submitting video: model=Omni Flash, aspect=..., refs=1` (`refs=0` = dropped, `refs=2` = read-this kicked in).
4. **Frame A to B:** two sources as in recipe 3. Video model "Veo Frame A->B (Flow)"; A → "Start frame", B → "End frame" (connect both; nothing enforces it, F6); ratio matching the frames; Text describing the transition → "Text prompt". Generate. The POST body must carry both `startFrameUrl` and `endFrameUrl`, both `/generated/...`; debug log `refs=2`.

---

## Appendix: evidence

- `generations` rows (flow video): `35d9ee75` omni, ref `/generated/flow/flow-828ebf0a.jpeg`, done; `a6d2b2e7` omni, ref `/generated/images/76c00027-...jpg`, done in 0.2 min; `5aaa968f` omni, ref `/generated/flow/flow-090e8b7b.jpeg`, done in 0.6 min; `7accee0d` same ref, done in 26.8 min; `93cdaf25` same ref, error after 35.3 min; `24949909` omni text only, 3.9 min; `e3c30f20`, `538eb508` veo fast, errors after about 80 min (old limit); `128e17c6` smoke, "Flow timed out after 20 min" at 21.6 min.
- "Space 9" (`mu3sx6qu08o2`): Omni Flash node, `grokResolution: "720p"`, generations `[{ error: "Reference files were supplied, but Flow's file input could not be found." }, "/generated/flow/flow-35d9ee75.mp4"]`, Start frame from a Reference Image with `r2Url: /generated/flow/flow-828ebf0a.jpeg`.
- Six "UGC Template" spaces hold generateNodes with `r2Url` = `imageUrl` = remote R2 (F2 is armed, not yet triggered: no node currently has diverging values).
- URL forms stored in node data across all spaces: `/generated/` 64, remote http 78 (all UGC Template seeds: 24 image `imageUrl` + 24 image `r2Url` + 24 video `videoUrl` + 6 Avatar `r2Url`), no `blob:`/`data:` persisted today. `uploads` and `asset_cache`: 100% `/generated/`.
