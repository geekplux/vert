# Phase 0 — Setup

Run this once, in an empty folder, as a single Claude Code session (no sub-agents needed).

---

You are setting up **Vert**, a Vite + TypeScript + React web app that turns one GPX file into a 3D terrain visualization and a poster. I'm a senior frontend/data-visualization engineer; this is a portfolio project, so code quality, tests and a polished UI matter more than speed.

The plan documents are already in `docs/` (PLAN.md, DESIGN-SPEC.md, BRIEF.md, and `docs/prompts/`). Read `docs/PLAN.md` and `docs/DESIGN-SPEC.md` first. The design canvas is https://claude.ai/artifact/NdsPXbrWdZh6Kujww7LFZm; if you can open it, use it; otherwise DESIGN-SPEC.md is the source of truth.

Do, committing after each step:

1. **Scaffold.** pnpm, Vite + React + TypeScript (strict), Vitest + Testing Library, Playwright, Ladle for component stories, ESLint (typescript-eslint, react-hooks, jsx-a11y) + Prettier. MIT license. `.nvmrc`. Scripts: `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `stories`.
2. **Tokens.** `src/styles/tokens.css` with every variable from DESIGN-SPEC §1, imported once in `main.tsx`. Self-host Archivo (variable, wdth+wght) and IBM Plex Mono in `public/fonts` with `@font-face` and real fallbacks; no CDN at runtime.
3. **Folders.** `src/components`, `src/page` (the one page and its states), `src/gpx` (parser), `src/terrain` (three.js), `src/poster` (styles and export), `src/lib` (shared math), `worker/` (Cloudflare Worker, wrangler config), `docs/`.
4. **Worker skeleton.** `worker/src/index.ts` with wrangler config: a route `GET /tiles/:z/:x/:y.png` that will proxy AWS Terrain Tiles and cache in R2. For now return 501 with a JSON body; wire the R2 binding name `TILES` in `wrangler.toml` but don't deploy.
5. **CLAUDE.md** at the repo root with: the one-line product definition, the approved dependency list from PLAN.md, the accessibility and privacy non-negotiables, the commands, and "ask before adding a dependency".
6. **docs/PROGRESS.md** with the phase table from PLAN.md and empty checkboxes.
7. Verify `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass on the empty app, and `pnpm stories` opens Ladle.

Finish with a summary of what exists, what is stubbed, and anything in the spec you could not follow.
