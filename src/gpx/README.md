# gpx

GPX file → a typed track (lat, lon, ele, time). Stats (distance, vert, moving time, high point,
climbs) are computed from it in a later task; nothing here computes them yet.

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
