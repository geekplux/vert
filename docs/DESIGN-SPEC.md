# Vert — design spec (text version of the canvas)

Canvas: (design canvas)
Frames: `00 Tokens and components`, `01 Upload`, `02 View`, `03 Poster mode + export`, then the three poster styles and the share card. If you can open the canvas, the frames win over this file on any visual detail. If you cannot, this file is sufficient to build.

## 1. Tokens (app chrome = style A, "Trail Sign")

CSS variables, light only in v1.

```css
:root {
  --bg: #F4F6F8;        /* page */
  --surface: #E6EAEE;   /* terrain canvas background, poster paper */
  --ink: #1B2A3A;       /* text, primary buttons, terrain lines */
  --muted: #5B6B7A;     /* secondary text, labels */
  --rule: #C9D1D9;      /* borders, dividers */
  --route: #D9480F;     /* the route, scrub marker, vert number */
  --white: #FFFFFF;

  --font-display: "Archivo", "Helvetica Neue", Arial, sans-serif;  /* variable: wdth 62–125, wght 400–800 */
  --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;

  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --radius-control: 4px; --radius-panel: 6px;
  --touch: 44px;
}
```

Type scale
| Role | Size / weight / width | Notes |
|---|---|---|
| Display | 44–72 / 800 / 75% | `letter-spacing: -0.01em`, line-height 0.95–1 |
| Wordmark | 30 / 800 / 62% | "VERT", `letter-spacing: 0.04em` |
| Stat | 34 / 700 / 75% | `font-variant-numeric: tabular-nums`; unit at 16/500 |
| Body | 16 / 400 | line-height 1.5 |
| Label | 12 mono | uppercase, `letter-spacing: 0.08em`, color `--muted` |

Fonts from Google Fonts: `Archivo:wdth,wght@62..125,400..800` and `IBM+Plex+Mono:wght@400;500`. Self-host them in `/public/fonts` for the production build (the poster export must not depend on a CDN).

## 2. Components (phase 1)

Each component: `src/components/<Name>/<Name>.tsx`, `<Name>.stories.tsx`, `<Name>.test.tsx`. Props typed. No global state inside components.

| Component | Props | Spec |
|---|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "quiet" \| "icon"`, `size?`, `aria-label` required for icon | Primary: ink bg, white text, 15/600, padding 12×18, min-height 44, radius 4. Secondary: transparent, 1px ink border. Quiet: no border, muted text. Icon: 44×44, 1px rule border, bg `--bg`. Focus ring: 2px `--route` outline offset 2. |
| `StatTile` | `label`, `value: number`, `unit`, `emphasis?: boolean`, `format` | Label 12 mono uppercase muted; value 34/700/75% tabular; unit 16/500 inline. `emphasis` colors value `--route` (used for Vert only). |
| `Segmented` | `options`, `value`, `onChange` | Inline-flex, 1px ink border, radius 4; selected = ink bg white text; 14/600; min-height 40. Used for km/mi. Role `radiogroup`. |
| `Slider` | `label`, `min`, `max`, `step`, `value`, `format` | Native `<input type=range>` with `accent-color: var(--ink)`; label row shows name left and formatted value right in mono. |
| `TextField` | `label`, `value`, `maxLength` | White bg, 1px rule border, radius 4, padding 10×12, min-height 44, 16px text. |
| `Dropzone` | `onFile`, `onSample`, `accept=".gpx"`, `maxBytes`, `busy`, `error`, `dragOver`, `busyKind` (`file` / `sample`), `fileName`, `describedBy`, `ref` (`takeFiles`) | A group holding: the card, one `<button>` that opens the file picker (2px dashed `--muted` border, radius 6, white, padding 48×24, centered upload icon 40px stroke 1.8, title 18/600 "Drop a .gpx file here", sub-line 14 muted "or click to choose one"; on touch screens "Choose a .gpx file" / "Tap to open your files"); the error under it; then "No file handy? Try the sample run" (a button drawn as a link). Hover: dashed `--ink`. Drag-over (anywhere on the page): solid `--ink`, "Release to open the file" / "Anywhere on this page works". Error: solid `--route`, alert below the card. Busy: disabled, solid `--rule`, muted text, "Reading <file>…" / "Parsed in your browser, nothing is uploaded", 3px `--ink` progress line along the bottom edge. |
| `ElevationProfile` | `points: {d, ele}[]`, `scrub: number`, `onScrub`, `climbs?` | SVG 1000×120 viewBox, `preserveAspectRatio="none"`, height 140 in View. Area fill `--ink` at 12% + 2px line; climbs shaded `--surface`; scrub = 2px `--route` vertical line + 14px dot with 3px white border; km ticks below in 12 mono muted. Keyboard: arrow keys move scrub by 1%, shift+arrow 10%. |
| `StylePicker` | `styles`, `value`, `onChange` | 3 columns, each a 3:4 swatch (A `#E6EAEE`, B `#0F2233`, E `#F2EFE6`) + name 13; selected = 2px ink border + 600 weight. Role `radiogroup`. |
| `SizePicker` | `sizes`, `value`, `onChange` | 2×2 grid of 44px-min buttons; each shows name 14/600 and "print · 5400 × 7200" in 11 mono. Selected = ink bg. |
| `Checkbox` | `label`, `checked` | Native, `accent-color: var(--ink)`, 18px, row min-height 44. |
| `Marker` (SVG) | `kind: "start" \| "summit" \| "scrub"` | start: circle r6 white fill, ink 2.5 stroke. summit: triangle ink fill. scrub: circle r5 route fill, white 2.5 stroke. Never distinguished by color alone. |
| `Wordmark` | `tagline?`, `link?` (`href`, `label`, `onClick`, `disabled`) | "VERT" 30/800/62% + optional tagline 12 mono muted. With `link` the name (not the tagline) is an `<a>` drawn the same (no underline, cursor pointer), hit area 44 tall, focus ring 2px `--route` offset 2. |

