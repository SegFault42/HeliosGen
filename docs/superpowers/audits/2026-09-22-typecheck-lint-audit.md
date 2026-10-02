# TypeScript + ESLint audit, HeliosGen

Date: 2026-09-22 (run executed 2026-09-23, branch `solstice`). Read-only audit, no source files touched.

## Method

Commands run exactly as allowed:

```
npx tsc --noEmit -p .
npx eslint . -f json -o <temp file outside the repo>
```

`package.json` scripts checked (not edited):

- `"lint": "eslint"`, no args. ESLint 9 flat config (`eslint.config.mjs`), so `pnpm lint` lints the same file set as the command above (the `-f json -o` flags only change the reporter, not which files get linted).
- `"test:workflow": "node scripts/test-workflow-runtime.mjs"`. Read, not executed (a live process already owns port 3000 and the hard rules excluded running it). The script does four things: (1) asserts a fixed list of workflow-runtime files exist, (2) greps `lib/modelConfig.ts` / `app/api/generate-video/route.ts` for HeyGen wiring strings, (3) greps `lib/workflow-runtime/productionTransport.ts` and `runner.ts` for balance-check strings, (4) shells out to `tsc --noEmit` and exits with its status. Step 4 is why the gallery/page.tsx tsc error currently fails `pnpm test:workflow` too: any repo-wide tsc error fails this script regardless of the other three checks.
- `node --test scripts/*.test.cjs` runs the 5 `.cjs` files under `scripts/` (`compose-split`, `flow-read-this`, `flow-reliability`, `kling-veto`, `workflow-behavior`). Not executed here (not in the allowed command list); read only to confirm they are plain CommonJS Node test files, which matters for part D below.

Versions: TypeScript 5.9.3, ESLint 9.39.5, `eslint-config-next` 16.2.3, `eslint-plugin-react-hooks` 7.1.1, Next 16.2.12, React 19.2.8.

