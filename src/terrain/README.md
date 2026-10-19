# terrain

three.js scene: elevation tiles → height grid → custom mesh and shaders, the route on top, camera,
scrub marker. No map library, no basemap.

**Grid space.** Drawing never sees a latitude or longitude. The mesh, the route, the markers and the
stage take a `TerrainGrid` (grid.ts: `width`, `height`, `elevations`, `min`, `max`,
`metresPerSample`, `zoom`) and a `GridTrack` (`col` / `row`, fractional sample coordinates: column
0 the west edge, row 0 the north edge; `cumulative` metres; `ele` or null; `loop`, decided once
outside grid space by the legend's rule, `isLoop` in lib/loop.ts). A `Heightfield` is a
`TerrainGrid` plus the `bounds` it was sampled over and its `failedTiles`. The one conversion is
`gridTrackFromRun(heightfield, track)` (gridTrack.ts), which `TerrainView` calls once per
heightfield and track (memoised, so the route is still built once) and the poster A figure calls
the same way; a baked scene for the library already carries its route in grid-local metres, so it
is only divided by the grid's spacing (`sceneToGrid`, sceneGrid.ts; DECISIONS.md "Library for
Activities"). A grid track belongs to the grid it was made for: a new grid brings a new one
(`show(grid, { track })`).

**The scene path** (docs/SCENE.md, src/vert-lib). `TerrainView` takes either `heightfield` +
`track` (the page) or `scene` (a decoded `.scene`), never both (a discriminated union of props).
`sceneToGrid(scene)` gives the grid (the scene's elevations, min, max, spacing and zoom, same
arrays) and a grid track: column = x / spacing x, row = y / spacing y; `cumulative` the scene's
distances, which count from the run's real start, so a trimmed route starts past 0 and `scrub` is
in the same metres; `ele` its elevations; `loop` when it has no finish marker; and `markers`, the
scene's stored markers as grid positions. The bake placed those on the original track (the summit
on its highest recorded point), not on the resampled route, so `routeMarkerIndices` on the scene's
route could move the summit by a step: a track that brings `markers` is drawn with them exactly
(`markerPositions` in markers.ts). Route and markers are draped on the grid as in the View
(DECISIONS.md "Scene terrain is softer, accepted"). The conversion is memoised per scene object
(a `WeakMap`), so the route is built once per scene. Nothing on this path reads a latitude or
longitude: `SceneTerrainView` (behind the library's `TerrainView`) imports neither gridTrack.ts,
heightfield.ts, tiles.ts nor lib/geo.ts (src/vert-lib/entry.test.ts walks its imports, and
bundle.test.ts greps the built bundle).

- `tiles.ts`: `tileUrl`, `fetchTile` (shared `TileLoader`): fetch, decode (body read with
  `arrayBuffer()`, never `blob()`, which fails on a nearly full disk; `createImageBitmap` +
  canvas, no colour conversion), 64-tile LRU cache, one shared request per tile, one retry on a
  network error, AbortError propagated. A tile that arrives but will not decode is a
  `TileDecodeError` (not retried); when every tile fails that way, `HeightfieldError.kind` is
  `'decode'` and the View says the data arrived but could not be read, not "check your connection".
  A response with a text / HTML / JSON / XML `Content-Type` (a site answering `/tiles/…` with its
  page) is a `TileNotServedError`, never decoded; all tiles so: `kind: 'unserved'`.
- `heightfield.ts`: `buildHeightfield(bounds)` pads the bbox 15%, picks z12–14 so the area is
  ≤ 512 samples a side at native resolution and ≤ 16 tiles (below z12 only when a long route needs
  it; a long route then samples one zoom finer, ≤ 32 tiles, and downsamples to 512; never below
  z6, the Worker's lowest, and an area that needs more than 16 tiles even at z6 fetches nothing and
  throws `HeightfieldTooLargeError`), stitches the tiles into one mosaic, fills failed tiles from neighbours (`failedTiles`),
  replaces spikes (Terrarium's coastal seam artefacts: pixels that most of their 5 × 5
  neighbourhood clears by > max(100 m, 5 px), `removeSpikes` in lib/terrarium) and resamples to a
  regular Web Mercator grid. `gridPosition` / `elevationAt` place a lon/lat on it (the page's
  terrain-filled elevations; gridTrack.ts for the route). Across the antimeridian the bounds run
  past ±180 (lib/geo), the mosaic's columns stay contiguous and each tile is fetched as `wrapTile(tile)`, so requests keep
  x in [0, 2^z). Latitudes are clamped to ±85 (inside the Mercator square), a minimum span apart.
  The grid is sampled bilinearly (the default, the app's grids); `sampling: 'smooth'` samples it
  with a Gaussian low-pass instead (lib/smoothSample.ts), which leaves no trace of the tiles' pixel
  pitch: Vert scenes require it (docs/SCENE.md, "No latitude from the grid").
- `grid.ts` (no three.js, no lat/lon): `TerrainGrid`, `GridTrack`, `gridElevation` (bilinear, the
  maths `elevationAt` uses, so values match bit for bit), `gridDistance` (metres between grid
  positions, at the grid's spacing: exact only at the grid's centre latitude, so never used to
  decide a loop), `groundExtent` (the grid's longer side in metres).
- `gridTrack.ts`: `gridTrackFromRun`, the drawing path's only reader of `lat` / `lon`: each point
  exactly where `gridPosition` puts it, `cumulative` and `ele` passed through (same arrays), and
  `loop` from `isLoop` (lib/loop.ts), the function the View's legend and the terrain's accessible
  name use, so the ○ / ◉ markers and the words always agree.
- `routeRules.ts` (no three.js): `ROUTE_STEP_M`, `MAX_ROUTE_POINTS` and `routeMarkerIndices`,
  shared by the renderer and the scene bake; `route.ts` and `markers.ts` re-export them.
- `mesh.ts`: `createTerrainMesh(grid, options)` builds the grid (`width × height` vertices,
  plus a skirt) in a local frame: x east, y up, z south, origin at the grid
  centre and lowest point, 1 unit = the longer horizontal side, true metres vertically. The style A
  `ShaderMaterial` draws a flat-shaded fill and 1px ink ridge lines on every Nth grid row (~48
  across, `fwidth` for constant pixel width and anti-aliasing), darker and thicker towards the
  camera on the top surface only; walls are a touch darker (`wallShade`, blended towards ink) with
  their top and bottom edges outlined at a constant, light strength, and no row lines. The skirt's flat base hangs a small fixed
  depth (`DEFAULT_BASE_DEPTH`) below the lowest point of the edges facing the camera
  (`visibleEdgeLevel`, updated per frame); where a more oblique wall's edge dips lower, its bottom
  follows the edge. Exaggeration is the `uExaggeration` uniform; colours come from a
  `TerrainPalette` (`readPalette` reads `--surface` / `--ink` from the style it is given, and falls back to style A's values
  for any token a host page lacks or leaves blank). `gridToLocal` places a grid position on the
  mesh (for the route and markers); `modelBounds` gives the extents; `radialHull` the surface's
  outline revolved around the vertical axis (for the zoom limits) and `surfaceEnvelope` a coarse
  envelope of the surface that never dips below it (for framing).
- `stage.ts`: `TerrainStage`, the imperative half of the view: one `WebGLRenderer` (transparent,
  pixel ratio ≤ 2), a perspective camera framed by `frameModel`: the distance fits the model as
  the current azimuth sees it (convex hull of the surface envelope plus the walls' bottom) inside
  a 16 px inset (in the View at most 4% of the box's short side, `viewInset`: 11 px on a phone) and 12 px clear of the overlays on the box (`setOverlays`: legend chip, icon
  buttons, as rectangles); a lens shift (`setViewOffset`) centres the model itself, and moves it
  away from an overlay (along a fixed direction per overlay, so it never jumps) before the camera
  backs off. At each polar angle the distance stays in a zoom band: no farther than the farthest
  any azimuth needs (sampled every 5°, computed per 3° of polar angle and interpolated), no closer
  than that ÷ 1.13, so turning changes the distance by under 1.15× (the flat map has no band, and
  tweens blend between their ends' bands). A camera tween
  first drops OrbitControls' leftover damping, so Flat map is exactly north-up after a drag.
  The default view is 62° from vertical (50° for a long route, terrain ≥ 15 km across:
  `defaultPolarFor`), 18° east of south. Flat map off returns to the pose Flat map was turned on
  from. OrbitControls (polar 20°–80°, damping,
  zoom as a factor on the fit, no pan); camera tweens (intro top-down → oblique in 1.2 s, ease-out
  cubic; Flat map; rotate); arrow-key orbit. It renders only while something moves: no frames when
  idle. `dispose` forces the WebGL context loss before disposing the renderer, so remounts never
  pile up live contexts.
- `route.ts`: `createRouteLayer(grid, gridTrack, { palette, exaggeration, lift = 2 })`. The
  track is resampled evenly by distance from its first point to its last (`cumulative[0]`, which
  is past 0 for a trimmed track: the poster's hide-ends, a scene; ≤ 10 m apart, ≤ 4,000 points,
  interpolating columns and rows) and draped: y is the terrain's own elevation (`gridElevation`,
  not the GPX's) plus 2 m.
  Two `Line2`s share one `LineGeometry`: a 9 px `--white` halo under a 4 px `--route` core, CSS-px widths
  (`worldUnits: false`). Positions are stored at exaggeration 1 and the patched vertex shader
  scales y by a shared `uExaggeration`, so the slider never rebuilds. **Visibility:** ridges in
  front of the route hide it, decided per route point, not per fragment: the stage renders the
  terrain's depth into a texture first, then `visibility.ts` runs a few tiny GPU passes (one texel
  per point, no readback): each point is hidden if terrain is more than 16 px worth of depth in
  front of it, then hidden gaps under 3 px are filled and shown runs under 4 px dropped, by screen
  distance along the route. The line draws with no depth test: a segment between shown points
  whole, between hidden points not at all, a mixed one up to its middle (the core 2.5 px shorter,
  so the halo closes around it). Halo and core read the same verdicts, so side-on slopes never
  thin the halo, crests leave no slivers, and the core never shows without its halo. Hidden
  stretches are not dropped: a third line (2 px, no halo, the route colour 15% towards the ink at
  85% opacity: ≥ 3:1 on the terrain fill) takes the opposite verdicts, drawn before the halo and each pixel once (a constant `gl_FragDepth`, depth
  test `less`), so a route behind a ridge still reads as one line, told apart by width and the
  missing halo. Widths scale with `setLineScale` (poster figures).
  `pointAtDistance` (binary search) maps metres along the track to a grid position.
  `readRoutePalette` reads `--route`, `--white`, `--ink`, each falling back to the app's value.
- `markers.ts`: screen-size sprites (`sizeAttenuation: false`, no depth test, drawn after the
  route) from small canvas textures, shapes as the 2D `Marker`: ○ start (white fill, 3 px ink
  ring, 22 px), ▲ summit (ink, 28 × 24 px, 2.5 px white edge; centroid on the highest point of
  the track's elevations, else the terrain's; none when it stands under 10 m above the lowest
  point, `hasSummit`), ● scrub (route fill, 3 px white ring, 14 px, plus
  a 1 px ink hairline so the ring reads over the white halo). Sizes follow the canvas's terrain
  figure. A loop (`track.loop`: the route ends within 50 m of its start, by great-circle distance,
  decided by `isLoop` before the track reaches the markers) gets one ○; otherwise the finish
  is a ◉ (the start circle with an ink dot), never a second ○. A track that brings its own
  `markers` (a scene's stored ones) is drawn with exactly those (`markerPositions`); the layer's
  `indices` are then null. `setScrub(d)` moves the scrub
  marker without rebuilding. Textures are painted at 4× their CSS size; a poster figure drawn at a
  larger scale repaints them at `markerTextureScale(scale)` (the 18 × 24 export: 8×) so a sprite
  is never magnified (`setTextureScale`, called by `renderFigure`). Before each frame `updateOcclusion` marches a ray from each marker
  to the eye over the height grid and fades markers behind a ridge to 35% opacity.
- The stage builds both layers once it has a heightfield and a track (`setTrack`, `setScrub`,
  `setRoutePalette`); `setOverlays` keeps the model 12 px clear of rectangles on the box, and
  `setInsets` reserves whole bands: each side keeps max(16 px rule, inset + 12 px), and the model
  is centred in what is left. Exports ignore the overlays. Every render goes
  through `renderNow()`, which refits first (OrbitControls' own methods move the camera and call
  `update()` before the stage follows; key handling also refits at once). The fit includes the
  markers' drawn boxes (○ 22 px, ▲ 28 × 24 with its edge) and the scrub marker's 16 px box along
  the route, so overlays keep their full gap. `renderToCanvas(w, h)` renders the current view
  (mid-tween or mid-damping as it is) framed for a `w × h` image into a 2D canvas, the start of
  the poster export: it never steps the controls, and puts the camera, controls and fit back
  exactly, so exports in a row match and the visible view does not move.
- `camera.ts` (no three.js): the camera angle constants and `ViewCamera` (azimuth, polar, zoom
  factor, flat / oblique), the pose "Make a poster" hands to Poster mode. `stage.viewCamera()`
  reads it (a running Rotate / Flat map move counts as finished; the flat view is top-down, north
  up).
- Figures: `new TerrainStage(canvas, { interactive: false })` has no pointer handling, no render
  loop and no zoom band; `renderFigure(camera, { width, height, scale, tile })` draws `camera` for
  a `width × height` output px figure, framed in logical px (`width / scale`), line widths and
  markers × `scale`, synchronously into its canvas sized to `tile` (the camera's view offset is
  `figureViewOffset`: the lens shift moved by the tile's corner). Used by `src/poster/terrainFigure.ts`.
- `GridTerrainView.tsx`: the React wrapper, fed a `TerrainGrid` and a `GridTrack`. Each stage
  gets a canvas of its own, created in the stage effect and removed with it (a disposed stage
  loses its context for good; StrictMode remounts on the same DOM). Canvas is `role="img"` with
  the page's `aria-label`; the wrapper is focusable (arrow keys orbit, Shift for larger steps, the
  plus and minus keys zoom; a visually hidden hint says so). Reduced motion: no camera move, the
  canvas fades in. `scrub` (metres, on the track's scale), `overlays`, `insets` and
  `routePalette` drive the route layer. Colours come from `--surface` / `--ink` and `--route` /
  `--white` / `--ink` as they reach the view's own container (`getComputedStyle(container)`, at
  mount): in the app the tokens sit on `:root`, so nothing changes, and a host can set Vert's
  tokens on a wrapper around the view, as the profile's CSS reads them (src/vert-lib/README.md).
  `palette` and `routePalette` win over the tokens. A ref handle exposes `rotateBy`, `resetView`,
  `requestRender`, `focus`, `camera()` and the stage.
- `TerrainView.tsx`: what the page renders: `heightfield` + `track` (put on the grid with
  `gridTrackFromRun`) or `scene` (`sceneToGrid`), memoised, drawn by `GridTerrainView`.
  `SceneTerrainView.tsx`: the scene half alone, which the library's `TerrainView`
  (src/vert-lib/TerrainView.tsx) wraps with its own standalone props and a handle without the
  stage.
- `attribution.ts`: `TERRAIN_ATTRIBUTION`, the elevation credit the About dialog shows (and the
  library exports), and `TERRAIN_ATTRIBUTION_LINK` with Mapzen's list of sources.
- three.js is ~150 kB gzipped: the page loads `TerrainView` with `React.lazy` (`src/page/terrainChunk.ts`)
  so the Upload state stays light.
- Decoding and tile maths are pure and live in `src/lib`, so they test without WebGL.

**Privacy.** Tiles come from the same origin at `/tiles/{z}/{x}/{y}.png` (the Worker in
production; Vite proxies to the AWS Terrarium bucket in dev and preview). A request carries the tile
z/x/y and nothing else: no query string, no coordinates or GPX data, `credentials: 'omit'`,
`referrerPolicy: 'no-referrer'`. `tileUrl` throws rather than build any other URL, and a test
asserts the fetch mock only ever sees tile URLs.
