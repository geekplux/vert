# poster

Poster styles A Trail Sign, B Night Ridge and E Survey Quad (DESIGN-SPEC §4), their shared layout
slots, and export.

- `sizes.ts` (`POSTER_SIZES`, `posterSizeById`) and `styles.ts` (`POSTER_STYLES`, palettes) are
  the one source for sizes and styles; the pickers and the page state import them.
- `types.ts`: `PosterContent`, what every style shows, already formatted, and
  `posterContentFromRun(run, prefs)` (stat toggles, units, title and subtitle defaults, sample
  note). The date is always shown (print: header right; share card: header right, followed by
  the subtitle). The subtitle defaults to none; on print it sits in the footer before the
  elevation note. Long subtitles truncate with an ellipsis instead of wrapping.
- `layout.ts`: `posterLayout(size)`. A poster is laid out at a logical width (720 for print, 1080
  for the share-card layout of 4:5 and 9:16) and scaled: `transform: scale()` in the preview,
  `scale = size.width / logicalWidth` in the export.
- `TrailSignPoster.tsx`: style A. Print sizes per the "Trail Sign 18×24" frame; social sizes per
  the "share card 4:5" frame (DECISIONS). The figure box follows `figureBoxRule` (layout.ts):
  print fills the height the text leaves (never below 75% of its natural height); 4:5 keeps the
  figure's aspect, never taller than wide; 9:16 grows the figure up to square, adds a 96 px
  elevation strip under it and spreads the rest evenly. `onFigureBox({ width, height })` reports
  the box in logical px so the terrain renderer can draw at its exact aspect; a placeholder image
  covers the box, centred. `data-slot` attributes name the slots (header, title, figure, stats,
  profile, footer, headline, body).
- `titleFit.ts`: the title fit rule: 104 px, smaller (2 px steps) only when the title would take
  more than three lines; at 48 px it may take a fourth. Latin breaks at spaces, CJK between
  characters (with kinsoku). In the browser, once Archivo has loaded, `useTitleMeasure` measures
  with canvas `measureText` on the real font stack; before that, and in jsdom, a fixed table of
  Archivo 800 / wdth 62% advances (East Asian wide characters at 1 em). Wide-script titles render
  in the system CJK face (Archivo has no CJK) with line-height 1 instead of 0.88, so their lines
  do not touch.
- Share card without vert or distance: the title takes the big number's slot (uppercase display
  type, `SHARE_TITLE`: fitted to ≤ 3 lines from 160 px), the line under it shows the remaining
  stats or else the date, and the free height is spread evenly between the blocks.
- Footers: stats win over the signature. On the share card the stats never truncate; when stats
  and signature do not fit on one row the signature wraps to a second row, right-aligned. On print
  the signature takes at most half the row; on the left only the subtitle shortens. Signatures are
  cut to 40 characters, the last one "…" (`clampSignature`).
- `PosterPreview.tsx`: scales any poster to fit a box (600 × 800 by default). The frame is sized by
  CSS alone, so scaling never shifts the layout.
- Accessibility: the poster root is `role="img"` with a summary (`posterAriaLabel`) as its name and
  the drawn text `aria-hidden`: it is artwork to be exported, and the summary carries the same
  facts.
- Export is client-side. Print sizes render as tiles of ≤ 4096 px, stitched in an OffscreenCanvas.
- Await `document.fonts.load(...)` for every face a style uses before drawing: `loadPosterFonts(style,
text)` (`fonts.ts`) does it, and for B and E first injects `src/styles/poster-fonts.css` (never
  loaded at app start).

## Styles B and E

Same props as `TrailSignPoster` plus `figureData`; same logical sizes (720 print, 1080 social; the
social layout is the print design at 1.5×, strokes included, except that no social text is under
18 px). Both draw their own SVG figure from
`figureData` and show `figure` (a placeholder) until it exists.

- `NightRidgePoster.tsx` (B): text column laid over a stage that the ridgeline figure fills; the
  stage reports `{ width, height, keepOut }` through `onFigureBox` (the text's line boxes), and
  `nightRidgeFigureData(run, heightfield, box, { exaggeration, rows })` (`figures.ts`) lays the
  ridges out clear of the text. Build the heightfield from `ridgeBounds(run.bounds, box)` with
  `padding: 0` so the rows run across the stage. Sunrise (`src/lib/sun.ts`) appears only when
  the run's timestamps put it during the run; clock times use the viewer's time zone (GPX times
  carry none).
- `SurveyQuadPoster.tsx` (E): title, map in its frame, stats band, legend and scale bar. The map box
  (inside the frame's padding) is reported through `onFigureBox`; build the heightfield from
  `quadBounds(run.bounds, box.width / box.height)` with `padding: 0`, then
  `surveyQuadFigureData(run, heightfield, box, { units, layout })`.
- Detail: pass `detailScale` (the export scale, `posterLayout(size).scale`) to the figure-data
  functions when exporting: lines are then sampled and simplified to 0.3 output px with finer
  coordinate rounding (`lineDetail`). The preview can use the default 1.
- `ridges.ts`: rows west to east, back (north) to front, lifted by elevation ×
  `ridgeExaggeration(setting)` (the setting × 1.5: ridgelines need the extra lift), which is also
  the factor the poster prints ("ELEVATION ×2.4") and states in its accessible name;
  paper-filled below each line, opacity 0.18 → 0.88; the depth compression is chosen to fill the
  free area; the route is draped on the same (lightly smoothed) surface, and vertical zigzags from
  GPS jitter on steep slopes are evened out (`smoothZigzags`).
- `contours.ts`: marching squares (saddles resolved by the cell centre), segments joined into
  polylines, smoothed input, 20 m interval (coarser only when lines would pack under 2.5 px; the
  label states the interval drawn), index every 5th, top-down true-aspect projection, RDP
  simplification, scale bar of four round segments.
- Palettes: `NIGHT_RIDGE_PALETTE` and `SURVEY_QUAD_PALETTE` in `styles.ts`. B's small text is
  `#B9D3DE` (10.36:1); `#8EC5DA` is for strokes only.
