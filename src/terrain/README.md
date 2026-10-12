# terrain

three.js scene: elevation tiles → height grid → custom mesh and shaders, the route on top, camera,
scrub marker. No map library, no basemap.

- `tiles.ts`: `tileUrl`, `fetchTile` (shared `TileLoader`): fetch, decode (`createImageBitmap` +
  canvas, no colour conversion), 64-tile LRU cache, one shared request per tile, one retry on a
  network error, AbortError propagated.
- `heightfield.ts`: `buildHeightfield(bounds)` pads the bbox 15%, picks z12–14 so the area is
  ≤ 512 samples a side at native resolution and ≤ 16 tiles (below z12 only when a long route needs
  it), stitches the tiles into one mosaic, fills failed tiles from neighbours (`failedTiles`) and
  resamples to a regular Web Mercator grid. `elevationAt` drapes the route.
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
  outline revolved around the vertical axis (for framing).
- `stage.ts`: `TerrainStage`, the imperative half of the view: one `WebGLRenderer` (transparent,
  pixel ratio ≤ 2), a perspective camera framed by `frameModel`: the distance fits the revolved
  outline plus the walls' bottom inside a 60 px inset (clear of the legend chip and icon buttons in
  the box's corners) at any azimuth, and a lens shift (`setViewOffset`) centres the model itself.
  The default view is 62° from vertical, 18° east of south. OrbitControls (polar 20°–80°, damping,
  zoom as a factor on the fit, no pan); camera tweens (intro top-down → oblique in 1.2 s, ease-out
  cubic; Flat map; rotate); arrow-key orbit. It renders only while something moves: no frames when
  idle. `dispose` forces the WebGL context loss before disposing the renderer, so remounts never
  pile up live contexts.
- `TerrainView.tsx`: the React wrapper. Canvas is `role="img"` with the page's `aria-label`; the
  wrapper is focusable (arrow keys orbit, Shift for larger steps, + / − zoom; a visually hidden hint
  says so). Reduced motion: no camera move, the canvas fades in. A ref handle exposes `rotateBy`,
  `resetView`, `requestRender` and the stage (scene, camera) for the route layer.
- three.js is ~150 kB gzipped: the page should load `TerrainView` with `lazy(() => import(...))`
  so the Upload state stays light.
- Decoding and tile maths are pure and live in `src/lib`, so they test without WebGL.

**Privacy.** Tiles come from the same origin at `/tiles/{z}/{x}/{y}.png` (the Worker in
production; Vite proxies to the AWS Terrarium bucket in dev and preview). A request carries the tile
z/x/y and nothing else: no query string, no coordinates or GPX data, `credentials: 'omit'`,
`referrerPolicy: 'no-referrer'`. `tileUrl` throws rather than build any other URL, and a test
asserts the fetch mock only ever sees tile URLs.
