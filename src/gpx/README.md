# gpx

GPX file → a typed track (lat, lon, ele, time) and its stats (distance, vert, moving time, high
point, climbs).

- Runs in a Web Worker. `DOMParser` does not exist in worker scope, so parse the XML without it.
- Pure functions plus a thin worker entry. No React, no network: the file never leaves the browser.
