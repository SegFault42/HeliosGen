# Flow confiável: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Os 4 fluxos de geração via Google Flow (imagem, texto para vídeo, start frame para vídeo, interpolação A→B) rodam pelo Anvil ponta a ponta sem intervenção manual na aba do Flow.

**Architecture:** A automação do Flow vive no pacote externo `google-flow-mcp` (Playwright via CDP no Chrome da porta 9444), que o HeliosGen importa do `dist/`. A detecção de mídia passa a olhar só os tiles da grade de resultados (nunca o painel de chat), o download passa a seguir sempre a identidade rastreada do asset, e o poller do HeliosGen ganha prazo por relógio e erros fatais.

**Tech Stack:** TypeScript, Playwright, Node `node:test` (via `tsx --test` no MCP e `node --test` + transpile no HeliosGen), Next.js 16, ffprobe.

Spec: `docs/superpowers/specs/2026-09-22-flow-reliability-design.md`

## Global Constraints

- Repo do MCP: `F:/CLAUDE/AGENT_AI/google-flow-mcp`. Repo do Anvil: `D:/CLAUDE PROJECTS/HeliosGen`.
- O HeliosGen consome `F:/CLAUDE/AGENT_AI/google-flow-mcp/dist/*.js`. Toda mudança no MCP exige `npx tsc -p tsconfig.json` no MCP e reinício do dev server do HeliosGen (cache de módulo ESM do Node).
- Há outras sessões do Claude editando o HeliosGen em paralelo. Antes de cada edição, reler o trecho atual do arquivo. Nunca reverter mudanças que não são suas.
- Grade de resultados do Flow: tiles `flow-video-tile` e `flow-image-tile` dentro de `.tiles-container`. Painel de chat do agente: `flow-agent-panel`. Tile de vídeo pronto não tem `<video>`, só `img.thumbnail`; tile em progresso mostra texto de porcentagem (ex: `5%`).
- Submenu Download de vídeo no Flow (en): `270p Animated GIF`, `720p Original size`, `1080p Upscaled`, `4K Upscaled`.
- Prazos do poller: imagem 5 min, vídeo 20 min, contados a partir de `created_at` do job.
- Códigos de erro fatais: `generated_asset_not_found`, `job_asset_identity_missing`, `ui_changed`, `login_required`, `download_failed`, `download_type_mismatch`.
- Projeto Flow dedicado ao Anvil: `https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3`.
- Durante o smoke test ninguém toca na aba do Flow, nem via CDP.
- Prosa em português sem travessão nem meia-risca. Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Baseline nos dois repos

**Files:**
- Delete: os 20 arquivos `*.bak-*` do HeliosGen
- Delete: PNGs de debug na raiz do MCP (`buttons-screen.png`, `debug-screen.png`, `debug-signout.png`, `flowuser-u1-screen.png`, `job-running-screen.png`, `project-workspace.png`)

- [ ] **Step 1: Apagar os .bak do HeliosGen**

```bash
cd "D:/CLAUDE PROJECTS/HeliosGen"
git ls-files --others --exclude-standard | grep -E '\.bak-[a-z]+-[0-9]{8}-[0-9]{6}$'
git ls-files --others --exclude-standard | grep -E '\.bak-[a-z]+-[0-9]{8}-[0-9]{6}$' | xargs -d '\n' rm --
```

Expected: a primeira linha lista exatamente 20 arquivos; depois do `rm`, a mesma listagem volta vazia.

- [ ] **Step 2: Conferir que nada sensível entra no baseline do HeliosGen**

```bash
git status --short | grep -iE '\.env|secret|credential|auth\.json|\.pem|\.key$' || echo "nothing sensitive"
```

Expected: `nothing sensitive`. Se aparecer algo, parar e perguntar ao usuário.

- [ ] **Step 3: Commit baseline do HeliosGen**

```bash
git add -A
git status --short | head -80
git commit -m "$(cat <<'EOF'
wip: baseline before flow reliability fixes

Snapshot of accumulated work (flow/heygen providers, workflow runtime,
compose-split, read-this bypass, prompt limit 20k) so each Flow fix
lands as its own revertable commit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Apagar PNGs de debug do MCP e commitar baseline**

```bash
cd "F:/CLAUDE/AGENT_AI/google-flow-mcp"
rm -f buttons-screen.png debug-screen.png debug-signout.png flowuser-u1-screen.png job-running-screen.png project-workspace.png
git status --short | grep -iE '\.env|secret|credential|cookie.*\.json|\.pem' || echo "nothing sensitive"
git add -A
git commit -m "$(cat <<'EOF'
wip: baseline before flow reliability fixes

Includes the Add media Upload menu fix and the image-only Method 0
download guard applied during the 2026-09-21 debugging session.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Expected: `nothing sensitive`, depois commit criado.

---

### Task 2: Detecção de mídia só na grade, com prontidão por tile (MCP)

**Files:**
- Modify: `F:/CLAUDE/AGENT_AI/google-flow-mcp/src/media-selection.ts`
- Modify: `F:/CLAUDE/AGENT_AI/google-flow-mcp/src/flow-adapter.ts` (métodos `mediaLocator`, `mediaSnapshots`, `waitForNewMedia`, `isMediaSourceReady`)
- Test: `F:/CLAUDE/AGENT_AI/google-flow-mcp/tests/media-selection.test.ts`

