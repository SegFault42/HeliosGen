# Open findings re-check, 2026-10-02

Re-check of the five 2026-09-22 audits against the working tree on 2026-10-02 (branch `solstice`, HEAD `1bc88da`, plus the uncommitted edits listed in `git status`). Read-only: nothing was run against :3000, no POST sent. Line numbers are for the current working tree.

Legend: OPEN = bug still present. FIXED = resolved (commit hash, or "uncommitted" when only in the working tree). PARTIAL = part fixed, remainder named. Size: S (under ~20 lines, one spot), M (one file, several spots or a helper plus a test), L (multi-file or needs design).

Commands run: `npx tsc --noEmit -p .` (exit 0, zero errors); `npx eslint . -f json` (exit 1, totals in the lint section).

## Scoreboard

| Report | Items | OPEN | PARTIAL | FIXED |
|---|---|---|---|---|
| HeyGen (H1..H18) | 18 | 14 | 2 (H1, H16) | 2 (H3, H7) |
| Codex (C1..C9) | 9 | 8 | 0 | 1 (C9) |
| Canvas/Flow (F1..F16) | 16 | 11 | 4 (F6, F8, F9, F14) | 1 (F1) |
| tsc + lint batches (0..7) | 1 tsc + 8 batches | 7 batches | 0 | tsc and Batch 0 |
| Hygiene + clipboard | 11 rows | 10 | 0 | 0 (1 N/A row) |

---

## 1. HeyGen audit

| ID | Status | Current path:line | Note | Size |
|---|---|---|---|---|
| H1 | PARTIAL | HeyGen part fixed in f48b101: `lib/heygenMcp.ts:265-278` (`readMedia` uses `ensureStorage` + `mediaPathFor`, no self-HTTP call). Remaining: `lib/workflow-runtime/bootstrap.ts:12`, `lib/workflow-runtime/productionTransport.ts:3` | `baseUrl` still defaults to `http://127.0.0.1:3000`; the desktop server runs on `PORT` 41730+, so every workflow-runtime step fails there. Fix: `?? \`http://127.0.0.1:${process.env.PORT ?? 3000}\`` | S |
| H2 | OPEN | `lib/heygenJobPoller.ts:11-12` (`POLL_MS=5_000`, `MAX_POLLS=144`), `:88` timeout settle; `app/api/job-stream/route.ts:15,87-89` | Attempt budget (about 12 to 18 min) and SSE 12 min cap vs renders up to ~22 min; restart resets the budget. Needs wall-clock deadline from `created_at`, 15 s interval | M |
| H3 | FIXED (uncommitted) | `lib/heygenJobPoller.ts:71` `mirrorToStorage(url,"videos","video/mp4")`; `lib/guest/localStorage.ts` (`ftyp` check) | Result is stored locally. Caveat: a mirror failure (256 MB cap, non-mp4) throws into the transient `catch` at `:79`, so it is retried silently to the deadline instead of falling back to the remote URL (see H6) | n/a |
| H4 | OPEN | `components/nodes/VideoGeneratorNode.tsx:410,431` | `es.onerror = () => es.close()` kills EventSource reconnect; node hangs on "Generating…". Fix: poll `/api/job-status` like `GenerateNode` | M |
| H5 | OPEN | `lib/jobEvents.ts:6` (`new EventEmitter()` plain module singleton) vs `lib/heygenJobPoller.ts:8-9` (active set on `globalThis`) | Emitter not process-global, SSE can miss the settle event. Moot if H4 lands, else pin on `globalThis` | S |
| H6 | OPEN | `lib/heygenJobPoller.ts:79-85` | Every poll error swallowed, nothing logged; fatal auth errors surface only at the end of the window | S |
| H7 | FIXED (uncommitted) | `lib/heygenVideoResult.ts:1-25` (only `video_url`-style keys, https, `.mp4/.webm` path), used at `lib/heygenJobPoller.ts:60` | A `video_page_url` can no longer settle `done`; covered by new `scripts/heygen-result.test.cjs` | n/a |
| H8 | OPEN | `lib/heygenJobPoller.ts:75-77` | Failure reason (`error.message`, `failure_message`) dropped, message is just `ended with status: failed`; `waiting_for_input` / `reviewing` unhandled | S |
| H9 | OPEN | `lib/modelConfig.ts:1202` | Still offers `1:1`, `4:5`, `5:4`; HeyGen only does landscape/portrait. `ratios: ["9:16","16:9"]` | S |
| H10 | OPEN | `lib/modelConfig.ts:1215` | `promptMaxLength: 20000`, HeyGen caps at 10000 | S |
| H11 | OPEN | `components/nodes/VideoGeneratorNode.tsx:1916` | Generate disabled when `kieKeySet === false` although HeyGen/Flow do not use Kie | S |
| H12 | OPEN | `lib/workflow-runtime/generationPayloads.ts:21` | `resolveMentions` (Kie tag rewrite) still applied to the HeyGen prompt; unmentioned files dropped | S |
| H13 | OPEN | `app/api/generate-video/route.ts:74-98` (`:95` spread of `rawRefImages as string[]`) | Bookkeeping after a paid submit can throw (null reference list) and orphan the job; no normalization before submit | S |
| H14 | OPEN | `lib/heygenMcp.ts:104,162,294` | No fetch timeout anywhere (refresh, MCP, upload PUT); 3 HTTPS round trips per tool call | S |
| H15 | OPEN | `lib/heygenMcp.ts:125,164` | No 401 recovery/retry; `persistToken` failure after refresh loses the new tokens; HTTP error body discarded | S |
| H16 | PARTIAL | `lib/workflow-runtime/generationPayloads.ts:26` (default is now `config.defaultDuration` = 0 for HeyGen), `lib/workflow-runtime/store.ts:23` unchanged | A stale `data.duration` still wins and the approval cap still reads it; no explicit premium approval flag for `provider==="heygen"` | M |
| H17 | OPEN | `lib/heygenMcp.ts:53` | `(?:access_token|...)` has no capture group, so the output is a literal `$1=[redacted]` | S |
| H18 | OPEN | `app/api/heygen/avatar/route.ts:7-10`; `lib/heygenMcp.ts:252-262` | Roots hard-coded to two local folders (route has no caller); `.heic/.avif/.gif/.webm/.m4a` map to octet-stream | S |

