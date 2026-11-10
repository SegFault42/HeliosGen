# Brand: ANVIL (working name, 2026-09-07)

English name, because the platform will be linked from the AI-expert video front.
Test: FHC (`creator/os/FUNIL_OS.md` §4: Fácil, Hype, Curioso) plus the Balaclava
rule that a name names the mechanism instead of describing the product.
Conflict check: web search on 2026-09-07 for "<name> AI" image/video tools.

## Candidates

| Name | Easy (1 s) | Hype | Curious | Mechanism it names | Conflicts found | Verdict |
|---|---|---|---|---|---|---|
| **ANVIL** | yes, EN; BR audience learns it from the logo | solid, heavy, "made on Anvil" | high ("an anvil in AI?") | the bench where every piece is hammered out; pay per strike | none in AI image/video | chosen |
| STRIKE | yes, EN and known in PT | highest, action verb | medium | one strike = one piece paid | none direct; generic word, crowded handles | runner-up |
| FORGE | yes | good | low (expected) | forge pieces | Forge (PostScarcity), ForgeAI, Forge Neo, VidForge, CreateForge | rejected: crowded |
| KILN | EN only | medium | medium | firing | kiln.tech (AI dev tool, desktop app) | rejected: taken |
| LOOM | yes | medium | low | weaving | Loom (video) | rejected: taken |
| FORJA (PT) | PT only | good | good | forge | none | dropped: user wants English |
| SOLSTICE | needs explaining | high | high | none (aesthetic) | Solstice is the design system name only | kept for the DS |

Why ANVIL: passes the three FHC axes in English, names the tool itself (the
pattern Loom / Kiln / Forge use for platforms), owns the metaphor the logo
already shows (anvil + spark = one strike, one piece), and has no competitor in
AI image/video generation. Pairs with the Solstice palette: lime = spark, ink =
iron.

## Mark

- `components/BrandLogo.tsx`: `BrandMark` (32 px lime tile, radius 10, glyph in
  `--on-accent`) and `BRAND_NAME`. Follows the accent token, teal switch included.
- Glyph: geometric anvil silhouette (horned top face, waist, base) plus a
  four-point spark. Letter-free, so it survives a rename.
- Static asset: `public/anvil.svg` (256 px, literal colours allowed in assets);
  `public/HG.svg` now holds the same mark so old references keep working.
- Tauri icons and favicon regenerated from the SVG (`src-tauri/icon-source.png`).

## Renamed (user-visible)

`<title>`, sidebar wordmark, WorkflowHero label, chat logo, Home hero fallback,
Tauri `productName` / window `title` / `longDescription`, fetch-url User-Agent,
README header.

## Deliberately NOT renamed

Local-data keys: `heliosgen-guest`, `heliosgen-chats-guest`, export format
`heliosgen-workflow`, Tauri identifier `cash.sdd.helios.desktop`, env
`HELIOS_DATA_DIR`, sidecar `helios-node`, `package.json` name, upstream GitHub
links (MIT credit) and the update-check repo. Renaming those wipes saved
gallery, workflows and chats. Do it only with a data migration.

## Pending

- AI raster candidates (GPT Image 2 via Codex): ChatGPT Plus image quota hit on
  2026-09-06 23h, resets in ~3 h. Prompts staged under
  `creator/experiments/logo-forja/` (rename the folder when running them).
- Handle check (@anvil.* on Instagram/TikTok/YouTube) before publishing the
  video front; a suffix like `anvil.studio` or `madeonanvil` is the fallback.
- Final call on ANVIL vs STRIKE is Rafa's; swapping is one line in
  `components/BrandLogo.tsx` plus `src-tauri/tauri.conf.json`.