**Interfaces:**
- Produces: `mediaTileSelector(type: MediaType): string`, `tileIsReady(tile: TileState): boolean`, `interface TileState { imageLoaded: boolean; imageWidth: number; text: string }`, exportados de `src/media-selection.ts`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `tests/media-selection.test.ts`:

```ts
import { mediaTileSelector, tileIsReady } from "../src/media-selection.js";

test("media tiles are scoped to the results grid, never the agent chat", () => {
  assert.equal(mediaTileSelector("video"), ".tiles-container flow-video-tile");
  assert.equal(mediaTileSelector("image"), ".tiles-container flow-image-tile");
});

test("a tile is ready only with a loaded full image and no progress text", () => {
  assert.equal(tileIsReady({ imageLoaded: true, imageWidth: 1376, text: "play_circle" }), true);
  assert.equal(tileIsReady({ imageLoaded: false, imageWidth: 0, text: "" }), false);
  assert.equal(tileIsReady({ imageLoaded: true, imageWidth: 1376, text: "5%" }), false);
  assert.equal(tileIsReady({ imageLoaded: true, imageWidth: 1376, text: "play_circle 87 %" }), false);
  assert.equal(tileIsReady({ imageLoaded: true, imageWidth: 64, text: "" }), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd "F:/CLAUDE/AGENT_AI/google-flow-mcp" && npx tsx --test tests/media-selection.test.ts
```

Expected: FAIL, `mediaTileSelector` / `tileIsReady` não exportados.

- [ ] **Step 3: Implementar em `src/media-selection.ts`**

Trocar a primeira linha de import por:

```ts
import type { MediaAssetIdentity, MediaType } from "./types.js";
```

Acrescentar ao final do arquivo:

```ts
export interface TileState {
  imageLoaded: boolean;
  imageWidth: number;
  text: string;
}

// Only grid tiles are generated media. The agent chat panel echoes attached
// reference images with the same /asb/ URLs, which used to be mistaken for output.
export function mediaTileSelector(type: MediaType): string {
  return type === "video" ? ".tiles-container flow-video-tile" : ".tiles-container flow-image-tile";
}

const PROGRESS_TEXT = /\b\d{1,3}\s?%/;

export function tileIsReady(tile: TileState): boolean {
  return tile.imageLoaded && tile.imageWidth >= 256 && !PROGRESS_TEXT.test(tile.text);
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx tsx --test tests/media-selection.test.ts
```

Expected: PASS em todos os testes do arquivo.

- [ ] **Step 5: Usar os helpers no `flow-adapter.ts`**

No bloco de import de `./media-selection.js`, acrescentar `mediaTileSelector,` e `tileIsReady,`.

Substituir o método `mediaLocator` inteiro por:

```ts
  private mediaLocator(page: Page, type: MediaType): Locator {
    return page.locator(mediaTileSelector(type));
  }
```

Substituir o método `mediaSnapshots` inteiro por:

```ts
  private async mediaSnapshots(page: Page, type: MediaType): Promise<MediaSnapshot[]> {
    const raw = await this.mediaLocator(page, type).evaluateAll((elements) => elements.map((element, index) => {
      const keys: string[] = [];
      let sourceUrl: string | undefined;
      const addUrl = (value: string | null | undefined) => {
        if (!value) return;
        try {
          sourceUrl ??= new URL(value, window.location.href).href;
        } catch {
          // Identity fallback below still applies.
        }
        keys.push(`url:${value}`);
        if (!value.startsWith("blob:")) {
          try {
            const parsed = new URL(value, window.location.href);
            const originalParameterCount = [...parsed.searchParams].length;
            for (const name of [...parsed.searchParams.keys()]) {
              if (/^(?:x-goog-|signature$|sig$|expire$|expires$|token$|key-pair-id$)/i.test(name)) {
                parsed.searchParams.delete(name);
              }
            }
            parsed.hash = "";
            parsed.searchParams.sort();
            if (parsed.searchParams.size > 0 || originalParameterCount === 0) {
              keys.push(`url-stable:${parsed.toString()}`);
            }
          } catch {
            // The exact value above remains a usable identity.
          }
        }
      };

      const img = element.querySelector("img");
      const video = element.querySelector("video");
      if (video) {
        addUrl(video.currentSrc);
        addUrl(video.getAttribute("src"));
        for (const source of video.querySelectorAll("source")) addUrl(source.src || source.getAttribute("src"));
        addUrl(video.poster);
      }
      if (img) {
        addUrl(img.currentSrc);
        addUrl(img.getAttribute("src"));
      }

      let current: Element | null = element;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        for (const attribute of ["data-asset-id", "data-generation-id", "data-media-id"]) {
          const value = current.getAttribute(attribute);
          if (value) keys.push(`${attribute}:${value}`);
        }
      }

      if (!keys.length) {
        const html = element as HTMLElement;
        html.dataset.flowMcpAssetKey ||= `dom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        keys.push(html.dataset.flowMcpAssetKey);
      }

      return {
        index,
        keys: [...new Set(keys)],
        ...(sourceUrl ? { sourceUrl } : {}),
        tile: {
          imageLoaded: Boolean(img && img.complete),
          imageWidth: img ? img.naturalWidth : 0,
          text: (element as HTMLElement).innerText || "",
        },
      };
    }));
    return raw.map(({ tile, ...snapshot }) => ({ ...snapshot, ready: tileIsReady(tile) }));
  }