Note on the prior baseline: previously measured was "around 88 errors / 106 warnings"; this run measures **120 errors / 105 warnings** across 43 files. `package.json`/`pnpm-lock.yaml`/`eslint.config.mjs` have no commits since 2026-09-06, so this isn't a dependency bump; the difference is almost entirely explained by source changes in today's `8842160` "wip" commit (see the tsc root cause below, and the four new React Compiler rule families in part B, which alone account for 59 of the 120 errors and did not need a new dependency version to start firing, they just hadn't been triggered by this exact code before).

---

## A. tsc errors

**1 error**, exactly matching the prior measurement.

### `app/gallery/page.tsx:3004:25`

```
error TS2322: Type '(url: string, itemIsVideo: boolean) => void' is not assignable to type '(url: string, isVideo: boolean) => Promise<void>'.
  Type 'void' is not assignable to type 'Promise<void>'.
```

**Root cause.** `GalleryCard`'s prop type (`app/gallery/page.tsx:5882`) declares:

```ts
onDownload?: (url: string, isVideo: boolean) => Promise<void>;
```

`handleDownload` (`app/gallery/page.tsx:2417-2434`), passed as that prop at line 3004, used to match this (an `async` function that awaited `fetch` + `blob()` before triggering the download). Today's commit `8842160` ("wip: baseline before flow reliability fixes") rewrote it to a synchronous version that builds a `/api/download?...` URL and clicks a same-origin anchor, letting the browser handle the download natively instead of fetching a blob in JS:

```ts
const handleDownload = useCallback((url: string, itemIsVideo: boolean) => {
  // ... no await, no async, ends with document.body.removeChild(a);
}, []);
```

The simplification was deliberate (`git show 8842160` shows the whole try/catch/fetch/blob block was removed on purpose); the `Promise<void>` on the prop's type was simply not updated to match. It's not a runtime bug: `GalleryCard`'s internal handler already does `await onDownload?.(...)` (line 5990), and `await` on a non-Promise value resolves immediately, so behavior is correct today. This is a pure type-annotation drift.

**Minimal fix.** Update the interface to reflect the now-synchronous implementation, one line, `app/gallery/page.tsx:5882`:

```ts
onDownload?: (url: string, isVideo: boolean) => void;
```

No other line needs to change. `handleDownloadSelected` (`app/gallery/page.tsx:2444-2450`) already does `await handleDownload(item.url, ...)` in a loop; awaiting a `void`-returning function is legal TS and behaves identically (resolves on the next microtask either way).

*Alternative considered and rejected*: re-adding `async` to `handleDownload` instead. Rejected because it would silently reintroduce the exact fetch-then-download indirection commit `8842160` deliberately removed in spirit (wrapping a synchronous, fire-and-forget anchor click in a needless Promise), for no behavioral gain. The prop-type fix matches the code's actual, intended shape.

This is a single-file, single-line, zero-behavior-change fix. Safe to batch alone (Batch 0 below).

---

## B. ESLint findings

**Totals: 120 errors, 105 warnings, 43 files with findings.**

### Rule summary (sorted by total)

| Rule | Errors | Warnings | Category |
|---|---|---|---|
| `@typescript-eslint/no-unused-vars` | 0 | 58 | Mixed: mostly dead code (style), a few worth a human look (below) |
| `@typescript-eslint/no-require-imports` | 41 | 0 | **Misconfiguration** (rule applied to `.cjs` files), see part D |
| `react-hooks/refs` | 25 | 0 | **Bug risk** |
| `react-hooks/set-state-in-effect` | 23 | 0 | **Bug risk** (perf + correctness smell) |
| `react-hooks/exhaustive-deps` | 0 | 22 | **Bug risk** (stale closures), case-by-case |
| `@typescript-eslint/no-explicit-any` | 17 | 0 | Style / type-safety debt, low acute risk |
| `unused-eslint-disable-directive` (no ruleId) | 0 | 12 | Style, zero risk, mechanical deletes |
| `@next/next/no-img-element` | 0 | 8 | Style / perf advisory, not correctness |
| `react-hooks/preserve-manual-memoization` | 8 | 0 | **Misconfiguration given current config**, see part D |
| `@typescript-eslint/no-unused-expressions` | 0 | 4 | Style, zero risk (see instances) |
| `react-hooks/immutability` | 3 | 0 | Mixed, see instances |
| `prefer-const` | 1 | 0 | Style, zero risk |
| `react/no-deprecated` | 1 | 0 | In a generated file, see part D |
| `@next/next/no-assign-module-variable` | 1 | 0 | In a generated file, see part D |
| `jsx-a11y/alt-text` | 0 | 1 | Real, minor a11y gap |

Two files skew the totals in ways worth calling out up front:

- `design/support.js` (1911 lines) opens with `// GENERATED from dc-runtime/src/*.ts, do not edit. Rebuild with 'cd dc-runtime && bun run build'.` It contributes 2 of the 120 errors and 8 of the 105 warnings. See part D, it should be excluded from lint, not "fixed."
- `scripts/*.test.cjs` (5 files) contribute all 41 `no-require-imports` errors, 34% of all errors in the run. See part D, the rule is being applied where it shouldn't be.

### Error-level instances, every one, by rule

**`@typescript-eslint/no-require-imports` (41, all in `scripts/*.test.cjs`)**

```
scripts/compose-split.test.cjs:2:12, 3:12, 9:18, 10:16, 11:14, 12:12, 13:22, 14:23, 17:34, 18:39
scripts/flow-read-this.test.cjs:2:12, 3:12, 4:14, 5:16, 24:18, 25:16, 26:15, 27:50, 49:43
scripts/flow-reliability.test.cjs:2:12, 3:12, 4:14, 5:16, 19:18, 20:16, 21:28, 53:64
scripts/kling-veto.test.cjs:2:12, 3:12, 9:18, 10:16, 11:67
scripts/workflow-behavior.test.cjs:2:12, 3:12, 9:18, 10:16, 11:26, 12:25, 13:32, 14:26, 15:39
```
All: "A `require()` style import is forbidden." Every hit is a plain `require("...")` at the top of a `.cjs` Node test file. Not a bug; see part D.

**`react-hooks/refs` (25)**, "Cannot access refs during render":

```
app/gallery/page.tsx:5916:25 (x2), 5920:18 (x2), 5921:27 (x2), 5922:22 (x2)
components/WorkflowCanvas.tsx:184:3, 1515:25, 1521:22, 1546:25, 1669:29
components/nodes/AssistantNode.tsx:36:3
components/nodes/PromptNode.tsx:141:3, 262:3
components/nodes/VideoGeneratorNode.tsx:345:3
components/nodes/VideoInputNode.tsx:98:3, 99:3, 100:3, 101:3, 102:3, 103:3, 174:3
lib/usePipelineRunner.ts:18:3
```

Two distinct shapes, both real:

1. **Ref-sync-during-render idiom** (WorkflowCanvas:184, AssistantNode:36, PromptNode:141, VideoGeneratorNode:345, VideoInputNode: all 7, usePipelineRunner:18): a bare `xRef.current = x;` statement directly in the component body (not inside an effect/handler), used to keep a ref in sync with the latest prop/state without adding it to a `useCallback`/`useEffect` dependency array. This is a widespread, repeated pattern (8 different files), not 20 independent bugs. It "works" today, but mutating during the render phase is unsound under React's rules: it isn't safe under work that gets thrown away and retried (Suspense, offscreen/prerendering), and React does not guarantee render only runs once. Genuine, if currently-quiet, risk.
2. **Reading a ref inside `useMemo`** (gallery/page.tsx:5916-5922, WorkflowCanvas.tsx:1515-1669): `useMemo` bodies run during render; reading a mutable ref inside one means the memo can silently miss a recompute when the ref changes (the ref isn't a tracked dependency), which is the same *stale value* failure mode `exhaustive-deps` exists to catch, just via a ref instead of a closed-over variable.

**`react-hooks/set-state-in-effect` (23)**, "Calling setState synchronously within an effect can trigger cascading renders":

```
app/chat/page.tsx:628:35, 632:53
app/gallery/page.tsx:451:5, 4871:5, 6559:21, 6561:39
components/MediaPickerModal.tsx:274:18
components/SelectionToolbar.tsx:70:7
components/SettingsModal.tsx:1090:5
components/nodes/AssistantNode.tsx:95:7
components/nodes/GenerateNode.tsx:166:23
components/nodes/ImageInputNode.tsx:181:21, 194:7
components/nodes/PromptNode.tsx:278:21, 279:21
components/nodes/VideoGeneratorNode.tsx:554:7
components/nodes/VideoInputNode.tsx:115:7, 301:7
components/ui/TypewriterHeading.tsx:15:5
hooks/use-mobile.ts:14:5
lib/useAnimatedPopup.ts:10:7
lib/usePipelineRunner.ts:70:7
lib/useSpaceSync.ts:44:7
```

Mostly the "reset local UI state when an id/prop changes" pattern (e.g. gallery `Lightbox`'s `useEffect(() => { setImgIdx(0); ... }, [item.id, thumbUrl])`). Functionally fine today; React's own current guidance is to prefer computing the value during render or resetting via a `key` change on the subtree instead of an effect, because the effect version causes one extra render pass. Not a crash risk, a real (if usually minor) perf/cascading-render smell, and a few of these (the hydration-gated store syncs in `app/chat/page.tsx:628/632` and `lib/useSpaceSync.ts:44`) are exactly the kind of "sync from an external system" case effects are for, so not every instance should be mechanically rewritten the same way. Needs per-instance judgment, see Batch 6.

**`@typescript-eslint/no-explicit-any` (17)**:

```
app/api/flow/status/route.ts:15:21
app/api/flow/token/route.ts:37:19
app/api/generate/route.ts:363:19
app/gallery/page.tsx:3577:1276, 3589:212, 3589:622, 4590:28, 4590:49
components/nodes/VideoGeneratorNode.tsx:693:17
lib/flowAdapter.ts:77:20, 78:23, 79:19, 170:58, 171:65, 239:58, 240:65
lib/flowJobPoller.ts:19:34
```

`lib/flowAdapter.ts` accounts for 7 of the 17 and they share one root cause: `storeInstance`, `browsersInstance`, `flowInstance` (lines 77-79) are module-level caches for modules loaded at runtime via `import()` from an absolute external path (`F:/CLAUDE/AGENT_AI/google-flow-mcp/dist/...`, outside this TS project, no `.d.ts` wired in). Lines 170/171/239/240 are `(a: any) => ...` filter callbacks over `accountsFile.accounts`, which comes from that same untyped store. Fixing this properly means hand-authoring ambient types for the external module, a real but separate task, not a one-line fix. The other 10 instances are scattered, ordinary "type this API response properly" debt. None showed evidence of an active bug in this pass, but `flowAdapter.ts` / `flowJobPoller.ts` are the exact subsystem the last 4 commits on this branch are hardening (Flow polling/reliability), so it's worth prioritizing those 8 over the rest if time is limited.

**`react-hooks/preserve-manual-memoization` (8)**, "Compilation Skipped: Existing memoization could not be preserved":

```
components/WorkflowCanvas.tsx:1429:42
components/nodes/PromptNode.tsx:453:5, 470:5, 546:41 (x3), 556:42 (x2)
```

Every one of these is the React Compiler's dependency inference disagreeing with a `useCallback` dependency array where the "missing" inferred dependency is a `useState` setter (`setSnapGuides`, `setLocalText`, `setExpandMentionQuery`, `setExpandSelectedIdx`). `useState` setters are guaranteed stable across renders, so none of these are stale-closure bugs, they're the compiler being stricter than necessary for code that's already safe. See part D, this is a config question, not a code-fix backlog.

**`react-hooks/immutability` (3)**:

```
app/gallery/page.tsx:6565:75 - "Cannot access variable before it is declared" (handleClose used in a useEffect above its own `const handleClose = ...` at line 6580)
components/WorkflowCanvas.tsx:433:51 - "Cannot access variable before it is declared" (setSnapGuides used at 433, declared via useState at 975)
components/WorkflowCanvas.tsx:1431:5 - "This value cannot be modified" (snapTargetRef.current = null inside handleNodeDragStop's useCallback body, flagged as mutating a value tied to an earlier hook call)
```

The first two work correctly today only because the referencing code runs inside a callback/effect that fires after the whole component body (and the later declaration) has run once; it's forward-reference-shaped code that is fragile to reorder, cheap to fix by moving the declaration above its first use, and worth doing regardless of Compiler adoption. The third is a ref mutation inside an event-handler callback, normally completely idiomatic React; flagged here for the same "hook-argument immutability" reasoning as `preserve-manual-memoization` above, current practical risk is low.

**`prefer-const` (1)**: `app/gallery/page.tsx:2336:11`, `'remaining' is never reassigned. Use 'const' instead.` Mechanical, zero risk.

**`react/no-deprecated` (1)** and **`@next/next/no-assign-module-variable` (1)**: both in `design/support.js` (lines 198 and 1215), the generated bundle. See part D.

### Warnings, counts per file, by rule

**`@typescript-eslint/no-unused-vars` (58)**: `app/gallery/page.tsx` 12, `components/nodes/VideoGeneratorNode.tsx` 8, `components/WorkflowCanvas.tsx` 6, `design/support.js` 5, `components/AppSidebar.tsx` 4, `components/CanvasToolbar.tsx` 3, `components/NodePickerMenu.tsx` 2, `components/nodes/PromptNode.tsx` 2, `lib/chatStreamingStore.ts` 2, `lib/getAzureKey.ts` 2, `lib/getKieToken.ts` 2, `lib/useGeneratingBorderAnimation.ts` 2, `lib/workflow-runtime/runner.ts` 2, `components/SelectionToolbar.tsx` 1, `components/edges/CuttableEdge.tsx` 1, `components/nodes/GenerateNode.tsx` 1, `components/nodes/VideoInputNode.tsx` 1, `lib/arrangeNodes.ts` 1, `lib/workflow-runtime/compiler.ts` 1.

Most of these are dead imports (icons, types) or a destructured store field/action nobody reads in that file, harmless (verified `getAzureKey.ts`/`getKieToken.ts`'s `_args` and `lib/useGeneratingBorderAnimation.ts`'s `_cardRef`/`_busy` are already underscore-prefixed, i.e. deliberately-unused parameters that should be in the rule's ignore pattern, not fixed by hand, see part D). A handful looked, on inspection, like possible leftovers from a refactor rather than harmless noise; listed individually under "needs a human look" in Batch 3:

- `app/gallery/page.tsx:6554` `setDownloading` (in `Lightbox`): the `downloading` state exists but its setter is never called anywhere in the file, and `Lightbox`'s own props don't even include `onDownload`. Looks like inert leftover state, not a live bug (nothing crashes), but worth a decision: wire it up or delete both halves.
- `app/gallery/page.tsx:714` `setKieKeySet`: confirmed benign, `kieKeySet` (the read side) is actively used at lines 1060/1797/2218 to gate generation; only the setter half of this destructure is unused in this file (called from elsewhere, e.g. a settings modal). Safe to delete just that one line.
- `app/gallery/page.tsx:2208-2210` `allUploaded`, `hasVidRefs`: computed booleans with no reader anywhere later in the function. Possibly leftover from a removed guard on the generate action; a human should check whether the generate button's disabled logic still accounts for in-flight uploads / video refs before deleting these.
- `components/WorkflowCanvas.tsx:1503` `canRun`: `!isRunning && nodes.some(...)` computed and never read. `isRunning`/`setIsRunning` themselves are used elsewhere in the file, but no "Run" trigger in this file (only 2 hits total for `isRunning`/`canRun`) appears to consult this guard. Worth checking whether whatever actually triggers a workflow run is still protected against double-submit / running with zero eligible nodes.

**`react-hooks/exhaustive-deps` (22)**: `components/WorkflowCanvas.tsx` 7, `components/nodes/GenerateNode.tsx` 5, `components/nodes/GroupNode.tsx` 2, `app/chat/page.tsx` 1, `app/gallery/page.tsx` 1, `components/QuickAssist.tsx` 1, `components/nodes/AssistantNode.tsx` 1, `components/nodes/PromptNode.tsx` 1, `components/nodes/VideoGeneratorNode.tsx` 1, `components/ui/TypewriterHeading.tsx` 1, `design/support.js` 1.

**`unused-eslint-disable-directive` (12, no ruleId, "Unused eslint-disable directive")**: `components/nodes/VideoInputNode.tsx:129, 495, 734, 785` (4), `components/nodes/VideoGeneratorNode.tsx:484, 1258, 1971` (3), `app/gallery/page.tsx:1217, 1327` (2), `components/nodes/PromptNode.tsx:943, 1128` (2), `components/nodes/ImageInputNode.tsx:218` (1). Every one names `react-hooks/exhaustive-deps` or `jsx-a11y/media-has-caption` as the rule that no longer fires there. Pure hygiene, delete the comment, the code underneath already doesn't trip the named rule.

**`@next/next/no-img-element` (8)**: `components/WorkflowHero.tsx` 4 (lines 40, 55, 70, 85), `app/gallery/page.tsx` 2 (436, 3578), `components/MediaPickerModal.tsx` 1 (56), `components/nodes/PromptNode.tsx` 1 (1081). Checked `WorkflowHero.tsx`'s 4: local static `/1.webp`.. `/4.webp` assets with fixed pixel sizes rendered as `absolute inset-0 size-full object-cover` inside a sized wrapper, i.e. a `fill`-mode `next/image` candidate, but not a blind tag swap (needs `fill`, a `sizes` prop, and `priority` instead of `loading="eager"`, and visual QA since this is hero/marketing art under the Solstice design system). Perf/LCP advisory only, nothing broken today.

**`@typescript-eslint/no-unused-expressions` (4)**: `app/gallery/page.tsx` 2 (605, 3203), `design/support.js` 2. Both `gallery/page.tsx` hits are the identical, intentional idiom `cond ? set.delete(x) : set.add(x)` used as a statement for its side effect, discarding the boolean. Not a bug, ESLint just dislikes ternary-as-statement; mechanical rewrite to `if (cond) set.delete(x); else set.add(x);` is safe.

**`jsx-a11y/alt-text` (1)**: `lib/nodeTypes.tsx:12`. Real, minor: an image element missing an `alt`.

---

## C. Fix order, in batches

Each batch is independently committable and independently verifiable with:

```
npx tsc --noEmit -p .
pnpm lint            # or: npx eslint . -f json -o <tmp>
node --test scripts/*.test.cjs
```

`pnpm test:workflow` was not run in this audit (excluded by the hard rules, and it would shell out through the live port-3000 process's working tree). Its own final step is `tsc --noEmit`, so it will pass once Batch 0 lands and stay green afterwards as long as `tsc` stays clean; its first three checks (workflow-runtime files present, HeyGen wiring strings, balance-check strings) are unaffected by anything in this plan, none of these batches touch those files' substance.

**Batch 0, the tsc fix.** `app/gallery/page.tsx:5882`, `Promise<void>` to `void` on `onDownload`. One line, one file. Verify: `tsc` goes to 0 errors; `pnpm test:workflow`'s gate 4 now passes.

**Batch 1, ESLint config only, no source edits.** In `eslint.config.mjs`:
- Add `design/support.js` to the `globalIgnores` array (already holds `.next/**`, `out/**`, `build/**`, `next-env.d.ts`, `src-tauri/**`, same category: generated output). Removes 2 errors + 8 warnings.
- Add an override turning `@typescript-eslint/no-require-imports` off for `**/*.cjs`. Removes 41 errors.
- Add an override lowering `react-hooks/preserve-manual-memoization` from `error` to `warn` (justified in part D). Removes 8 errors from the CI-blocking count, keeps them visible.

Net: 120 to 69 errors, 105 to 97 warnings, zero source files touched. Verify with the three commands above; expect identical tsc output to Batch 0, and the ESLint error/warning totals to drop by exactly 51 errors / 8 warnings from wherever Batch 0 left them.

**Batch 2, mechanical zero-risk source cleanups.** Safe to do as one commit, none of these can change behavior:
- Delete the 12 stale `// eslint-disable-line` / `eslint-disable` comments listed above.
- `app/gallery/page.tsx:2336`, `let` to `const` for `remaining`.
- `app/gallery/page.tsx:605` and `:3203`, rewrite the two `cond ? del : add` ternary-statements to `if/else`.
- Delete the plainly-dead imports/locals in the `no-unused-vars` list that are unused *icons, types, and destructures with no special meaning* (e.g. `AppSidebar.tsx`'s `FolderOpen`/`FolderPlus`/`GitHubIcon`, `CanvasToolbar.tsx`'s `Scissors`/`LayoutTemplate`/`MessageSquare`, `NodePickerMenu.tsx`'s `Node`/`NodeData`, `WorkflowCanvas.tsx`'s `Panel`, `lib/workflow-runtime/runner.ts`'s `PlanStep`/`Output`, `lib/chatStreamingStore.ts`'s `SYSTEM_PROMPT`, and similar). Skip the four items flagged "needs a human look" below, they go in Batch 3.

Verify: tsc still 0; error count unchanged (Batch 2 only touches warnings); warning count drops by roughly 12 (disables) + ~40-45 (unused vars, excluding the 4 flagged ones) + design/support.js's share already removed in Batch 1.

**Batch 3, the `no-unused-vars` instances that need a human decision first, not a mechanical delete:**
- `app/gallery/page.tsx:6554` `downloading`/`setDownloading` in `Lightbox`: decide wire-up vs delete.
- `app/gallery/page.tsx:2208-2210` `allUploaded`/`hasVidRefs`: check the generate button's guard logic before deleting.
- `components/WorkflowCanvas.tsx:1503` `canRun`: check whatever triggers a run for a missing double-submit/empty-canvas guard before deleting.
- The three `_`-prefixed intentionally-unused params (`getAzureKey.ts`, `getKieToken.ts`, `useGeneratingBorderAnimation.ts`, `arrangeNodes.ts:93`, `chatStreamingStore.ts:34`) don't need code changes at all, they need the `argsIgnorePattern`/`varsIgnorePattern: '^_'` option added to the rule config (part D), not per-site fixes.

**Batch 4, `no-explicit-any` (17 errors).** Not mechanical; each needs a real type. Suggested order: the `lib/flowAdapter.ts` cluster (7, one shared root cause, the untyped external `google-flow-mcp` module boundary) and `lib/flowJobPoller.ts:19` first since they're in the subsystem the last 4 commits are actively hardening; the 3 API-route instances and 5 `gallery/page.tsx` instances and `VideoGeneratorNode.tsx:693` after, ordinary JSON/event-payload typing. Low risk if done as "add an interface", flag for a second look only if a fix requires *narrowing* an existing `any` in a way that could now throw where it silently coerced before.

**Batch 5, `react-hooks/exhaustive-deps` (22 warnings).** Classic stale-closure territory, the one category the task brief specifically calls out. Each of the 11 files needs its own look; do not blanket-add missing deps without checking whether that turns an intentional "run once" or "run on X only" effect into a re-run-on-every-render effect (the opposite failure mode). **Flag for human review, not batchable as one mechanical pass.**

**Batch 6, the big one: `react-hooks/refs` (25) + `react-hooks/set-state-in-effect` (23) + the 2 forward-reference `react-hooks/immutability` hits (2 of the 3), 50 errors total.** These are real patterns, not false positives (see part B), but every fix changes *when* something runs relative to render (moving a ref assignment into an effect delays it to post-commit; moving a `setState` out of an effect and into render-time computation or an event handler changes render count and timing). None of this is mechanically safe to batch-apply without checking each call site's assumptions, and there is no running app available in this read-only audit to confirm nothing visually regresses. Recommend: its own dedicated pass, file by file, starting with the highest-concentration files (`VideoInputNode.tsx` 7 refs + 2 set-state, `PromptNode.tsx` 2 refs + 2 set-state + the immutability forward-reference, `WorkflowCanvas.tsx` 5 refs + the immutability forward-reference and the ref-mutation-in-callback), each verified against the running app, not just against `tsc`/`lint`. **All 50 are "needs a human look" by the task brief's own definition.**

**Batch 7, `no-img-element` (8 warnings) and `jsx-a11y/alt-text` (1 warning).** Optional, perf/a11y polish, not correctness. `WorkflowHero.tsx`'s 4 need `fill` + `sizes`, not a bare tag swap, and touch marketing-visible art under the Solstice design system, visual QA recommended if attempted.

---

## D. ESLint config adjustments recommended (vs. fixing code)

**1. Scope `@typescript-eslint/no-require-imports` (and, generally, the typescript-eslint rule block) away from `.cjs` files.**

Add to `eslint.config.mjs`:

```js
{
  files: ["**/*.cjs"],
  rules: {
    "@typescript-eslint/no-require-imports": "off",
  },
},
```

Justification: `.cjs` is Node's own explicit marker for "this file is CommonJS regardless of the nearest `package.json`'s `type` field." `require()` is not just permitted there, it's the only valid top-level import form (`import` in a `.cjs` file is a syntax error under Node's loader). All 41 hits are in `scripts/*.test.cjs`, exactly the working, `node --test`-run test files the task's own verification command exercises. `eslint-config-next`'s own "next" rule block deliberately scopes itself to `**/*.{js,jsx,mjs,ts,tsx,mts,cts}`, is explicit that `.cjs` is excluded there, but `eslint-config-next/typescript` layers `typescript-eslint.configs.recommended` on top without any file-extension restriction at all, so it lands on every file this project's own `eslint.config.mjs` feeds it, `.cjs` included. This project's config is the right place to close that gap, not a rewrite of 5 working test scripts to a different module system.

**2. Add `design/support.js` to `globalIgnores`.**

```js
globalIgnores([
  ".next/**",
  "out/**",
  "build/**",
  "next-env.d.ts",
  "src-tauri/**",
  "design/support.js",
]),
```

Justification: the file's own first line says `// GENERATED from dc-runtime/src/*.ts, do not edit. Rebuild with 'cd dc-runtime && bun run build'.` It is an esbuild-style bundle (`__defProp`/`__publicField` helpers), same category as the already-ignored `.next/**`/`out/**`/`build/**`. Linting it produces findings that cannot be "fixed" in place (the next `bun run build` overwrites any hand-edit) and hides real per-rule counts behind noise from a file nobody edits directly. It is the only `.js`/`.ts` file directly under `design/`, so this is a precise one-line ignore, not a broad exclusion that could hide a real source file.

**3. Lower `react-hooks/preserve-manual-memoization` from `error` to `warn`, repo-wide, until the React Compiler is actually adopted.**

```js
{
  rules: {
    "react-hooks/preserve-manual-memoization": "warn",
  },
},
```

Justification: this rule's entire purpose is "the React Compiler could not safely optimize this component." `next.config.ts` has no `reactCompiler` key at all, and `babel-plugin-react-compiler` is not in `package.json`, confirmed by reading both, so the compiler does not run in this project's build today (per Next's own `reactCompiler.md` doc: "It is not enabled by default"). Every one of the 8 current findings traces to a `useState` setter (`setSnapGuides`, `setLocalText`, `setExpandMentionQuery`, `setExpandSelectedIdx`) being "missing" from a manual dependency array, and setters are referentially stable across renders by React's own contract, so none of these are the stale-closure bugs `exhaustive-deps` would flag; they're the compiler's inference being stricter than the code needs to be while the compiler is inert. Blocking CI on 8 errors with zero current runtime effect, whose "fix" means hand-editing dependency arrays on drag-stop and textarea-change handlers, is a bad trade until `reactCompiler: true` is actually turned on. Re-promote to `error` at that point, since then it would gate real optimizer correctness.

**Considered and rejected: doing the same for `react-hooks/refs` and `react-hooks/set-state-in-effect`.** All four rule families shipped together in the same `eslint-plugin-react-hooks` major version, so it's tempting to treat them as one "new noisy dependency" problem. Rejected because, unlike `preserve-manual-memoization`, these two describe runtime-observable anti-patterns that predate and do not depend on whether the compiler is enabled (mutating/reading a ref during the render phase is unsound under React's own rules regardless of Compiler; calling `setState` synchronously inside an effect causes a real extra render today). Downgrading them would hide a real, if currently low-severity, backlog rather than correctly-scoped noise. Leave at `error`, work through them in Batch 6.

**4. Add `argsIgnorePattern`/`varsIgnorePattern` for the `_`-prefixed convention already in use, instead of hand-deleting those specific unused vars.**

```js
{
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
},
```

Justification: `components/WorkflowCanvas.tsx:51` (`_token`), `lib/getAzureKey.ts:7,11` (`_args`), `lib/getKieToken.ts:7,11` (`_args`), `lib/useGeneratingBorderAnimation.ts:11,12` (`_cardRef`, `_busy`), `lib/arrangeNodes.ts:93` (`_`), `lib/chatStreamingStore.ts:34` (`_`), and `design/support.js:833` (`_prevProps`, moot once ignored per item 2) all already follow the common "underscore means deliberately unused" convention, by hand, without the lint config actually recognizing it. Right now the rule doesn't know that convention, so it flags all of them anyway, defeating the point of using the convention. Configuring the pattern once is less code than adding an ignore comment to each site, and keeps working for the next one.

**Not recommended:** changing `@typescript-eslint/no-explicit-any` severity. It's `error` via `typescript-eslint`'s own `recommended` preset (not something `eslint-config-next` or this repo escalated), and none of the 17 instances are false positives, they're real, untyped `any`s. Leave it as a real backlog item (Batch 4), not a config question. Also not recommended: touching `@next/next/no-img-element` or `jsx-a11y/alt-text` severity, both are already `warn`, both are correctly firing on real (if low-severity) instances, no misconfiguration there.
