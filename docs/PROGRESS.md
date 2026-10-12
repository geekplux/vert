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

## 2 Layout

## 3 Features
