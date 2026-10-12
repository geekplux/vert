# terrain

three.js scene: elevation tiles → height grid → custom mesh and shaders, the route on top, camera,
scrub marker. No map library, no basemap.

- Tiles come from the Worker at `/tiles/:z/:x/:y.png` (Terrarium encoding). Requests carry tile
  x/y/z only, never coordinates or GPX data.
- Decoding and tile maths are pure and live in `src/lib`, so they test without WebGL.
