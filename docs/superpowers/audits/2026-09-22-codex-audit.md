# GPT-via-Codex provider audit — HeliosGen / Anvil

Date: 2026-09-22 (run 2026-09-23, branch `solstice`). Read-only on source; the only file written is this report. A live smoke test of another provider was running on :3000 throughout; no generation endpoint or codex-login POST was called, no node process touched.

## Scope and method

Traced the GPT/Codex path end to end: canvas `GenerateNode` / gallery composer → `POST /api/generate` (codex branch) → `runCodexImagegen` → `codex-imagegen.exe` → PNG on disk → `/generated/...` URL → `GET /api/job-status` poll → node/gallery. Also the workflow-runtime path (`compiler` → `productionTransport` → `runner`), account rotation (`lib/codexAccounts.ts`), and the login/re-auth UX (`codex-login`, `codex-status`, `SettingsModal`). Read the actual CLI source (`D:/CLAUDE PROJECTS/codex-imagegen-cli/codex_imagegen_cli/cli.py`, editable-installed behind the `.exe`).

Live environment checks (all allowed, read-only):

- `where codex` → `…/npm/codex` + `codex.cmd` (npm shim). `where codex-imagegen` → `C:/Users/Administrator/.local/bin/codex-imagegen.exe` (real PE, a uv-tool shim over `D:/CLAUDE PROJECTS/codex-imagegen-cli`).
- `codex --version` → `codex-cli 0.153.4`. `codex-imagegen --version` → `0.1.0`.
- `codex login status` → **`Logged in using ChatGPT`** (exit 0).
- `GET /api/settings/codex-status` (localhost:3000) → `{"installed":true,"authFound":true,"ready":true}`.
- Two auth files present: `~/.codex/auth.json` (primary, access token ~197 h to expiry, refreshed 2026-09-21) and `~/.codex/profiles/aw.rafa01/auth.json` (secondary, distinct account/email, both Plus; access token stale ~-139 h but has a refresh_token). Cooldown file `data/.codex-limits.json` holds two *expired* cooldowns (neither account currently benched).
- Job history: 367 `codex-*` rows in `guest.db`, all `status=done`; 3 recent `error` entries in `data/.job-store.json` all reading `Your session has ended. Please log in again.` (2026-09-20/21) — the reported incident, now recovered (reauth at 09-21 05:37).
- `npx tsc --noEmit -p .` → **1 error** (C9 below).

### Spawn / shell safety — the argument-injection question, answered

Every `spawn(`/`execFile(` in `app/` and `lib/` was checked. Behavior confirmed empirically on this box:

| call site | binary | `shell` | verdict |
|---|---|---|---|
| `app/api/generate/route.ts:253` | `codex-imagegen` (.exe) | no | works (`.exe` resolves via CreateProcess); **no shell → prompt is NOT parsed by cmd.exe** |
| `app/api/generate/route.ts:151` | `curl` (.exe) | no | works |
| `app/api/settings/codex-status/route.ts:14` | `codex-imagegen` (.exe) | no | works |
| `app/api/settings/codex-login/route.ts:17,68` | `codex` (.cmd shim) | `win32` | works (the ENOENT fix; args are static `login status` / `login --device-auth`, no user input) |
| `app/api/open-external/route.ts:33` | `cmd /c start` | n/a | url is `URL`-validated to http(s) first |
| `mediaMetadata`, `extract-frame`, `trim-video`, `composeSplit` | `ffmpeg`/`ffprobe` (.exe) | no | works |

Confirmed by direct test: `spawn("codex-imagegen", …)` succeeds without `shell`; `spawn("codex", …)` throws `ENOENT` without `shell` and succeeds with it. Because the **prompt path uses no shell**, a 20 k-char prompt full of `" & | > ^ %PATH% \n` round-trips to `codex-imagegen`'s `--prompt` byte-for-byte (verified with `--dry-run`, `payload.prompt === input`). **There is no command-injection vector via prompt text**, and no length problem for the only model that reaches this path (gpt-image-2, cap 20 000 chars, well under Windows' ~32 767 argv limit). The one caveat is C8.

---

## Findings

