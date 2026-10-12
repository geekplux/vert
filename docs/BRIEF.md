# Vert — product brief (English copy of the Claude Doc)

Source doc (Chinese, editable): https://claude.ai/code/artifact/c2c3396c-f92f-4229-bac5-a0e7ab9c03ab

## Positioning

Vert turns one GPX file into a terrain visualization that looks good at a glance on a web page, then makes you want to share it as a poster. The web visualization is the main product: beautiful, with light interaction. The poster is the sharing outlet, in a few styles. Nothing else.

- For: trail runners, hikers and cyclists who have a GPX and want to keep one outing. First user: Sean.
- Not: a training-analysis tool. No accounts, no stored data, no Strava competitor.
- Proves (portfolio): design (poster layout, a style system), WebGL and geodata handling, shipping a product end to end on Cloudflare.
- Tagline candidate: Drop a GPX. Get a poster.

## Core flow: four states of one page

1. **Upload**: drop or choose a .gpx, or "try a sample run". Parsed in the browser; nothing is uploaded.
2. **View and play**: 3D terrain and route appear within seconds with a short intro animation. Interaction is limited to rotate, zoom, and scrubbing the elevation profile to move a dot along the route. Four numbers beside it: distance, vert, moving time, high point. Most polish time goes here.
3. **Share as a poster**: "Make a poster" uses the current camera; switch between a few styles and sizes; edit the title. Preview is the final output; no complex editor.
4. **Export**: download PNG (print or social resolution); PDF for print sizes.

## v1 scope

| In v1 | Not in v1 |
|---|---|
| .gpx upload, one track | .fit / .tcx, merging tracks |
| Parse, render, export in the browser | Accounts, saved history, share links |
| 3D terrain + route + elevation profile | Strava / Garmin sync |
| 3 poster styles, several sizes | Archive view of all runs (direction D) |
| Privacy: hide the first/last stretch of the route | Pace / heart-rate colouring, training analysis |
| Desktop editing; mobile can view and export | Full mobile editing |
| Open source (MIT), English UI | Chinese UI, paid features |

## Posters

Styles: A Trail Sign, B Night Ridge, E Survey Quad. Sizes: 18×24 in (5400×7200), A3 (3508×4961), 4:5 (1080×1350), 9:16 (1080×1920). Editable: title, subtitle, date, signature; which stats show, metric/imperial; style, camera angle, vertical exaggeration 1–3×, terrain crop; hide 0/200/500 m at start and end.

## Architecture (Cloudflare)

Browser: drop GPX → parse + stats (Web Worker) → terrain mesh + route (three.js) → poster layout + style → export PNG/PDF (tiled). Cloudflare: Pages hosts the static site; one Worker proxies elevation tiles; R2 caches them. Source of tiles: AWS Terrain Tiles (public). No D1, no accounts, no user data stored.

## Decisions (approved)

three.js custom terrain (no MapLibre) · no basemap · AWS Terrain Tiles via Worker + R2 · client-side export · Vite + TypeScript + React · styles A, B, E · vert.geekplux.com · name "Vert" (check collisions before publishing).

## v1 acceptance checks

- [ ] Sean exports one poster from each of 10 of his own GPX files; at least 8 he would print.
- [ ] A 20 km GPX goes from drop to 3D view in ≤ 5 s (desktop Chrome).
- [ ] The 18×24 poster exports on desktop without crashing.
- [ ] The GPX never leaves the browser (verifiable in the network panel).
- [ ] Information is never carried by color alone; the UI is keyboard operable.