---

## 2. Codex audit

| ID | Status | Current path:line | Note | Size |
|---|---|---|---|---|
| C1 | OPEN | `app/api/generate/route.ts:597` (file-backed `pending`, no live registry); `app/api/job-status/route.ts:42-46` (resume no-ops for `codex-`, `kieJobPoller.ts:57-59`); `lib/jobStore.ts:37` (prune keeps pending forever) | Restart or wedged child leaves the node on "pending" forever. Fix: treat stale `pending` for `codex-`/`azure-` (older than ~12 min) as `error` | M |
| C2 | OPEN | `app/gallery/page.tsx:1797,2218` | Gallery gate `kieKeySet === false` blocks Codex/Azure (masked here because a Kie key exists) | S |
| C3 | OPEN | `app/api/generate/route.ts:262-282`; `lib/codexAccounts.ts:48-50` (`isUsageLimitError` only) | "Session has ended" on account 1 throws instead of rotating to the healthy account 2. Add `isAuthError` | S |
| C4 | OPEN | `app/api/generate/route.ts:253-254` | `--quality` never passed; 1k/2k/4k selector has no effect on Codex | S |
| C5 | OPEN | `app/api/generate/route.ts:633-637` (error path writes jobStore only; `insertGeneration` only on success `:628`) | Failed Codex jobs leave no `generations` row; also blocks DB reconciliation for C1 | S |
| C6 | OPEN | `app/api/generate/route.ts:616` (`slice(0,5)`), `:187` (cap 14), `:341-343` (mirror failure swallowed) | References 6+ dropped silently; failed mirror degrades edit to text-to-image | S |
| C7 | OPEN | `app/api/generate/route.ts:209-221` (`cleanCodexError`); `app/api/settings/codex-status/route.ts` (file-exists only) | "Session ended" has no pointer to Settings > Codex Reauth; badge stays READY. UX only | S |
| C8 | OPEN | `app/api/generate/route.ts:256`; `app/api/settings/codex-status/route.ts:14` | `spawn("codex-imagegen")` without `shell` works only while it is a real `.exe`; hardening needs `--prompt-file` first | M |
| C9 | FIXED (uncommitted) | `app/gallery/page.tsx:5882` prop widened to `void \| Promise<void>`; `npx tsc` now exit 0 | The tsc error is gone (uncommitted edit in the working tree) | n/a |