### C1 — Server restart (or a wedged child) mid-Codex-job hangs the node on "pending" forever — MAJOR

**Where.** `app/api/generate/route.ts:568-614` (codex branch), `app/api/job-status/route.ts:36-48`, `lib/jobStore.ts:34-39`, `lib/kieJobPoller.ts:55-57`.

**Symptom.** Start a Codex generation, restart the dev server (or the `codex-imagegen` child wedges/crashes) before it settles. The node spinner never resolves. Canvas `GenerateNode` polls `/api/job-status` every 3 s indefinitely; the gallery `pollTask` gives up only after 150×3 s and throws a generic `Timed out`. The image never appears even though nothing is running.

**Root cause.** The Codex branch runs a fire-and-forget in-process IIFE and writes `jobStore.set(codexTaskId, { status: "pending" })` — which is **file-backed** and survives restarts:

```ts
// generate/route.ts:569-570
const codexTaskId = `codex-${Date.now()}-${…}`;
jobStore.set(codexTaskId, { status: "pending", type: "image", userId: … });
```

Unlike the kie/flow/grok branches, it inserts **no `guestDb` pending row** — `insertGeneration` runs only inside the success path (`:601-605`). On restart the child is gone, but `jobStore.get()` still returns the persisted `pending`, and `jobStore.prune()` only drops *non-pending* entries (`lib/jobStore.ts:37`). `job-status` then takes the "known & pending" branch and tries to resume a poller — but codex matches none of the prefixes and `resumeKieJob` no-ops it (`isKieTaskId` returns false for `codex-`, `kieJobPoller.ts:55-57`), so it just returns `pending` again. There is no in-memory registry of live Codex jobs, so the request can't tell "genuinely in flight in this process" from "orphaned by a restart." **Azure shares this exact root cause** (its `azure-` prefix is likewise skipped), and is only handled in the *cold* branch (`job-status:52-54`), which never runs while the file-backed `pending` is present.

**Fix.** Make orphaned in-process jobs terminal. Lazy + correct: in the pending branch of `job-status`, for non-resumable prefixes (`codex-`, `azure-`), treat a `pending` entry whose `ts` is older than a ceiling (e.g. `MAX_POLL_MS` = 12 min) as `error` ("Generation was interrupted before it finished — please retry."), persisting that verdict. `jobStore` already stamps `ts` on every `set`. Alternatively, sweep `pending` `codex-`/`azure-` entries to `error` once at server boot (a `bootId` change is already tracked by the workflow-runtime lease if a hook is wanted). Do not add a kie-style poller — there is nothing remote to poll.

**Verify.** Unit test in the `scripts/*.test.cjs` mould (transpile `lib/jobStore.ts` via `typescript.transpileModule`): write `{status:"pending", ts: Date.now() - 13*60000}` for `codex-x`, assert the recovery helper maps it to `error`; write one with a fresh `ts`, assert it stays `pending`. Live: set a stale pending codex entry in `data/.job-store.json`, `GET /api/job-status?taskId=codex-x`, expect `error` not `pending`.

---

### C2 — Gallery blocks Codex (and Azure) generation whenever no Kie key is set — MAJOR (currently masked)

**Where.** `app/gallery/page.tsx:1797` and `:2218`; store default `lib/store.ts:738` (`kieKeySet: null`), set by `components/AppSidebar.tsx:617-618` from `/api/settings/kie-key`.

**Symptom.** A user who wants GPT Image 2 via Codex but has **no Kie.ai key** cannot generate from the gallery: the Generate button is disabled and the handler bails.

**Root cause.** The gallery gate is provider-blind:

```ts
// gallery/page.tsx:1796-1797
const generate = async () => {
  if (kieKeySet === false) return;               // ← bails for codex/azure too
// :2218
const canGenerate = kieKeySet === false ? false : … ;
```

Codex needs no Kie key (the codex branch has no key lookup, by design — `generate/route.ts:566-567`). The canvas node gets this right — its button disable is `(!isCodexProvider && kieKeySet === false)` (`GenerateNode.tsx:1338`) — but the gallery never exempts codex/azure. Masked in this deployment only because `/api/settings/kie-key` returns `{"hasToken":true}` (a key lives in `guest.db` settings), so `kieKeySet === true`. Any codex-only install trips it.

