# SOLSTICE — Component specs

Every measurement below is what the reference HTML renders. Recreate with the codebase's existing primitives (shadcn/base-ui) by restyling them — do not build parallel components.

Conventions used everywhere
- Outline = `1px solid var(--border-2)`. Divider = `1px solid var(--border-1)`. Never rgba borders, never 2px+ borders.
- Hover on outlined things: border-color → `--text-2`. Colours don't change on hover except the primary button (→ `--accent-hover`).
- Selected state inside a segmented control: fill `--text-1`, text `--on-accent`. The accent is NOT used for selection — it's reserved for primary action, handles, running state, and the model dot.
- Metadata (labels, badges, counters, kickers) is always Space Mono 12px uppercase, tracking .1em.
- Nothing renders below 12px.

## Button
| Variant | Height | Padding | Font | Fill | Text | Border | Shadow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| primary md | 40 | 0 18px | 600 14px ui | --accent | --on-accent | none | 0 3px 0 --accent-edge |
| primary sm | 32 | 0 14px | 600 13px | --accent | --on-accent | none | 0 2px 0 --accent-edge |
| primary xl (Generate in left composer) | 52 | 0 20px | 600 17px | --accent | --on-accent | none | 0 4px 0 --accent-edge |
| secondary md | 40 | 0 18px | 500 14px | --surface | --text-1 | 1px --border-2 | none |
| secondary sm | 32 | 0 14px | 500 13px | --surface | --text-1 | 1px --border-2 | none |
| ghost | 40 | 0 14px | 500 14px | transparent | --text-2 | none | none |
| danger | 40 | 0 18px | 500 14px | transparent | --error | 1px --error | none |
Radius: pill (999px) always. Icon+label gap 8px, icons 12–16px.
States — primary: hover fill --accent-hover; active translateY(2px) + shadow 0 1px 0 --accent-edge + fill --accent-press; disabled opacity .4 shadow intact. Secondary: hover border --text-2, active fill --bg-2. Ghost: hover text --text-1 fill --bg-2. Danger: hover fill --error text --on-accent. Transition 120ms transform/box-shadow.
Optional trailing shortcut/meta inside primary: mono 12–13px, opacity .75 (e.g. "⌘↵", "2K · 1:1 · ×1").

## Input
Height 40, padding 0 14px, fill --bg-2, 1px --border-2, radius pill (single-line) or 12px (textarea block), text 14px --text-1, placeholder --text-3. Mono 13px when the value is a key/URL.
Focus: border --accent + outline 2px --focus-ring offset 2px. Caret: 2px × 16px block in --accent (design flourish; native caret color: var(--accent) is fine).
Textarea "Prompt" card: fill --bg-2, 1px --border-1, radius 12, padding 14px 16px, label "Prompt" 13px --text-3 above, text 15px/1.5. Footer row: pill chips 28px (@ Elements, Assistant) + char count mono 12 --text-3 right.

## Select / Dropdown
Trigger (model row): fill --bg-2, 1px --border-1, radius 12, padding 10px 16px. Two lines: label 13px --text-3, value 15px/600 with three-bar "signal" mark in --accent (3px wide bars 6/10/14px tall). Chevron-right 16px --text-3 at far right. Hover border --border-2.
Menu: fill --surface, 1px --border-2, radius 12, padding 6px. Two columns (IMAGE | VIDEO) with mono 12 headers --text-3. Rows 8px 10px, radius 8, 13px/500; selected fill --bg-2; hover fill --bg-2. Opens upward above the trigger with 6px gap.

## Segmented control
Track: fill --bg-2, 1px --border-1, radius pill, padding 3px, gap 2px. Segments radius pill, padding 6–7px 12px (or flex:1 when the control spans the panel). Text 13px/600 for words, mono 12 for values (1K/2K/4K, 1:1, ×1, JSON). Selected: fill --text-1, text --on-accent (700 for mono). Unselected: text --text-2. Disabled segment: --text-3 opacity .4.
Used for: provider (Kie.ai | Azure Foundry | Codex CLI), quality, ratio, count, format, gallery filter (All/Images/Videos), chat model (Gemini 3 | GPT 5.2 | Claude), per-model provider in Settings.
Compact grouped variant (left composer): three cards fill --bg-2, radius 12, padding 8px 10px, mono label on top (QUALITY / RATIO / COUNT · FMT), segments inside 4px 0 with radius 6.

