# HeliosGen redesign brief (paste into Claude Design)

Redesign the UI of HeliosGen, a local desktop/web app for building AI image and
video pipelines. Keep every feature and flow; change the visual system.

## Screens to design (4 artboards, desktop 1440x900, dark theme)

1. **Home / Composer + Gallery**: left sidebar (Image, Video, Workflow,
   Chat, Settings, spaces list, storage counter), main area with a hero
   "Start creating with [model]", a prompt composer at the bottom with:
   model picker (GPT Image 2, Nano Banana, Seedream, Kling, Seedance, Veo),
   provider picker (Kie.ai / Azure Foundry / Codex CLI), quality (1K/2K/4K),
   aspect ratio, image count (1/4), reference-image slots ("IMAGE, 16 left"),
   JSON/YAML toggle. Below: grid of generated images and videos with status
   (pending, done, error), hover actions (download, reuse prompt, delete).
2. **Workflow canvas**: infinite node canvas with dot background; node types:
   Text, Image, Video, Reference Image, Group; edges with teal handles; canvas
   toolbar (add node, run, export); selection toolbar; node running/queued/error
   states; JSON prompt preview panel.
3. **Settings modal**: tabs API Keys (Kie.ai key with SAVED badge, Azure
   Foundry key + base URL, Codex CLI status READY / NOT CONFIGURED), Image
   Models (per-model provider toggle Kie.ai | Azure Foundry | Codex CLI),
   Video Models, Text Models.
4. **Prompt assistant chat**: side panel chat that rewrites prompts; model
   picker (Gemini 3, GPT 5.2, Claude); message list; "use this prompt" action.

Also design the persistent top banners: "No kie.ai API key configured" (warning)
and "Update available 1.2.0" (info).

## Current state (what to replace)

- Tailwind 4 + shadcn/base-ui, but most styling is hardcoded inline: 111 uses
  of teal #2DD4BF, backgrounds #0B0E14 / #141C28 / #1E2840, greys #A0A0A0 /
  #7D7D7D / #4A4A45, errors #f87171 / #ef4444, orange #fb923c, cyan #22d3ee.
- System font stack, sizes 8 to 13px everywhere (too small), weights only
  400/500, low contrast grey-on-black text (rgba white 0.3 for labels).
- No spacing scale, no elevation scale, borders 1px rgba(255,255,255,0.1).
- Neon teal on near-black reads as generic "AI tool" template.

## Design system to produce

- Token sheet: background (3 levels), surface, border (2 levels), text
  (primary, secondary, muted; minimum 4.5:1 contrast), one accent + accent
  hover/pressed, semantic success/warning/error, focus ring.
- Type scale from 12 to 28px, one UI font with a real fallback stack, weights
  400/500/600, tabular numerals for counters.
- Spacing scale 4/8/12/16/24/32, radius scale (4/8/12), two shadow levels.
- Component specs: button (primary, secondary, ghost, danger; sm/md), input,
  select/dropdown, segmented control (used for provider and quality pickers),
  toggle, badge (SAVED, READY, NOT CONFIGURED, pending/done/error), modal,
  tabs, tooltip, toast, canvas node (idle/selected/running/error), edge
  handle, empty state, drop zone.
- Map every token to a CSS variable name so it can drop into `globals.css`
  and replace the hardcoded hex values.

## Constraints

- Dark theme only for now. Keep the teal family as accent if it still works;
  otherwise propose one alternative and show both on the composer screen.
- Dense, tool-like layout (this is a production tool, not a landing page).
  No hero gradients, no glassmorphism, no glow.
- Text never below 12px. Labels readable on the canvas at 100% zoom.
- Deliver: tokens table, component sheet, the 4 screens, and a short
  migration note listing which CSS variables replace which hex values.
