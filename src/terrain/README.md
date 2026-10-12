# terrain

three.js scene: elevation tiles → height grid → custom mesh and shaders, the route on top, camera,
scrub marker. No map library, no basemap.

- `tiles.ts`: `tileUrl`, `fetchTile` (shared `TileLoader`): fetch, decode (`createImageBitmap` +
  canvas, no colour conversion), 64-tile LRU cache, one shared request per tile, one retry on a
  network error, AbortError propagated.
- `heightfield.ts`: `buildHeightfield(bounds)` pads the bbox 15%, picks z12–14 so the area is
  ≤ 512 samples a side at native resolution and ≤ 16 tiles (below z12 only when a long route needs
  it; a long route then samples one zoom finer, ≤ 32 tiles, and downsamples to 512), stitches the tiles into one mosaic, fills failed tiles from neighbours (`failedTiles`) and
  resamples to a regular Web Mercator grid. `elevationAt` drapes the route; `groundExtent` is the
  grid's longer side in metres.
- `mesh.ts`: `createTerrainMesh(heightfield, options)` builds the grid (`width × height` vertices,
  plus a skirt) in a local frame: x east, y up, z south, origin at the grid
  centre and lowest point, 1 unit = the longer horizontal side, true metres vertically. The style A
  `ShaderMaterial` draws a flat-shaded fill and 1px ink ridge lines on every Nth grid row (~48
  across, `fwidth` for constant pixel width and anti-aliasing), darker and thicker towards the
  camera on the top surface; walls are a touch darker (`wallShade`, blended towards ink) and carry
  the rows' ends as lines of constant, light strength. The skirt's flat base hangs a small fixed
  depth (`DEFAULT_BASE_DEPTH`) below the lowest point of the edges facing the camera
  (`visibleEdgeLevel`, updated per frame); where a more oblique wall's edge dips lower, its bottom
  follows the edge. Exaggeration is the `uExaggeration` uniform; colours come from a
  `TerrainPalette` (`readPalette` reads `--surface` / `--ink`). `heightfieldToLocal` places a
  lon/lat on the mesh (for the route); `modelBounds` gives the extents; `radialHull` the surface's
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
- `route.ts`: `createRouteLayer(heightfield, track, { palette, exaggeration, lift = 2 })`. The
  track is resampled evenly by distance (≤ 10 m apart, ≤ 4,000 points) and draped: y is the
  terrain's own elevation (`elevationAt`, not the GPX's) plus 2 m. Two `Line2`s share one
  `LineGeometry`: a 9 px `--white` halo under a 4 px `--route` core, CSS-px widths
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
  `pointAtDistance` (binary search) maps metres along the track to lon/lat.
- `markers.ts`: screen-size sprites (`sizeAttenuation: false`, no depth test, drawn after the
  route) from small canvas textures, shapes as the 2D `Marker`: ○ start (white fill, 3 px ink
  ring, 22 px), ▲ summit (ink, 28 × 24 px, 2.5 px white edge; centroid on the highest point of
  the track's elevations, else the terrain's), ● scrub (route fill, 3 px white ring, 14 px, plus
  a 1 px ink hairline so the ring reads over the white halo). Sizes follow the canvas's terrain
  figure. A route ending within 50 m of its start is a loop and gets one ○; otherwise the finish
  is a ◉ (the start circle with an ink dot), never a second ○. `setScrub(d)` moves the scrub
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
- `TerrainView.tsx`: the React wrapper. Canvas is `role="img"` with the page's `aria-label`; the
  wrapper is focusable (arrow keys orbit, Shift for larger steps, + / − zoom; a visually hidden hint
  says so). Reduced motion: no camera move, the canvas fades in. Props `track`, `scrub`
  (metres), `overlays`, `insets` and `routePalette` drive the route layer. A ref handle exposes
  `rotateBy`, `resetView`, `requestRender`, `focus`, `camera()` and the stage.
- three.js is ~150 kB gzipped: the page loads `TerrainView` with `React.lazy` (`src/page/terrainChunk.ts`)
  so the Upload state stays light.
- Decoding and tile maths are pure and live in `src/lib`, so they test without WebGL.

**Privacy.** Tiles come from the same origin at `/tiles/{z}/{x}/{y}.png` (the Worker in
production; Vite proxies to the AWS Terrarium bucket in dev and preview). A request carries the tile
z/x/y and nothing else: no query string, no coordinates or GPX data, `credentials: 'omit'`,
`referrerPolicy: 'no-referrer'`. `tileUrl` throws rather than build any other URL, and a test
asserts the fetch mock only ever sees tile URLs.
