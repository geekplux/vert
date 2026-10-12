# page

The one page and its four states (DESIGN-SPEC §3): Upload, View, Poster mode, Exporting.

This is the only place that owns application state and composes `components`, `terrain` and
`poster`. Layout: header, aside (300–380 px) and main at 1440; stacked at ≤ 900; one column at 390.

- `state.ts`: the one state machine (`usePageState`): `screen` (upload, view, poster, exporting)
  plus `prefs` (units, exaggeration, poster settings) in one pure reducer. Rules in its header.
- `types.ts`, `sample.ts`: the `Run` (with its `track` arrays) and `Terrain` shapes, and a
  placeholder sample run for tests and stories. Missing times or elevations are `NaN` (`hasTime`,
  `hasElevation` say which).
- `hooks.ts`: `RunProvider`, `useRun()`, `useTerrain()`, `useRunChooser()` (`chooseFile`,
  `chooseSample`, `newFile`). The loader is injectable (`RunProvider loadRun`); the default is
  `realLoadRun` (`src/gpx/loadRun.ts`, the GPX parsed in a Web Worker), and passing `schedule` or
  `delayMs` selects the placeholder loader instead (tests, stories). It rejects with `RunLoadError`
  (`errors.ts`) for a message the user should see; anything else shows "Vert couldn't read this
  file."
- `runCopy.ts`: `runDateLine(run)` ('' without timestamps; never call `formatDateLine` on a run
  directly) and `runPaceAt(run, d)` (`null` without timestamps). Every call site uses them.
- Poster sizes and styles come from `src/poster/sizes.ts` and `src/poster/styles.ts`.
- `Page.tsx`: the composition: `RunProvider`, the state machine, the header with the state's nav,
  the current state, and the About dialog. `App` renders it.
- `UploadState/`: the Upload state (h1, intro, Dropzone, note, sample preview and chip).
- `ViewState/`: the View state (aside: date line, route name, stats, climbs, exaggeration, help;
  main: `TerrainBox` with legend and Rotate / Flat map, then the elevation section with its scrub
  readout). `viewCopy.ts` holds its data-driven copy and profile maths. Phase 3 swaps the
  placeholder terrain illustration for `TerrainView` and supplies `paceAt`.
- `PosterState/`: Poster mode, also shown under the export overlay (aside: style, size, text,
  stats, hide ends, then the sticky Download block; main: the live `PosterPreview` of
  `TrailSignPoster`, fitted to the stage). At ≥ 900px the page is one viewport tall and the aside
  scrolls. `posterCopy.ts` holds the file name and button copy. Phase 2 placeholders, marked in
  the code: the sample terrain illustration as the figure, a plain card for styles B and E, and
  `simulateExport.ts` as the `defaultExporter` (see the exporter contract below).
- Exporting (`PosterState/ExportProgress.tsx`): under the Download button, a 6px progress bar, the
  label ("Preparing…" until the exporter reports its tile count, then "Rendering tile 4 of 12")
  and a Quiet Cancel; afterwards "✓ Saved <file>" or "⚠ <error>" (`--route-text`). While
  exporting the settings fieldset, the Download buttons and Back to the run are disabled. A
  visually hidden polite status region announces the start, each quarter and the outcome.
- Exporter contract (`PosterState/exporter.ts`): `buildExportJob(run, prefs, format)` builds the
  whole `ExportJob` (run, prefs, content, resolved size, format, file name); an `Exporter` is
  `(job, onProgress({ done, total }), signal) => Promise<{ fileName }>` and owns the tile count;
  rejecting with an `ExportError` shows its message, anything else a generic one. `useExport`
  turns that into EXPORT_STARTED / EXPORT_PROGRESS / EXPORT_DONE / EXPORT_FAILED /
  EXPORT_CANCELLED. `defaultExporter` is what the app uses: in phase 2 the simulator
  (`simulateExport.ts`: 12 tiles, 150 ms a step, no download), until phase 3 points it at
  `src/poster/export.ts`. `Page` takes an `exporter` prop; tests pass one explicitly, so the
  swap does not change them.
- Focus: on a screen change `Page` focuses the new screen's h1 (DECISIONS "Focus on screen changes");
  starting an export focuses the progress label, ending it focuses the Download button used.
- `AboutDialog/`: the native modal `<dialog>` the header's About opens.