**Fix.** Gate on "the selected model's provider needs a Kie key," not on `kieKeySet` globally. Compute `providerForModel`/`isCodex`/`isAzure` (already derived at `:1645-1647`) and only block when the effective provider is `kie`. Mirror the node's `!isCodexProvider && kieKeySet === false` condition at both `:1797` and `:2218`.

**Verify.** Live: with `kie_api_token` absent (or a codex-only profile), set gpt-image-2 → Codex in Settings, confirm the gallery Generate button is enabled and a codex task submits. Unit: extract the boolean into a pure `canGenerate({provider, kieKeySet, …})` helper and assert `provider:"codex", kieKeySet:false → true`.

---

### C3 — An expired **primary** Codex session fails the whole request; rotation to the healthy secondary account never happens — MAJOR

**Where.** `app/api/generate/route.ts:265-282` (rotation loop), `lib/codexAccounts.ts:48-50` (`isUsageLimitError`).

**Symptom.** Exactly the reported incident: primary account returns `Your session has ended. Please log in again.` (a 401 whose refresh also fails). The generation errors out even though a second, working ChatGPT account is configured under `~/.codex/profiles/`.

**Root cause.** The account loop only advances on a *usage-limit* stderr; every other failure throws immediately:

```ts
// generate/route.ts:265-280
for (const authFile of authFiles) {
  const { exitCode, stderr } = await runOnce(authFile);
  if (exitCode === 0) return await readFile(outPath);
  if (isUsageLimitError(stderr)) { markCodexLimited(authFile); continue; }   // only path that rotates
  … throw new Error(`codex-imagegen exited with code ${exitCode}: …`);        // session-ended lands here → no account 2
}
```

`isUsageLimitError` is `/usage limit/i` only (`codexAccounts.ts:49`). "Your session has ended" / "log in again" / HTTP 401 don't match, so account 2 is never tried. Since the secondary carries its own `refresh_token`, `codex-imagegen --auth-file <profile>` would have refreshed and could have served the request.

**Fix.** Add an `isAuthError(stderr)` sibling (`/session has ended|log in again|\bHTTP 401\b|unauthorized/i`) and, on it, `continue` to the next account (no cooldown needed, or a short one). Only if **all** accounts fail auth, throw a clear "all Codex sessions expired — reauth in Settings → Codex" error. Keep throwing immediately on genuine content/other errors so bad prompts aren't retried N× (and don't burn quota).

**Verify.** Unit (transpile `codexAccounts.ts`): assert `isAuthError("… Your session has ended. Please log in again.")` true and `isAuthError("HTTP 429 … usage limit")` false. Behavior: stub `runOnce` to return an auth error for file 1 and `exitCode:0` for file 2; assert the buffer from file 2 is returned.

---

### C4 — Codex silently ignores the quality (1k/2k/4k) selector — MINOR

**Where.** `app/api/generate/route.ts:247-249` (arg list has `--size`, never `--quality`).

**Symptom.** The node/gallery quality pill (1k/2k/4k, sent as `quality`) has no effect on Codex output. The value is written to the DB row (`:604`) but never reaches the CLI.

**Root cause / ceiling.** `runCodexImagegen` builds `["generate", "--prompt", …, "--size", size, "--out", …]` with no `--quality`, so `codex-imagegen` uses its `auto` default. Codex's Images backend only supports 1024-scale canvases (`auto|1024x1024|1536x1024|1024x1536` — confirmed in `cli.py:33`), so 2k/4k are physically unavailable there anyway; the UI just implies otherwise. `CODEX_SIZE_MAP` (`:190-197`) is keyed by aspect ratio only and its values are all valid codex sizes, so size itself is fine.

**Fix.** Either map `low/medium/high` onto codex `--quality` (Codex accepts `auto|low|medium|high`) and pass it, or hide/disable the 1k/2k/4k pill when the provider is Codex so the control doesn't lie. Lowest-effort correct: drop 2k/4k from the pill for codex and pass `--quality`.

---

### C5 — Codex *failures* are never persisted to guest DB — MINOR

