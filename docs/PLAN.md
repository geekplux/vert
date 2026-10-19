# Vert — build plan

Vert turns one GPX file into a terrain visualization on a web page, then into a poster in a few styles. Nothing else in v1.

Links
- Product brief: https://claude.ai/code/artifact/c2c3396c-f92f-4229-bac5-a0e7ab9c03ab
- Design canvas (Claude Design): https://claude.ai/artifact/NdsPXbrWdZh6Kujww7LFZm
- Design spec in text (same content as the canvas, for agents that cannot open it): `DESIGN-SPEC.md`
- Prompts: `prompts/`

## Decisions (approved by Sean, 2026-10-12)

| Topic | Decision |
|---|---|
| Terrain rendering | three.js, custom mesh + shaders. No MapLibre, no basemap. |
| Elevation data | AWS Terrain Tiles (Terrarium PNG), fetched through a Cloudflare Worker that caches tiles in R2. |
| Where work happens | Parsing, rendering and export all in the browser. The GPX never leaves the client. |
| Export | Client-side, tiled rendering for print sizes. |
| Stack | Vite + TypeScript + React, Vitest, Playwright. pnpm. |
| Hosting | Cloudflare Pages (app) + one Worker (tile proxy) + R2 (tile cache). |
| Poster styles in v1 | A Trail Sign, B Night Ridge, E Survey Quad. |
| Domain | vert.geekplux.org (planned as vert.geekplux.com; bound to the Worker on 2026-10-19) |
| Name | "Vert" — check npm, GitHub and the domain for collisions before publishing. |

## Phases

The build runs bottom-up: components first, layout second, features last. Each phase has three prompts: one for the main agent (owns the plan and the merge), one for the implementation sub-agent, one for the verification sub-agent. The main agent never writes feature code itself; it splits work, reviews, and decides.

| Phase | Builds | Done when |
|---|---|---|
| 0 Setup | Repo, tooling, CLAUDE.md, design tokens as CSS variables, Worker skeleton | `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm build` all pass on an empty app |
| 1 Components | Every UI piece in isolation with stories and tests: buttons, stat tile, dropzone, elevation profile, style picker, size picker, text fields, sliders, markers | Each component renders in Ladle, matches DESIGN-SPEC, passes a11y checks, has unit tests |
| 2 Layout | The one page in its four states (Upload, View, Poster mode, Exporting) with placeholder data and a placeholder terrain box | Screenshots match the canvas frames at 1440 and 390 widths; keyboard navigation works |
| 3 Features | GPX parsing, elevation fetch, terrain mesh, route, scrub, poster rendering in 3 styles, tiled export, Worker + R2 | The five v1 acceptance checks in the brief pass with Sean's real GPX files |

Order inside phase 3: parser → terrain → route and scrub → poster style A → export → styles B and E → Worker deploy.

## Models

Every session and sub-agent in this build runs on Opus 5.5 (`claude-opus-5-5`): the goal-mode main agent, the implementation sub-agents and the verification sub-agents. Set it in each prompt's session (`/model claude-opus-5-5`) or in `.claude/settings.json` so sub-agents inherit it.

## Agent roles

- **Main agent** (goal mode): reads PLAN.md and DESIGN-SPEC.md, breaks the phase into tasks of 1–3 files each, hands each to the implementation sub-agent, sends the result to the verification sub-agent, merges only on a pass. Keeps `docs/PROGRESS.md` current.
- **Implementation sub-agent**: builds exactly one task, with tests, and reports what it did and what it did not do.
- **Verification sub-agent**: never edits product code. Runs the checks, compares against the spec, reports pass/fail with evidence (test output, screenshot paths, measured numbers).

## Non-negotiables

- Accessibility: every piece of information carried by color is also carried by shape, position or a label. Sean is color-weak. Keyboard operable. Contrast ≥ 4.5:1 for text.
- Privacy: no network request carries GPX data or coordinates except elevation tile requests (tile x/y/z only).
- Keep the repo private until BlackRock's outside-activity and IP policy has been checked. (Done: Sean made it public on 2026-10-19.)
- No dependencies beyond the approved list without asking: react, react-dom, three, @react-three/fiber (optional), vite, typescript, vitest, @testing-library/react, axe-core, @playwright/test, @ladle/react, eslint, prettier, wrangler. No map library, no PMTiles.

## How to run this with Claude Code

1. Unzip `vert-plan.zip` into an empty repo folder: it creates `docs/` with PLAN.md, DESIGN-SPEC.md, BRIEF.md and `docs/prompts/`.
2. Paste `prompts/00-setup.md` (below its divider) into a normal Claude Code session.
3. For each later phase, start a goal-mode session with the **Main agent** prompt from `prompts/0N-*.md`. The main agent fills `{{COMPONENT}}` / `{{TASK}}` in the sub-agent prompts itself.
4. If your Claude Code can open claude.ai artifact links, it will read the canvas; if not, DESIGN-SPEC.md has the same information, and you can export the canvas frames as PNGs into `docs/design/` for the verifiers to diff against.
