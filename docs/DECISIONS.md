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
  Padding 10×12, left aligned. The sub-line breaks only between "print ·" and the pixel size, which
  stays on one line: in the 380px poster aside (1440 and 1000 wide) the cards are narrower than at
  390 and "5400 × / 7200" used to split.
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

- Climbs list: the steepest row is shaded `--surface` **and** says "steepest". The gain column is
  `max-content` (never squeezed); the range breaks only after its arrow ("km 154.6 →" / "168.5"),
  so a long range (imperial, or past 100 km with a four-digit gain) wraps instead of running into
  the gain; "steepest" is a tag (11px mono caps, `--muted`, 4.54:1 on `--surface`) that follows
  it when there is room and otherwise takes the line under it as a whole. The canvas's running text
  "· steepest" wrapped as a lone "·" or a lone word in the 300px aside (accessible text is still
  "km 14.1 → 15.5 · steepest").
- The aside h1 (44px) never breaks inside a word: a word wider than the column steps the size down
  2px at a time, to 32px ("Longyearbyen Loop" at 1440: 40px); only a word too wide even at 32px
  hyphenates (`hyphens: auto`, the page's `lang="en"`), then breaks anywhere. Titles whose words fit
  are set exactly as before (pixel-identical to the Main frame layout).
- Side by side (≥ 900px) the terrain box is at most `100dvh − 339px` (header, main padding and gap,
  the elevation section) and at least 460px, so the elevation profile, the scrub control, is on
  screen from a window 800px tall (at 1440 × 900 it was 35px in view). At the Main frame's height
  (1059) the box is its 1000:680 height, unchanged.
- A loaded sample shows "SAMPLE DATA" in the date line, in `--route-text`.
- "About" opens a short in-page dialog (what Vert is, privacy, credits); "GitHub" links to
  https://github.com/geekplux.

- Below 900px the aside is drawn under main but stays first in DOM and Tab order (PageShell). Each
  region is one labelled landmark, so focus never interleaves; desktop (the editing platform)
  keeps reading order = Tab order. Accepted trade-off.
- Focus on screen changes: when the screen changes (upload → view → poster and back), focus moves
  to the new screen's h1 (`tabIndex={-1}`, no visible ring on programmatic focus) so keyboard and
  screen-reader users start at the top of the new content. Opening/closing the export overlay moves
  focus to its progress label / back to the Download button.

- Terrain overlays: below 600px the View moves the legend chip and the Rotate / Flat map buttons
  out of the terrain box into a row under it, so nothing covers the model on phones. TerrainView
  takes `insets` so the page reserves room for any overlay that stays on top.

## Posters (phase 3)

- Fonts per the canvas, all self-hosted and loaded only in poster mode: B = Big Shoulders Display
  800 + JetBrains Mono 400; E = Libre Caslon Text 400 (italic only when there is a subtitle) +
  Archivo Narrow 400/600/700. Night Ridge prints its effective relief (setting × 1.5).
- The poster subtitle defaults to empty: the date already sits in the header and Vert has no place
  data, so the canvas's "[Place] · [Date]" would be invented. Social sizes show a short note where
  the PDF button would be (PDF is for print sizes).
- Clock times (Night Ridge start and sunrise) are shown in the viewer's time zone: most people
  upload their own local runs, and a longitude-based offset would show 05:32 for a 07:32 Georgia
  sunrise. The date line keeps the longitude rule, because it must survive any viewer time zone.
- Poster A's display title keeps line-height 0.88, except where its lines, as broken, put an
  accented capital (Ż, Ó, É, Å, Ñ) under another line or a mark below (Ç, Ę) over one: those lines
  are set looser (from each line's real ink, canvas `TextMetrics` with the face loaded, so
  doubled Vietnamese marks count; Archivo's measured extremes only where there is no canvas) so glyphs stay ≥ 5 logical px clear on print and ≥ 10 on the share card (≥ 3 whole
  pixel rows in every preview, antialiasing included), and the size shrinks until they fit the box
  the same title takes at 0.88. The box height, and so the figure, stats and footer, stay exactly
  where they are; one-line and Latin-only titles are unchanged.
- Style A at the social sizes (4:5, 9:16) uses the share-card layout (frame "Style A · share card
  4:5"); print sizes use the Trail Sign layout.
- No invented data: poster A's "VERT № 014" becomes "VERT"; footer URL is VERT.GEEKPLUX.COM.
  Night Ridge's sunrise line appears only when the GPX has timestamps (solar position computed in
  `src/lib`); its top nav (RUNS / COMPARE / UPLOAD) is mockup decoration and is omitted.
- Terrain look, style A (View and poster): oblique 3D, `--surface` fill, 1px ink ridge lines along
  rows of the grid (front rows darker), route 4px `--route` with a 9px white halo, ○ start, ▲ summit.
  Where a ridge hides the route it is drawn, not dropped: 2px, no halo, the route colour mixed 15%
  towards the ink at 85% opacity (told apart by width and the missing halo, not colour). It keeps
  ≥ 3:1 on the terrain fill (WCAG 1.4.11) for a colour-weak viewer: 3.5:1 in the View, 4.0:1 on
  poster A (measured on screen; the route colour at 40% was 1.7:1 and 1.8:1). Poster widths are
  logical px × scale.
- Hide start and end also reframes (privacy): with ends hidden every poster figure is framed on
  the drawn (trimmed) route's bounds (A builds its own grid, +15%; the View keeps the whole run),
  so neither the margin nor the frame's centre shows where the trimmed start was.
- The 9:16 share card's elevation strip is the muted `#C9D1D9` at 60% (4.37:1 on the card).
- Style A's walls (View and poster) are plain: shade plus top and bottom edges. The ridge rows stay
  on the top surface; drawn down the side walls they hatched a narrow block's wall with verticals.
  (The canvas's "Trail Sign" figure drops the row ends down its wall; the acceptance run ruled it out.)
- Night Ridge draws every ridge line whole (the paper fills hide what is behind), except stretches
  standing more than 1 px clear above the rows in front that would print as stray dashes: under
  3 logical px anywhere (a back row just clearing a crest), or under 20 logical px at the field's
  edge (reaching a row's end, or past the end of the rows in front: the skew-step stubs and floating
  "ladders" along the right edge). A stub at a row's end shortens that row, fill and all, so the rows
  behind are judged without it. What runs within 1 px of the line in front (inside its stroke) is
  always drawn, so bundles of near-coincident rows stay continuous, as when every row was drawn.
- No route distortion: Night Ridge never draws the ground's depth deeper than its true size (depth
  scale ≤ 1, the view at most straight down), so a runner always sees the real shape of the route.
  Measured depth scale on the 16 posters below: 0.25–1.000, never above 1.
- Night Ridge's ground is never deepened to the south, in front of the route: on a tall stage the
  E51's ground had grown 9 km south (and north) of the route, and the Jungfrau massif and the
  Lauterbrunnen valley's wall in front of it stood as a tall "curtain" of ridges (the DEM and tiles
  were fine). It is widened east–west for a wide stage, and on a tall stage it runs on to the north,
  behind the route, so distant back ridges fill the sky: as much ground as the figure needs to fill
  the free height at true depth with its sides cropped to the route (plus 4% of the width each side),
  at most 2× the route's north–south extent. The back rows are the dimmest (0.18 opacity rising to
  0.88 at the front) and keep the same spacing as the rest, so they read as distance, not a wall.
  Then the view steepens (≤ true depth) to fill, and the figure is enlarged with its sides cropped.
  Fill of the free stage height under the text (18 × 24 / A3 / 4 : 5 / 9 : 16): sample 97/100/98/99%,
  Lavaredo 139/120/155/100% (rising beside the text), E51 100/100/100/100% (9 : 16 was 67% with the
  depth capped and 94% stretched), CCC 100/100/100/100%.