```

Em `waitForNewMedia`, substituir o corpo do `while` por:

```ts
      const candidates = selectNewMedia(await this.mediaSnapshots(page, type), baselineKeys);
      const ready = candidates.filter((candidate) => candidate.ready);
      if (ready.length >= expectedCount) {
        return ready.slice(0, expectedCount);
      }
      await page.waitForTimeout(2_000);
```

Apagar o método `isMediaSourceReady` inteiro (não tem mais chamador).

- [ ] **Step 6: Typecheck e testes do MCP**

```bash
npx tsc -p tsconfig.json --noEmit && npx tsx --test tests/media-selection.test.ts tests/approval.test.ts
```

Expected: sem erro de tipo, todos PASS. Se o `tsc` acusar `isMediaSourceReady` ainda referenciado, remover a referência restante.

- [ ] **Step 7: Commit**

```bash
git add src/media-selection.ts src/flow-adapter.ts tests/media-selection.test.ts
git commit -m "$(cat <<'EOF'
fix: detect generated media only from results grid tiles

The chat panel echoes attached start frames with /asb/ URLs, which were
counted as new output: clickGenerate returned before the approval gate
and the echo was downloaded as the "video".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Classificar opções do menu de download sem depender do `<video>` (MCP)

**Files:**
- Modify: `F:/CLAUDE/AGENT_AI/google-flow-mcp/src/upscale.ts` (`extractUpscaleOptions`)
- Test: `F:/CLAUDE/AGENT_AI/google-flow-mcp/tests/upscale.test.ts`

**Interfaces:**
- Produces: `extractUpscaleOptions(entries, originalHeight?)` classifica `original` / `upscale` / `preview` mesmo quando `originalHeight` é `undefined` ou `0`.

- [ ] **Step 1: Teste que falha**

Acrescentar em `tests/upscale.test.ts`:

```ts
test("infers the original size when the tile exposes no video element", () => {
  assert.deepEqual(
    extractUpscaleOptions([
      { text: "270p\nAnimated GIF" },
      { text: "720p\nOriginal size" },
      { text: "1080p\nUpscaled" },
      { text: "4K\nUpscaled" },
    ]),
    [
      { id: "270p", label: "270p Animated GIF", available: true, kind: "preview" },
      { id: "720p", label: "720p Original size", available: true, kind: "original" },
      { id: "1080p", label: "1080p Upscaled", available: true, kind: "upscale" },
      { id: "4k", label: "4K Upscaled", available: true, kind: "upscale" },
    ],
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx tsx --test tests/upscale.test.ts
```

Expected: FAIL, as opções saem com `kind: "unknown"`.

- [ ] **Step 3: Implementar**

Em `src/upscale.ts`, dentro de `extractUpscaleOptions`, logo após `const options: UpscaleOption[] = [];`, acrescentar:

```ts
  // Tiles in the results grid carry no <video>, so the caller often cannot measure
  // the native height. Flow lists a sub-480p GIF preview first, then the native
  // size, then upscales: the smallest height >= 480p is the original.
  const menuHeights = entries
    .map((entry) => upscaleHeight(normalizeUpscaleId(entry.text)))
    .filter((height): height is number => height !== undefined && height >= 480);
  const baseHeight = originalHeight || (menuHeights.length ? Math.min(...menuHeights) : undefined);
```

E trocar as duas ocorrências de `originalHeight` dentro do cálculo de `kind` por `baseHeight`:

```ts
    const kind = factor
      ? Number.parseInt(factor, 10) <= 1 ? "original" as const : "upscale" as const
      : baseHeight && height
        ? height < baseHeight ? "preview" as const : height === baseHeight ? "original" as const : "upscale" as const
        : "unknown" as const;
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx tsx --test tests/upscale.test.ts
```

Expected: PASS em todos (inclusive o teste localizado em espanhol, que continua passando 720).

- [ ] **Step 5: Commit**

```bash
git add src/upscale.ts tests/upscale.test.ts
git commit -m "$(cat <<'EOF'
fix: infer original download size when the tile has no video element

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Download sempre pela identidade rastreada, com trava de tipo (MCP)

**Files:**
- Modify: `F:/CLAUDE/AGENT_AI/google-flow-mcp/src/errors.ts`
- Modify: `F:/CLAUDE/AGENT_AI/google-flow-mcp/src/media.ts`
- Modify: `F:/CLAUDE/AGENT_AI/google-flow-mcp/src/flow-adapter.ts` (`downloadTracked`, `saveCapturedDownload`, imports)
- Test: `F:/CLAUDE/AGENT_AI/google-flow-mcp/tests/media.test.ts`

**Interfaces:**
- Consumes: `mediaLocator`, `mediaSnapshots` (Task 2); `readVideoDownloadOptions` com `kind: "original"` confiável (Task 3).
- Produces: `detectMediaKind(head: Uint8Array): "video" | "image" | "unknown"`, `assertMediaKind(file: string, expected: MediaType): Promise<void>` em `src/media.ts`; código de erro `download_type_mismatch`.

- [ ] **Step 1: Teste que falha**

Acrescentar em `tests/media.test.ts`:

```ts
import { detectMediaKind } from "../src/media.js";