---

## 3. Canvas to Flow audit

| ID | Status | Current path:line | Note | Size |
|---|---|---|---|---|
| F1 | FIXED (uncommitted) | `lib/flowAdapter.ts:159-165` (`referenceFile`: `ensureStorage` then `resolveLocalPath`, throws), `:176-185`, `:240-243` | Unreadable frames/refs now fail the request instead of being dropped (video and image) | n/a |
| F2 | OPEN | `lib/executor.ts:87` (`r2Url` before `imageUrl` for every node type); `lib/templates.ts:196` | Stale `r2Url` on UGC Template image nodes beats the displayed `imageUrl`. Fix: `generateNode` returns `imageUrl` first | S |
| F3 | OPEN | `lib/jobEvents.ts:6`; `app/api/job-stream/route.ts:91`; `lib/flowJobPoller.ts` active set on `globalThis` (9e62bc4) | Same root cause as H5: emitter per bundle, pollers per process | S |
| F4 | OPEN | `app/api/job-stream/route.ts:15,87-89`; `lib/flowPollPolicy.ts:2` (20 min); `components/nodes/VideoGeneratorNode.tsx:431` | Node reports "Generation timed out" at 12 min, Flow runs to 20; `onerror` closes the stream | S |
| F5 | OPEN | `app/api/generate-video/route.ts:110` | `rawResolution === "1080p" \|\| cfg.defaultResolution === "1080p"` is always true for Flow models; 720p ignored | S |
| F6 | PARTIAL | Done (uncommitted): `lib/flowAdapter.ts:168-174` `framePrompt` (first/last role line, start-only and both). Missing: `lib/modelConfig.ts:654-676` no `requiredHandles`, `isInterpolation` read nowhere; no 400 in the route; end-only case not labeled | Interpolation model still submits with 0 or 1 frame | S |
| F7 | OPEN | `lib/flowAdapter.ts:17-20,206-211` | Omni Flash prompts over 200 chars still turn into PNG plus "read this", appended after the start frame; no `hasFrames` guard | S |
| F8 | PARTIAL | Server fetch fixed in f48b101 (`app/api/extract-frame/route.ts:34` `ensureStorage`). Remaining: `components/nodes/VideoGeneratorNode.tsx:805-806` guard accepts `r2Url`/`capturedFrameUrl` as content while `lib/executor.ts:82-84` returns only the eager frame | Guard can pass with `startFrameUrl` undefined | S |
| F9 | PARTIAL | A `blob:`/`data:` frame no longer drops silently (F1 fix errors at submit). Remaining: client guard `components/nodes/VideoGeneratorNode.tsx:805`; upload failure swallowed at `components/WorkflowCanvas.tsx:533`, `components/nodes/ImageInputNode.tsx:141-143` | No "still uploading" toast, no `hasError` on failed upload | S |
| F10 | OPEN | `app/gallery/page.tsx:1786` (`i < 150`, 7.5 min) then `throw new Error("Timed out")` | Gallery abandons Flow jobs (20 min deadline) | S |
| F11 | OPEN | `lib/workflow-runtime/generationPayloads.ts:10`; `lib/flowAdapter.ts` (no `<<<image N>>>` rewrite in `submitFlowImage`); `components/WorkflowCanvas.tsx:1030` (`count >= 14`) | Kie tags reach Flow prompts; `maxImages: 1` not enforced on connect | S |
| F12 | OPEN | `components/nodes/VideoGeneratorNode.tsx:1916`; `components/nodes/GenerateNode.tsx:1338` (exempts Codex only); `app/gallery/page.tsx:1797,2218` | Flow (and HeyGen) generation blocked without a Kie key | S |
| F13 | OPEN | `components/nodes/VideoGeneratorNode.tsx:1292`; `components/nodes/GenerateNode.tsx:933` | "Credits refunded" badge shown on every error incl. Flow; screenshot path is plain text | S |
| F14 | PARTIAL | Duration fixed for Omni Flash (`generationPayloads.ts:18-26`, `modelConfig.ts` `durations:[10]`) and Veo (default 0). Remaining: `generationPayloads.ts:11` (`?? "1:1"`) vs `GenerateNode.tsx:322` (`?? "9:16"`); `lib/modelConfig.ts:594,617,640,663` `sound: true` on Flow video entries | Sound toggle is a no-op; ratio default mismatch | S |
| F15 | OPEN | (a) `lib/workflow-runtime/runner.ts:~33` patches only `r2Url/imageUrl/videoUrl`, no eager frames; (b) `lib/usePipelineRunner.ts:85`; (c) `lib/workflow-runtime/productionTransport.ts:4` (fetch without timeout); (d) `components/nodes/VideoGeneratorNode.tsx:969` (`taskId` stored only after blocking POST) | Four independent edge cases, all unchanged | M |
| F16 | OPEN | `components/WorkflowCanvas.tsx:1151` (`runAll`, `:1381` marks done from POST), `:1503` (`canRun`) | Dead code, still referenced nowhere (also 2 lint warnings) | S |

