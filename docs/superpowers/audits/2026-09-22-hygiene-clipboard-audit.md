# Hygiene + Clipboard Audit

Date: 2026-09-22/23. Branch: `solstice`. Method: read-only (grep/read across `app/`, `components/`, `lib/`, `scripts/`, `docs/`, plus a read-only grep of `F:/CLAUDE/AGENT_AI/google-flow-mcp`). No files edited, no servers started, no processes touched. The only file written is this one.

---

## D. Clipboard sentinel leak

### Root cause

`handleCopy` in `components/WorkflowCanvas.tsx:586-608` writes a throwaway sentinel straight into the **real OS clipboard**:

```tsx
// components/WorkflowCanvas.tsx:579-608 (current)
const clipboardRef = useRef<{ nodes: Node<NodeData>[]; edges: Edge[] } | null>(null);
// Written to the OS clipboard when nodes are copied, so Ctrl+V can tell the
// difference between "paste my nodes" and "paste real external text".
const nodeSentinelRef = useRef<string | null>(null);
...
const handleCopy = useCallback(() => {
  ...
  clipboardRef.current = { nodes: allNodes, edges: selectedEdges };
  // Write a sentinel to the OS clipboard so Ctrl+V knows this was a node copy,
  // not real external text the user wants to paste as a prompt node.
  const sentinel = `__rf_nodes_${Date.now()}__`;
  nodeSentinelRef.current = sentinel;
  navigator.clipboard.writeText(sentinel).catch(() => { });
}, [nodes, edges]);
```

`navigator.clipboard.writeText()` replaces the **entire** system clipboard, globally, for every app on the machine — there is no per-app-scoped clipboard. Whatever the user had copied before (a URL, a paragraph, anything) is gone, replaced by the literal string `__rf_nodes_1789973644127__`. Nothing ever restores it.

The paste side then uses that same sentinel purely to decide "was the last copy ours":

```tsx
// components/WorkflowCanvas.tsx:718-810 (current, relevant lines)
const onPasteEvent = (e: ClipboardEvent) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;          // 723-724: inputs get native paste

  const raw = e.clipboardData?.getData("text/plain") ?? "";
  const text = raw.trim();
  if (text && text !== nodeSentinelRef.current) {              // 730: real text → prompt node(s)
    ...
  } else if (clipboardRef.current) {                           // 803: else → paste nodes
    e.preventDefault();
    handlePaste();
  }
};
```