test("detects media kind from magic bytes", () => {
  const mp4 = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
  assert.equal(detectMediaKind(mp4), "video");
  assert.equal(detectMediaKind(webm), "video");
  assert.equal(detectMediaKind(jpeg), "image");
  assert.equal(detectMediaKind(png), "image");
  assert.equal(detectMediaKind(webp), "image");
  assert.equal(detectMediaKind(new Uint8Array(16)), "unknown");
});
```

Se `tests/media.test.ts` ainda não importa `assert` e `test`, eles já existem no topo do arquivo (conferir; se não, acrescentar `import assert from "node:assert/strict";` e `import test from "node:test";`).

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx tsx --test tests/media.test.ts
```

Expected: FAIL, `detectMediaKind` não exportado.

- [ ] **Step 3: Implementar em `src/errors.ts` e `src/media.ts`**

Em `src/errors.ts`, na união `FlowErrorCode`, logo após `| "download_failed"`, acrescentar:

```ts
  | "download_type_mismatch"
```

Em `src/media.ts`, trocar `import { stat } from "node:fs/promises";` por:

```ts
import { open, stat } from "node:fs/promises";
import { FlowError } from "./errors.js";
```

Acrescentar ao final de `src/media.ts`:

```ts
export function detectMediaKind(head: Uint8Array): "video" | "image" | "unknown" {
  const ascii = (start: number, end: number) => Buffer.from(head.subarray(start, end)).toString("latin1");
  if (ascii(4, 8) === "ftyp") return "video";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image";
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "image";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image";
  if (ascii(0, 4) === "GIF8") return "image";
  return "unknown";
}

export async function assertMediaKind(file: string, expected: MediaType): Promise<void> {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    const actual = detectMediaKind(head);
    if (actual !== expected) {
      throw new FlowError("download_type_mismatch", `Expected a ${expected} file but got ${actual} content: ${file}`);
    }
  } finally {
    await handle.close();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx tsx --test tests/media.test.ts
```

Expected: PASS.

- [ ] **Step 5: Reescrever `downloadTracked` no `flow-adapter.ts`**

Trocar `import { mediaExtension, probeMedia } from "./media.js";` por:

```ts
import { assertMediaKind, mediaExtension, probeMedia } from "./media.js";
```

Conferir que `MediaProbe` está no import de `./types.js`; se não estiver, acrescentar `type MediaProbe,` nesse bloco.

Substituir o método `downloadTracked` inteiro (hoje com "Metodo 0", "Metodo 1" e o fallback por blob) por:

```ts
  private async downloadTracked(page: Page, job: FlowJob): Promise<void> {
    await mkdir(job.outputDirectory, { recursive: true });
    const tracked = this.resolveTrackedMedia(await this.mediaSnapshots(page, job.mediaType), job);
    const media = this.mediaLocator(page, job.mediaType);
    const downloaded: string[] = [];

    for (const [offset, snapshot] of tracked.entries()) {
      const suffix = tracked.length > 1 ? `-${offset + 1}` : "";
      const stem = `${safeFileStem(job.fileName || job.prompt.slice(0, 60))}-${job.id.slice(0, 8)}${suffix}`;

      if (job.mediaType === "image") {
        // The grid tile image is already full resolution; fetch it with the page's cookies.
        if (!snapshot.sourceUrl) continue;
        const response = await page.context().request.get(snapshot.sourceUrl, { timeout: 30_000 });
        try {
          if (!response.ok()) continue;
          const extension = mediaExtension(response.headers()["content-type"] ?? "", "image");
          const destination = path.join(job.outputDirectory, `${stem}${extension}`);
          await writeFile(destination, await response.body());
          await assertMediaKind(destination, "image");
          downloaded.push(destination);
        } finally {
          await response.dispose();
        }
        continue;
      }

      // Video tiles only carry a poster <img>; the real file comes from the asset menu.
      const options = await this.readVideoDownloadOptions(page, media.nth(snapshot.index));
      const original = options.find((option) => option.kind === "original" && option.available);
      if (!original) {
        await page.keyboard.press("Escape").catch(() => undefined);
        throw new FlowError("download_failed", "Flow did not offer an original-size download for the generated video.");
      }
      const choice = await this.findVisibleMenuOption(page, original.id);
      if (!choice) throw new FlowError("ui_changed", "The original-size download option disappeared before selection.");
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        choice.click(),
      ]);
      const destination = path.join(job.outputDirectory, `${stem}${path.extname(download.suggestedFilename()) || ".mp4"}`);
      await download.saveAs(destination);
      await page.keyboard.press("Escape").catch(() => undefined);
      await assertMediaKind(destination, "video");
      downloaded.push(destination);
    }

    if (downloaded.length === 0) {
      await this.store.updateJob(job, "failed", { error: "No generated file could be downloaded for this job." });
      throw new FlowError("download_failed", "No generated file could be downloaded for this job.");
    }

    const probes = await Promise.all(downloaded.map((file) => probeMedia(file).catch(() => undefined)));
    const completed = await this.store.updateJob(job, "completed", {
      downloadedFiles: downloaded,
      mediaProbe: probes.filter((probe): probe is MediaProbe => probe !== undefined),
    });
    await this.writeManifest(completed);
  }
```

