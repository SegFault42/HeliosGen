@AGENTS.md


# Solstice UI (redesign em andamento)

Sistema visual final em `design/`. Regras completas: `design/SOLSTICE_CLAUDE.md`. Tokens: `design/tokens.css` (já aplicado em `app/globals.css`). Specs: `design/components.md`. Referência renderizada: `design/Solstice v2 Higgsfield.dc.html`. Sem hex literal em componentes; sem gradiente, blur, glow; dark only.

## ANVIL v2 (night forge) — design de referência

Canvas publicado (Claude Design): https://claude.ai/code/artifact/d195a887-454e-4234-a1a8-744ef20065a5
Fonte dos artboards: `design/anvil-v2-canvas/src/` (tokens em `shared.css`, telas em `*.body.html`,
`node build.mjs` gera os `.dc.html`). Brief: `design/ANVIL_V2_BRIEF.md` (a paleta final é a dark
do canvas, não a light do brief). Tokens: coal `#0B0A09`, slate `#141311`, inset `#1B1A17`,
card `#1E1C19`, bone `#F3EFE8`, ash `#B3AEA4`, smoke `#7C7870`, rule `#2A2823` / `#403C34`,
ember `#FF5A2C` (glow só em estado vivo), ok `#4CC38A`, wait `#E6B422`, fail `#FF5C5C`.
Fontes: Newsreader (display, palavra de acento em itálico Ember), Geist (UI), Geist Mono (números).
Raio 4/8/12/16, sem pills, sem dot-grid, ports quadrados. Motion: GSAP 3.13, tokens t-1 180 /
t-2 320 / t-3 600 / t-4 900 ms (storyboards na prancha Components).
