# page

The one page and its four states (DESIGN-SPEC §3): Upload, View, Poster mode, Exporting.

This is the only place that owns application state and composes `components`, `terrain` and
`poster`. Layout: header, aside (300–380 px) and main at 1440; stacked at ≤ 900; one column at 390.

- `state.ts`: the one state machine (`usePageState`): `screen` (upload, view, poster, exporting)
  plus `prefs` (units, exaggeration, poster settings) in one pure reducer. Rules in its header.
- `types.ts`, `sample.ts`: the `Run` and `Terrain` shapes, and the phase 2 placeholder sample run.
- `hooks.ts`: `RunProvider`, `useRun()`, `useTerrain()`, `useRunChooser()` (`chooseFile`,
  `chooseSample`, `newFile`). The loader is injectable (`RunProvider loadRun`); phase 3 swaps the
  placeholder default for the GPX parser in a Web Worker. It rejects with `RunLoadError` for a
  message the user should see; anything else shows "Vert couldn't read this file."
- Poster sizes and styles come from `src/poster/sizes.ts` and `src/poster/styles.ts`.
- `Page.tsx`: the composition: `RunProvider`, the state machine, the header with the state's nav,
  the current state, and the About dialog. `App` renders it.
- `UploadState/`: the Upload state (h1, intro, Dropzone, note, sample preview and chip).
- `ViewState/`: the View state (aside: date line, route name, stats, climbs, exaggeration, help;
  main: `TerrainBox` with legend and Rotate / Flat map, then the elevation section with its scrub
  readout). `viewCopy.ts` holds its data-driven copy and profile maths. Phase 3 swaps the
  placeholder terrain illustration for `TerrainView` and supplies `paceAt`.
- Focus: on a screen change `Page` focuses the new screen's h1 (DECISIONS "Focus on screen changes").
- `AboutDialog/`: the native modal `<dialog>` the header's About opens.
