# Vert

Vert turns one GPX file into a 3D terrain visualization on a web page, then into a poster in a few
styles. Nothing else in v1.

Read before working: `docs/PLAN.md` (decisions, phases, roles), `docs/DESIGN-SPEC.md` (tokens,
components, page states, poster styles, accessibility), `docs/DECISIONS.md` (main-agent rulings where sources disagree; it outranks the canvas and the
spec text), `docs/PROGRESS.md` (where the build is), `docs/SCENE.md` (the scene format and the
bake), `docs/INTEGRATION.md` (how a host page uses the library).
The design canvas ((design canvas)) wins over DESIGN-SPEC.md on
visual detail when you can open it; local copies of every frame are in `docs/design/` (HTML source
and PNG renders).

## Non-negotiables

**Accessibility.** the maintainer is color-weak.

- Every piece of information carried by color is also carried by shape, position or a label
  (start ○, summit ▲, scrub ● with a white ring; climbs shaded _and_ labelled).
- Everything is keyboard operable; focus is always visible (2px `--route` outline, offset 2).
- Text contrast ≥ 4.5:1; large display text ≥ 3:1. Touch targets ≥ 44px.
- The terrain canvas has an `aria-label`, and the aside carries a text alternative (stats, climbs).
- `prefers-reduced-motion`: the intro animation becomes a fade.

**Privacy.**

- The GPX is parsed, rendered and exported in the browser. It never leaves the client.
- No network request carries GPX data or coordinates, except elevation tile requests, which carry
  tile z/x/y only. No analytics, no CDN at runtime (fonts are self-hosted in `public/fonts`).
- The repository is public (since 2026-10-19) and the site is live at https://vert.geekplux.com
  (vert.geekplux.org 301-redirects to it; print and link `.com`): write code, docs and commits
  for outside readers, and never commit personal GPX files or paths.

## Dependencies

**Ask before adding a dependency.** That includes dev dependencies and type packages.

Approved in PLAN.md: `react`, `react-dom`, `three`, `@react-three/fiber` (optional), `vite`,
`typescript`, `vitest`, `@testing-library/react`, `axe-core`, `@playwright/test`, `@ladle/react`,
`eslint`, `prettier`, `wrangler`. No map library, no PMTiles.

Installed in phase 0 because the setup prompt's tooling needs them: `@vitejs/plugin-react`,
`@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `jsdom`,
`@testing-library/dom` (peer of Testing Library), `@types/react`, `@types/react-dom`,
`@types/node`. `three` is installed (with `@types/three`); load the terrain module lazily.

Pinned on purpose:

- `typescript` ~6.0: typescript-eslint supports `<6.1`.
- `eslint` 9: eslint-plugin-jsx-a11y does not declare ESLint 10 support yet.

## Commands

```sh
pnpm dev            # Vite dev server
pnpm build          # typecheck, then production build to dist/
pnpm test           # Vitest, once (app and worker unit tests)
pnpm test:e2e       # Playwright against the production build, at 1440 and 390 widths
pnpm lint           # ESLint + Prettier check
pnpm format         # Prettier write
pnpm typecheck      # tsc -b (app, node configs, worker)
pnpm stories        # Ladle on http://localhost:61000
pnpm stories:build  # static Ladle build to build/
pnpm build:lib      # the library for host pages to dist-lib/ (docs/INTEGRATION.md)
pnpm bake <in> --out <dir>  # one .gpx or points .json → <id>.scene + sidecar (docs/SCENE.md)
pnpm worker:dev     # run the tile Worker locally
pnpm worker:types   # regenerate worker/worker-configuration.d.ts after editing wrangler.toml
pnpm posters        # regenerate poster examples, README shots, og-image (needs `pnpm preview
                    # --port 4173` running, macOS sips and cwebp; header of scripts/capture-posters.mjs)
```

Before reporting work as done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Layout

```
src/components  UI pieces from DESIGN-SPEC §2, one folder each (tsx, module.css, stories, test)
src/page        the one page and its four states; the only place that owns app state
src/gpx         GPX parser and stats (runs in a Web Worker: no DOMParser there)
src/terrain     three.js mesh, shaders, route, camera
src/poster      poster styles A, B, E and tiled export
src/scene       the .scene format: codec, builder, privacy scanners (docs/SCENE.md)
src/vert-lib    the library for host pages (entry, public types), built to dist-lib/
src/lib         pure shared maths (geodesy, tile maths, Terrarium decoding, units, formatting)
src/hooks       shared React hooks with no app state (useMediaQuery)
src/styles      tokens.css (DESIGN-SPEC §1), fonts.css, base.css
scripts/bake    the headless bake (Node ≥ 22.18, no DOM)
worker/         Cloudflare Worker: /tiles/:z/:x/:y.png proxy for AWS Terrain Tiles, cached in R2
e2e/            Playwright tests
docs/           plan, spec, brief, prompts, PROGRESS.md
```

## Conventions

- Style with CSS modules and the variables in `src/styles/tokens.css`. No hard-coded colors or
  sizes unless the spec gives a px value that has no token.
- Tests sit next to the code (`*.test.ts(x)`); Vitest runs without globals, so import
  `describe`/`it`/`expect`. Query by role and label, not class names.
- No `div` with `onClick`: use `<button>`, `<a href>`, native inputs.
- The Worker's main module (`worker/src/index.ts`) exports only the default handler; workerd treats
  every named export as an entrypoint and fails to start. Put helpers in their own modules.