- Survey Quad marks a point-to-point run ○ start and ◉ finish (as the View, A and B do), legend
  "○ Start · ◉ Finish" on one row; a loop keeps one ○ with "Start / finish" (the View's wording,
  instead of the canvas's "Start and finish"). Start and finish within 14 px of each other on the map
  are drawn as one ○.
- Camera handoff: Make a poster copies the View's camera (angle, zoom, flat) into
  `prefs.poster.camera`, and style A's figure (preview and export) is drawn from it. Back to the run
  keeps it and starts the View from it, no intro; New file resets it.
- Flat map off returns to the oblique angle and zoom the user left when turning it on (the default
  view only if the View opened flat). Reset view still goes to the default.
- Long routes (terrain ≥ 15 km on its longer side, e.g. the CCC): the default oblique view is 50°
  from vertical instead of 62°, so ridges hide less of the route (CCC: 42% → 11% hidden at 1440,
  28% → 4% at 600), and the heightfield samples one tile zoom finer than its 512-sample grid needs
  (CCC: z10 → z11, 6 → 12 tiles, 107 → 77 m samples from 2× finer data), capped at 32 tiles.

## Flat and elevation-less runs

- **Profile minimum span.** Every elevation profile (the View's ElevationProfile and the poster A
  and B bands, all through `plotProfile`) is drawn over at least max(100 m, 1% grade over the
  route), the run's range centred in it: a flat 10 km loop with 0.8 m of noise is a flat line
  half-way up, a 2 km run with 23 m of climb a gentle slope. 1% rather than 2%: at 2% the CCC
  (1,521 m of range over 99.4 km) would have been squashed. The sample, Lavaredo and the CCC draw
  pixel-identically to before.
- **Plotted line smoothing.** Only when the drawn span is under 300 m (a metre is then ≥ 0.5 px at
  140 px): a centred moving average over ±(4 m / span) of the points (at most ±5%), ends kept.
  Removes the whole-metre stairs of watch and course files. Stats, readouts, climbs and ticks keep
  the real values; the scrub dot sits on the drawn line, its readout gives the real elevation.
- **No usable `<ele>`: elevations from the terrain.** A file has no usable elevation when no point
  has an `<ele>`, every `<ele>` is the same value (all 0, a fixed altitude, or a lone `<ele>` on
  a longer route), or, on a route of 1 km or more, they all lie within 0.5 m (see "Running-app
  files" below). When the terrain grid is ready, `RunProvider` samples it along the track
  (bilinear, the same DEM the View draws), averages it over ±50 m of route (below), applies the same
  median filter and rules as a file's own elevations (`elevationStats`) and serves the run with profile, vert, high/low point, climbs and
  `track.ele` filled and `elevationSource: 'terrain'`, in the same render that reports the terrain
  ready. O(n) on the main thread; the run's id is unchanged.
- **Gaps in `<ele>`.** A gap without `<ele>` spanning under 200 m (measured between the recorded
  points around it, or from the route's start or end) is interpolated as before: a straight line
  over 200 m can hide a 20–40 m bump, under it the line is within a recorder's own noise, and
  every-tenth-point files (≈ 40 m gaps, the sample stays +1,092 m) stay GPX-based. Longer gaps are
  left for the terrain (`track.partialEle`, `NaN` there): only those points are sampled, shifted to
  meet the recorded values on either side (the offset blends linearly by distance across the gap;
  one side at the route's ends), so a recorder reading 30 m above the DEM adds no step or false
  climb. `elevationSource: 'mixed'`, or `'terrain'` when the file's own values cover under 5% of
  the route's distance (they are then ignored). Measured in the browser on the sample (+1,102 m with all its
  `<ele>`), with the ±50 m terrain average: second half removed +1,092 m, mixed (+1,122 unaveraged;
  was +698); a lone first `<ele>` or all-zero `<ele>` +1,094 m, terrain (+1,176 unaveraged; was
  flat / 0 m); every tenth point +1,092 m, GPX.
- **Copy.** Until the terrain loads, or if it fails, every elevation figure stays "–" and no ▲ is
  drawn (gaps included: half a profile would mislead; a mostly recorded file is interpolated instead
  when the terrain fails, below). The aside says why under the stats, in a
  polite status region: "This file has no usable elevation. Reading it from the terrain…" / "…, and
  the terrain couldn't load."; with gaps "This file's elevation has gaps. Filling them from the
  terrain…" / "…, and the terrain couldn't load to fill them."; once filled "Elevation from terrain
  data. This file has no usable elevation." or "Elevation partly from terrain data, where this
  file has gaps."
- **Gaps when the terrain fails.** A file whose own values cover at least half the route's
  distance ("mostly recorded") does not stay at "–" when the terrain fails: each long gap is drawn
  as a straight line between the recorded values around it (held level at the route's ends), the
  same median filter and rules give the stats, profile and climbs (`withInterpolatedGaps`,
  `elevationSource: 'interpolated'`), and the aside says "Elevation gaps interpolated; the terrain
  couldn't load." Posters say "ELEVATION GAPS INTERPOLATED" in the A (print) and B footers and
  "Elevation gaps interpolated." in every poster's name. Try again, if the terrain then loads,
  fills the gaps from it (`'mixed'`). A file covering under half keeps "–" and the gaps copy above
  (a straight line would be most of its profile), and so does one with no usable elevation.
- **Recorded share by distance.** "Cover" is measured along the route: the steps whose two ends
  both have a value (recorded, or a short gap already interpolated) over the total distance, by
  points only for a route with no length. Ten points bunched in the first 10 m of a 1 km route are
  1%, not 83%.
- **The route is built once** when the track changes in the render that brings the heightfield
  (terrain elevations): `TerrainView` hands the current track to `stage.show()`, which takes it
  before building the route, and the `setTrack` effect after it finds nothing to do.
- **Posters without elevation** leave vert and high point out (as they leave out time without
  timestamps), so nothing prints "–". Night Ridge's hero is the vert, else the distance (whether the
  vert is switched off or unknown), and the distance then leaves the line under it; its profile
  axis ends at the run's distance and the sunrise tick is placed by distance even with no profile.
  Terrain-sampled elevations add "ELEVATION FROM TERRAIN DATA" ("ELEVATION PARTLY FROM TERRAIN
  DATA" for gaps) to the A (print) and B footers and "Elevation [partly] from terrain data." to
  every poster's accessible name; the share card and Survey Quad have no natural slot and say it
  only in the name.
- **Summit threshold.** A ▲ summit (terrain marker, legend entry, terrain label) only when the high
  point stands ≥ 10 m above the route's lowest point (`hasSummit`, `src/lib/summit.ts`), the same
  rule in the View, poster A's figure and the legend. Unknown elevation: no summit.
- **Sample chip.** The Upload chip reads `SAMPLE_TOTALS` (21,480 m, +1,102 m, 3:04:58), the loaded
  sample's own figures; a test parses `coosa-backcountry.gpx` with the worker's handler and fails if
  they drift. The placeholder `SAMPLE_RUN` (tests and stories) carries the same totals.

## Running-app files (Sean's GPX, Hong Kong)

Sean's 25 runs (running_page / gpxpy exports, Hong Kong waterfront and Island, 1–18 km) loaded
without an error message but showed broken terrain and junk elevation. Rulings:

- **Terrain spikes removed.** Terrarium has seam artefacts along the Hong Kong coast: one-pixel
  lines of −1,000 to −8,600 m at z14 (8–425 samples below −50 m in each z14 grid there) and ringing of
  −1,256 to +6,431 m at z12. They drew the terrain as a needle-thin wall thousands of metres deep in
  the View and on all three posters (a Night Ridge route plunging off the page, Survey Quad index
  contours around each line) and put −3,976 m and −1,696 m on two routes' sampled elevations.
  `buildHeightfield` now replaces, before sampling, every mosaic pixel that more than half of its
  5 × 5 neighbourhood clears by more than max(100 m, 5 pixel widths) (z14: 100 m, z10 in the Alps:
  525 m) with the neighbourhood's median (`removeSpikes`, `src/lib/terrarium.ts`). On a slope the
  median is the pixel itself, so ordinary relief is left alone, but not every pixel of real terrain
  is: on near-vertical walls it moves single rim and foot pixels (the verifier's 18 cliff and gorge
  sites, z10–14: Mt Thor at z11 25 pixels, by up to 527 m; El Capitan, Half Dome, Zion a few each,
  by 114–200 m; Lavaredo's Tre Cime at z11 one pixel, 401 m). On the four reference grids it
  replaces 0 pixels (at a 50 m threshold the CCC would already lose 527 real pixels, so the margin
  there is about 3×); their View screenshots are byte-identical and their A / B / E 18 × 24 exports
  differ from before only by the ±1 noise two runs of the same build show. Cost up to 36 ms per
  grid (only pixels near a steep step are tested). A second pass was tried for the z12 harbour's
  leftover −150 to −168 m: it replaced nothing there (the residue is wider than a spike) and moved
  more cliff pixels (Mt Thor, Zion, El Capitan), so there is one pass.
- **Near-constant `<ele>` is not a measurement.** The 11 older files carry `<ele>` on about 40% of
  the points, all 0.00–0.38 m over 2–5 km. They showed "Vert 0 m, high point 0 m" as if measured
  (three of them, with long gaps, were blended with the terrain at that level: +5 to +18 m). No
  GPS or barometer holds its altitude within half a metre over a kilometre, so a route of ≥ 1 km
  whose `<ele>` all lie within 0.5 m counts as having no usable elevation (`MIN_ELEVATION_RANGE_M`,
  `FLAT_ELEVATION_MIN_DISTANCE_M` in `stats.ts`): filled from the terrain, with the existing copy
  "Elevation from terrain data. This file has no usable elevation." Under 1 km, or with ≥ 0.5 m of
  range (a flat file its app smoothed), a file keeps its own values. Negative values are fine.
- **Barometric series kept.** The 14 newer files have `<ele>` from −12.8 to 97 m, which looked
  relative. Against the DEM along the track they are absolute: the mean offset (file − DEM) is
  +3.3 to +11.0 m on the flat waterfront files and −4.5 and −6.5 m on the two hilly ones (within
  both sources' noise), and where there is real relief both see it (the 17.8 km run: a
  96 m hill at km 1.3–2.3 in the file, 94–101 m in the DEM, r = 0.7; the Chai Wan run starts at
  49–56 m in both). On the flat waterfront both are noise around a 2–5 m truth (the file wanders
  ±10 m, the DEM has ±8 m bumps from roofs and flyovers), so neither is better and the file's own
  record wins, as for any file. No rule change, no new copy.
- **Terrain elevations averaged over ±50 m of route** (`TERRAIN_SMOOTHING_M`, `smoothByDistance` in
  `terrainElevation.ts`: the integral of the sampled curve over the window, which shrinks at the
  ends). Terrarium's grid is finer than its data and in cities is a surface model, so raw samples
  add climb nobody ran: the terrain gave the sample +1,176 m, Lavaredo +1,222, the E51 +3,394 and
  the CCC +6,838 where their own recordings give +1,102, +1,062, +2,876 and +6,106 (+7 to +18%).
  Averaged over ±50 m: +1,094, +1,090, +2,958, +5,939 (−3 to +3%; ±35 m was +1 to +7%, ±75 m −7
  to +2%), high points within 2 m. Sean's flat waterfront runs filled from the terrain read +22 to
  +78 m instead of +39 to +196 m: still DEM noise on a flat run, said plainly ("Elevation from
  terrain data"). Files with their own elevations are not touched.
- **Known limitation: flat-run vert from a noisy recorder.** The barometric waterfront files show
  +55 to +171 m on flat 5 km runs (Night Ridge puts it in the headline). A noise-adaptive
  hysteresis, max(2 m, k × the recording's noise), was tried and not shipped: no k separates them
  from the reference courses. Short-scale noise (robust sd of the residual after ±50 m, after the
  median filter) is 0.6–1.2 m on Sean's files and 0.4–1.2 m on the courses (CCC 1.21): at k = 3
  the CCC loses 2.8% (6,106 → 5,937) while Sean's files lose 0–21%. Over ±150 m the "noise" is
  1.1–3.0 m on Sean's files and 1.7–3.3 m on the courses: k = 1 already takes the CCC down 2.8%
  and the E51 0.4%, for 0–8% off Sean's. MAD of second differences: 0.30–0.44 m on Sean's, 0.06–0.61
  on the courses. The wander is a ±10 m swell over hundreds of metres, which a recording alone
  cannot tell from real 10 m hills; only the DEM could (and on these runs it is noisy too, see
  above). The file's vert stands, as Sean's watch recorded it.
- **Survey Quad's 0 m line, the coast, from a cleaned land / sea mask** (`seaLevelField` in
  `src/poster/contours.ts`; every other level is traced from the elevations as before). Terrarium's
  sea is coarse bathymetry in blocks ~200 m across straddling 0 (Hong Kong harbour: −2 to +2 m,
  most positive values under 0.5 m), so the raw 0 m index line drew a lattice of rectangles across
  the water; where the sea is exactly 0 (Étretat) it could not follow the shore and drew beads at
  the cliff foot. (Round 1 dropped the 0 m line; that emptied Scheveningen's map, left Sean's routes
  apparently running over water with the 20 m line 100–300 m inland, and took the 0 m line off the
  Masada escarpment.)
  - The mask: land above 0.5 m; opened, then closed, by 50 m (at least a sample); low land patches
    (never reaching 3 m) and sea patches under 250 × 250 m (and under 2% of the grid) flipped, at
    the map's edge too (a block cut by the frame stayed as a stray line out in the harbour); then
    any ground of 3 m or more is land again.
  - **Small islands stay.** A land patch is flipped only when it is low: the harbour's noise blocks
    peak at 0–1.6 m, real islets rise far above (round 2 removed Château d'If, 2.5–4.4 ha). Land
    kept within 400 m of the islet (mask / data above 0.5 m, z14): Château d'If 385 / 507 samples,
    Alcatraz 1,563 / 1,587, Bass Rock 1,603 / 1,627, St Michael's Mount 2,767 / 2,850, Green
    Island (HK) 3,382 / 3,332; Fort Boyard has no land in Terrarium at all. The harbour stays clean:
    Hong Kong waterfront 2 lines (main 31), the 17.8 km run 13 (main 142), Chai Wan 2 (main 14).
    Accepted limit: a real islet that is both low (peak under 3 m in the data) and small (under
    ~6 ha) is dropped with the noise, e.g. most of San Michele in Venice (peak 2.8 m, ~4.5 ha).
  - **Cost:** 50–76 ms on a 512 × 512 grid (24–38 ms before the smooth tracing), once per Survey
    Quad layout; acceptable for a poster.
  - **Traced smooth.** Round 2 set the samples on the wrong side of the mask ±1 cm across 0, which
    snapped the line to the grid: 67–75% of its segments exactly horizontal, vertical or 45°, a
    1–3 mm staircase at 18 × 24 in the heaviest line of the map. Now, where cleaning left a sample as
    the threshold put it, the field is the elevation itself, its crossing moved from 0 to 0.5 m near
    any disagreement with the mask (a sea block, a beach under half a metre, a sea of exact zeros)
    and fading back to 0 over a few samples, so the line lies between samples where the data puts
    it, and Masada's (and Salton's, Galilee's) 0 m line is the data's own; where cleaning changed a
    sample, the cleaned mask blurred by 3 samples. Both have the mask's sign, so the line runs from
    one to the other without a break. Last the field is clipped to ±0.5 m and blurred by 2 samples:
    that rounds what the data leaves on the grid (a constant sea against a cliff) without letting a
    cliff's tall side pull the line out to sea; it stays within about a sample of the crossing.
    Snapped segments (H / V / 45° ± 0.5°, on the poster's smoothed grid), now vs main's raw 0 m line
    vs the intermediate contours: Scheveningen 2% / 5% / –, Chai Wan 4% / 15% / 2%, Hong Kong
    waterfront 2% / 23% / 2%, the 17.8 km run 3% / 12% / 2%, Étretat 3% / 13% / 3%, Masada 3% /
    2% / 2%. What is left are straight runs (sea walls, the grid's edge), not steps; at 1:1 on the
    18 × 24 exports the coast reads as one smooth stroke (`docs/verify/sean-gpx/coast-r3ui/crop-*`).
  - **Scheveningen's coast sits inland of the water.** The beach there stays at 0–1.6 m for about
    300 m, and the line runs where it passes 0.5 m: measured against the data's sustained 0 m
    crossing (8 samples above 0), a median 82 m inland, p90 176 m, max 259 m (row by row, 370
    rows). Sean's Hong Kong waterfront has no such beach: there the line is the quay.
  - The four reference courses never reach 0 m, so they are unchanged. O(n): chamfer distances,
    one flood fill per side and three box blurs.
- **The View gets a fresh canvas per stage.** `pnpm dev` runs React StrictMode, which mounts,
  cleans up and mounts the terrain again on the same DOM; the cleanup's `forceContextLoss` left
  that canvas without a usable context, so every run in dev said "This browser couldn't draw the
  3D terrain" (with `THREE.WebGLRenderer: Cannot read properties of null (reading 'precision')` in
  the console). `TerrainView` now creates its `<canvas role="img">` in the stage effect and removes
  it with the stage; the label is kept in sync by an effect.
- **A tile answered with a web page is "not served", not a decode failure.** The deployed site,
  before the tile proxy is switched on, answers `/tiles/…` with its SPA shell (200, `text/html`);
  the View blamed the browser ("the elevation data arrived, but this browser couldn't read it.
  Reload the page"). A tile response whose `Content-Type` is text, HTML, JSON or XML is now a
  `TileNotServedError` (not retried, not decoded); when every tile fails that way the View says
  "The terrain couldn't load: this site isn't serving elevation data right now. Try again later."
  (Try again kept). Stats, profile and posters B / E behave as for any terrain failure.
- **Titles.** These files have no `<name>`, so the title is the file name, a 13-digit timestamp
  ("1612088536516"). Vert does not invent a title; the poster's title field is where to type one.

## Export

- Exports reuse the preview's height grids (the View's grid, or the figure loader's cache by
  bounds), so a download normally fetches no tiles and draws exactly what the preview shows.
- File names: `vert-<title slug>-<style>-<size>.<ext>`, the style as `trail-sign`, `night-ridge`
  or `survey-quad`, so A, B and E downloads of one run never share a name (the 200-byte cap cuts
  the title, never the style or size). Latin letters lose their accents and the ones
  without a decomposition are transliterated (ł→l, ø→o, đ/ð→d, æ→ae, œ→oe, ß→ss, þ→th, ı→i,
  ŋ→n, ħ→h, ŧ→t, ĸ→k, capitals too); every other script is kept as written, marks included
  (NFC), so Japanese voiced kana and Indic vowel signs survive. Invisible leftovers are dropped:
  marks that follow no letter (a U+0301 after a digit, an emoji's VS16), variation selectors, format
  characters, ZWJ and ZWNJ included even between letters: Chrome saves them as "_", and the
  "Saved <name>" text must match the file written (Persian می‌خواهم → میخواهم; a Devanagari
  conjunct keeps its virama, so it stays whole). Slugs
  stop at 60 code points and the whole name at 200 UTF-8 bytes, both cut at a grapheme boundary
  (`Intl.Segmenter`; without it, never before a mark), so no conjunct is split.
- A canvas size that failed once is tried again on the next Download (the cause may be gone);
  after two failures in a row it fails at once for the rest of the session. A size that works
  clears the failures of every size no larger in both sides and counts as proof they work; a
  failure drops any working size at least as large in both sides. Error messages suggest a
  smaller size only when one exists (not at 4 : 5).
- A size counts as working once its file is encoded, not when its canvas verifies: a canvas that
  verifies but cannot be encoded (`toBlob` gives null, `convertToBlob` rejects, the bytes do not
  fit) is recorded as an output-canvas failure, so the retry rule above applies to it too. A cancel
  records nothing.
- File names also drop every default-ignorable code point (`\p{Default_Ignorable_Code_Point}`):
  the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0 (the last two become U+1160 under NFKD), the
  combining grapheme joiner U+034F and Khmer U+17B4/U+17B5 draw nothing, so "ㅤㅤ" names the file
  `vert-<style>-<size>`, never `vert-ᅠᅠ-…`. Hyphens around a dropped character collapse into one.
  The slug is recomposed (NFC) again after the stripping: a CGJ removed between Hangul jamo left
  ᄒ + ᅡ decomposed (about 1.4% of names were not NFC), now 하.
- **Terrain that fails or never comes.** An export waits at most 20 s (`TERRAIN_TIMEOUT_MS`,
  from Download until the figure is ready; drawing the tiles after that has no limit) for its
  figure's grid. When the grid fails (tiles refused, offline, too large), Night Ridge and Survey
  Quad export as the preview shows them: "THE TERRAIN COULDN’T BE DRAWN." in the figure box. The
  export makes its own attempt through the preview's loader (a failed grid is not cached), so if
  the tiles are back by then it draws the terrain. Trail Sign, whose poster is its terrain, fails
  at once with "The terrain for this poster couldn’t be loaded. Check your connection and try
  again." (or the too-large message). A grid still loading at 20 s (tiles never answered) fails
  every style with "The terrain for this poster is taking too long to load. Check your connection
  and try again."; Cancel works throughout and is never reported as a timeout. Before this an
  export with hanging tiles waited for ever, and B / E refused to export without terrain.
- **No relief, no relief labels.** When the terrain figure could not be drawn, the poster leaves
  out what describes it, in the preview and the file alike: Night Ridge's "ELEVATION ×2.4" (footer
  and accessible name), Trail Sign's "ELEVATION ×1.6" (print footer) and Survey Quad's "CONTOUR
  INTERVAL …", the labels of its "Index contour" and "Intermediate contour" legend rows and the
  credit under the map ("MAPPED FROM GPX + PUBLIC ELEVATION DATA"). Those lines keep their place,
  empty (a no-break space each: same height, nothing to see or read), so the layout does not move:
  the map box keeps its size and the route its place (measured: 0 px apart from the normal poster
  at all four sizes for the sample, Lavaredo, Eiger and the CCC). Survey Quad is a top-down map, so it still draws what needs no terrain, flat on the empty
  quad: the route, ○ start (and ◉ finish for a point-to-point run), and the scale bar, projected
  exactly as the grid it asked for would have placed them (`flatGrid(quadBounds(…))`: same frame,
  same true scale; checked against a real `buildHeightfield` grid), with the printed coordinates
  unchanged. Its legend keeps "Route run" and
  "○ Start · ◉ Finish" (or "Start / finish" for a loop), which stay true; the "couldn’t be drawn"
  note sits low in the map box, haloed in the map's paper, clear of the route. Night Ridge's "couldn’t be drawn" / "Drawing the terrain…" note sits at the bottom
  of its stage, where the ridges rise, instead of centred over the hero number.
- **The preview follows the export.** When Download starts and the preview's figure has failed
  (not "too large"), the preview asks again through the same loader: the B / E figure grids and
  Trail Sign's own grid share the export's build by bounds (free once it is cached), and Trail
  Sign drawn from the View's grid rebuilds the run's terrain (`retryTerrain`, which shares tile
  requests with the export's own build). The export never waits on the preview. So after an export
  that drew the terrain, the preview shows what the file shows ("ELEVATION ×2.4" included).
- **Try again by the preview.** A failed figure (not "too large", and not a renderer without
  WebGL) shows "The terrain couldn’t be drawn." and a quiet Try again (44 px) on the stage, not in
  the figure's note: the poster is one image (`role="img"`, its drawing `aria-hidden`), scaled
  down, and exported as drawn. The preview never changes size for it: the row goes under the
  preview when the stage has the room, else beside the poster's bottom edge (1440 × 900: the poster
  fills the stage's height), and only when neither fits does the preview give up 56 px. Once a
  figure has failed the row stays until it is drawn, saying what the poster's note says: "The
  terrain couldn’t be drawn." with Try again, or "Drawing the terrain…" while it is asked for again
  (Try again, Download, a relayout). Focus never drops to the page: while it is in the row (or went
  with what the row removed) it moves to the note while loading, back to Try again on a failure,
  and when the row goes to Download PNG (or, while an export runs and that is disabled, to the
  export's progress). "Terrain loaded." is read out whenever a failed figure is drawn.
- **No tile waits for ever.** Each tile request (fetch and body) has 15 s (`TILE_TIMEOUT_MS`),
  then is aborted and fails as `TileTimeoutError` (not retried), like an unreachable tile; a grid
  whose tiles all fail rejects, and a failed figure grid is evicted from the loader's cache. So a
  shared figure build the preview started cannot hang the export (it ends at ≈ 15 s, inside the
  export's 20 s limit, and B / E export with the note) and Try again always builds afresh. A tile
  that answers in time is unaffected.
- No WebGL at all is told apart from a draw failure: "This browser can’t draw 3D terrain, so Trail
  Sign posters can’t be exported here. Night Ridge and Survey Quad still work."
- Progress: the engine waits for a paint after every report, so each "Rendering tile k of N" is
  seen, then shows "Saving the file…" while it encodes. The live region says "Exporting <file>."
  and the outcome; only once an export has run 2 s does it also speak at each quarter ("Export
  25% done." … "Rendered N of N tiles."), so a typical sub-second export is two announcements.
  "Saving the file…" is never announced.

## Architecture

- **three.js directly**, no `@react-three/fiber`: one renderer, explicit lifecycle, fewer deps.
  `three` (approved) and `@types/three` (its types) are the only additions. The terrain module is
  lazy-loaded so the Upload state stays light.
- **Hosting**: Cloudflare connected the repo as a Worker with static assets
  (`vert.fum.workers.dev`), not Pages. So the app and the tile proxy ship as **one Worker**: static
  assets from `dist/`, with `/tiles/*` routed to Worker code (`run_worker_first`) and R2 bound as
  `TILES`. Same parts as PLAN.md (static app + tile proxy + R2), one deployable, same origin (no
  CORS, and tile requests never leave the app's origin).
- **Tile zooms**: the Worker accepts z 6–15 (the heightfield drops below z12 only for very long
  routes, then samples one zoom finer; z6–7 covers 100+ km courses). Anything else, and any query
  string, is a 400.
- **Dev tiles**: Vite proxies `/tiles/:z/:x/:y.png` to the public AWS Terrarium bucket in dev only.
- **Zoom floor**: the heightfield never asks for a zoom below 6 (`MIN_SERVED_ZOOM`), and the dev
  proxy serves z6–15 only, so dev fails where production would. A z6 grid wider than 512 samples
  is downsampled; an area that needs more than 16 tiles even at z6 (a flight-like track hundreds of
  kilometres across, a figure grid reaching a pole) fetches nothing, and the View says "This route
  covers too much ground to draw its terrain." instead of "Check your connection", with no "Try
  again" (a retry would fail the same way without a request; network and decode errors keep it).
  Posters B and E keep their stats and print their own "THE TERRAIN COULDN'T BE DRAWN." where the
  figure would be, as for any failed figure grid, and export that way; each figure grid has its own
  bounds, so which of Night Ridge and Survey Quad falls back first depends on the route's shape and
  size. A Trail Sign export says "This route covers too much ground to draw its terrain, so Trail
  Sign posters can’t be made from it."
- **Sample run**: a real trail, the Coosa Backcountry Trail loop (Vogel State Park, Georgia;
  ≈ 21 km, ≈ +1,070 m, matching the canvas). Geometry from OpenStreetMap (ODbL, credited in About),
  elevation from Terrarium, timestamps synthesized from a pace model, labelled SAMPLE DATA in the UI.
- **GPX parsing** runs in a Web Worker with a small hand-written XML tokenizer (no `DOMParser` in
  workers, no XML dependency).
- **Antimeridian**: a run that crosses 180° is unwrapped in the parse worker: every longitude is
  moved by whole turns into the narrowest interval holding them all (middle in −180…180), so the
  track is continuous and `run.bounds` has one edge past ±180 (e.g. 179.98…180.02). Everything
  downstream (heightfield, drape, posters, figure bounds) works in that space; tile columns are
  folded into [0, 2^z) only when fetched, so requests stay `/tiles/z/x/y.png`. Printed
  coordinates are folded back (Survey Quad: "179°59′ W"; exactly 180° prints "180°00′ W"). The
  date line reads the start’s longitude as recorded (`lonForOffset`). Terrarium's own data is
  rough at 180° and Vert draws it as it is: on Taveuni the z11+ tiles just west of the line are
  70–77% zeros (the island shows only at z10 and coarser), and in Chukotka the tiles step ~115 m
  across it.
- **Coordinates at 180°**: the Survey Quad formatter decides the hemisphere after rounding to the
  minute, so anything that rounds to 180°00′ (179.995, exactly 180, −179.996, 180.004) prints
  "180°00′ W", the side ±180 folds to; 179.991 stays "179°59′ E". By the same rule 0°00′ is
  always N or E (a centre at −0.004° printed "0°00′ W").
- **Taveuni at z11+**: the tiles east of 180° are not zero-filled: decoded, they hold real
  bathymetry with no exact zeros (z11 still has pixels up to 59 m), while the tiles just west of
  the line are 70–77% zeros. Either way the island itself is missing at z11 and finer; only z10 and
  coarser show it.
- **Tile decode errors**: tile bodies are read with `arrayBuffer()` (Chromium's `blob()` failed on
  every tile with the disk nearly full). When every tile arrives but none decodes, the View says
  "the elevation data arrived, but this browser couldn't read it. Reload the page and try again."
  instead of "Check your connection".
