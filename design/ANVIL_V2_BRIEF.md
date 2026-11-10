# ANVIL v2 brief (paste into Claude Design)

Context for the operator, not part of the prompt: v1 (Solstice) was built "after
the Higgsfield reference": dark, lime, pills, dot-grid canvas, node cards with
coloured handles. v2 must not share DNA with Higgsfield or HeliosGen. The way to
guarantee that is to change the four things people recognise first: theme
(light, not dark), accent (heat, not neon), type (serif display, not condensed
grotesk), and the product metaphor (a workbench with a cost ledger, not a
credits dashboard). Motion is a first-class layer, built on GSAP 3.13+ (all
plugins free since 2025: SplitText, Flip, DrawSVG, MorphSVG, Inertia,
ScrambleText, CustomEase).

---

## Prompt

Design ANVIL v2: a local-first desktop app where a creator forges AI images and
videos piece by piece and pays per strike (per generation, real dollars, no
subscription). The current UI is a dark, lime-accented, pill-heavy tool. Replace
it with a premium, editorial, daylight "workshop" system. Nothing in v2 may
resemble Higgsfield, HeliosGen, Runway or Midjourney dashboards.

### Positioning in one line
"Made on Anvil": a quiet, precise bench. Heat appears only where work happens.

### Hard exclusions (anything below is a bug)
- No dark default theme. No neon/lime/teal accents. No glow, blur, glass,
  gradients, drop shadows with blur.
- No pill-shaped controls as the default shape. No dot-grid canvas. No node
  cards with coloured circular handles. No "credits" wording anywhere.
- No condensed grotesk display (Archivo/Bebas/Anton family). No Outfit, no
  Space Mono, no Inter.
- No emoji, no illustrations, no 3D, no mascots.

### Tokens (final, ship these exact values)
Colour
- Bone `#F4F1EA` (app ground) · Paper `#FBFAF7` (panels) · Linen `#ECE8DF`
  (inset, inputs at rest) · Card `#FFFFFF`
- Ink `#121212` (primary text) · Graphite `#4A4A48` (secondary) · Ash `#8A8781`
  (muted floor, ≥4.6:1 on Paper) · Rule `#DAD6CC` (hairlines) · Rule-2 `#B9B4A8`
  (interactive outlines)
- Ember `#FF4A1C` (heat: the one accent) · Ember-deep `#D93A10` (press) ·
  Ember-ink `#1A0B06` (text on Ember)
- Signal: Ok `#1F7A4D` · Wait `#B8860B` · Fail `#B3261E`
- Night shift (optional second theme, do NOT design it now): invert Bone/Paper
  to `#141311` / `#1B1A17`, keep Ember.
Type (Google Fonts)
- Display: Fraunces, optical size 144, weight 500, italic for the accent word
  only. Sizes 64 (hero), 40 (section), 28 (panel title).
- UI: Instrument Sans 400/500/600. 15 body, 14 controls, 13 captions.
- Meta: IBM Plex Mono 400/500, 12 uppercase, tracking .08em, tabular numerals.
  Every number in the ledger is mono.
- Floor 12px. Muted text never lighter than Ash.
Shape
- Radius: 2 (hairline chips), 6 (controls), 10 (cards), 14 (panels), 0 for the
  stage/canvas frame. Rectangles, not pills. Buttons are 40 × auto, radius 6.
- Borders: 1px Rule (dividers), 1px Rule-2 (interactive). Elevation = one
  hairline plus a 1px offset "ink edge" (`0 1px 0 Ink`) on the primary button
  only.
Spacing 4/8/12/16/24/32/48. App padding 16. Rail 64. Panels float on Bone with
16px gutters.

