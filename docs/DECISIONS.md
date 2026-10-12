# Vert — main-agent decisions

Rulings the main agent made where the sources disagree or are silent. Implementation and
verification sub-agents treat this file as part of the spec: **DECISIONS.md > canvas frames >
DESIGN-SPEC.md text**, except that the accessibility and privacy non-negotiables in CLAUDE.md beat
everything.

## Design sources in the repo

- `docs/design/canvas/*.html`: the canvas frames' source (copied 2026-10-12). Every inline style is
  an exact value; read them for px, colors and copy.
- `docs/design/frames/*.png`: those frames rendered at their canvas size (`Main-390.png` is the
  fluid View frame at 390 wide). Compare screenshots against these.
- Bracketed text in the frames (`[Route name]`, `[DATE]`, `[Place]`) is a slot filled from data.

## Tokens

| Token              | Value     | Why                                                                                                                                                                                                    |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--route-text`     | `#BB3E0D` | `--route` is 3.97:1 on `--bg`: fine for strokes, markers and text ≥ 24px (the 34px Vert stat), not for small text. `--route-text` is 5.09:1 on `--bg`, 4.56:1 on `--surface`, 5.51:1 on white.         |
| `--surface-strong` | `#DCE2E8` | The steepest climb's shading in the elevation profile (Main frame).                                                                                                                                    |
| `--rule-strong`    | `#83909C` | Text-field borders. `--rule` on white is 1.54:1; a field's boundary is the only cue that it is a field, so it needs 3:1 (WCAG 1.4.11): 3.26:1 on white. Dividers and decorative borders keep `--rule`. |
| `--radius-poster`  | `0`       | Canvas frame 00.                                                                                                                                                                                       |

## Type details from the canvas

- Line-height: `normal` by default (the canvas sets none), 1.5 on running text (`p`, help text,
  hints). `base.css` does this globally; components don't need to reset it.

- Stat and section labels (DISTANCE, CLIMBS, STYLE, ELEVATION…): **11px** mono, uppercase,
  `letter-spacing: 0.08em`, `--muted`. The date line and chips stay 12px.
- Header tagline: 12px mono, `letter-spacing: 0.06em`, `--muted`.
- Taglines: Upload "DROP A GPX. GET A POSTER."; View "TRAIL RUNS AS TERRAIN"; Poster mode
  "POSTER · <ROUTE NAME>".

## Components (phase 1)

- **Button**: `size: "md"` (default; 15/600, padding 12×18, min-height 44) and `"lg"` (16/600,
  padding 14×18, min-height 48; the poster Download PNG button). Quiet padding is 12×10. Icon is
  44×44, icon glyph 20px, stroke 2. Buttons can render as a link (`href`) for "Make a poster"-style
  navigation only if they navigate; otherwise `<button type="button">`.
- **Segmented**: drawn 40px tall (spec and canvas), but the hit area is 44px: extend it with a
  pseudo-element, not by changing the drawn size. Each segment also has `min-width: var(--touch)`
  so short labels ("mi", "ft") still give a 44px-wide target. Padding `0 14px`. Native radio inputs inside a
  `radiogroup` (arrow keys move selection, as native radios do).
- **StatTile**: unit follows the value after a space, 16/500. `emphasis` colours the value
  `--route` (34px bold is large text: 3.97:1 ≥ 3:1) and the 16px unit `--route-text` (small text
  needs 4.5:1). The value never wraps (`white-space: nowrap`); line-height `normal`, as in the
  Main frame.
- **Dropzone** (Upload frame wins over the Tokens frame):
  - Rest: background `--white`, 2px dashed `--muted`, radius 6, padding 40×24, gap 10, upload icon
    36px stroke 1.8, title 18/600 "Drop a .gpx file here", line 14 `--muted` "or choose a file · or
    try a sample run" where both are real `<button>`s styled as underlined links.
  - Drag-over: border becomes **solid** 2px `--ink` (the dashed→solid change carries the state
    without color) and the title reads "Release to open the file".
  - Error: solid 2px `--route` border and a message below with a warning glyph and text, announced
    with `role="alert"`. Errors: wrong type, larger than `maxBytes`.
  - The whole zone is not a clickable div: the buttons are the controls; dropping works anywhere
    on the zone.
- **StylePicker** and **SizePicker**: native radio inputs, visually hidden, labels styled as the
  canvas draws them (the canvas uses links; that is a mockup shortcut). Selected state is carried
  by border width + weight (StylePicker) or fill (SizePicker) **and** by the radio's checked state.
- **SizePicker** copy: "18 × 24 in" / "print · 5400 × 7200", "A3" / "print · 3508 × 4961", "4 : 5" /
  "social · 1080 × 1350", "9 : 16" / "story · 1080 × 1920". Unselected: transparent, 1px `--rule`
  border, sub-line `--muted`. Selected: `--ink` fill, white text, sub-line white at 80% opacity.
  Padding 10×12, left aligned.
