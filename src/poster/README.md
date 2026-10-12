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
- Await `document.fonts.load(...)` for every face a style uses before drawing.