### Screens (5 artboards, 1440 × 900, light)
1. **Bench (Home)**. Left icon rail 64 (Bench, Canvas, Ledger, Settings) with
   Plex Mono labels on hover. Centre = the Stage: the latest piece large
   (aspect-fit, Card, radius 10) with a Plex Mono plate under it:
   `PIECE 0142 · NANO BANANA · 2K · $0.04 · 6.2S`. Below the stage, the Bench:
   a wide prompt field (Linen, radius 6, 15px, serif placeholder "Describe the
   piece"), then one row of rectangular selectors with mono labels above each
   (MODEL, PROVIDER, QUALITY, RATIO, COUNT, FORMAT) and the primary
   **STRIKE** button (Ember, Ember-ink text, radius 6, ink edge). Right = the
   Ledger panel 320: "THIS STRIKE $0.04" large mono, then TODAY / MONTH totals,
   a hairline bar chart of spend by model, and the wallet balance in dollars.
   Bottom = the Rack: horizontal strip of recent pieces (72px thumbs, mono
   index numbers), scrolls with inertia.
2. **Canvas (Workflow)**. Paper frame, no grid. Nodes are "plates": Card,
   radius 10, 1px Rule-2, a Plex Mono header (`03 · IMAGE`), body content,
   and square 8px ports on the edges (Ink when connected, Rule-2 when empty).
   Edges are 1.5px Ink lines with a subtle curve; a running edge marches a
   dash. Running plate: Ember 2px left rule + mono "STRIKING 42%" with a thin
   progress line. Error plate: Fail left rule. Floating bottom bar: rectangular,
   Paper, hairline, buttons "Add plate", "Run all" (Ember), zoom mono. Right
   drawer 340: the Sheet (JSON/YAML of the selected plate, mono, Ink keys,
   Ember strings, Wait numbers).
3. **Ledger**. Full page: monthly spend table (mono, hairlines only), per-model
   cost, per-piece list with thumbnails, export CSV. This is the page
   Higgsfield does not have; make it feel like a bank statement designed by a
   type foundry.
4. **Settings**. Panel 880 centred: left index (Providers, Models, Storage,
   Motion), right content. Provider rows: name, status word in mono (READY /
   NOT SET), key field (mono), Save (secondary, Ink outline). Motion section
   exposes "Reduced motion" and "Strike effects" toggles (rectangular switches).
5. **Assistant**. Right drawer 400 over any screen: serif prompt rewrite in a
   Paper card, actions "Use", "Shorter", "Two more" as Ink-outline buttons,
   model selector as three rectangular tabs.

Also: the persistent top notice (40px, Paper, hairline bottom, mono text, no
colour fill; Wait left rule for warnings) and an empty state (hairline frame,
Fraunces italic "Nothing forged yet.").

### Brand
Wordmark ANVIL in Fraunces 500, tracking -0.02em; mark = the existing anvil +
spark glyph in Ink on Paper (or Ember on Ink for the app icon). Show it at 16,
32, 128.

### Motion system (GSAP 3.13, all plugins; specify in the components sheet)
Tokens: `t-1` 180ms, `t-2` 320ms, `t-3` 600ms, `t-4` 900ms. Eases: `expo.out`
(reveals), `power3.inOut` (layout), `back.out(1.4)` (drop-ins), custom
`CustomEase "anvil" = M0,0 C0.2,0 0.1,1 1,1` (strike compress-and-release).
Stagger 40ms. Reduced motion: every tween duration 0, Flip disabled, dashes
static.
Signature moves (design these as 4-frame storyboards on the components sheet):
1. **First paint**: hero words split by character (SplitText), rise from 110%
   with clip, `t-4`, stagger 20ms; panels fade-slide 16px, `t-3`, stagger 40ms.
2. **Strike**: button compresses 2px on `anvil` ease; 5 Ember spark strokes
   (12px lines) burst 60px and fade in `t-2`; the ledger amount ticks up with a
   number tween (`t-3`, mono); the new piece drops into the Rack from y −24
   with `back.out(1.4)`.
3. **Flip**: clicking a piece in the Rack or grid Flips it into the Stage
   (GSAP Flip, `t-3`, `power3.inOut`); Esc Flips back.
4. **Canvas**: dragging plates uses Inertia (throw, snap to 8px grid);
   connecting a port draws the edge with DrawSVG `t-2`; running edges march
   dashoffset 1.1s linear loop; a finished plate gets a 1-frame Ember flash on
   its left rule then settles to Ink.
5. **Micro**: primary button magnetic within 12px; hover on plates lifts the
   hairline to Rule-2 only (no shadow); toasts slide from bottom-right `t-2`.

### Deliverables
Tokens sheet, type specimen (Fraunces + Instrument Sans + Plex Mono in use),
components sheet with states (button primary/secondary/ghost/danger, input,
selector, tabs, switch, plate idle/selected/running/error, port, edge, toast,
notice, empty state) plus the 5 motion storyboards, the 5 screens, and a short
migration note mapping each Solstice token to its ANVIL v2 replacement.