---

## 4. Typecheck and lint audit

### tsc

| ID | Status | Current path:line | Note | Size |
|---|---|---|---|---|
| tsc `app/gallery/page.tsx:3004` | FIXED (uncommitted) | `app/gallery/page.tsx:5882` | `npx tsc --noEmit -p .` exit 0, zero errors. Fix was widening the prop to `void \| Promise<void>`, not the audit's `void` | n/a |

### ESLint totals (`npx eslint . -f json`, exit 1)

**234 errors, 105 warnings, 54 files** (audit baseline: 120 / 105 / 43). The delta is almost entirely `no-require-imports`: 41 to 154 errors, because 11 new `scripts/*.test.cjs` files landed (16 files now), and `no-explicit-any` 17 to 18. Excluding `no-require-imports` the error count is 80 (baseline 79). `eslint.config.mjs` is unchanged since the audit (no ignores or overrides added).

| Rule | Errors | Warnings | Baseline E/W |
|---|---|---|---|
| `@typescript-eslint/no-require-imports` | 154 (16 `.cjs` files, 0 elsewhere) | 0 | 41 / 0 |
| `@typescript-eslint/no-unused-vars` | 0 | 58 | 0 / 58 |
| `react-hooks/refs` | 25 | 0 | 25 / 0 |
| `react-hooks/set-state-in-effect` | 23 | 0 | 23 / 0 |
| `react-hooks/exhaustive-deps` | 0 | 22 | 0 / 22 |
| `@typescript-eslint/no-explicit-any` | 18 | 0 | 17 / 0 |
| `unused-eslint-disable-directive` | 0 | 12 | 0 / 12 |
| `@next/next/no-img-element` | 0 | 8 | 0 / 8 |
| `react-hooks/preserve-manual-memoization` | 8 | 0 | 8 / 0 |
| `@typescript-eslint/no-unused-expressions` | 0 | 4 | 0 / 4 |
| `react-hooks/immutability` | 3 | 0 | 3 / 0 |
| `prefer-const` | 1 | 0 | 1 / 0 |
| `react/no-deprecated` | 1 (`design/support.js`) | 0 | 1 / 0 |
| `@next/next/no-assign-module-variable` | 1 (`design/support.js`) | 0 | 1 / 0 |
| `jsx-a11y/alt-text` | 0 | 1 (`lib/nodeTypes.tsx:12`) | 0 / 1 |