Em `saveCapturedDownload`, logo após `await download.saveAs(destination);`, acrescentar:

```ts
    await assertMediaKind(destination, job.mediaType);
```

- [ ] **Step 6: Typecheck e testes**

```bash
npx tsc -p tsconfig.json --noEmit && npx tsx --test tests/media.test.ts tests/media-selection.test.ts tests/upscale.test.ts
```

Expected: sem erro de tipo, todos PASS. Se o `tsc` apontar `APIResponse` sem uso no import de playwright, remover só esse nome do import.

- [ ] **Step 7: Commit**

```bash
git add src/errors.ts src/media.ts src/flow-adapter.ts tests/media.test.ts
git commit -m "$(cat <<'EOF'
fix: download only the tracked asset and reject mismatched file types

Replaces the first-img-on-page and first-tile shortcuts with the tracked
identity. Video goes through the asset menu (Original size); an image
saved for a video job now fails instead of becoming a fake mp4. Zero
downloads marks the job failed instead of completed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Projeto Flow fixo (MCP + HeliosGen)

**Files:**
- Modify: `F:/CLAUDE/AGENT_AI/google-flow-mcp/src/types.ts` (`GenerationRequest`)
- Modify: `F:/CLAUDE/AGENT_AI/google-flow-mcp/src/flow-adapter.ts` (`generate`)
- Modify: `D:/CLAUDE PROJECTS/HeliosGen/lib/flowAdapter.ts` (`submitFlowVideo`, `submitFlowImage`, novo `flowProjectUrl`)
- Modify: `D:/CLAUDE PROJECTS/HeliosGen/.env.local`
- Test: `D:/CLAUDE PROJECTS/HeliosGen/scripts/flow-reliability.test.cjs` (novo)

**Interfaces:**
- Produces: `GenerationRequest.flowProjectUrl?: string` no MCP; `export function flowProjectUrl(): string` em `lib/flowAdapter.ts`.

- [ ] **Step 1: MCP, aceitar a URL do projeto**

Em `src/types.ts`, dentro de `interface GenerationRequest`, logo após `flowProject?: string;`, acrescentar:

```ts
  flowProjectUrl?: string;
```

Em `src/flow-adapter.ts`, dentro de `generate()`, trocar:

```ts
        page = await this.readyPage(account.id, true);
```

por:

```ts
        page = await this.readyPage(account.id, true, request.flowProjectUrl);
```

- [ ] **Step 2: Build do MCP**

```bash
cd "F:/CLAUDE/AGENT_AI/google-flow-mcp" && npx tsc -p tsconfig.json && npx tsx --test tests/media.test.ts tests/media-selection.test.ts tests/upscale.test.ts tests/approval.test.ts
```

Expected: build sem erro, `dist/` atualizado, testes PASS.

- [ ] **Step 3: Commit MCP**

```bash
git add src/types.ts src/flow-adapter.ts
git commit -m "$(cat <<'EOF'
feat: open a fixed Flow project URL for generations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: HeliosGen, teste que falha**

Criar `D:/CLAUDE PROJECTS/HeliosGen/scripts/flow-reliability.test.cjs`:

```js
// Compile local TypeScript modules for behavioral tests without a Next server.
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(ROOT, request.slice(2));
  return originalResolve.call(this, request, ...rest);
};
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { flowProjectUrl } = require("../lib/flowAdapter.ts");

test("flowProjectUrl: missing env fails with an actionable message", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  delete process.env.FLOW_PROJECT_URL;
  try {
    assert.throws(() => flowProjectUrl(), /FLOW_PROJECT_URL/);
  } finally {
    if (saved !== undefined) process.env.FLOW_PROJECT_URL = saved;
  }
});

test("flowProjectUrl: rejects anything that is not a Flow project URL", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  process.env.FLOW_PROJECT_URL = "https://flow.google.com/?pli=1";
  try {
    assert.throws(() => flowProjectUrl(), /FLOW_PROJECT_URL/);
  } finally {
    if (saved === undefined) delete process.env.FLOW_PROJECT_URL; else process.env.FLOW_PROJECT_URL = saved;
  }
});

test("flowProjectUrl: returns a valid project URL", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  process.env.FLOW_PROJECT_URL = " https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3 ";
  try {
    assert.equal(flowProjectUrl(), "https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3");
  } finally {
    if (saved === undefined) delete process.env.FLOW_PROJECT_URL; else process.env.FLOW_PROJECT_URL = saved;
  }
});
```

- [ ] **Step 5: Rodar e ver falhar**

```bash
cd "D:/CLAUDE PROJECTS/HeliosGen" && node --test scripts/flow-reliability.test.cjs
```

Expected: FAIL, `flowProjectUrl is not a function`.

- [ ] **Step 6: Implementar em `lib/flowAdapter.ts`**

Reler o arquivo antes (outra sessão pode ter mexido). Acrescentar logo após a função `shouldUseReadThis`:

