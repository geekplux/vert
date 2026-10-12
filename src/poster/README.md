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
  do not touch. Poster A titles with diacritics (Ż, Ó, É, Å above; Ç, Ę below) are set by
  `fitTitleSetting`: where the lines as broken (`breakLines`) put an accent under a line or a mark
  below over one, a looser line-height (`titleLineHeight`, from each line's ink extents:
  canvas `TextMetrics` via `useTitleFonts`, a table of Archivo's extremes in jsdom) keeps them 5 logical px apart (10 on the share card), and the size shrinks
  until those lines fit the box height the plain fit takes, so the layout never moves; one-line and
  Latin-only titles keep 0.88.
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
- Export is client-side; see "Export" below.
- Await `document.fonts.load(...)` for every face a style uses before drawing: `loadPosterFonts(style,
text)` (`fonts.ts`) does it, and for B and E first injects `src/styles/poster-fonts.css` (never
  loaded at app start).

## Export

Download runs `posterExporter` (`src/page/PosterState/posterExporter.ts`, the app's
`defaultExporter`) with the `ExportJob` Poster mode builds:

- The element is the preview's own `LivePoster` with `exportScale = posterLayout(size).scale`:
  same style, size, content, units, exaggeration, View camera, trimmed track and frame. In export
  mode B and E lay out for the reported box at once and pass `detailScale` (lines sampled to 0.3
  output px), the fonts gate is skipped (the engine loads the faces first), and style A draws no
  preview figure. The poster reports its figure through `onFigureStatus` (`loading`, `ready`,
  `error`); the engine's `waitFor` holds until it has been `ready` for 50 ms. Height grids come
  from the preview's loader (`job.sources.loadFigureTerrain`, cached by bounds), so an export
  usually fetches no tiles; style A with the whole route uses the View's grid
  (`job.sources.terrain`), built afresh only if it is not ready.
- Style A's terrain is a raster `FigureLayer`: its own `TerrainFigureRenderer` (lazy three.js
  chunk) draws each output tile's part of the figure box with `renderTile` (whole-figure camera,
  view offset, 24 logical px bleed), at the export scale: route core 4 × s, halo 9 × s, ridge
  lines and marker sprites (textures repainted at `markerTextureScale(s)`, 8× at 18 × 24). The
  renderer and its WebGL context are disposed when the export ends, however it ends.
- The engine (`export/export.ts`, a lazy chunk): mount off-screen, load faces, serialize to SVG,
  rasterize in tiles of ≤ 4096 px into one canvas, encode PNG (300 dpi pHYs for print) or a
  one-page PDF holding a JPEG (q 1.0). Progress: `{ done: 0, total }` once the tiles are planned
  (poster tiles plus one figure tile per poster tile the figure overlaps: 18 × 24 style A is 4 + 4),
  then one report per tile, then `{ done: total, total, stage: 'encode' }` ("Saving the file…");
  "Preparing…" until the first. After every report the engine waits for the next paint
  (`nextPaint`: a frame, then a task; at once in a hidden tab; ≤ 100 ms), so each "Rendering tile
  k of N" is on screen; each wait is a User Timing measure `vert:export-paint-wait`.
- Cancel: the signal is checked between every step; waits (grids, font settling, the encode)
  reject at once; nothing is downloaded after an abort; canvases and the renderer are released.
- Errors shown to the user (`ExportError`): too large for this browser (`tooLargeMessage`), the
  terrain could not be loaded (`TERRAIN_UNAVAILABLE_MESSAGE`), no WebGL at all (`NO_WEBGL_MESSAGE`:
  Trail Sign cannot be exported here, Night Ridge and Survey Quad can; asked with
  `browserHasWebGL` only after the figure failed), or WebGL but the figure could not be drawn
  (`terrainDrawMessage`); anything else is the generic message. "Try a smaller size" is said only
  when a smaller size exists (`hasSmallerSize`: not at 4 : 5).
- Canvas sizes (`canvasLimits.ts`): a size that failed once is tried again on the next Download
  (the failure may have been transient); after two failures in a row it fails at once for the
  session, as does any size at least as large. A size that works clears its failures.
- Measured (M4 Mac mini, Chromium, Metal; download event after the click): 18 × 24 PNG A 0.8 s,
  B 0.8 s, E 0.7 s; PDF A 0.7 s, E 0.8 s; A3 A 0.5 s; 4 : 5 and 9 : 16 A 0.4 s; CCC (99 km)
  18 × 24 A 0.8 s, B 0.7 s, E 0.7 s. Peak: 8 tiles (18 × 24 A). `e2e/export.spec.ts` checks the
  files (size, pHYs, PDF page and JPEG, terrain and text pixels, Latin Extended glyphs against the
  preview, Cancel, the network log).

## Styles B and E

Same props as `TrailSignPoster` plus `figureData`; same logical sizes (720 print, 1080 social; the
social layout is the print design at 1.5×, strokes included, except that no social text is under
18 px). Both draw their own SVG figure from
`figureData` and show `figure` (a placeholder) until it exists.

