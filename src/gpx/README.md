# gpx

GPX file → a typed track (lat, lon, ele, time) → run statistics → the page's `Run`.

- Runs in a Web Worker. `DOMParser` does not exist in worker scope, so parse the XML without it.
- Pure functions plus a thin worker entry. No React, no network: the file never leaves the browser.

Files:

- `xml.ts`: a single-pass pull tokenizer (tags, attributes, text, CDATA, entities; skips comments,
  processing instructions, DOCTYPE). Linear time on any input, hostile or not. Knows nothing
  about GPX.
- `parse.ts`: `parseGpx(text, { maxPoints? })` → `ParsedGpx`, a recursive-descent reader over the
  tokenizer. First `<trk>` with a valid point (all its segments), else the first such `<rte>`;
  waypoints and extensions skipped. `lat`/`lon` must be plain decimals (`xsd:decimal`); `<ele>`
  may also carry an exponent. A repeated name, type, time or `<ele>` keeps its first usable value;
  the file's name and time are one field across `<metadata>` and the top level (GPX 1.0), first
  in document order wins. Every element is consumed whichever branch reads it.
- `types.ts`: `TrackPoint`, `ParsedGpx`, and `GpxError` with a `code` (`not-gpx`, `no-points`,
  `malformed`, `too-large`) and a message written for the UI.
- `stats.ts`: `computeStats(points)` → distance (haversine), moving time (steps over 30 s and
  standing still excluded), ascent/descent (gaps filled, 3-point median, 2 m hysteresis), high and
  low point, climbs (≥ 50 m at ≥ 4%, small dips merged, at most 8, one `steepest`), a 500-point
  profile; `<ele>` that is constant, or within 0.5 m over ≥ 1 km, counts as none; `timeAtDistance` and `paceAt` for the scrub readout. The rules are in its header.
- `terrainElevation.ts`: elevations for a run without usable `<ele>` (or with long gaps), sampled
  from the terrain grid along the track and averaged over ±50 m of route (`smoothByDistance`);
  `withInterpolatedGaps` when the terrain fails.
- `trim.ts`: `trimEnds(points, cumulative, metres)` and `trimTrack(track, metres)` for "hide start
  and end" (the drawn line only, never the stats).
- `handler.ts`: the worker's message protocol (`ParseRequest`, `ParseResponse`) and
  `handleMessage` (decode UTF-8/UTF-16/Latin-1, parse, compute, build the run; never throws),
  testable without a Worker. `worker.ts` is the thin worker entry around it.
- `client.ts`: `parseInWorker(input, signal)`: one reused module worker, 20 MB limit, abort,
  20 s timeout. `loadRun.ts`: `realLoadRun`, the app's `LoadRun` (a user file is read locally;
  only the sample is fetched, from the app's origin).