## 3. The one page, four states (phase 2)

Layout at 1440: header 20×40 padding, 1px rule bottom. In every state the wordmark's "Vert" links home (`href="/"`, name "Vert, home", first Tab stop): a plain click goes to Upload like New file (on Upload: scroll to top, focus the h1; during an export: nothing, like Back to the run); modified clicks open a tab. Body = aside (300–380px, right 1px rule) + main (flex 1). At ≤ 900: aside stacks under main; at 390 everything is one column, terrain box is 4:3, profile height 100.

**01 Upload**: header (wordmark + tagline "DROP A GPX. GET A POSTER.", nav About / GitHub). Two columns: left = h1 "Your run, as terrain." 72/800/75%, paragraph 18 muted, Dropzone (card, error, sample line; 12 apart), note line in 12 mono ("GPX only · up to 20 MB · from Strava, Garmin, Coros, Suunto", describes the card); 24 between blocks. Right = 4:3 sample preview, a button: the sample terrain image and a "TRY THE SAMPLE RUN · 21.5 km · +1,102 m →" chip bottom-left that fills `--ink` on hover. A file can be dropped anywhere on the page: while one is dragged over it, the card shows its drag-over state and a 2px `--ink` frame is drawn 8px inside the viewport. Canvas frames `UploadV2`, `UploadStatesV2`, `UploadPhoneV2` (390 wide). Under the two columns (which keep their place: at ≥ 900 they still fill and centre in the first screen), a static poster styles band in the same horizontal padding: 1px `--rule` top border, 40 above and below; Label "POSTER STYLES"; h2 "Three posters from one run." 34/700/75% `--ink`, letter-spacing −0.01em; one line 16 `--muted` "Made from the sample run. Yours render in your browser, up to 18 × 24 in at 300 dpi."; then 3 columns (gap 24; 12 below 600; 3 at every width) of `<figure>`: the poster image 3:4 (600×800 WebP, lazy, Poster mode's preview shadow) and a caption, name 13/600 `--ink` ("A · Trail Sign", "B · Night Ridge", "E · Survey Quad") over a description 12 mono `--muted` ("Oblique 3D terrain", "Ridge lines at night", "Topographic contours"). Not buttons or links. The images are the sample run at default settings, 18×24, captured from Poster mode by `pnpm posters`.

**02 View**: header nav = Segmented km/mi, Secondary "New file", Primary "Make a poster". Aside: date line 12 mono (e.g. "SAT · 2026-10-04"), h1 route name 44/800/75% (editable later), 2×2 StatTiles (Distance, Vert emphasised, Moving time, High point), Climbs list (rows: index 700, "km 5.6 → 8.4", "+270 m" mono; the steepest row shaded `--surface`), Slider "Vertical exaggeration" 1–3 step 0.1 default 1.6, help text 14 muted. Main: terrain box (`--surface`, radius 6) with top-left legend chip ("○ Start / finish · ▲ Summit 820 m · Vertical ×1.6") and bottom-right icon buttons (Rotate, Flat map); below it the ElevationProfile with a header row ("ELEVATION · 300–820 m" left, "km 12.2 · 640 m · grade 18% · 6:48 /km" right in mono) and km ticks. A file dropped anywhere replaces the run: while one is dragged over the page, a light `--bg` wash, the 2px `--ink` viewport frame and a centred ink pill "Drop to open a new run" / "REPLACES <ROUTE NAME>" (canvas `ViewDropV2`). A GPX then goes through the Upload screen's Dropzone; a wrong file (extension, size) keeps the run on screen and says why in a bar under the header (`--surface`, header padding, 1px `--rule` under, the Dropzone's error text, a Dismiss button).

