# page

The one page and its four states (DESIGN-SPEC §3): Upload, View, Poster mode, Exporting.

This is the only place that owns application state and composes `components`, `terrain` and
`poster`. Layout: header, aside (300–380 px) and main at 1440; stacked at ≤ 900; one column at 390.

- `state.ts`: the one state machine (`usePageState`): `screen` (upload, view, poster, exporting)
  plus `prefs` (units, exaggeration, poster settings) in one pure reducer. Rules in its header.
- `types.ts`, `sample.ts`: the `Run` (with its `track` arrays) and `Terrain` shapes, and a
  placeholder sample run for tests and stories. Missing times or elevations are `NaN` (`hasTime`,
  `hasElevation` say which); a file without elevations gets them from the terrain grid once it
  loads (`elevationSource: 'terrain'`, filled in `RunProvider`).
- `hooks.ts`: `RunProvider`, `useRun()`, `useTerrain()`, `useRunChooser()` (`chooseFile`,
  `chooseSample`, `newFile`). The loader is injectable (`RunProvider loadRun`); the default is
  `realLoadRun` (`src/gpx/loadRun.ts`, the GPX parsed in a Web Worker), and passing `schedule` or
  `delayMs` selects the placeholder loader instead (tests, stories). It rejects with `RunLoadError`
  (`errors.ts`) for a message the user should see; anything else shows "Vert couldn't read this
  file." The terrain: as soon as a run is current, `RunProvider` builds its height grid
  (`loadTerrain`, default `realLoadTerrain` = `buildHeightfield(run.bounds)`; placeholder mode uses
  `pendingLoadTerrain`, which stays loading), aborted by a new run, New file or unmount.
  `useTerrain()` is `idle | loading | ready (heightfield, failedTiles, totalTiles) | error (message)`;
  `useRetryTerrain()` builds again. Choosing a file also starts loading the terrain chunk
  (`terrainChunk.ts`) and sets the `perfMarks.ts` marks (`vert:chosen` … `vert:first-frame`).
- `runCopy.ts`: `runDateLine(run)` ('' without timestamps; never call `formatDateLine` on a run
  directly) and `runPaceAt(run, d)` (`null` without timestamps). Every call site uses them.
- Poster sizes and styles come from `src/poster/sizes.ts` and `src/poster/styles.ts`.
- `Page.tsx`: the composition: `RunProvider`, the state machine, the header with the state's nav,
  the current state, and the About dialog. `App` renders it.
- `UploadState/`: the Upload state (h1, intro, Dropzone, note, sample preview and chip).
- `ViewState/`: the View state (aside: date line, route name, stats, climbs, exaggeration, help;
  main: `TerrainBox` with the live `TerrainView` (lazy, its own chunk), legend and Rotate / Flat map,
  then the elevation section with its scrub readout; the scrub is shared, so the profile moves the
  terrain's marker). `TerrainBox` shows "Loading terrain…" (polite status) until the first frame,
  the error with "Try again" (tile failure, chunk failure or no WebGL, caught by an error
  boundary; each has its own message), and a mono note when some tiles were filled from
  neighbours. After Try again focus moves to the loading text, then to the terrain once drawn
  ("Terrain loaded." politely), or back to Try again. Rotate view and Flat map are `aria-disabled`
  (described by the status text) until the terrain is drawn. The box draws the terrain's focus
  ring (its rounded clip would cut the view's own). The legend reads "○ Start / finish" for a loop
  and "○ Start · ◉ Finish" otherwise (same 50 m rule as the label). Below 600px the legend and
  buttons move into a row under the box (no `overlays`); at 600px and up they overlay it and their
  measured rectangles are passed as `overlays`. Tab order at every width: terrain → Rotate view →
  Flat map → profile. `viewCopy.ts` holds its data-driven copy and profile maths (the terrain
  label says "loop" only when the track ends within 50 m of its start).
- `PosterState/`: Poster mode, also shown under the export overlay (aside: style, size, text,
  stats, hide ends, then the sticky Download block; main: the live `PosterPreview`, fitted to the
  stage). At ≥ 900px the page is one viewport tall and the aside scrolls. `posterCopy.ts` holds
  the file name and button copy. `LivePoster.tsx` draws the chosen style with its live figure
  (`figureHooks.ts`): style A's three.js terrain (`renderTerrainFigure`, loaded on demand) at the
  figure box × the preview's scale × device pixel ratio (≤ 2), re-rendered 150 ms after the box,
  scale, exaggeration, hide ends, camera or terrain change, with "Drawing the terrain…" until the
  first frame; Night Ridge and Survey Quad build their own height grids for the box they report
  (`ridgeBounds` / `quadBounds`, cached by bounds, `useFigureTerrainLoader()`), and show only once
  their fonts have loaded (`loadPosterFonts`; a plain card in the style's paper until then).
  Hide start and end: every style draws `trimTrack(run.track, hideEnds)` (route and start / finish
  markers); stats, profile, sunrise and the map's centre keep the whole run. The camera: "Make a
  poster" reads the View's terrain camera (`TerrainBox` `cameraRef`) into `prefs.poster.camera`
  (`MAKE_POSTER { camera }`; New file resets it). The figure renderer's WebGL context is released
  when Poster mode closes. `simulateExport.ts` is still the `defaultExporter` (see the exporter
  contract below).
- Exporting (`PosterState/ExportProgress.tsx`): under the Download button, a 6px progress bar, the
  label ("Preparing…" until the exporter reports its tile count, then "Rendering tile 4 of 12",
  then "Saving the file…" while it encodes) and a Quiet Cancel; afterwards "✓ Saved <file>" or "⚠ <error>" (`--route-text`). While
  exporting the settings fieldset, the Download buttons and Back to the run are disabled. A
  visually hidden polite status region announces the start, each quarter and the outcome.
- Exporter contract (`PosterState/exporter.ts`): `buildExportJob(run, prefs, format, sources)`
  builds the whole `ExportJob` (run, prefs, content, resolved size, format, file name, and the
  terrain Poster mode has: `sources.terrain` and `sources.loadFigureTerrain`); an `Exporter` is
  `(job, onProgress({ done, total, stage? }), signal) => Promise<{ fileName }>` and owns the tile
  count (`stage: 'encode'` once every tile is drawn and the file is being written);
  rejecting with an `ExportError` shows its message, anything else a generic one. `useExport`
  turns that into EXPORT_STARTED / EXPORT_PROGRESS / EXPORT_DONE / EXPORT_FAILED /
  EXPORT_CANCELLED. `defaultExporter` is what the app uses: `posterExporter`
  (`PosterState/posterExporter.ts`, see `src/poster/README.md` "Export"). The phase 2 simulator
  (`simulateExport.ts`: 12 tiles, 150 ms a step, no download) stays for stories and tests.
  `Page` takes an `exporter` prop; tests pass one explicitly.
- Focus: on a screen change `Page` focuses the new screen's h1 (DECISIONS "Focus on screen changes");
  starting an export focuses the progress label, ending it focuses the Download button used.
- `AboutDialog/`: the native modal `<dialog>` the header's About opens.