- **TextField**: border `--rule-strong` (not `--rule`). The counter's accessible text says
  "characters" ("37 / 40 characters") through a visually hidden word; the visible text stays "37 / 40".
- **Slider**: the drawn layout matches the canvas (native track directly under the label row,
  gap 6px). The 44px hit area may extend invisibly over the slider's own label row (clicking a
  label focuses its input anyway) and into the space below, never over another control.
  The track spans the column exactly (the canvas's native input overflows its column by the UA's
  2px margin; that is a mockup artefact). The track is styled, not native, so it is visible to a
  colour-weak user: 4px tall, radius 2, unfilled part `--rule-strong` (3:1), filled part `--ink`;
  thumb 16px `--ink` circle with a 2px `--white` ring, centred where the native thumb sits.
- **ElevationProfile**: climbs shaded `--surface`, the steepest one `--surface-strong`; the scrub
  is an ARIA `slider` (`aria-valuetext` like "km 12.2, 640 m"); arrow keys ±1%, Shift+arrow ±10%,
  Home/End to the ends; pointer drag scrubs. km ticks under it: "0 km", round steps, total.
  Ticks are placed by distance (the canvas spaces them evenly; the spec says by distance); an
  interior tick within 10% of the total, or overlapping an end label, is dropped. Each climb band
  carries its number in its top-left corner (clear of the scrub line); the steepest band's number
  is `--ink` because `--muted` on `--surface-strong` is 4.20:1. Readouts come from the data, not the
  canvas copy (its "640 m at km 12.2" doesn't match its own curve).
- **Marker**: renders an inline `<svg>` (default 18px). With `label` it is `role="img"` +
  `aria-label`; without, `aria-hidden`. Shapes per spec; never told apart by color alone.
- **Wordmark**: "VERT" 30/800/62%, `letter-spacing: 0.04em`; optional tagline per the type
  details above, baseline-aligned with a 14px gap.

## Page (phase 2)

- Below 600px wide the elevation profile is 100px tall (DESIGN-SPEC §3). `Main-390.png` is the fluid
  View frame rendered at 390 for reference; the canvas has no designed phone frame, so the spec wins.

- Climbs list: the steepest row is shaded `--surface` **and** says "· steepest".
- A loaded sample shows "SAMPLE DATA" in the date line, in `--route-text`.
- "About" opens a short in-page dialog (what Vert is, privacy, credits); "GitHub" links to
  https://github.com/geekplux.

## Posters (phase 3)

- Fonts per the canvas, all self-hosted and loaded only in poster mode: B = Big Shoulders Display
  800 + JetBrains Mono 400/500; E = Libre Caslon Text 400 (roman + italic) + Archivo Narrow 700.
- Style A at the social sizes (4:5, 9:16) uses the share-card layout (frame "Style A · share card
  4:5"); print sizes use the Trail Sign layout.
- No invented data: poster A's "VERT № 014" becomes "VERT"; footer URL is VERT.GEEKPLUX.COM.
  Night Ridge's sunrise line appears only when the GPX has timestamps (solar position computed in
  `src/lib`); its top nav (RUNS / COMPARE / UPLOAD) is mockup decoration and is omitted.
- Terrain look, style A (View and poster): oblique 3D, `--surface` fill, 1px ink ridge lines along
  rows of the grid (front rows darker), route 4px `--route` with a 9px white halo, ○ start, ▲ summit.

## Architecture

- **three.js directly**, no `@react-three/fiber`: one renderer, explicit lifecycle, fewer deps.
- **Hosting**: Cloudflare connected the repo as a Worker with static assets
  (`vert.fum.workers.dev`), not Pages. So the app and the tile proxy ship as **one Worker**: static
  assets from `dist/`, with `/tiles/*` routed to Worker code (`run_worker_first`) and R2 bound as
  `TILES`. Same parts as PLAN.md (static app + tile proxy + R2), one deployable, same origin (no
  CORS, and tile requests never leave the app's origin).
- **Dev tiles**: Vite proxies `/tiles/:z/:x/:y.png` to the public AWS Terrarium bucket in dev only.
- **Sample run**: a real trail, the Coosa Backcountry Trail loop (Vogel State Park, Georgia;
  ≈ 21 km, ≈ +1,070 m, matching the canvas). Geometry from OpenStreetMap (ODbL, credited in About),
  elevation from Terrarium, timestamps synthesized from a pace model, labelled SAMPLE DATA in the UI.
- **GPX parsing** runs in a Web Worker with a small hand-written XML tokenizer (no `DOMParser` in
  workers, no XML dependency).