**03 Poster mode**: header tagline shows "POSTER · <ROUTE NAME>", right = Secondary "Back to the run". Aside 380px, scrollable: StylePicker; SizePicker (18×24 in, A3, 4:5, 9:16); TextFields Title / Subtitle / Signature; Checkboxes for which stats show; Slider "Hide start and end" 0–500 step 100 default 200 (metres); bottom (sticky): Primary "Download PNG · 5400 × 7200", Secondary "Download PDF for print", note 11 mono "Rendered in your browser, in tiles. Large sizes take a few seconds." (line-height 1.5); the sticky block shows a soft top shadow only while settings are scrolled under it, and spans the aside edge to edge (canvas `PosterModeV2`). Main: `--surface` background, the poster preview centred at 600×800 with a soft shadow, live. Dropping a file works as in 02 View, except during an export, when drops are ignored. Each screen fades in over 160ms when it opens (none with reduced motion).

**04 Exporting** (overlay on 03): a progress bar in `--ink` over `--rule` under the Download button, label "Rendering tile 4 of 12", cancel as Quiet button. On completion the browser download starts and the label reads "Saved <filename>".

## 4. Poster styles (phase 3)

All styles share the same data and the same slots: title, subtitle, date, stats row, signature, terrain figure, elevation profile strip. Only palette, type and terrain treatment change.

| | A Trail Sign | B Night Ridge | E Survey Quad |
|---|---|---|---|
| Paper | `#E6EAEE` | `#0F2233` | `#F2EFE6` |
| Ink | `#1B2A3A` | `#E8F1F5` | `#1E1B18` |
| Accent | `#C2410C` (print-safe route) | `#FFD9A0` route, `#8EC5DA` ridges | `#9A5B2E` contours, route ink dashed |
| Display face | Archivo 62% / 800, uppercase | Big Shoulders Display 800, uppercase | Libre Caslon Text 400 (title), Archivo Narrow 700 (stats) |
| Terrain | oblique 3D, flat `--surface` facets, 1px ink edges, route 4px with 9px white halo, ○ start, ▲ summit | oblique ridge lines (front rows brighter), route glow halo at 35% + 3px core | top-down contours, 20 m interval, every 5th index line 1.6px, route 3.5px dashed with white halo, legend, scale bar, "CONTOUR INTERVAL 20 METRES" |
| Layout | number row above figure, stats under a 2px rule, footer mono | left text column over figure, profile strip bottom | map in a 2px frame left (900px of 1440), stats and legend column right |

Sizes and pixel targets: 18×24 in → 5400×7200; A3 → 3508×4961; 4:5 → 1080×1350; 9:16 → 1080×1920. Print sizes are 300 dpi. Browser canvases are commonly capped around 8192–16384 px per side (unverified; measure on the maintainer's Mac mini in phase 3), so render print sizes as tiles of ≤ 4096 px and stitch in an OffscreenCanvas.

## 5. Accessibility rules (apply everywhere)

- Color is never the only channel: start ○, summit ▲, scrub ● with white ring; climbs shaded and labelled.
- Text contrast ≥ 4.5:1; large display ≥ 3:1. Check B's `#8EC5DA` on `#0F2233` for small text (use `#B9D3DE` for body).
- All controls reachable by Tab, operable by keyboard; the terrain canvas has an `aria-label` describing the route and a text alternative in the aside (the stats and climbs).
- `prefers-reduced-motion`: intro animation becomes a fade.