## Toggle
42×24 pill. On: fill --accent, knob 18px --on-accent at right (3px inset). Off: fill --bg-2, 1px --border-2, knob 18px --border-2 at left (2px inset). 120ms.

## Badge (status pills)
Mono 12, tracking .1em, padding 4px 10px, radius pill, weight 700 when filled.
| Badge | Fill | Text | Border |
| --- | --- | --- | --- |
| SAVED / READY / RUNNING / NEW | --accent | --on-accent | none |
| NOT CONFIGURED / QUEUED 02 | none | --text-2 (queued: --text-3) | 1px --border-2 |
| PENDING | --bg-0 | --warning | 1px --warning (+ 10px spinner: 2px ring, top transparent, 1s linear) |
| DONE | --bg-0 | --text-1 | 1px --border-2 |
| ERROR | --error | --on-accent | none |
Gallery meta pill (e.g. "IMG · 2K"): fill --bg-0, text --text-2, no border, padding 4px 9px.

## Modal
Width 920, fill --bg-1, 1px --border-2, radius 20. Header 18px 20px: title 20px/600, close = 34px circle 1px --border-2. Tabs row under header (see Tabs). Body padding 20px, section cards fill --bg-2, 1px --border-1, radius 16, padding 16. Scrim rgba(9,9,11,.72) — the only translucent surface in the system. Enter: 200ms translateY(8px→0), no fade-only.

## Tabs
Underline tabs: 14px, active 600 --text-1 with 2px bottom border --text-1 (margin-bottom -1px over the 1px --border-1 row), inactive 500 --text-3, hover --text-1. Padding 8px 12px 12px. Composer panel tabs same at 15px.

## Tooltip
Fill --text-1, text --on-accent 12px/600, padding 6px 10px, radius pill, no arrow, 6px offset. Show after 300ms.

## Toast
Fill --surface, 1px --border-2 (error: 1px --error), radius pill, padding 12px 14px 12px 16px, gap 12. Leading 8px dot (--accent success / --error), message 13px with muted detail in --text-2, trailing action 13px/600. Bottom-right, 20px inset, slide-up 200ms. Auto-dismiss 5s, errors persist.

## Banner (persistent top)
Height 40, padding 0 20px, gap 12, edge-to-edge under the window chrome. Warning: fill --warning; Info: fill --text-1; both text --on-accent. Content: 16px icon, bold 13px title, 13px body, spacer, pill button 26px (fill --on-accent, text --text-1, 600 12px), mono 12 dismiss text. Version number in info banner sits in a lime pill (padding 2px 8px). Stack order: warning above info.

