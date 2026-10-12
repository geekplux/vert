# Vert — progress

Phases from `docs/PLAN.md`. The main agent of each phase keeps this file current: tick a box only
when its "done when" is verified, and add the task list for the phase under its heading.

| Done | Phase        | Builds                                                                                                                                                        | Done when                                                                                |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [ ]  | 0 Setup      | Repo, tooling, CLAUDE.md, design tokens as CSS variables, Worker skeleton                                                                                     | `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm build` all pass on an empty app              |
| [ ]  | 1 Components | Every UI piece in isolation with stories and tests: buttons, stat tile, dropzone, elevation profile, style picker, size picker, text fields, sliders, markers | Each component renders in Ladle, matches DESIGN-SPEC, passes a11y checks, has unit tests |
| [ ]  | 2 Layout     | The one page in its four states (Upload, View, Poster mode, Exporting) with placeholder data and a placeholder terrain box                                    | Screenshots match the canvas frames at 1440 and 390 widths; keyboard navigation works    |
| [ ]  | 3 Features   | GPX parsing, elevation fetch, terrain mesh, route, scrub, poster rendering in 3 styles, tiled export, Worker + R2                                             | The five v1 acceptance checks in the brief pass with Sean's real GPX files               |

Phase 3 order: parser → terrain → route and scrub → poster style A → export → styles B and E →
Worker deploy.

## 0 Setup

## 1 Components

One component per task, simplest first. Each: implementation sub-agent (own worktree) →
verification sub-agent → merge on PASS. Max three rounds.

| Done | Component        | Rounds | Notes                                                                                                                                                     |
| ---- | ---------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x]  | Button           | 1      | Four variants, md/lg, link form; widths identical to the canvas buttons; keyboard verified in Chromium.                                                   |
| [x]  | Wordmark         | 1      | Name 30/800/62%, optional mono tagline; matches the Upload header pixel-for-pixel.                                                                        |
| [x]  | StatTile         | 2      | Label/value/unit in dl semantics with StatGrid; emphasised unit uses --route-text; 0px from the Main frame.                                               |
| [x]  | Segmented        | 2      | Native radios in a radiogroup; 40px drawn, 44x44 hit area per segment; NoInfer value typing; 0.4px from the canvas.                                       |
| [x]  | Checkbox         | 1      | Native checkbox in a 44px label row; within 0px of the PosterMode stats row; keyboard verified.                                                           |
| [x]  | TextField        | 2      | Label above a 44px input with a --rule-strong (3:1) border; counter from 80% that reads 'N / M characters' to AT; 0px from the canvas.                    |
| [ ]  | Slider           |        |                                                                                                                                                           |
| [x]  | Marker           | 1      | Start ring, summit triangle, scrub dot; MarkerShape for embedding; 0px from the Tokens legend; distinct in greyscale.                                     |
| [ ]  | SizePicker       |        |                                                                                                                                                           |
| [x]  | StylePicker      | 1      | Native radios; 3:4 swatches with a per-style terrain sketch so styles differ by shape, not just colour; within 1.3px of the canvas.                       |
| [x]  | Dropzone         | 1      | Drop or choose a .gpx (extension-validated, 20 MB cap), sample button, dashed-to-solid drag state, alert errors, busy; within 0.03px of the Upload frame. |
| [ ]  | ElevationProfile |        |                                                                                                                                                           |

## 2 Layout

## 3 Features