```ts
const FLOW_PROJECT_URL_PATTERN = /^https:\/\/flow\.google\.com\/project\/[0-9a-f-]+$/i;

export function flowProjectUrl(): string {
  const url = process.env.FLOW_PROJECT_URL?.trim();
  if (!url || !FLOW_PROJECT_URL_PATTERN.test(url)) {
    throw new Error(
      `FLOW_PROJECT_URL ausente ou inválida (${url ?? "vazia"}). Crie um projeto no Google Flow e cole a URL https://flow.google.com/project/<id> em .env.local.`,
    );
  }
  return url;
}
```

Em `submitFlowVideo` e em `submitFlowImage`, dentro do objeto passado para `flow.generate({ ... })`, acrescentar a linha:

```ts
    flowProjectUrl: flowProjectUrl(),
```

- [ ] **Step 7: Rodar e ver passar**

```bash
node --test scripts/flow-reliability.test.cjs
```

Expected: 3 PASS.

- [ ] **Step 8: Configurar a env**

```bash
cd "D:/CLAUDE PROJECTS/HeliosGen"
grep -q '^FLOW_PROJECT_URL=' .env.local 2>/dev/null \
  && sed -i 's#^FLOW_PROJECT_URL=.*#FLOW_PROJECT_URL=https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3#' .env.local \
  || echo 'FLOW_PROJECT_URL=https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3' >> .env.local
grep '^FLOW_PROJECT_URL=' .env.local
git check-ignore -q .env.local && echo "ignored ok"
```

Expected: a linha da env impressa e `ignored ok` (o `.env.local` não entra no git).

- [ ] **Step 9: Commit HeliosGen**

```bash
git add lib/flowAdapter.ts scripts/flow-reliability.test.cjs
git commit -m "$(cat <<'EOF'
feat: route Flow generations to a fixed project from FLOW_PROJECT_URL

Starting from the Flow home screen failed with "Could not find Flow's
Generate control"; a dedicated project avoids that path entirely.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Poller com prazo por relógio e erros fatais (HeliosGen)

**Files:**
- Create: `D:/CLAUDE PROJECTS/HeliosGen/lib/flowPollPolicy.ts`
- Modify: `D:/CLAUDE PROJECTS/HeliosGen/lib/flowJobPoller.ts`
- Modify: `D:/CLAUDE PROJECTS/HeliosGen/lib/guest/db.ts:132-137` (`recoverJob` passa a expor `created_at`)
- Test: `D:/CLAUDE PROJECTS/HeliosGen/scripts/flow-reliability.test.cjs`

**Interfaces:**
- Produces: `flowDeadlineMs(isVideo: boolean): number`, `isFatalFlowError(error: unknown): boolean`, `flowErrorMessage(error: string, screenshot?: string): string` em `lib/flowPollPolicy.ts`.

- [ ] **Step 1: Teste que falha**

Acrescentar ao final de `scripts/flow-reliability.test.cjs`:

```js
const { flowDeadlineMs, isFatalFlowError, flowErrorMessage } = require("../lib/flowPollPolicy.ts");

test("poll deadline is wall clock: 5 min image, 20 min video", () => {
  assert.equal(flowDeadlineMs(false), 5 * 60_000);
  assert.equal(flowDeadlineMs(true), 20 * 60_000);
});

test("fatal Flow errors stop polling, transient ones do not", () => {
  for (const code of ["generated_asset_not_found", "job_asset_identity_missing", "ui_changed", "login_required", "download_failed", "download_type_mismatch"]) {
    const error = Object.assign(new Error("x"), { code });
    assert.equal(isFatalFlowError(error), true, code);
  }
  assert.equal(isFatalFlowError(Object.assign(new Error("x"), { code: "browser_error" })), false);
  assert.equal(isFatalFlowError(new Error("socket hang up")), false);
  assert.equal(isFatalFlowError(null), false);
});

test("error message carries the diagnostic screenshot path when present", () => {
  assert.equal(flowErrorMessage("boom", "C:/diag/job-1.png"), "boom (screenshot: C:/diag/job-1.png)");
  assert.equal(flowErrorMessage("boom"), "boom");
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --test scripts/flow-reliability.test.cjs
```

Expected: FAIL, módulo `lib/flowPollPolicy.ts` não existe.

- [ ] **Step 3: Criar `lib/flowPollPolicy.ts`**

```ts
export const FLOW_IMAGE_DEADLINE_MS = 5 * 60_000;
export const FLOW_VIDEO_DEADLINE_MS = 20 * 60_000;

const FATAL_CODES = new Set([
  "generated_asset_not_found",
  "job_asset_identity_missing",
  "ui_changed",
  "login_required",
  "download_failed",
  "download_type_mismatch",
]);

export function flowDeadlineMs(isVideo: boolean): number {
  return isVideo ? FLOW_VIDEO_DEADLINE_MS : FLOW_IMAGE_DEADLINE_MS;
}

export function isFatalFlowError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && FATAL_CODES.has(code);
}

export function flowErrorMessage(error: string, screenshot?: string): string {
  return screenshot ? `${error} (screenshot: ${screenshot})` : error;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
node --test scripts/flow-reliability.test.cjs
```

Expected: 6 PASS.

- [ ] **Step 5: `recoverJob` expõe `created_at`**

Em `lib/guest/db.ts`, na assinatura de `recoverJob`, trocar:

```ts
): Pick<Generation, "status" | "generation_type" | "video_url" | "image_url" | "image_urls" | "error_msg"> | null {
```

por:

```ts
): Pick<Generation, "status" | "generation_type" | "video_url" | "image_url" | "image_urls" | "error_msg" | "created_at"> | null {
```

