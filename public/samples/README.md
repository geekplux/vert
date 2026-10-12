# Sample run

`coosa-backcountry.gpx` is the app's sample run: the Coosa Backcountry Trail loop from the Vogel
State Park trailhead (Georgia, USA), about 21.5 km and +1,090 m, written as GPX 1.1 the way a GPS
watch records a trail run (a point every 2 s, small horizontal noise, two short stops).

It is real terrain with synthetic timing:

- **Route geometry**: © OpenStreetMap contributors, licensed under the
  [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). Fetched from the
  Overpass API and stitched into one loop.
- **Elevation**: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium
  encoding, Mapzen terrain from various sources), sampled at zoom 14 and lightly smoothed.
- **Times**: synthetic sample data from a grade-dependent trail-running pace model, starting
  Saturday 2026-10-03 at 07:10 America/New_York. Not anyone's actual run.

## Regenerate

```sh
pnpm sample
```

This runs `scripts/make-sample.mjs` (Node 22, no dependencies). Network responses are cached in
`scripts/.cache/` (gitignored), so reruns are offline and produce the same file byte for byte.
Delete that folder to refetch current OpenStreetMap data and tiles.
