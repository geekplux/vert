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
- Decoding and tile maths are pure and live in `src/lib`, so they test without WebGL.

**Privacy.** Tiles come from the same origin at `/tiles/{z}/{x}/{y}.png` (the Worker in
production; Vite proxies to the AWS Terrarium bucket in dev and preview). A request carries the tile
z/x/y and nothing else: no query string, no coordinates or GPX data, `credentials: 'omit'`,
`referrerPolicy: 'no-referrer'`. `tileUrl` throws rather than build any other URL, and a test
asserts the fetch mock only ever sees tile URLs.