Current `no-explicit-any` locations: `app/api/flow/status/route.ts:9,29`, `app/api/flow/token/route.ts:37`, `app/api/generate/route.ts:370`, `app/gallery/page.tsx:3577,3589(x2),4590(x2)`, `components/nodes/VideoGeneratorNode.tsx:693`, `lib/flowAdapter.ts:97(x3),191,192,250,251`, `lib/flowJobPoller.ts:21`. `react-hooks/refs`, `immutability`, `preserve-manual-memoization` instances are at the same locations the audit listed (gallery `:5916-5922`, `:6565`; `WorkflowCanvas.tsx:184,433,1429,1431,1515-1669`; PromptNode, VideoInputNode `:98-103,174`, AssistantNode `:36`, VideoGeneratorNode `:345`, `usePipelineRunner.ts:18`).

### Batch status

| Batch | Status | Current evidence | Note | Size |
|---|---|---|---|---|
| 0 tsc prop type | FIXED (uncommitted) | `app/gallery/page.tsx:5882` | see above | n/a |
| 1 eslint config only (ignore `design/support.js`, `**/*.cjs` no-require-imports off, preserve-manual-memoization to warn) | OPEN | `eslint.config.mjs` unchanged | Now worth 164 errors, not 51: 154 cjs + 2 `design/support.js` + 8 preserve-memo. Expected after: 70 errors | S |
| 2 mechanical cleanups (12 stale disables, `prefer-const` `gallery/page.tsx:2336`, 2 ternary statements `:605,:3203`, dead imports) | OPEN | counts unchanged (12 / 1 / 2 / most of 58) | | M |
| 3 unused vars needing a decision + `argsIgnorePattern: "^_"` | OPEN | `gallery/page.tsx:2208,2210` (`allUploaded`, `hasVidRefs`), `WorkflowCanvas.tsx:1503` (`canRun`, see F16); `setDownloading` is now used (`:5989`), drop that item | `^_` ignore pattern not configured | S |
| 4 `no-explicit-any` (18) | OPEN | locations above; `flowAdapter.ts` untyped external module is 7 of them | | M |
| 5 `exhaustive-deps` (22) | OPEN | unchanged, per-file review | | L |
| 6 refs (25) + set-state-in-effect (23) + immutability (2) | OPEN | unchanged | | L |
| 7 `no-img-element` (8) + `alt-text` (1) | OPEN | `WorkflowHero.tsx` x4, `gallery/page.tsx` x2, `MediaPickerModal.tsx`, `PromptNode.tsx`, `lib/nodeTypes.tsx:12` | optional polish | M |

---

## 5. Hygiene and clipboard audit

| ID | Status | Current path:line | Note | Size |
|---|---|---|---|---|
| HY-D clipboard sentinel | OPEN | `components/WorkflowCanvas.tsx:583,605-607` (`writeText(\`__rf_nodes_${Date.now()}__\`)`), `:730` | Sentinel still written to the OS clipboard; `lib/clipboardIntent.ts` and `scripts/clipboard-intent.test.cjs` do not exist. Audit's fix (clear instead of stamp, pure `resolvePasteIntent`) still applies | S |
| HY-R orphan API routes (7) | N/A | `flow/token`, `flow/status`, `gallery/cleanup`, `heygen/avatar`, `heygen/status`, `workflow-*` | Audit said keep all; nothing to fix. `gallery/cleanup` still has no trigger (decision, optional) | n/a |
| HY-X1 dead `pendingFiles` | OPEN | `lib/pendingFiles.ts:7` | Zero references; delete | S |
| HY-X2 dead `useGeneratingPhase` | OPEN | `lib/useGeneratingPhase.ts` | Zero references; delete | S |
| HY-X3 unused `chatStreamingStore` + duplicate SSE loop | OPEN | `lib/chatStreamingStore.ts` (zero refs) vs `app/chat/page.tsx:330-410` | Needs a decision (wire store in or delete it) | M |
| HY-X4 dead `isPolling` | OPEN | `lib/kieJobPoller.ts:37` | Zero references; delete | S |
| HY-X5 dead `heygenPathDir` | OPEN | `lib/heygenMcp.ts:381` | Zero references; delete | S |
| HY-L1 `console.log` in assistant route | OPEN | `app/api/assistant/route.ts:72` | Wrap in `dlog` | S |
| HY-L2 `console.log` per cache hit | OPEN | `lib/guest/db.ts:210` | Noisiest; wrap in `dlog` | S |
| HY-L3 `console.log` on DB import | OPEN | `lib/guest/sqlite.ts:100,121` | Wrap in `dlog` | S |
| HY-G `.gitignore` `*.bak-*` | OPEN | `.gitignore` (no `bak` pattern) | One line | S |