- [ ] **Step 6: Reescrever o laço do poller**

Reler `lib/flowJobPoller.ts` antes. Trocar o import de debug e as constantes do topo:

```ts
import { dlog } from "./debugLog";

const active = new Set<string>();
const POLL_MS = 4_000;
const MAX_POLLS = 150; // ~10 minutes
```

por:

```ts
import { dlog } from "./debugLog";
import { flowDeadlineMs, flowErrorMessage, isFatalFlowError } from "./flowPollPolicy";

const active = new Set<string>();
const POLL_MS = 4_000;
```

Substituir a função `poll` inteira por:

```ts
async function poll(taskId: string): Promise<void> {
  const isVideo = taskId.startsWith("flow-video:");
  const isImage = taskId.startsWith("flow-image:");
  if (!isVideo && !isImage) return;

  const jobId = isVideo ? taskId.slice("flow-video:".length) : taskId.slice("flow-image:".length);
  const createdAt = Date.parse(guestDb.recoverJob(taskId)?.created_at ?? "") || Date.now();
  const deadline = createdAt + flowDeadlineMs(isVideo);

  dlog(`[FlowPoller] Polling started for ${taskId} (job ${jobId})`);

  while (Date.now() < deadline) {
    try {
      const dbGen = guestDb.recoverJob(taskId);
      if (dbGen?.status === "done") {
        if (isVideo && dbGen.video_url) {
          settle(taskId, { status: "done", videoUrl: dbGen.video_url }, true);
          return;
        }
        if (!isVideo && (dbGen.image_url || dbGen.video_url)) {
          settle(taskId, { status: "done", imageUrl: dbGen.image_url || dbGen.video_url }, false);
          return;
        }
      }

      let job = await refreshFlowJob(jobId);
      const status = (job?.status ?? "").toLowerCase();

      if (status === "failed" || status === "needs_attention") {
        const message = flowErrorMessage(job?.error || `Flow generation failed with status: ${status}`, job?.diagnosticScreenshot);
        console.error(`[FlowPoller] ${taskId} failed: ${message}`);
        settle(taskId, { status: "error", error: message }, isVideo);
        return;
      }

      if (status === "completed" || status === "ready" || (job?.generatedAssets?.length ?? 0) > 0) {
        if (!(job.downloadedFiles?.length) && job.generatedAssets?.length) {
          job = await downloadFlowJob(jobId);
        }
        const files: string[] = job?.downloadedFiles ?? [];
        if (files.length > 0) {
          const mediaUrl = resolveMediaUrl(files[0]);
          dlog(`[FlowPoller] ${taskId} finished: ${mediaUrl}`);
          settle(taskId, isVideo ? { status: "done", videoUrl: mediaUrl } : { status: "done", imageUrl: mediaUrl }, isVideo);
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isFatalFlowError(error)) {
        const job = await getFlowJob(jobId).catch(() => null);
        const full = flowErrorMessage(message, job?.diagnosticScreenshot);
        console.error(`[FlowPoller] ${taskId} fatal: ${full}`);
        settle(taskId, { status: "error", error: full }, isVideo);
        return;
      }
      console.warn(`[FlowPoller] ${taskId} transient error: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  const minutes = Math.round(flowDeadlineMs(isVideo) / 60_000);
  console.error(`[FlowPoller] ${taskId} timed out after ${minutes} min`);
  settle(taskId, { status: "error", error: `Flow timed out after ${minutes} min` }, isVideo);
}
```

- [ ] **Step 7: Typecheck dos arquivos tocados e testes**

```bash
npx tsc --noEmit 2>&1 | grep -E "flowJobPoller|flowPollPolicy|flowAdapter|guest/db" || echo "no type errors in touched files"
node --test scripts/flow-reliability.test.cjs scripts/workflow-behavior.test.cjs scripts/flow-read-this.test.cjs
```

Expected: `no type errors in touched files` (o erro pré-existente em `app/gallery/page.tsx` pertence ao subsistema A e fica); todos os testes PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/flowPollPolicy.ts lib/flowJobPoller.ts lib/guest/db.ts scripts/flow-reliability.test.cjs
git commit -m "$(cat <<'EOF'
fix: bound Flow polling by wall clock and stop on fatal errors

The count-based limit really meant ~50 min because each refresh waits
up to 15s, and fatal errors were retried silently. Failures now log
unconditionally and surface the diagnostic screenshot path.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Smoke test ao vivo dos 4 fluxos (HeliosGen)

**Files:**
- Create: `D:/CLAUDE PROJECTS/HeliosGen/scripts/flow-smoke.mjs`

**Interfaces:**
- Consumes: `POST /api/generate` `{ model, prompt, aspectRatio }` → `{ taskId }`; `POST /api/generate-video` `{ videoModel, prompt, aspectRatio, startFrameUrl?, endFrameUrl? }` → `{ taskId }`; `GET /api/job-status?taskId=` → `{ status, imageUrl?, videoUrl?, error? }`. Model ids: `flow-nano-banana-2`, `flow-omni-flash`, `flow-veo-interpolation`.

- [ ] **Step 1: Criar `scripts/flow-smoke.mjs`**

```js
// Live end-to-end check of the Flow providers through the running Anvil API.
// Usage: node scripts/flow-smoke.mjs [--rounds N]   (needs `pnpm dev` on :3000)
// Do not touch the Flow tab while this runs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const rounds = Number(process.argv[process.argv.indexOf("--rounds") + 1]) || 1;
const START_FRAME = "/generated/flow/flow-090e8b7b.jpeg";

