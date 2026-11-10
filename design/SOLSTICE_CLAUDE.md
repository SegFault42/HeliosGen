# CLAUDE.md — Solstice UI (HeliosGen redesign)

## Read this first

The visual system for this app is FINISHED and lives in `design_handoff_solstice/`. Your job is to **apply it to the existing codebase**, not to design. Do not invent colours, radii, shadows, fonts, or component shapes. If something isn't specified, derive it from the closest spec in `components.md` and the reference HTML — never from your own defaults, Tailwind defaults, or shadcn defaults.

Reference of truth, in order:
1. `tokens.css` — every variable. Copy it into `globals.css` verbatim (replace, don't merge).
2. `components.md` — measurements and states per component.
3. `Solstice v2 Higgsfield.dc.html` — the rendered reference. Open it in a browser when a spec is ambiguous; what it renders wins.

## Hard rules

- **No hex literals in components.** Every colour is `var(--*)` or its Tailwind alias (`bg-bg-1`, `text-text-2`, `border-border-2`, `bg-accent`). The 111 existing `#2DD4BF` and friends map via the table below.
- **Dark only.** Do not add a light theme, `prefers-color-scheme` branches, or `dark:` prefixes — there is one theme.
- **No gradients, no blur, no glow, no glass.** The only translucent value in the system is the modal scrim `--scrim`. `backdrop-filter` is banned. Blurred `box-shadow` is banned.
- **Borders are 1px solid** `--border-1` (dividers) or `--border-2` (interactive outlines). Never `rgba(255,255,255,.1)`, never 2px.
- **Elevation is outline + the primary button edge.** Hover = border-color to `--text-2`. Primary buttons carry `0 3px 0 var(--accent-edge)` and press down 2px. Nothing else has a shadow.
- **The accent is scarce.** Per view it appears on: the primary action, edge handles, running/live states, the model dot, SAVED/READY badges. Selection inside segmented controls is `--text-1` fill, NOT accent.
- **Type floor is 12px.** Anything that was 8–11px becomes 12px Space Mono uppercase (`.label`). Muted text is never lighter than `--text-3`. Counters use `tabular-nums`.
- **Three fonts, fixed roles.** Outfit 400/500/600 for UI; Archivo (wdth 75, wght 900, uppercase) ONLY for the hero line, empty-state titles and the wordmark; Space Mono for all metadata. Do not use Archivo for headings inside modals or panels.
- **Pills for controls, 12/16/20 for containers.** Buttons, segmented controls, badges, nav items, inputs (single-line) = `--r-pill`. Inset blocks 8–12, nodes 16, panels/cards/modals 20.
- **Motion is 120 / 200 / 420ms with `--ease`.** No fades as the primary transition — things move and snap. GSAP is allowed on the canvas (edge dash flow, running-node pulse) and for micro-interactions; nowhere else. No three.js in the production tool.
- **Icons: Lucide only**, 2px stroke, 12–18px. No emoji.

## Structure to keep

- App chrome: 12px padding around everything; sidebar 200, then rounded panels (radius 20, `--bg-1`, 1px `--border-1`). Panels are not full-bleed.
- Home: composer is a **left panel (360px)** by default; bottom-bar variant exists in the reference behind the `composer` tweak — implement left first.
- Workflow: canvas panel with 22px dot grid, floating bottom-center pill toolbar, 340px prompt-preview panel on the right.
- Settings: 920px modal, underline tabs, section cards.
- Chat: 400px right panel.
- Banners: 40px, above everything, warning (`--warning`) stacks above info (`--text-1`).

## Migration map (old hex → variable)

| Old | New |
| --- | --- |
| `#2DD4BF` (111×) | `var(--accent)` — but audit each: if it marked *selection*, use `--text-1` fill instead |
| `#22d3ee` | `var(--accent-hover)` |
| `#0B0E14` | `var(--bg-0)` |
| `#141C28` | `var(--bg-1)` |
| `#1E2840` | `var(--bg-2)` for inset/inputs, `var(--surface)` for cards/nodes/popovers |
| `#A0A0A0` | `var(--text-2)` |
| `#7D7D7D`, `rgba(255,255,255,.3)` | `var(--text-3)` |
| `#4A4A45` | `var(--border-2)` (it was never a text colour) |
| `rgba(255,255,255,.1)` | `var(--border-1)` |
| `#f87171`, `#ef4444` | `var(--error)` |
| `#fb923c` | `var(--warning)` |
| any blurred `box-shadow` | remove, or `var(--shadow-btn)` if it's a primary button |
| font-size 8–11px | `var(--fs-2)` + `.label` |
| system font stack | `var(--font-ui)` |

## Working method

1. Paste `tokens.css` into `globals.css`. Confirm the `@theme inline` block compiles under Tailwind 4.
2. Restyle shadcn/base-ui primitives in place (Button, Input, Select, Tabs, Dialog, Tooltip, Toast, Switch, Badge) to the specs in `components.md`. Keep their APIs; change only classes/variants.
3. Do a global find-and-replace of the hex table above. Then grep for any remaining `#` colour and `rgba(` in components — the count must be zero.
4. Rebuild screens in this order: Home → Workflow → Settings → Chat → Banners.
5. Before finishing each screen, open the reference HTML side by side at 1440×900 and compare. Differences are bugs on your side, not design updates.

## When you're unsure

Say so and point to the spec you'd extend. Do not resolve ambiguity by falling back to "standard" dark-UI patterns (grey borders at 10% white, glow on focus, blue links, 11px labels). Those are exactly what this redesign removes.

## Teal switch

Accent can be flipped to the original teal family by setting `data-accent="teal"` on `<html>`. Do not expose this as a user setting unless asked; it exists so the team can compare.