---

## Fix batches

Each batch owns a disjoint set of files, so batches can run in parallel. A batch also clears the lint findings of the files it owns (`npx eslint <files>`). Existing test files that other sessions have modified and not committed (`scripts/compose-split.test.cjs`, `db-runtime-guards.test.cjs`, `flow-reliability.test.cjs`, `workflow-behavior.test.cjs`) must not be edited: new tests go in new `scripts/*.test.cjs` files, using the same pattern (`ts.transpileModule` + `require.extensions[".ts"]` + the `@/` resolve hook, see `scripts/flow-read-this.test.cjs`). Run with `node --test --test-force-exit scripts/<file>.test.cjs`.

Files with uncommitted edits from other sessions (rebase onto them, do not overwrite): `lib/flowAdapter.ts`, `lib/modelConfig.ts`, `lib/heygenJobPoller.ts`, `app/api/generate/route.ts`, `app/gallery/page.tsx`, `lib/workflow-runtime/{generationPayloads,productionTransport,runner,compiler}.ts`. Batches B1, B5, B7, B8, B10, B12 touch them.

| Batch | Files owned | Finding IDs | Verification |
|---|---|---|---|
| B1 heygen-poller | `lib/heygenJobPoller.ts`, new `lib/heygenPollPolicy.ts`, new `scripts/heygen-poller.test.cjs` | H2 (poller side: 15 s interval, deadline from `created_at`), H6, H8 (and the H3 mirror-failure fallback) | Unit: the `require.cache` stub harness from the HeyGen audit section 5 (stub `jobStore`, `guest/db`, `heygenMcp`, `storage.mirrorToStorage`); assert fatal `token refresh failed (400)` settles `error` at once, HTTP 503 does not, failed video carries `failure_message`, 61 min old job settles `error`. tsc |
| B2 heygen-mcp-client | `lib/heygenMcp.ts`, `app/api/heygen/avatar/route.ts`, new `scripts/heygen-mcp.test.cjs` | H14, H15, H17, H18, HY-X5 | Unit: `sanitizeError("token=abc")` is `token=[redacted]`; `defaultContentType` for `.heic/.gif/.webm/.m4a`; fake `fetch` answering 401 then refresh then 200 with a temp `HEYGEN_MCP_TOKEN_FILE`; never-resolving fetch rejects after timeout (export the helpers). tsc |
| B3 video-node | `components/nodes/VideoGeneratorNode.tsx` | H4, H11, F4 (client `onerror`), F8 (guard), F9 (guard + toast), F12 (video button), F13 (video overlay), F15d, plus the file's 15 lint findings | tsc + `npx eslint components/nodes/VideoGeneratorNode.tsx`. Live: block `/api/job-status` for a few seconds, node must finish; delete the Kie key, HeyGen/Flow Generate stays enabled. Land first: it makes B4 low priority |
| B4 sse-bus | `lib/jobEvents.ts`, `app/api/job-stream/route.ts`, `lib/flowPollPolicy.ts`, new `scripts/job-events.test.cjs` | H5, F3, F4 (server cap `SSE_TIMEOUT_MS = FLOW_VIDEO_DEADLINE_MS + 2 min`), H2 (SSE cap) | Unit: require `lib/jobEvents.ts` twice with `delete require.cache` between, assert same emitter; assert `SSE_TIMEOUT_MS > flowDeadlineMs(true)`. tsc. Optional if B3 removes the SSE client |
| B5 payload-runtime | `lib/workflow-runtime/generationPayloads.ts`, `store.ts`, `bootstrap.ts`, `productionTransport.ts`, `runner.ts`, `compiler.ts`, new `scripts/payload-runtime.test.cjs` | H12, H16, H1 residual (`PORT` default in `bootstrap.ts:12` and `productionTransport.ts:3`), F14 (aspect default), F15a (eager frames), F15c (fetch timeout), lint (`runner.ts` unused vars, `compiler.ts`) | Unit on `buildVideoPayload` (prompt `"Follow @rafa.lima"` with two resources stays unchanged, both URLs present; HeyGen payload has no stale duration); `compilePlan` + `createRun` with a HeyGen node `duration: 15`, `maxVideoSeconds: 10`; `createProductionTransport()` default base URL honors `PORT`. tsc |
| B6 generate-video-route | `app/api/generate-video/route.ts`, new `lib/videoRequest.ts` (`asUrlList`, `flowUpscale`), new `scripts/video-request.test.cjs` | H13, F5, F6 (400 when `isInterpolation` and a frame is missing) | Unit on the pure helpers: `asUrlList(null)` is `[]`; `flowUpscale("720p", cfg)` is `"none"`, undefined is `"1080p"`. tsc |
| B7 flow-adapter | `lib/flowAdapter.ts`, `lib/flowJobPoller.ts`, extend clean `scripts/flow-read-this.test.cjs` | F7 (`hasFrames` guard in `shouldUseReadThis`), F11 (tag rewrite in `submitFlowImage`), F6 (end-only role line in `framePrompt`), lint `no-explicit-any` (flowAdapter x7, flowJobPoller x1) | Unit: `shouldUseReadThis("Omni Flash", LONG, undefined, true) === false`; `framePrompt` cases for start, end, both; `<<<image 1>>>` becomes `image 1`. tsc + eslint on both files |
| B8 model-config | `lib/modelConfig.ts`, new `scripts/model-config.test.cjs` | H9, H10, F6 (`requiredHandles: ["startFrame","endFrame"]` on `flow-veo-interpolation`), F14 (`sound: false` on the four Flow video entries) | Config assertions in the style of `scripts/kling-veto.test.cjs`: HeyGen ratios are exactly 9:16 and 16:9, `promptMaxLength` 10000, interpolation requires both handles, Flow entries have `sound:false`. tsc |
| B9 executor-templates | `lib/executor.ts`, `lib/templates.ts`, new `scripts/executor-frame.test.cjs` | F2 | Unit: `resolveInputs` with a `generateNode` having `imageUrl:"/generated/flow/NEW.jpeg"` and a stale `r2Url` yields `startFrameUrl` = the new path. tsc |
| B10 codex-route | `app/api/generate/route.ts`, `lib/codexAccounts.ts`, `app/api/settings/codex-status/route.ts`, new `scripts/codex-accounts.test.cjs` | C3, C4, C5 (insert pending row at submit, update at the end), C6, C7, C8 (`--prompt-file` then `shell:true`), lint (`generate/route.ts:370` any) | Unit: `isAuthError("Your session has ended. Please log in again.")` true, `isAuthError("HTTP 429 usage limit")` false; `cleanCodexError` appends the reauth hint. Behavior: fake `codex-imagegen` on PATH returning an auth error for account 1 and success for account 2. tsc |
| B11 codex-orphans | `app/api/job-status/route.ts`, new `lib/jobOrphans.ts`, new `scripts/job-orphans.test.cjs` | C1 | Unit on pure `staleOrphan(taskId, entry, now)`: `codex-x` pending with `ts` 13 min old maps to error, a fresh one stays pending, `kie` ids never match. tsc |
| B12 gallery | `app/gallery/page.tsx`, new `lib/galleryGate.ts` (pure `canGenerate`), new `scripts/gallery-gate.test.cjs` | C2, F12 (gallery `:1797,:2218`), F10 (loop to terminal status), plus the file's 38 lint findings (`prefer-const`, 2 ternary statements, any x5, refs `:5916-5922`, set-state x4, immutability `:6565`, unused vars x12, exhaustive-deps, img-element x2, unused disables x2) | Unit: `canGenerate({provider:"codex", kieKeySet:false})` true, `provider:"kie"` false. tsc + eslint on the file |
| B13 generate-node | `components/nodes/GenerateNode.tsx` | F12 (`needsKie` for Flow images), F13 (image overlay), lint (set-state `:166`, exhaustive-deps x5, unused var) | tsc + eslint on the file. Live: no Kie key, Flow image node Generate enabled |
| B14 workflow-canvas | `components/WorkflowCanvas.tsx`, `components/nodes/ImageInputNode.tsx`, new `lib/clipboardIntent.ts`, new `scripts/clipboard-intent.test.cjs` | HY-D, F9 (upload failure sets `hasError` + toast), F11 (cap `maxImages` in `isValidConnection`), F16 (delete `runAll`, `canRun`), plus lint on both files (refs x5, immutability x2, preserve-memo x1, exhaustive-deps x7, set-state x3, unused vars) | Unit: the four cases of `resolvePasteIntent` from the hygiene audit (empty with buffer is nodes, empty without is none, real text is text, a leaked sentinel is text). tsc + eslint on both files |
| B15 pipeline-runner | `lib/usePipelineRunner.ts` | F15b (wave never active hangs "Run pipeline"), lint (refs `:18`, set-state `:70`) | tsc + eslint on the file. Live: fail the upstream image, pipeline must stop |
| B16 lint-config | `eslint.config.mjs` only | Lint Batch 1 (ignore `design/support.js`, `**/*.cjs` no-require-imports off, preserve-manual-memoization to warn) and the `^_` ignore pattern from Batch 3 | `npx eslint .` totals: expect 70 errors (from 234) and at most 97 warnings (from 105); no source file touched |
| B17 lint-leftovers | `components/{AppSidebar,CanvasToolbar,NodePickerMenu,SelectionToolbar,SettingsModal,MediaPickerModal,QuickAssist,WorkflowHero}.tsx`, `components/edges/CuttableEdge.tsx`, `components/nodes/{AssistantNode,GroupNode,PromptNode,VideoInputNode}.tsx`, `components/ui/TypewriterHeading.tsx`, `app/chat/page.tsx`, `hooks/use-mobile.ts`, `lib/{chatStreamingStore,getAzureKey,getKieToken,useGeneratingBorderAnimation,arrangeNodes,useAnimatedPopup,useSpaceSync,nodeTypes}.ts(x)`, `app/api/flow/status/route.ts`, `app/api/flow/token/route.ts` | Lint Batches 2 to 7 for these files (unused vars, any x3, refs, set-state, exhaustive-deps, img-element, alt-text, stale disables), HY-X3 (decide store vs inline SSE in `app/chat/page.tsx`) | `npx eslint <files>` shows zero findings for them; tsc. Suggested split: PromptNode/VideoInputNode/AssistantNode/GroupNode (hooks-heavy, L) vs the rest (M) |
| B18 hygiene-misc | `lib/pendingFiles.ts` (delete), `lib/useGeneratingPhase.ts` (delete), `lib/kieJobPoller.ts`, `app/api/assistant/route.ts`, `lib/guest/db.ts`, `lib/guest/sqlite.ts`, `.gitignore` | HY-X1, HY-X2, HY-X4, HY-L1, HY-L2, HY-L3, HY-G | `grep` shows zero references to the deleted names; tsc; `git check-ignore -v foo.bak-1` matches; no unconditional `console.log` left in the three files |

Ordering notes (all batches are file-disjoint, these are soft dependencies only): land B3 before B4 (B4 may then be dropped); B10 and B11 both address Codex restart behavior (C5 gives C1 a durable row) but touch different files; B16 should land last so its before/after lint numbers are clean; B3, B12, B13, B14, B15, B17 each include lint cleanup of their own files, so no separate lint pass is needed for those.