async function post(route, body) {
  const res = await fetch(`${BASE}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.taskId) throw new Error(`${route} ${res.status}: ${json.error ?? JSON.stringify(json)}`);
  return json.taskId;
}

async function waitJob(taskId, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const job = await (await fetch(`${BASE}/api/job-status?taskId=${encodeURIComponent(taskId)}`)).json();
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`smoke timeout for ${taskId}`);
}

function probe(mediaUrl) {
  const file = path.join(ROOT, "public", mediaUrl.replace(/^\//, ""));
  if (!existsSync(file)) throw new Error(`file missing: ${file}`);
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" }));
  const stream = out.streams?.find((s) => s.codec_type === "video");
  return { file, codec: stream?.codec_name, duration: Number(stream?.duration ?? out.format?.duration) };
}

function expectImage(mediaUrl) {
  const p = probe(mediaUrl);
  if (!["png", "mjpeg", "webp"].includes(p.codec)) throw new Error(`not an image: codec=${p.codec} ${p.file}`);
  return p;
}

function expectVideo(mediaUrl) {
  const p = probe(mediaUrl);
  if (p.codec !== "h264" || !(p.duration > 0)) throw new Error(`not a real video: codec=${p.codec} duration=${p.duration} ${p.file}`);
  return p;
}

async function runRound(round) {
  const results = [];
  const record = async (name, fn) => {
    const started = Date.now();
    try {
      const detail = await fn();
      results.push({ round, flow: name, ok: true, secs: Math.round((Date.now() - started) / 1000), detail });
      return detail;
    } catch (error) {
      results.push({ round, flow: name, ok: false, secs: Math.round((Date.now() - started) / 1000), detail: String(error.message ?? error) });
      return null;
    }
  };

  const image = await record("image nano-banana-2", async () => {
    const taskId = await post("/api/generate", { model: "flow-nano-banana-2", prompt: "a red fox sitting in fresh snow, soft morning light, photorealistic", aspectRatio: "9:16" });
    const job = await waitJob(taskId, 6 * 60_000);
    return { url: job.imageUrl, ...expectImage(job.imageUrl) };
  });

  await record("text->video omni", async () => {
    const taskId = await post("/api/generate-video", { videoModel: "flow-omni-flash", prompt: "waves rolling onto a quiet beach at sunset, slow camera push in", aspectRatio: "9:16" });
    const job = await waitJob(taskId, 25 * 60_000);
    return expectVideo(job.videoUrl);
  });

  await record("start frame->video omni", async () => {
    const taskId = await post("/api/generate-video", { videoModel: "flow-omni-flash", prompt: "the wolf slowly turns its head and howls, snow gently falling", aspectRatio: "9:16", startFrameUrl: START_FRAME });
    const job = await waitJob(taskId, 25 * 60_000);
    return expectVideo(job.videoUrl);
  });

  await record("frame A->B veo", async () => {
    const endFrame = image?.url ?? START_FRAME;
    const taskId = await post("/api/generate-video", { videoModel: "flow-veo-interpolation", prompt: "smooth cinematic transition between the two snowy scenes", aspectRatio: "9:16", startFrameUrl: START_FRAME, endFrameUrl: endFrame });
    const job = await waitJob(taskId, 25 * 60_000);
    return expectVideo(job.videoUrl);
  });

  return results;
}

const all = [];
for (let round = 1; round <= rounds; round += 1) {
  console.log(`\n=== round ${round}/${rounds} ===`);
  const results = await runRound(round);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.flow.padEnd(26)} ${String(r.secs).padStart(5)}s  ${JSON.stringify(r.detail)}`);
  all.push(...results);
}
const failed = all.filter((r) => !r.ok);
console.log(`\n${all.length - failed.length}/${all.length} passed`);
process.exit(failed.length ? 1 : 0);
```

- [ ] **Step 2: Reiniciar o dev server com o `dist/` novo e a env**

Parar o dev server atual e subir de novo (`pnpm dev` na porta 3000, ou `preview_stop` + `preview_start heliosgen-web`). Conferir no log: `Ready`.

- [ ] **Step 3: Rodada única de fumaça**

```bash
cd "D:/CLAUDE PROJECTS/HeliosGen" && node scripts/flow-smoke.mjs --rounds 1
```

Expected: `4/4 passed`. Se algo falhar, NÃO mexer na aba durante a rodada. Depois dela terminar, ler a mensagem de erro (que agora traz o caminho do screenshot de diagnóstico), abrir o screenshot, usar superpowers:systematic-debugging para achar a causa, corrigir no task correspondente e repetir este passo.

- [ ] **Step 4: Duas rodadas seguidas (critério de pronto)**

```bash
node scripts/flow-smoke.mjs --rounds 2
```

Expected: `8/8 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/flow-smoke.mjs
git commit -m "$(cat <<'EOF'
test: add live Flow smoke test for the four generation flows

Validates image, text-to-video, start-frame video and A->B
interpolation through the Anvil API, checking each file with ffprobe.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