## Canvas node
Width 240–260. Fill --surface, 1px --border-2, radius 16. Header 10px 14px: type label mono 12 --text-2 with 8px dot (TEXT --text-2 · IMAGE --accent · VIDEO --warning · REFERENCE IMAGE --text-2) + right slot (index mono 12 --text-3, or status badge). Body: inset block fill --bg-2, radius 10, margin 0 8px 8px, padding 12, rows 13px label --text-3 / value 600.
States: idle as above · selected border --accent + outline 2px --focus-ring offset 3px, selection toolbar floats 50px above (fill --text-1 pill, items 30px 12px 600 12px, Run item filled --accent, Delete text #B7150E) · running border --accent pulsing to --border-2 (700ms yoyo), RUNNING badge, 4px progress bar --border-1 track / --accent fill · queued QUEUED badge + dashed 1px --border-2 block "WAITING FOR IMAGE · 03" · error border --error, ERROR badge, red row with Retry pill (fill --text-1).
Group: 1px dashed --border-2, radius 24, transparent fill, title pill on the top edge (mono 12, fill --bg-1, 1px --border-2).

## Edge + handle
Edge: 2px stroke, cubic bezier with 60px horizontal handles. Active/flowing: --accent, dasharray 8 6, dashoffset animating −28 over 1.1s linear loop. Inactive: --border-2 solid.
Handle: 14px circle, fill --accent (connected/output) or --border-2 (empty), 3px ring in --bg-1 so it punches out of the node edge (center sits on the node border).
Canvas background: --bg-1 with 1px --border-2 dots on a 22px grid. Canvas is a rounded panel (radius 20, 1px --border-1) inside the app padding, not full bleed.

## Canvas toolbar
Bottom-center floating pill: fill --surface, 1px --border-2, padding 4px, gap 4. Items 40px tall, 14px padding, 13px (600 for the first). 1px vertical divider then primary "Run all" pill 40px with edge shadow. Top-left: file pill (600 13px + mono suffix ".FLOW") and a status pill (mono 12, 1px --border-2, 8px accent dot). Top-right: zoom pill − 100% +.

## Prompt preview panel
Width 340, fill --bg-1, 1px --border-1, radius 20. Header 16px with JSON|YAML mini segmented (selected fill --text-1). Mono 12 kicker row "NODE 03 · IMAGE" / "LIVE" in --accent. Code block fill --bg-2, radius 12, mono 12/1.6: keys --text-1, strings --accent, numbers --warning, comments --text-3. Footer: two pills 40px (Copy JSON secondary, Run node primary).

## Empty state
1px dashed --border-2, radius 20, centered: display 22–24px uppercase --text-2 "NOTHING HERE YET" + 13–14px --text-3 line.

## Drop zone
Reference-image card in composer: fill --bg-2, 1px --border-1, radius 12, padding 18px 16px, centered: two 36px circles (--surface, 1px --border-2) with 14px icons, title 15px/600 --text-2, mono 12 "IMAGE · 16 LEFT" (count in --text-1). Hover border --border-2; drag-over border --accent (solid, 1px). Compact inline slot (bottom composer): 56px square, 1px dashed --border-2, radius 12, "+" icon; hover border+icon --accent.

## Gallery card
Grid 4 columns, rows 210px, gap 12. Card fill --bg-2, 1px --border-2, radius 20, overflow hidden. Top-left status badge, top-right meta pill. Bottom bar fill --bg-0, padding 10px 12px: prompt 13px ellipsis + three 28px circle icon buttons (download, reuse, delete) 1px --border-2 --text-2; hover download/reuse → fill --accent text --on-accent; delete → --error border+text. Card hover: border --text-2, translateY(−2px), 120ms.

## Sidebar / nav
Width 200 in app padding 12. Nav items 38px pills, 14px, padding 0 12px, gap 10 with 18px icon; active fill --surface + 1px --border-2 600; inactive --text-2 500, hover fill --bg-2. NEW tag on Workflow: lime pill mono 12 700. SPACES section: mono kicker + 22px "+" circle; rows 34px pills 13px with 8px colour dot and tabular count right in mono 12 --text-3; active fill --bg-2 600. Storage card pinned bottom: fill --bg-1, 1px --border-1, radius 12, padding 14px 12px, mono 12 "STORAGE / 12.4 / 20 GB" tabular, 6px bar --border-1 track / --accent fill.
Logo: 32px square radius 10 --accent with ink glyph; wordmark display 18px uppercase.

## Hero
Kicker-free. Display 44px uppercase, line-height .92: "START CREATING WITH " + model name in --accent. Sub-line 16px --text-2 with mono details. Ghost numeral: display 300px, --text-1 at 5% opacity, bleeding off the top-right of the main panel (pointer-events none). Ghost numerals are the only decorative element allowed.

## Chat (prompt assistant)
Panel 400 wide, fill --bg-1, 1px --border-1, radius 20. Header 16px: title 16px/600 + 30px close circle. Model segmented (Gemini 3 | GPT 5.2 | Claude) full-width. User bubble: fill --surface, 1px --border-2, radius 16 16 4 16, 14px, max 85%, right-aligned. Assistant: mono kicker "CLAUDE · 2.1S" --text-3, bubble fill --bg-2 radius 16 16 16 4, 14px/1.5 --text-2; the rewritten prompt sits in a nested block fill --bg-0, 1px --border-2, radius 12, --text-1; actions row: "Use this prompt" primary sm + secondary sm pills (Shorter, Two more). Thinking indicator: 10px spinner + mono "THINKING". Input: 44px pill --bg-2 + 44px circle primary send button.
"Use this prompt" writes the text into the composer, which then shows a "REWRITTEN BY ASSISTANT" outlined pill (1px --accent, text --accent) and an accent border on the composer until the user edits.