**Where.** `app/api/generate/route.ts:606-610` (error branch writes only `jobStore`), contrast kie branch `:671-675` (inserts a `pending` row up front).

**Symptom.** A failed Codex job leaves no `generations` row. Once its `jobStore` entry is pruned (7-day TTL, `jobStore.ts:15`) or the file is lost, `job-status` cold recovery (`guestDb.recoverJob`) returns `not_found` → the node shows "Job expired or unknown" with no record of *why* it failed. Also compounds C1 (no pending row means even a DB-based recovery couldn't reconcile a restart).

**Fix.** In the codex catch, also `guestDb.updateGeneration`/`insertGeneration` with `status:"error", error_msg`. Cleanest is to insert a `pending` row at submit time (like kie/flow/grok) and `updateGeneration` to done/error at the end — which also gives C1's fix a durable record to reconcile against.

---

### C6 — Silent truncation of reference images and swallowed mirror failures — MINOR

**Where.** `app/api/generate/route.ts:588-595` (`r2ImageUrls.slice(0, 5)`), `:182-187` (`resolveImages` caps 14), `:333-337` (mirror failure swallowed).

**Symptom.** gpt-image-2 advertises `maxImages: 16` and the node accepts up to 16 image inputs, but Codex edit takes at most 5 (`MAX_EDIT_IMAGES`, `cli.py:31`); refs 6-16 are dropped with no warning. Separately, if `resolveImages` throws, `r2ImageUrls` becomes `[]` and an intended image-to-image edit silently degrades to text-to-image.

**Fix.** When `codexProvider` is set, cap the node's image-input affordance at 5 (or surface a toast "Codex uses the first 5 reference images"). Don't fully swallow the mirror error for the codex/edit case — if references were supplied but none resolved, fail with a clear message rather than quietly generating from text.

---

### C7 — "Session ended" surfaces on the node with no route to re-auth; badge still says READY — MINOR (UX)

**Where.** `app/api/generate/route.ts:206-221` (`cleanCodexError`), `components/SettingsModal.tsx:710-717` (the READY-state "Reauth" hatch).

**Symptom.** The node error is the raw upstream string `Your session has ended. Please log in again.` — clear that *something* auth-related broke, but it points nowhere. Meanwhile the Settings badge reads **READY** because `codex-status` only checks that `auth.json` exists on disk (`codex-status/route.ts:20-26`), not that the token still works.

**Assessment.** Error mapping itself is *correct* — the expired session surfaces as a clean message on the node, **not** a hang or a generic 500 (`cleanCodexError` extracts the `error.message`/prose tail). The gap is discoverability. The manual Reauth escape hatch already exists (`SettingsModal.tsx:715`), which is the right recovery.

**Fix (optional).** In `cleanCodexError`, when the message matches session/401, append " Reauth in Settings → Codex." And/or have `codex-status` optionally run `codex login status` (not just stat the file) so the badge can show a "signed-in but session may be expired" sub-state.

---

### C8 — Both `codex-imagegen` spawns rely on it being a real `.exe`; an npm-style `.cmd` shim would ENOENT like the old `codex` bug — MINOR (hardening)

**Where.** `app/api/generate/route.ts:253`, `app/api/settings/codex-status/route.ts:14` (both `spawn("codex-imagegen", …)` with no `shell`).

**Assessment.** On *this* host `codex-imagegen` is a real PE, so both work and there's no injection surface (see the safety table). But the login route already learned that a Windows shim (`.cmd`/`.ps1`) needs `shell: process.platform === "win32"`. If a future deployment installs `codex-imagegen` via npm (shim) instead of uv (exe), `codex-status` would falsely report NOT CONFIGURED and `generate` would throw `spawn codex-imagegen ENOENT` — the identical failure that was just fixed for `codex`.

**Fix.** For parity and future-proofing, add `{ shell: process.platform === "win32" }` to both `codex-imagegen` spawns. Note the tradeoff: under `shell:true` the 20 k prompt would then be concatenated into a cmd.exe line (re-introducing the quoting/length concerns) — so if you add the shell guard, pass the prompt via `--prompt-file` (the CLI supports it, `cli.py:1090`) instead of `--prompt`, which also sidesteps the ENAMETOOLONG edge below. This is the cleaner long-term shape: **write the prompt to a temp file and use `--prompt-file`**, then `shell:true` is safe on both dimensions.

*(Related micro-note: if a model with a huge `promptMaxLength` — e.g. Grok's 390 000 — were forced through `codexProvider`, `runCodexImagegen` would hit `spawn ENAMETOOLONG`, mis-reported as "spawn failed … is it installed and on PATH?" (`:256`). Only gpt-image-2 exposes the provider choice today, so this isn't reachable via the UI; `--prompt-file` eliminates it regardless.)*

---

### C9 — the sole `tsc` error is unrelated to Codex but breaks `next build` — MINOR (pre-existing)

**Where.** `app/gallery/page.tsx:3004` (prop type at ~`:5882`).

```
app/gallery/page.tsx(3004,25): error TS2322:
Type '(url: string, itemIsVideo: boolean) => void' is not assignable to
type '(url: string, isVideo: boolean) => Promise<void>'.
```

`handleDownload` returns `void`; `GalleryCard.onDownload` is typed `=> Promise<void>`. Not in the Codex code path, but `next.config.ts` sets **no** `typescript.ignoreBuildErrors`, so `next build` (including the packaged `DESKTOP_BUILD` sidecar that ships Codex) fails on it. `next dev` (running now) tolerates it. Fix: make `handleDownload` `async` or widen the prop type to `=> void | Promise<void>`.

---

## How to run one real GPT/Codex image generation via the API (do NOT run now)

**Precondition (all currently true):** `codex-status` ready (`installed && authFound`), `codex login status` = "Logged in using ChatGPT", server up on `http://localhost:3000`. No Kie key needed for this path.

**Text-to-image** — `POST http://localhost:3000/api/generate`, `Content-Type: application/json`:

```json
{
  "model": "gpt-image-2",
  "codexProvider": true,
  "prompt": "a red fox curled in fresh snow, soft studio lighting",
  "aspectRatio": "1:1",
  "quality": "1k"
}
```

Response: `{"taskId":"codex-<ts>-<rand>"}`. Then poll `GET /api/job-status?taskId=codex-…` every ~3 s until `{"status":"done","imageUrl":"/generated/generated/<uuid>.png"}` (errors come back as `{"status":"error","error":"…"}`; e.g. an expired session yields `Your session has ended. Please log in again.`). The PNG is served same-origin at that `/generated/...` path and the gallery reads it from the `generations` DB row.

**Image-to-image (edit)** — add 1–5 references (http(s) URLs or existing `/generated/...` paths); this routes to `codex-imagegen edit --image …`:

```json
{
  "model": "gpt-image-2",
  "codexProvider": true,
  "prompt": "make the fox's fur silver",
  "imageUrls": ["/generated/generated/<existing>.png"],
  "aspectRatio": "1:1",
  "quality": "1k"
}
```

`aspectRatio` maps to a fixed Codex canvas (`1:1`→1024², `16:9`/`4:3`→1536×1024, `9:16`/`3:4`→1024×1536, else `auto`) and is also appended to the prompt as guidance. Reminder: a smoke test is live and the rules forbid running this — recipe is for reference only.

## Verified as NOT bugs

- **No prompt command-injection** — the `codex-imagegen` spawn uses no shell; a 20 k prompt with quotes/newlines/shell metachars round-trips intact to `--prompt` (dry-run confirmed).
- **No prompt-length failure on the supported model** — gpt-image-2 caps at 20 000 chars, far under Windows' argv limit.
- **Login-status regex** anchoring (`/^logged in/im`) correctly rejects "Not logged in".
- **Concurrency** of two Codex nodes: independent children, unique temp files; no shared lock needed. (Only theoretical risk: two concurrent refreshes of the *same* account's `auth.json` could tear it — very unlikely; would self-heal on next `codex login`.)
- **Workflow-runtime** codex path (`compiler.ts:63-69`, `runner.ts:36`, `productionTransport`) correctly skips the kie balance check for `provider==="codex"` and submits the same payload — but inherits C1 on restart (poll stays `pending`).
