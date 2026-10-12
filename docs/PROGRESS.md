# Vert — progress

Phases from `docs/PLAN.md`. The main agent of each phase keeps this file current: tick a box only
when its "done when" is verified, and add the task list for the phase under its heading.

| Done | Phase        | Builds                                                                                                                                                        | Done when                                                                                |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [x]  | 0 Setup      | Repo, tooling, CLAUDE.md, design tokens as CSS variables, Worker skeleton                                                                                     | `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm build` all pass on an empty app              |
| [x]  | 1 Components | Every UI piece in isolation with stories and tests: buttons, stat tile, dropzone, elevation profile, style picker, size picker, text fields, sliders, markers | Each component renders in Ladle, matches DESIGN-SPEC, passes a11y checks, has unit tests |
| [ ]  | 2 Layout     | The one page in its four states (Upload, View, Poster mode, Exporting) with placeholder data and a placeholder terrain box                                    | Screenshots match the canvas frames at 1440 and 390 widths; keyboard navigation works    |
| [ ]  | 3 Features   | GPX parsing, elevation fetch, terrain mesh, route, scrub, poster rendering in 3 styles, tiled export, Worker + R2                                             | The five v1 acceptance checks in the brief pass with Sean's real GPX files               |

Phase 3 order: parser → terrain → route and scrub → poster style A → export → styles B and E →
Worker deploy.

## 0 Setup

## 1 Components

One component per task, simplest first. Each: implementation sub-agent (own worktree) →
verification sub-agent → merge on PASS. Max three rounds.

| Done | Component        | Rounds | Notes                                                                                                                                                                 |
| ---- | ---------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x]  | Button           | 1      | Four variants, md/lg, link form; widths identical to the canvas buttons; keyboard verified in Chromium.                                                               |
| [x]  | Wordmark         | 1      | Name 30/800/62%, optional mono tagline; matches the Upload header pixel-for-pixel.                                                                                    |
| [x]  | StatTile         | 2      | Label/value/unit in dl semantics with StatGrid; emphasised unit uses --route-text; 0px from the Main frame.                                                           |
| [x]  | Segmented        | 2      | Native radios in a radiogroup; 40px drawn, 44x44 hit area per segment; NoInfer value typing; 0.4px from the canvas.                                                   |
| [x]  | Checkbox         | 1      | Native checkbox in a 44px label row; within 0px of the PosterMode stats row; keyboard verified.                                                                       |
| [x]  | TextField        | 2      | Label above a 44px input with a --rule-strong (3:1) border; counter from 80% that reads 'N / M characters' to AT; 0px from the canvas.                                |
| [x]  | Slider           | 3      | Native range with a styled 3:1 track and ink thumb, live formatted value + aria-valuetext, 44px hit area; within 1px of the canvas vertically.                        |
| [x]  | Marker           | 1      | Start ring, summit triangle, scrub dot; MarkerShape for embedding; 0px from the Tokens legend; distinct in greyscale.                                                 |
| [x]  | SizePicker       | 2      | 2x2 native-radio cards copying the canvas line boxes (0px off); POSTER_SIZES data; names read 'A3, print · 3508 × 4961'.                                              |
| [x]  | StylePicker      | 1      | Native radios; 3:4 swatches with a per-style terrain sketch so styles differ by shape, not just colour; within 1.3px of the canvas.                                   |
| [x]  | Dropzone         | 1      | Drop or choose a .gpx (extension-validated, 20 MB cap), sample button, dashed-to-solid drag state, alert errors, busy; within 0.03px of the Upload frame.             |
| [x]  | ElevationProfile | 1      | Scrubbable SVG profile as an ARIA slider (keys, pointer, touch), numbered climb bands, ticks by distance; within 1px of the canvas; no path rebuilds while scrubbing. |

## 2 Layout

| Done | Task                                                | Rounds | Notes                                                                                                                                                    |
| ---- | --------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x]  | a. State machine, sample run, `useRun`/`useTerrain` | 1      | Reducer for 4 screens + prefs; 180-case probe vs an oracle; typed per-screen dispatch.                                                                   |
| [x]  | b. AppHeader and responsive page shell              | 2      | Header pixel-identical to the canvas in all 3 states; aside 300/380; stacks under main < 900; no h-scroll at 390.                                        |
| [x]  | c. UploadState                                      | 2      | 0px from the Upload frame at 1440; About dialog with focus return; Page composition; axe clean incl. region.                                             |
| [x]  | d. ViewState                                        | 1      | Aside (date, h1, stats, climbs, slider), terrain box + legend + Rotate/Flat, profile with readout; within 1–2px of the Main frame; focus to h1 on entry. |
| [x]  | e. PosterState with live poster preview             | 1      | Aside (style, size, text, stats, hide-ends, sticky downloads) within 0.7 px of the canvas; live 600×800 preview; focus rules.                            |
| [ ]  | f. ExportingState overlay                           |        |                                                                                                                                                          |
| [ ]  | g. Playwright e2e: all four states by keyboard      |        |                                                                                                                                                          |

## 3 Features

Started early where a module has no UI dependency (sample data, `src/lib`, parser, tile data).

| Done | Task                                                             | Rounds | Notes                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x]  | Sample run (Coosa Backcountry, OSM + Terrarium, synthetic times) | 1      | 21.48 km, +1,092 m, 5,623 points.                                                                                                                                           |
| [x]  | `src/lib`: geo, tile maths, Terrarium decoding, formatting       | 1      | Verified against Vincenty and the OSM tile formulas.                                                                                                                        |
| [x]  | 0. Course fixtures (UTMB courses, git-ignored)                   | 1      | Lavaredo 20K, Eiger E51, CCC; terms forbid reproduction, so `pnpm fixtures` downloads them locally. The committed shareable sample is the Coosa run (ODbL).                 |
| [x]  | 1a. GPX parser (worker-safe tokenizer)                           | 4      | Rounds: quadratic entities → prototype-key entities → unconsumed duplicate metadata (4th round authorized by the main agent). 30k-doc fuzz clean; 20 MB in ~140 ms.         |
| [x]  | 1b. Stats + Web Worker + real loader                             | 2      | Matches an independent implementation to 0.000%; courses within 2% (distance) / 1.5% (D+) of UTMB profile figures; 18 MB parses in 128 ms off the main thread.              |
| [x]  | 2. Terrarium tiles → heightfield                                 | 1      | Exact decode in Chromium vs Node; sample: z13, 278×430, mean error 0.86 m vs GPX; 273 ms cold.                                                                              |
| [ ]  | 3. Terrain mesh + TerrainView (three.js)                         | 2      | 3a merged: ridge-row shader, every-azimuth framing (≥ 60 px at 1440), 60 fps, 0 idle renders, contexts released. 3b (route, markers, insets, page wiring) next.             |
| [ ]  | 4. Scrub: profile ↔ route marker                                 |        |                                                                                                                                                                             |
| [ ]  | 5. Poster layout + style A                                       |        |                                                                                                                                                                             |
| [ ]  | 6. Tiled export (PNG, PDF)                                       |        |                                                                                                                                                                             |
| [ ]  | 7. Styles B and E                                                |        |                                                                                                                                                                             |
| [ ]  | 8. Worker tile proxy + R2, deploy                                | 1      | Proxy implemented and verified locally (edge → R2 → upstream, byte-identical, header-clean). One-Worker deploy config ready in `wrangler.deploy.jsonc`; activation pending. |