This explains the exact symptom: the canvas paste handler itself never shows the sentinel (it special-cases it away at line 730). It leaks in the two places that *don't* go through this handler:
- Inputs/textareas (line 723-724 `return`s early, deliberately falling back to the browser's native paste) — which pastes whatever raw text sits in the now-poisoned OS clipboard, i.e. the sentinel.
- Any other application entirely (Notepad, Slack, another browser tab) — same reason, it just reads the OS clipboard.

Three lines: (1) `navigator.clipboard.writeText(sentinel)` at line 607 overwrites the real OS clipboard with `__rf_nodes_<timestamp>__`; (2) nothing ever restores the prior clipboard content; (3) the very next native paste anywhere other than this one keydown-gated handler — an input in this app, or any other app — surfaces that literal string, exactly matching `__rf_nodes_1789973644127__` being pasted where the user expected their real text.

### Why the sentinel exists at all (so the fix doesn't regress it)

It is not gratuitous: `handleCopy`'s `e.preventDefault()` on the keydown (line 697) means the browser's native copy never fires, so without *some* OS-clipboard signal, a stale piece of real text the user copied hours ago would still be sitting in the clipboard at paste time, and the paste handler would have no way to tell "nothing has changed, paste my nodes" from "the user copied something since." Reading the clipboard proactively (`navigator.clipboard.readText()`) is what the paste-side comment (line 718-720) explicitly avoids, because it can pop a permission prompt outside a direct paste gesture. So the design constraint is real: the OS clipboard is the only free, permission-safe signal available, and it has to be touched on copy.

### The fix

Clear the OS clipboard instead of stamping a sentinel into it. An **empty** clipboard is just as good a signal as a magic string — "nothing has been copied since" — and it carries no visible content to leak. If the user copies real text after the node-copy, the clipboard stops being empty and text-paste correctly wins, exactly as today.

New file, `lib/clipboardIntent.ts` (pure function, no imports — same shape as the existing `lib/flowPollPolicy.ts` / `lib/textFormat.ts` pattern):

```ts
// lib/clipboardIntent.ts
/** What a paste on the canvas should do, given what's actually on the OS
 * clipboard right now and whether we still hold a copied selection in
 * memory. Node-copy (see WorkflowCanvas handleCopy) clears the OS text
 * clipboard instead of writing a visible sentinel into it — a sentinel is
 * real text that would otherwise leak into the next paste anywhere else
 * (another app, a prompt textarea). So "clipboard still holds our nodes"
 * reduces to: the OS clipboard has no text of its own since the copy. */
export type PasteIntent = "nodes" | "text" | "none";

export function resolvePasteIntent(clipboardText: string, hasNodeBuffer: boolean): PasteIntent {
  if (clipboardText.trim()) return "text";
  return hasNodeBuffer ? "nodes" : "none";
}
```

`components/WorkflowCanvas.tsx` — add the import next to the other `@/lib/*` imports (after line 28):

```tsx
import { detectTextMode } from "@/lib/textFormat";
import { resolvePasteIntent } from "@/lib/clipboardIntent";
```

Replace lines 579-608 (drop `nodeSentinelRef` entirely, clear instead of stamp):

```tsx
// ── Copy / Paste ─────────────────────────────────────────────────────────────
const clipboardRef = useRef<{ nodes: Node<NodeData>[]; edges: Edge[] } | null>(null);
const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

const handleCopy = useCallback(() => {
  const selected = nodes.filter((n) => n.selected);
  if (selected.length === 0) return;
  const selectedIds = new Set(selected.map((n) => n.id));

  for (const n of selected) {
    if (n.type === "groupNode") {
      ((n.data?.memberIds as string[] | undefined) ?? []).forEach((mid) => selectedIds.add(mid));
    }
  }

  const allNodes = nodes.filter((n) => selectedIds.has(n.id));
  const selectedEdges = edges.filter(
    (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
  );
  clipboardRef.current = { nodes: allNodes, edges: selectedEdges };
  // Claim the OS clipboard by clearing it — not by stamping a sentinel
  // string into it. resolvePasteIntent treats "no text on the clipboard" as
  // "the node buffer is still current"; a written sentinel would be real,
  // visible text that leaks into whatever the user pastes into next
  // (another app, a prompt textarea in this app — see the paste handler).
  navigator.clipboard.writeText("").catch(() => { });
}, [nodes, edges]);
```

Replace the body of `onPasteEvent` (lines 722-730 and 803-806; the untouched middle — the block-splitting/node-creation logic — stays exactly as-is except reading `raw.trim()` locally instead of the module-level `text`):

```tsx
const onPasteEvent = (e: ClipboardEvent) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const raw = e.clipboardData?.getData("text/plain") ?? "";
  const intent = resolvePasteIntent(raw, clipboardRef.current !== null);

  if (intent === "text") {
    e.preventDefault();
    const text = raw.trim();
    const currentState = useWorkflowStore.getState();
    const currentNodes = currentState.nodes;
    const currentEdges = currentState.edges;
    const size = getDefaultNodeSize("promptNode", currentState.lastNodeSize);

    // ... unchanged: blocks split, target detection, addNode/insertEdge loop ...

  } else if (intent === "nodes") {
    e.preventDefault();
    handlePaste();
  }
};
```

That's the whole fix: one file added (3 lines of logic), one write call changed from `writeText(sentinel)` to `writeText("")`, one `if` condition routed through the pure function instead of an inline ref comparison, `nodeSentinelRef` deleted. Behavior check against the three requirements:

- **Copying nodes can't leak the sentinel** — there is no sentinel anymore; the only thing ever written to the OS clipboard is `""`.
- **Pasting text into inputs pastes text** — inputs already bypass this handler (line 723-724) and get the browser's native paste; since the app no longer writes visible garbage into the clipboard, native paste now shows either the user's real last-copied text, or nothing (if the last action was a node-copy) — never the sentinel.
- **Pasting on canvas pastes nodes only when the clipboard still holds our nodes** — `resolvePasteIntent` returns `"nodes"` exactly when the OS clipboard is empty (nothing copied since) *and* a node buffer exists; any real copy since — in this app or another — makes the clipboard non-empty and text-paste correctly takes over.

One accepted trade-off, called out rather than hidden: a node-copy still clears whatever was in the OS clipboard before it (can't be avoided without reading the clipboard first, which reintroduces the permission-prompt problem the paste side already avoids on purpose). The difference from today is that the user now gets an empty paste instead of a garbage sentinel — a no-op, not a visible bug.

### Test

`scripts/clipboard-intent.test.cjs` (same transpile-and-require pattern as `scripts/workflow-behavior.test.cjs`; no `@/` alias needed since `clipboardIntent.ts` has zero imports):

```js
// Compile local TypeScript modules for behavioral tests without a Next server.
const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolvePasteIntent } = require("../lib/clipboardIntent.ts");

test("empty clipboard with a node buffer pastes nodes", () => {
  assert.equal(resolvePasteIntent("", true), "nodes");
  assert.equal(resolvePasteIntent("   \n  ", true), "nodes");
});

test("empty clipboard with no node buffer pastes nothing", () => {
  assert.equal(resolvePasteIntent("", false), "none");
});

test("real clipboard text always pastes as text, even with a node buffer queued", () => {
  assert.equal(resolvePasteIntent("hello world", true), "text");
  assert.equal(resolvePasteIntent("hello world", false), "text");
});

test("regression: a leaked sentinel (old bug, or stale from before this fix) is just text now", () => {
  assert.equal(resolvePasteIntent("__rf_nodes_1789973644127__", true), "text");
});
```

The pure-function logic was dry-run outside the repo (`node -e`, no files written) against all four cases above — all pass. Run for real with `node --test scripts/clipboard-intent.test.cjs` once the files exist.

---

## B. Repo hygiene

### Orphan API routes

34 routes under `app/api/**/route.ts`. 27 have a confirmed in-repo caller (grepped `/api/<name>` across `app/`, `components/`, `lib/`, `scripts/`) — not tabulated below. 7 have no in-repo caller; each investigated individually rather than assumed dead:

| Path | What | Evidence | Keep/Delete | Risk |
|---|---|---|---|---|
| `app/api/flow/token/route.ts` | POST: stores a Google Flow OAuth token into the shared `FlowStore` (dynamically imports `F:/CLAUDE/AGENT_AI/google-flow-mcp/dist/store.js`) | No in-repo caller. `google-flow-mcp/bookmarklet.js`, `extension/content.js`, `extension/popup.js`, `extension/manifest.json` reference this route (grepped read-only, no token values printed) | **Keep** — external caller is the google-flow-mcp browser extension/bookmarklet, exactly as expected | High if deleted (silently breaks Flow account connect from the extension) |
| `app/api/flow/status/route.ts` | GET: Flow account list + credits via `lib/flowAdapter.ts`'s `listFlowAccounts`/`getFlowCredits`, which load the **same** `FlowStore` class `flow/token` writes into | No in-repo caller | **Keep** — companion read endpoint to `flow/token`, same external integration | High if deleted |
| `app/api/gallery/cleanup/route.ts` | POST: `sweepOrphans()` — deletes generated media files (>1h old) no generation/asset-cache/workflow references anymore | No caller in app/components/lib, no cron in `.github/workflows` (only `version-check.yml` exists), no README/DESKTOP.md mention | **Keep, but flag** — real, working, but has no trigger at all today; either wire to a Gallery "clean up" button or document as a manual `curl -X POST` maintenance step | Low (media just accumulates until someone hits it manually) |
| `app/api/heygen/avatar/route.ts` | POST: creates a HeyGen photo avatar from a **hardcoded personal path allowlist** (`D:/CLAUDE PROJECTS/social media/creator/avatar-refs`, `F:/CLAUDE/AGENT_AI/rodadas`) | No caller anywhere in the app. README's documented HeyGen flow (§"HeyGen via MCP") goes through Video-node → `/api/generate-video` → `lib/heygenMcp.ts`, never this route | **Keep** — reads as an intentional manual/dev-only utility (the allowlist is the tell), not part of the product UI | Low |
| `app/api/heygen/status/route.ts` | GET: HeyGen MCP auth/user check via `getHeyGenCurrentUser` | No caller. Shape mirrors `/api/settings/codex-status` and `/api/settings/kie-key`, both of which **are** wired into `SettingsModal.tsx`/`AppSidebar.tsx` — this one just never got a Settings-panel row | **Keep** — cheap diagnostic, good candidate to wire into Settings for parity with the other providers | Low |
| `app/api/workflow-plans/route.ts`, `app/api/workflow-runs/route.ts`, `app/api/workflow-runs/[runId]/route.ts`, `app/api/workflow-runs/[runId]/retry/route.ts`, `app/api/workflow-runs/[runId]/retry-requests/[requestId]/route.ts`, `app/api/workflow-runtime/route.ts` | A whole parallel "workflow-runtime v2" execution engine (`lib/workflow-runtime/{compiler,store,runner,bootstrap,contracts,productionTransport,generationPayloads}.ts`) | No caller — the live canvas (`components/WorkflowCanvas.tsx:24`) still executes via the older `lib/executor.ts` (`topoSort`/`resolveInputs`) + direct `/api/generate*` calls. But `lib/workflow-runtime/compiler.ts` has **uncommitted edits right now** (`git status`), and 3 dedicated test files exercise it (`scripts/workflow-behavior.test.cjs`, `scripts/test-workflow-runtime.mjs`, `scripts/compiler-kling-veto.test.cjs`) | **Keep — active WIP**, not dead code, just not yet wired to the UI | High if deleted (would destroy in-progress work with its own test suite) |

`app/api/upload-video/route.ts` has no *client-side* caller either, but is called server-to-server from `app/api/compose-split/route.ts:8` — not an orphan, just an internal chain; no action needed.

### Dead exports (in `lib/`)

Found by extracting every `export function/const/class` in `lib/**/*.ts` (131 names) and checking how many times each identifier appears repo-wide (`.ts/.tsx/.js/.mjs/.cjs`, excluding its own declaration line). Candidates with zero uses even inside their own file (declared, never called by anything, anywhere):

| Path | What | Evidence | Fix | Risk |
|---|---|---|---|---|
| `lib/pendingFiles.ts:7` | `export const pendingFiles = new Map<string, File>()` — doc comment claims "WorkflowCanvas writes here after creating a new node; the node reads and clears its entry on mount" | Zero references anywhere, including `components/WorkflowCanvas.tsx` itself — the described hand-off never happens in the current code | Delete the file, or wire it up if the drag-a-file-onto-a-new-node flow it describes is still wanted | Low |
| `lib/useGeneratingPhase.ts:1-3` | `useGeneratingPhase(busy)` → `"Generating…"` / `""` | Zero references anywhere | Delete | Low |
| `lib/chatStreamingStore.ts` (128 lines) | Full zustand store (`useChatStreamingStore`) that POSTs `/api/assistant`, parses the SSE stream, persists the final message, and toasts if the user navigated away mid-stream | Zero references anywhere. **`app/chat/page.tsx:330-410`'s `send()` callback independently re-implements the same POST + SSE-parse loop inline**, tied to the component's own lifecycle (no survive-navigation toast) — see Duplicated helpers below | Don't just delete: it's the more capable of the two implementations (survives navigating away from `/chat`). Either finish wiring it into `app/chat/page.tsx` to replace the inline version, or delete it if the cross-navigation behavior was abandoned on purpose | Medium — deleting loses a near-complete feature; leaving both costs a second SSE-parsing implementation to keep in sync |
| `lib/kieJobPoller.ts:35-37` | `isPolling(taskId)` — thin public wrapper around the module-private `active` Set (line 33), which the module already checks directly via `active.has(taskId)` at line 41 | Zero external references; the module doesn't even use its own exported wrapper | Delete | Low |
| `lib/heygenMcp.ts:378` | `heygenPathDir()` | Zero references. Its two neighbors `heygenTokenPath()` (376) / `heygenClientPath()` (377) **are** used, by `app/api/heygen/status/route.ts` | Delete | Low |

### Duplicated helpers

`lib/chatStreamingStore.ts` vs. `app/chat/page.tsx:330-410` (`send` callback): both POST to `/api/assistant` with `stream: true`, both hand-roll the same SSE parse loop (`buf.split("\n")`, strip `"data: "`, `JSON.parse`, accumulate `content`). The store version is unused (see above) and is strictly more capable — it survives the user navigating away from the chat page and shows a toast when the response finishes elsewhere in the app. Treat this as one finding, not two: pick one implementation and delete the other rather than maintaining both.

### Stray `console.log` in server code

`lib/debugLog.ts` already provides the right pattern — `dlog(...args)` only logs when `ANVIL_DEBUG=1`. These bypass it and fire unconditionally:

| Path | What | Evidence | Fix | Risk |
|---|---|---|---|---|
| `app/api/assistant/route.ts:75` | `console.log("[azure-auto] POST", url...)` on every Azure-routed chat request | Unconditional, in a per-request hot path | Wrap in `dlog(...)` | Medium (log noise on every chat message) |
| `lib/guest/db.ts:210` | `console.log("[guest/asset-cache] HIT:", hash...)` on every asset-cache hit | Unconditional; cache hits can be very frequent (gallery grids, thumbnails) | Wrap in `dlog(...)` | Medium-High (likely the noisiest of the three) |
| `lib/guest/sqlite.ts:100,121` | One-time guest-DB JSON import logs | Unconditional, but only fires once per fresh guest DB bootstrap | Wrap in `dlog(...)` for consistency | Low |

### `.gitignore` gaps

| Pattern | Status | Evidence | Fix |
|---|---|---|---|
| `*.bak-*` | **Real, recurring, currently unguarded** | `docs/superpowers/specs/2026-09-22-flow-reliability-design.md:37`: "apagar os 20 arquivos `*.bak-*`" — 20 of these existed and were manually deleted as part of commit `8842160 wip: baseline before flow reliability fixes`. Nothing in `.gitignore` stops the next batch from being `git add`-able | Add `*.bak-*` to `.gitignore` |
| generated media (`public/generated/**`) | Covered | `git status --ignored` confirms `public/generated/{avatar-refs,flow,generated,images,references,uploads,videos}/` all show `!!` (ignored) via line 51-52 | none needed |
| `data/*.db` (+`-shm`/`-wal`) | Covered | `git check-ignore -v` confirms `data/guest.db`, `-shm`, `-wal` all match lines 48-50 | none needed |
| `.env*` | Covered | `.env.local` shows `!!`; `.env.example` correctly stays trackable via the `!.env.example` exception | none needed |
| screenshots | Not applicable here | No code under `lib/`/`app/` writes screenshot files — `diagnosticScreenshot` is a path *string* that arrives from the external google-flow-mcp job response; if any PNGs get written, it's in that other repo's tree (its own baseline commit mentions cleaning up debug PNGs), not this one | none needed in this repo |

### Leftover debug files

None found. Searched `app/`, `components/`, `lib/`, `scripts/` for `*scratch*`, `*-copy.*`, `*_old*`, `*.old.*`, `*backup*`, `*temp.*`, `*-tmp.*`, `*debug*` — the only hit is the legitimate `lib/debugLog.ts` helper itself.
