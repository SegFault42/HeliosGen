# Handoff: Solstice — HeliosGen UI redesign

## Overview
Dark-theme visual system for HeliosGen (working name **Solstice**), a local desktop/web tool for building AI image and video pipelines. Every feature and flow is unchanged; only the visual system changes. Direction: flat surfaces with 1px outlines, lime accent, condensed uppercase display type for one hero line per screen, Space Mono metadata, pill controls, and a single hard bottom edge on primary buttons. No gradients, glass, blur or glow.

## About the design files
`Solstice v2 Higgsfield.dc.html` is a **design reference built in HTML**. It is not production code. Recreate it inside the existing codebase (Tailwind 4 + shadcn/base-ui) by restyling the components that already exist. `Solstice Redesign.dc.html` (v1) is included for history only — do not implement it.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii and states are final. Match them exactly; use `components.md` for numbers and the HTML for anything the doc leaves out.

## Files in this bundle
- `CLAUDE.md` — instructions for Claude Code. Copy to the repo root (or merge into the existing one). It tells the agent to apply this system, not redesign.
- `tokens.css` — the full token sheet with a Tailwind 4 `@theme inline` bridge. Drop into `globals.css`.
- `components.md` — component specs and states.
- `Solstice v2 Higgsfield.dc.html` + `support.js` — rendered reference (open the HTML directly in a browser; tweaks panel switches accent lime/teal, composer left/bottom, banners, motion).
- `Solstice Redesign.dc.html` — superseded v1, for context.

## Screens
1. **Home** — sidebar 200 (nav pills, spaces, storage) · composer left panel 360 (tabs, reference drop card, prompt card, model row, provider segmented, quality/ratio/count·fmt group, Generate xl) · main panel with hero line, filter pills, 4-col gallery with status badges and hover actions. Alternative: bottom-bar composer (tweak `composer=bottom`).
2. **Workflow** — icon rail 64 · canvas panel (22px dot grid, group frame, Text / Reference Image / Image (running, selected) / Video (queued) / Image (error) nodes, animated edges, floating bottom toolbar, zoom pill) · prompt preview panel 340 with JSON/YAML.
3. **Settings modal** — 920 wide; API Keys (Kie.ai SAVED, Azure Foundry NOT CONFIGURED with key + base URL, Codex CLI READY) and Image Models (per-model provider segmented) states. Video/Text Models tabs reuse the Image Models table.
4. **Prompt assistant** — 400 right panel; model segmented Gemini 3 / GPT 5.2 / Claude; user and assistant bubbles; nested rewritten prompt with "Use this prompt"; composer shows REWRITTEN BY ASSISTANT pill.
5. **Banners** — 40px warning (no kie.ai key) and info (update 1.2.0).

## Interactions
- Primary button: hover `--accent-hover`; press translateY(2px), shadow 0 1px; 120ms.
- Outlined controls: hover border → `--text-2`; no colour change.
- Gallery card hover: border `--text-2`, lift 2px; action circles fill accent on hover, delete goes red.
- Canvas: edges connected to a running node animate dashoffset (−28 / 1.1s linear loop); running node border pulses accent↔border-2 at 700ms yoyo; progress bar fills over 420ms per step. Implemented with GSAP in the reference; CSS keyframes are acceptable.
- Model dropdown opens upward from the model row; selecting closes it and updates the hero line.
- Modal: scrim `--scrim`, panel enters 200ms translateY.
- Toast: bottom-right slide-up 200ms, 5s auto-dismiss, errors persist.
- Reduced motion: all durations → 0.

## State
Composer: model, provider, quality, ratio, count, format, references[], prompt. Gallery item: status pending|done|error, kind image|video, meta, prompt. Node: type, index, status idle|running|queued|error, progress. Settings: per-provider key + status, per-model provider. Chat: model, messages[], thinking. Banners: kieKeyMissing, updateAvailable(version).

## Tokens
See `tokens.css`. Summary: bg 0/1/2 + surface · border 1/2 · text 1/2/3 (≥4.8:1) · accent + hover/press/edge (lime; teal alt) · success/warning/error · focus ring · type 12–44 · spacing 4–32 · radius 8/12/20/pill · shadow-btn only · motion 120/200/420.

## Assets
None. Lucide icons via the existing dependency. Fonts from Google Fonts (Archivo variable wdth 75/wght 900, Outfit 400–600, Space Mono 400/700) — self-host if the app must work offline.