- `NightRidgePoster.tsx` (B): text column laid over a stage that the ridgeline figure fills; the
  stage reports `{ width, height, keepOut }` through `onFigureBox` (the text's line boxes), and
  `nightRidgeFigureData(run, heightfield, box, { exaggeration, rows })` (`figures.ts`) lays the
  ridges out clear of the text. Build the heightfield from `ridgeBounds(run.bounds, box)` with
  `padding: 0` so the rows run across the stage (it widens the ground east–west for the stage but
  never deepens it to the south, where terrain in front of the route stacks into a tall "curtain";
  a tall stage gets ground to the north, behind the route, at most `NORTH_FILL_MAX` (2) × the
  route's north–south extent). Sunrise (`src/lib/sun.ts`) appears only when
  the run's timestamps put it during the run; clock times use the viewer's time zone (GPX times
  carry none).
- `SurveyQuadPoster.tsx` (E): title, map in its frame, stats band, legend and scale bar. The map box
  (inside the frame's padding) is reported through `onFigureBox`; build the heightfield from
  `quadBounds(run.bounds, box.width / box.height)` with `padding: 0`, then
  `surveyQuadFigureData(run, heightfield, box, { units, layout })`. Scale labels sit on their ticks
  (the first starts at the bar, the last centres its number and hangs the unit after it, in room
  the block reserves, or ends flush with the bar when the key has no room for that); labels
  are thinned by their measured widths (`scaleLabelsShown`). Markers: ○ start, and ◉ finish (the
  ring with an ink dot, drawn under the start) when the ends are ≥ 14 px apart; the legend's last
  row follows them: "○ Start · ◉ Finish", or "○ Start / finish" for a loop.
- Detail: pass `detailScale` (the export scale, `posterLayout(size).scale`) to the figure-data
  functions when exporting: lines are then sampled and simplified to 0.3 output px with finer
  coordinate rounding (`lineDetail`). The preview can use the default 1.
- `ridges.ts`: rows west to east, back (north) to front, lifted by elevation ×
  `ridgeExaggeration(setting)` (the setting × 1.5: ridgelines need the extra lift), which is also
  the factor the poster prints ("ELEVATION ×2.4") and states in its accessible name;
  paper-filled below each line, opacity 0.18 → 0.88, each line drawn whole except stretches that
  would print as stray dashes (`ridgePieces`: an occlusion envelope, front to back; stretches more
  than `HUG_PX` clear of the rows in front and under `MIN_VISIBLE_RUN_PX`, or under
  `MIN_FLOATING_RUN_PX` at the field's edge, where they also shorten the row); the depth
  compression is chosen to fill the free area, never above the true depth (`depthScale` ≤ 1: the
  route keeps its plan shape), then the figure is enlarged with its sides cropped to the route (rows
  clipped at the box); the route is draped on the same (lightly smoothed) surface, and vertical zigzags from
  GPS jitter on steep slopes are evened out (`smoothZigzags`: blended in by a smoothed per-point
  weight, so it adds no step or lone spike; summits and valleys of 25 m or more are kept).
- `contours.ts`: marching squares (saddles resolved by the cell centre), segments joined into
  polylines, smoothed input, 20 m interval, 50 ft in imperial units (coarser only when lines would
  pack under 2.5 px; the label states the interval drawn), index every 5th (100 m, 250 ft), top-down true-aspect projection, RDP
  simplification, scale bar of four round segments.
- Hide start and end: both figure-data functions take `drawnTrack` (the run's track with the
  hidden ends cut off by `trimTrack`, or null for no route); sunrise and the start time still come
  from the whole run. Every style is framed on what is drawn (`figureFrameBounds`: the drawn
  route's bounds when ends are hidden), so the empty margin never shows where the start was:
  `ridgeBounds` / `quadBounds` take it, Survey Quad centres its map and coordinates on it
  (`frame`), and style A builds its own grid from it plus 15% (`padBounds`).
- Palettes: `NIGHT_RIDGE_PALETTE` and `SURVEY_QUAD_PALETTE` in `styles.ts`. B's small text is
  `#B9D3DE` (10.36:1); `#8EC5DA` is for strokes only.

## Style A's terrain figure

`terrainFigure.ts` (three.js; load it with `loadTerrainFigure()` from `terrainFigureChunk.ts`):
`renderTerrainFigure({ heightfield, track, camera, exaggeration, width, height, pixelScale })`
draws the terrain, the route (#C2410C core 4 px, white halo 9 px; where a ridge hides it, a 2 px
line at 40% with no halo) and ○ / ▲ markers into a canvas
of `round(width × pixelScale) × round(height × pixelScale)` px. `width × height` is the figure box
in logical px; every line width and marker size is logical px × `pixelScale`, so the preview
(preview scale) and the export (export scale) show the same picture. (The canvas is drawn at
pixel ratio 1 and `Line2` takes its resolution from the viewport in output px, so the route's
widths are multiplied by the scale: `RouteLayer.setLineScale`.) The camera is the View's
(`ViewCamera`: azimuth, polar, zoom factor, flat or oblique); the model is framed for the box at
that azimuth (no zoom band: a figure never turns). One off-screen `TerrainStage` (`interactive:
false`) is reused; `releaseTerrainFigure()` frees it and loses its WebGL context.

For the export, `renderTerrainFigureTile(scene, tile)` takes the engine's `FigureTile` (`x, y,
width, height` in output px of the figure box, `scale`, `boxWidth`, `boxHeight`) and draws that
part with the whole figure's camera plus a view offset (`figureViewOffset` in `stage.ts`), with a
24 logical px bleed on inner edges so the route's per-point visibility and strokes match across
seams. Tests check that tiles reproduce the whole frame's camera matrices exactly. Marker textures
are drawn at 4× (`markers.ts` `TEXTURE_SCALE`), or at `markerTextureScale(pixelScale)` when the
figure is drawn larger (8× at 18 × 24), so markers are never magnified.
