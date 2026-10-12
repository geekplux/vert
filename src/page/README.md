# page

The one page and its four states (DESIGN-SPEC §3): Upload, View, Poster mode, Exporting.

This is the only place that owns application state and composes `components`, `terrain` and
`poster`. Layout: header, aside (300–380 px) and main at 1440; stacked at ≤ 900; one column at 390.

- `state.ts`: the one state machine (`usePageState`): `screen` (upload, view, poster, exporting)
  plus `prefs` (units, exaggeration, poster settings) in one pure reducer. Rules in its header.
- `types.ts`, `sample.ts`: the `Run` and `Terrain` shapes, and the phase 2 placeholder sample run.
- `hooks.ts`: `RunProvider`, `useRun()`, `useTerrain()`, `useRunChooser()`. Phase 3 swaps the
  loader inside (GPX parsed in a Web Worker); callers stay the same.
