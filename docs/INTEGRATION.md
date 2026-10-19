# Integrating Vert into a host site

This guide is for a site that shows Vert's 3D terrain of a run on one of its own pages. The first
host is [Activities](https://activities.geekplux.org) (repo `geekplux/activities`), whose Activity
page has a `TerrainSlot` placeholder for it, so its examples are written for that page; nothing in
it is specific to Activities otherwise.

Read with it: [`docs/SCENE.md`](SCENE.md) (the scene format and the bake, in full) and
`dist-lib/README.md` (the library's own reference, shipped with it; source
[`src/vert-lib/README.md`](../src/vert-lib/README.md)). Where this guide and the code disagree, the
code wins; please report it.

Contents: [What you get](#1-what-you-get) · [Vendoring](#2-vendoring-dist-lib) ·
[Scenes](#3-scenes) · [Baking](#4-baking) ·
[Tile proxy policy](#5-tile-proxy-policy-for-offline-bakes) · [Attribution](#6-attribution) ·
[Rendering](#7-rendering) · [CSS custom properties](#8-css-custom-properties) ·
[Accessibility](#9-accessibility) · [Testing](#10-testing-in-the-host) ·
[Changelog](#11-changelog)

## 1. What you get

| piece                                | what it is                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<id>.scene` and `<id>.scene.json`   | One activity's terrain: a height grid and the drawn route in grid-local metres, with markers, climbs and times; its sidecar holds the size, a hash and whole-metre totals.           |
| `pnpm bake` (`node scripts/bake.ts`) | The command that makes them, offline, from a `.gpx` or a `.json` points file, on the machine that has the activity.                                                                  |
| `dist-lib/` (`pnpm build:lib`)       | The library a host vendors: `TerrainView`, `ElevationProfile`, `decodeScene`, time ↔ distance helpers, the credit text. One ES module (96 KB, 30 KB gzipped) plus `vert.css` (2 KB). |

**Privacy model.** Everything georeferenced happens offline, in the bake on the owner's machine:
it reads the coordinates, fetches elevation tiles by tile number, and writes a scene that holds no
latitude, longitude, bounds, tile numbers, timestamps or names. The browser gets only that file and
draws it; the library has no network code and no geodesy. What remains is accepted and documented
in `docs/DECISIONS.md` ("Library for Activities") and `docs/SCENE.md` ("Forbidden content"):

- **The terrain is a fingerprint**: a height grid can be matched against a global elevation model.
- **The zoom band**: the grid's zoom narrows the latitude to the band where that zoom is chosen (a
  factor of two in cos(latitude); nothing for a route small enough for zoom 14).
- **Mercator scale along the route**: grid-local step lengths differ from true ones by about 0.5%
  across 30 km at 45°, which a regression could turn into a rough tan(latitude).
- **The tiles' own smoothness** adds to the sampler's kernel; it gave no latitude in 20 fits.
- **Trimmed ends**: the first and last 200 m along the route are hidden, which does not hide a
  start that a loop or laps pass again (the bake warns, see [Trim](#trim-loops-and-laps)).
- **Ids**: an explicit `--id` of 10 or more digits is not read, so someone typing concatenated
  coordinates there is not stopped; coordinates folded inside a hash-like token, and a 1-digit
  degree at the start of a long digit run, are not read either.
- **The byte scanner near the antimeridian** does not look for a tile pair containing a zero in the
  format's defined fields (column 0 lies within about 5.6° east of 180°); the decoded-object scan
  still covers them.

**Vendoring into a public repository.** Vert's repository is public (since 2026-10-19, MIT), so a
public host such as `geekplux/activities` may commit `dist-lib/`; keep Vert's `LICENSE` with it.

**For Activities, the whole change**, each item explained below:

- **Approval first.** Embedding Vert reverses an Activities decision marked "do not relitigate"
  (its `CLAUDE.md`, "Vert: link out; `TerrainSlot` placeholder"; `docs/PLAN.md` §2, "integrate
  later as a package"), adds a runtime dependency (`three`, exact) and a vendored folder. Sean
  approved it on 2026-10-19 (Vert's `docs/DECISIONS.md`); Activities records it in its own
  `docs/DECISIONS.md`.
- `vendor/vert/` committed, ignored by ESLint and Prettier; `three@0.186.1` installed
  ([Vendoring](#2-vendoring-dist-lib)); a pin test under `scripts/`.
- `public/scenes/` with the baked pairs, the `virtual:vert-scenes` plugin, a `/scenes/*` rule in
  `public/_headers` and its line in `deploy.test.ts` ([Scenes](#3-scenes)).
- In `Activity.tsx`, `TerrainSlot` replaced by the worked example's `TerrainCard` (in
  `ActivityBody`) and `TerrainCardGhost` (in `ActivityGhost`), and the heart-rate chart wrapped in
  `HeartRateScrub` when there is a series; `HeartRateGhost` and `HeartRateEmpty` unchanged
  ([the worked example](#a-worked-example-activities-terrain-card)).
- Tests updated: the ones that failed in a copy of Activities with this guide applied, running its
  whole Vitest suite and its whole Playwright suite (every spec, all three projects; 375 passed,
  185 skipped by the specs themselves, and nothing failed but these):
  - `src/pages/Wp5Pages.test.tsx`, "a GPS session": it looks for `TERRAIN_PLACEHOLDER`.
  - `e2e/activity.spec.ts`, "a GPS + HR session" (lines 68–75): the Terrain region's placeholder
    text and 16:9 box.
  - `e2e/activity.spec.ts`, the keyboard walk (lines 302–325): the heart-rate slider ("Time in the
    session") is a new stop, and once the card has loaded so are the terrain view, Rotate / Flat /
    Reset, the profile and the credit link.
  - `e2e/activity.spec.ts`, the "1 px sweep" of More like this (line 365) on Translantau50, which
    had a scene in that copy: about 23 s instead of 2 s, because every one of its 1,600 viewport
    resizes redraws the terrain. It passed alone but timed out (30 s) in the full run; give it a
    longer timeout, or sweep a session without a scene.

  Every `e2e/polish.spec.ts` test passed there, its layout rule (section tops within 2 px,
  skeleton vs loaded, every session at 320, 390, 768 and 1440 px) included.

- A script that bakes chosen activities on Sean's machine ([Baking](#from-activities-importer)).

## 2. Vendoring `dist-lib/`

> **Vert is public.** Vendoring publishes Vert's bundle, declarations and README wherever the
> host's repository is visible; since Vert's own repository is public (2026-10-19, MIT), a public
> host such as `geekplux/activities` may vendor it. The MIT licence asks that its notice travel
> with copies: vendor Vert's `LICENSE` next to the files.

A host whose build cannot see Vert's repository (Activities' Cloudflare build clones only its own)
copies the built files into its own repository and commits them.

```sh
# In Vert, from a clean, committed checkout (the version records HEAD's sha, not local edits):
pnpm install --frozen-lockfile
pnpm build:lib
# In the host (here Activities, next to vert/):
rm -rf vendor/vert && mkdir -p vendor && cp -R ../vert/dist-lib vendor/vert
```

`dist-lib/` holds `index.js`, `vert.css`, `index.d.ts`, `types/` and `README.md`. Keep the folder
as it is built: `vendor/vert/` at the host's root (outside `src/`) works, and keep it out of the
host's lint and format checks, since `index.js` is minified. For Activities:

- `eslint.config.js`: add `'vendor'` to `globalIgnores([...])`.
- `.prettierignore`: add `vendor/`.

### Version

`VERT_LIB_VERSION` is `package.json`'s version plus the short git sha the library was built from,
for example `0.1.0+1face09` (`0.1.0+nogit` outside a git checkout). It is a string literal in the
bundle, so you can read what is vendored without running it:

```sh
grep -o '"0\.[0-9]*\.[0-9]*+[0-9a-z]*"' vendor/vert/index.js
```

Pin it with a test, so a re-vendor changes one line on purpose. In Activities it goes under
`scripts/` (say `scripts/vendor.test.ts`): `tsconfig.node.json` covers `scripts/` with Node's
types, and Vitest collects `scripts/**/*.test.ts`, whereas `tsconfig.app.json` gives `src/` only
`vite/client` types, so `node:fs` there fails to typecheck.

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The Vert build in vendor/vert/, pinned: a re-vendor must change this line on purpose. */
const PINNED = '0.1.0+1face09';

describe('vendored Vert', () => {
  it('is the pinned build', () => {
    // VERT_LIB_VERSION is a string literal in the bundle; reading it needs no three.js.
    const bundle = readFileSync('vendor/vert/index.js', 'utf8');
    expect(/"(\d+\.\d+\.\d+\+[0-9a-z]+)"/.exec(bundle)?.[1]).toBe(PINNED);
  });
});
```

### Packages the host installs

The bundle imports `react`, `react/jsx-runtime`, `three` and five `three/examples/jsm/…` modules,
and nothing else.

- **`three`, at exactly the version Vert builds against: 0.186.1** (Vert's lockfile and
  `node_modules/three/package.json`). three.js makes breaking changes in minor releases, and the
  `examples/jsm` modules move with it, so pin it: `pnpm add --save-exact three@0.186.1`. When Vert
  moves to a new three, its changelog entry says so.
- **`react` 19** (Vert builds with 19.3.0): the components take `ref` as a prop, which needs
  React 19. `react-dom` is your own (the library does not import it).
- **`@types/three` (0.186.0, dev)**: only if your TypeScript checks declaration files. The
  declarations import `WebGLRenderer` from `three`, which ships no types: with `skipLibCheck: false`
  that is `TS7016` in `vendor/vert/types/vert-lib/types.d.ts`; with `skipLibCheck: true` (as
  Activities has) everything type-checks without it, and only `TerrainRenderer`'s members become
  untyped. To add it: `pnpm add -D --save-exact @types/three@0.186.0`.

### TypeScript

Import from `vendor/vert/index.js`. The declarations' relative imports carry `.js` extensions, so
`moduleResolution` `bundler`, `node16` and `nodenext` all resolve them (checked under `strict` with
Activities' own options: `verbatimModuleSyntax`, `noUncheckedSideEffectImports`,
`noUncheckedIndexedAccess`). The side-effect import `vendor/vert/vert.css` needs a `*.css` module
declaration, which `vite/client` (in Activities' `types`) provides.

### Load it lazily

three.js is most of the weight: the terrain chunk of the example in
[Rendering](#a-worked-example-activities-terrain-card) is 657 KB minified (172 KB gzipped) with
three inside. Import Vert only from a module you load with `import()`, so it loads on pages that
show a scene and nowhere else: `React.lazy` does that. Everything the page itself imports from
`vendor/vert` must be `import type`, or the bundle comes back into the page's chunk.

```tsx
// Excerpt; the whole card is in "A worked example" below.
import { lazy, Suspense } from 'react';

// Only this import pulls in Vert, and with it three.js: a chunk of its own, loaded on demand.
const VertTerrain = lazy(() => import('../vert/VertTerrain.tsx'));

<Suspense fallback={<p>Loading the terrain…</p>}>
  <VertTerrain
    sceneId={sceneId}
    hash={hash}
    title={title}
    seconds={seconds}
    onSeconds={setSeconds}
  />
</Suspense>;
```

Vite warns that the chunk is over 500 KB; that is expected (`build.chunkSizeWarningLimit` silences
it).

### Updating

1. In Vert: read the changelog entries since your version ([below](#11-changelog)); breaking
   changes come first.
2. `pnpm build:lib` from a clean checkout of the version you want.
3. In the host: replace `vendor/vert/` as above, bump `PINNED`, install the `three` version the
   entry names, run your tests, and commit the folder in one commit ("Vendor Vert 0.2.0+abc1234").
4. A new **scene format version** needs a re-bake of every scene before the new library ships:
   a library that knows only version 2 refuses version-1 files (`SceneError` reason `version`), and
   the other way round.

## 3. Scenes

The format is specified in [`docs/SCENE.md`](SCENE.md); a host needs only `decodeScene`.

### Where to keep them

Bake into `public/scenes/` and commit both files of each pair: `public/scenes/<id>.scene` and
`public/scenes/<id>.scene.json`. Vite copies `public/` into `dist/` as it is, so they are served at
`/scenes/<id>.scene`. Not `public/data/`: Activities' deploy guard allows only `activities.json` and
`meta.json` there.

A page needs to know which activities have a scene before it asks for one. On a host with
single-page-app fallback (Activities: `not_found_handling: "single-page-application"`, no Worker
script), a missing file comes back as `index.html` with **200**, so a probe cannot tell. Read the
sidecars at build time instead (the page's loading skeleton needs the same answer, see
[the worked example](#a-worked-example-activities-terrain-card)). A Vite plugin in the style of
Activities' own hint modules, in `scripts/vertScenes.ts` (Node code, so under `tsconfig.node.json`)
and added to `plugins` in `vite.config.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** `virtual:vert-scenes`: { [scene id]: sidecar hash } for every baked scene in `dir`. */
export function vertScenes(dir = 'public/scenes'): Plugin {
  const id = 'virtual:vert-scenes';
  return {
    name: 'vert-scenes',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const index: Record<string, string> = {};
      for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
        if (!name.endsWith('.scene.json')) continue;
        // Absolute: a relative watch file reaches Vite's import analysis as an import, and fails.
        const path = resolve(dir, name);
        // A re-bake in `pnpm dev` reloads the index (a new scene needs a restart).
        this.addWatchFile(path);
        const sidecar = JSON.parse(readFileSync(path, 'utf8')) as {
          format?: unknown;
          version?: unknown;
          hash?: unknown;
        };
        if (
          sidecar.format !== 'vert-scene' ||
          sidecar.version !== 1 ||
          typeof sidecar.hash !== 'string'
        ) {
          throw new Error(`${path} is not a version-1 Vert sidecar`);
        }
        index[name.slice(0, -'.scene.json'.length)] = sidecar.hash;
      }
      return `export default ${JSON.stringify(index)};`;
    },
  };
}
```

```ts
// src/virtual-modules.d.ts
declare module 'virtual:vert-scenes' {
  /** Scene id → the sidecar's hash, for every scene in public/scenes/. */
  const scenes: Readonly<Record<string, string>>;
  export default scenes;
}
```

### Fetching

```ts
import { decodeScene, SceneError, type Scene } from '../../vendor/vert/index.js';

/**
 * The scene `<id>.scene` from `public/scenes/`, or null when it is not there or not a scene.
 * `hash` is the sidecar's: a new bake gets a new URL, so the file can be cached for good.
 */
export async function loadScene(
  id: string,
  hash: string,
  signal?: AbortSignal,
): Promise<Scene | null> {
  const response = await fetch(`/scenes/${id}.scene?v=${hash}`, { signal });
  if (!response.ok) return null;
  try {
    return decodeScene(await response.arrayBuffer());
  } catch (error) {
    // A missing file can come back as the SPA's index.html with 200: reason 'magic'.
    // 'version' is a scene newer than the vendored library: update dist-lib.
    if (error instanceof SceneError) return null;
    throw error;
  }
}
```

`decodeScene` takes an `ArrayBuffer` or `Uint8Array` and throws `SceneError` (with `reason`:
`magic`, `version`, `truncated`, `length`, `range`, `corrupt`) for anything that is not a valid
version-1 scene; it checks every size before allocating, so untrusted bytes are safe. It takes
about 3 ms for a 20 km route. Decode once per scene and pass the same `Scene` object to both
components (the view rebuilds when the object changes).

### Caching and compression

The URL carries the sidecar's hash (FNV-1a of the file's bytes), so `/scenes/*` can be cached for a
year. In Activities' `public/_headers`:

```text
# Baked Vert scenes, fetched with ?v=<sidecar hash>: a re-bake is a new URL.
/scenes/*
  Cache-Control: public, max-age=31536000, immutable
```

(Its `deploy.test.ts` checks every path has exactly one `Cache-Control` rule; add `/scenes/a.scene`
to that list.) Compression does not matter: a scene is already entropy-coded (brotli saves 2% on
the Coosa sample, gzip 1.5%), and the sidecar is under 300 bytes.

### Sizes

At most 80 KB before compression for a ~20 km route; measured (default settings): Coosa 21.5 km
43 KB, Lavaredo 19.5 km 37 KB, Eiger 52 km 35 KB, CCC 99 km 58 KB; a near-square ~20 km area up to
62 KB (`docs/SCENE.md`, "Sizes").

### Never publish decoded values as they are

Decoded numbers are float32/float64 approximations of stepped values (an elevation of 412.3 m is
412.29998779296875). Printed in full they match Activities' coordinate check `\d{2}\.\d{4,}`.
Round before printing anything (whole metres, or km to one decimal), and never serialise a decoded
`Scene` into a published file. Runtime DOM text is not scanned by that check, but round it there
too (the examples here do).

### Activities' privacy and deploy guards

Checked against `scripts/import/privacy.ts`, `privacy.test.ts` and `scripts/deploy/checks.ts`
(`pnpm run deploy` runs `dist.ts` first):

- **The privacy test** reads only `public/data/activities.json` and `meta.json`. Scenes are not
  scanned, and nothing there fails.
- **The deploy guard** walks all of `dist/`, but scans text only in `data/activities.json` and
  `data/meta.json`; it fails on extra files under `data/` and on file names matching
  `.(fit|gpx|tcx|csv|zip|gz)` or `export_*` / `inbox` folders. `scenes/<id>.scene` and
  `scenes/<id>.scene.json` match none of these, so **committing them passes both guards as they
  are**.
- That also means the guards **do not look at scenes at all**. Recommended (not required): extend
  `checkDist` so `dist/scenes/` may hold only `<id>.scene` / `<id>.scene.json` pairs, and run
  `COORDINATE_RE` over every sidecar. Both pass: sidecar numbers are whole by construction, and the
  bake already ran Vert's own scanners on the bytes, the decoded scene and the sidecar text. Even
  the binary passes the regex (read as Latin-1, the Coosa scene has no match; a random match in
  50 KB of coded data has a probability around 10⁻⁶, and the bake's scanner looks for decimal text
  in it).
- **Why the guards have nothing to catch**: a scene holds no coordinates, bounds, tile numbers or
  clock times ([Forbidden content](SCENE.md#forbidden-content)), and the bake refuses to write one
  its scanners flag. The file names are ids, checked for coordinates and timestamps (below).
- **CSP**: unchanged. The scene is a same-origin `fetch` (`connect-src 'self'`); the library and
  three.js need no `eval`, no inline script or `<style>`, no `blob:` or worker. The example page
  below ran under Activities' policy (`default-src`, `script-src`, `connect-src` and `img-src` as
  in its `_headers`) with no violation.

## 4. Baking

```sh
pnpm bake <input> --out <dir> [--id <id>] [--trim <metres>] [--tiles <url-template>] [--cache <dir>]
```

`pnpm bake` is `node scripts/bake.ts`. It needs Node 22.18 or later (it runs Vert's TypeScript
directly) and no installed packages: no `pnpm install` is needed in Vert to bake. It runs on the
machine that has the activity, never in a host's build.

| option    | default                                           | meaning                                                                                                                                                  |
| --------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<input>` | (required)                                        | one `.gpx`, or one `.json` points file (below); relative to the current directory                                                                        |
| `--out`   | (required)                                        | the directory to write `<id>.scene` and `<id>.scene.json` to; created if needed; relative to the current directory                                       |
| `--id`    | from the input's file name                        | the files' base name: 1–64 of `a-z`, `0-9`, `_`, `-`, starting with a letter or digit; used as typed                                                     |
| `--trim`  | `200`                                             | metres hidden at each end of the route, 0–10,000; `0` keeps the ends                                                                                     |
| `--tiles` | `https://vert.geekplux.org/tiles/{z}/{x}/{y}.png` | elevation tile URL template, http(s) with `{z}`, `{x}`, `{y}` ([policy](#5-tile-proxy-policy-for-offline-bakes))                                         |
| `--cache` | Vert's `scripts/.cache/terrarium/`                | the tile cache, `{z}/{x}/{y}.png`; the default sits beside the script, whatever the current directory. It holds tile numbers: never commit or publish it |
| `-h`      |                                                   | the usage text                                                                                                                                           |

**Exit codes**: `0` both files written; `1` the bake failed and nothing was written (unreadable or
invalid input, an id that reads as a coordinate of the run, a route too short for the trim, a tile
problem, a privacy finding, a write error); `2` a usage error (arguments, `--trim` out of range, a
malformed `--id`, a default id that looks like a timestamp). An older Node refuses the `.ts`
entry before the bake starts.

### Input: GPX or points

A `.gpx` is parsed exactly as Vert's page parses it. For a host whose activities are FIT or
similar, write a **points file**:

```json
{ "points": [{ "lat": 46.1, "lon": 7.2, "ele": 1250.5, "t": 1791025800000 }] }
```

- `lat` (−90…90) and `lon` (−180…180), degrees: required, finite numbers.
- `ele`, metres: optional (absent or `null`). Without usable elevations the bake takes them from
  the terrain, as Vert's page does; the scene's climb is then the terrain's (Coosa: 1,094 m against
  the file's 1,102 m).
- `t`: optional (absent or `null`); epoch **milliseconds** (1990–2100; seconds are refused) or an
  ISO 8601 date-time **with a zone** (`"2026-10-03T11:10:00Z"`). Present times must never go
  backwards. Only offsets from the first point reach the scene.
- 2 to 500,000 points, no other keys (a typo such as `lng` is an error, not dropped data). Errors
  name the point and field, never the value.

The same points as a GPX or as a points file bake to the same bytes (checked on the Coosa sample).

For Activities (`scripts/import/types.ts`): from a parsed FIT's `RawRecord`s, keep those with a
position and write `{ lat, lon, t }` (`t` is already epoch ms, or `null`). `RawRecord` has no
elevation today; add FIT `enhancedAltitude` (or `altitude`), in metres as the FIT SDK decodes it, as
`ele` to keep the recorded climb, or leave it out and let the bake use the terrain. Two things to
know:

- **Time 0** of a scene is the points file's first point. If the importer drops leading records
  without a position (GPS lock), the HR chart's 0 is earlier by that gap. Start both at the same
  record, or keep the gap (whole seconds, not a coordinate) next to the scene id and add it when
  mapping.
- **The points file is as private as the FIT**: write it outside the repository (or into the
  git-ignored `inbox/`) and delete it after the bake.

### Ids

The id becomes a published file name, so the bake checks it:

- **Coordinates**: any id whose digits read as a coordinate of this run (decimal degrees,
  degrees-minutes(-seconds), decimal minutes, digits run together, any separator) is refused,
  exit 1, "pass another with --id". Hashes are skipped: a hex run of 16 or more, or a UUID, with a
  letter in it.
- **An explicit `--id` of 10 or more digits and nothing else is opaque**: not read at all, so a
  Strava activity id (already public on Activities) is never refused. Shorter digit-only ids, and
  any id with other characters, are read.
- **Default ids** (from the file name: lower-cased, accents dropped, other runs turned into `-`)
  are also refused, exit 2, when a digit run reads as a timestamp (epoch µs/ms/s/min from 2000 to
  2100, or YYYYMMDD), since some apps name exports by the time of the run. Pass `--id`. An explicit
  id is never checked for timestamps.

Activities' ids: every published id today is a 10- or 11-digit Strava id, which passes as it is
(`--id 8071241781`); a bare file's `f:<sha1>` has a `:`, which `--id` refuses (exit 2): bake it as
`f-<sha1>` and look it up the same way (`activityId.replace(/:/g, '-')`).

### Trim, loops and laps

`--trim 200` (default) hides the first and last 200 m along the route: the drawn route, profile,
markers and climbs cover only the rest, and the grid is framed on it. Distances stay true (the drawn
route starts at 200 m) and times stay offsets from the real start, so time ↔ distance mapping needs
no correction. The sidecar's totals (length, climb) are the whole run's.

A loop or a lap session passes its start again after the trim. When the real start or finish lies
within 100 m of the drawn route, the bake warns on stderr and still writes the scene; decide whether
a larger `--trim` is needed:

```text
vert-bake: warning: The run's real start lies within 10 m of the drawn route (a loop or laps pass it again), so the trim does not hide it; a larger --trim hides more.
```

### What it does and prints

The run is built as Vert's page builds it; the scene grid is sampled for the drawn stretch; before
anything is written the privacy scanners run on the bytes, the decoded scene and the sidecar text,
and any finding refuses the scene. Both files are written together (temporary names, then a marked
swap; a crashed bake is settled by the next one), so a pair is never half old, half new. The same
input and tiles always give byte-identical files. Tiles are cached in `--cache`; a second bake of
the same area makes no request.

### A worked example

From Vert's checkout, the bundled sample into a host's `public/scenes/`:

```sh
pnpm bake public/samples/coosa-backcountry.gpx --out ../host/public/scenes --id coosa-sample
```

```text
Baked coosa-sample
  run      21.48 km, +1,102 m; elevation from the file
  drawn    21.08 km (200 m hidden at the start, 200 m at the end)
  grid     207 × 320 samples, 4,361 m × 6,747 m, zoom 13
  scene    43,115 bytes, hash c787f362
  tiles    6 fetched, 0 from cache, 0 missing upstream across both grids, 0 of them under the scene (filled from neighbours)
  privacy  clean (bytes, decoded scene, sidecar text, pixel pitch)
  wrote    …/host/public/scenes/coosa-sample.scene
           …/host/public/scenes/coosa-sample.scene.json
  took     0.5 s
```

Nothing printed, errors included, holds a coordinate, a bound, a tile x/y or a tile URL.

### From Activities' importer

The bake lives in Vert's repository and Activities' Cloudflare build cannot see it, so scenes are
baked on Sean's machine and committed; the deployed build only copies them. A sketch of how
Activities could wire it (not implemented):

1. A script in Activities (say `pnpm run scenes <id…>`), run after `pnpm run import`, takes the
   activities Sean chose (scenes are opt-in, per activity).
2. For each, it reads the original FIT/GPX from the archive or `inbox/`, writes a points file to a
   temporary directory, and runs, from Activities' root, with Vert checked out next to it:

   ```sh
   tmp=$(mktemp -d) # the script writes the points file to "$tmp/8071241781.json"
   node ../vert/scripts/bake.ts "$tmp/8071241781.json" --id 8071241781 \
     --out public/scenes --cache "$HOME/.cache/vert-tiles"
   ```

   Always pass `--cache`: without it the tiles land in `../vert/scripts/.cache/terrarium/`, inside
   Vert's checkout, and Activities never writes into a sibling repository. The cache's paths are
   tile numbers, that is locations, so it lives outside both repositories (or in an ignored folder)
   and is never committed or published. A GPX can be passed directly; a `.gz` must be unpacked
   first, since the bake reads only `.gpx` and `.json`. Only the exit code and stderr matter to the
   script: 0 written, 1 refused or failed, 2 a usage error.

3. It deletes the points file, and Sean reviews and commits `public/scenes/`.

## 5. Tile proxy policy for offline bakes

The default `--tiles` is Vert's tile Worker, `https://vert.geekplux.org/tiles/{z}/{x}/{y}.png`
(`worker/README.md`): a proxy for AWS Terrain Tiles (Terrarium PNGs), cached in R2, paid for by
Vert's owner.

- **Accepts** `GET`/`HEAD /tiles/{z}/{x}/{y}.png` for 6 ≤ z ≤ 15 and x, y < 2^z, **no query
  string** (any `?`, even bare, is a 400). Bakes ask for z 12–14 on ordinary routes and lower for
  very long ones.
- **Answers**: 200 PNG (cached a year, `ETag`); **404** when the tile does not exist upstream (open
  sea): the bake fills it from its neighbours, as the app does, and counts it; **400** for a bad
  path or zoom: the bake stops (a bug, or a `--tiles` template that builds bad paths); **502** when
  upstream failed: the bake retries once after a second, then stops rather than invent terrain;
  a 200 that is not a PNG also stops it.
- **Politeness, built in**: at most 4 requests in flight, one retry, 20 s per request,
  `User-Agent: vert-bake/<version> (offline scene bake)`, every tile cached on disk after it is
  verified. Only z/x/y leave the machine; the Worker logs no x/y, path or IP.
- **What it is for**: baking the owner's own activities, one at a time or a few hundred once. It is
  not a public tile service: do not crawl areas, bulk-bake other people's tracks, or point another
  site at it.

**Another source.** `--tiles` takes any server that answers the same way. The public AWS bucket
works directly, and bakes the same bytes:

```sh
pnpm bake public/samples/coosa-backcountry.gpx --out ../host/public/scenes \
  --tiles 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
```

AWS Terrain Tiles are in the AWS Open Data registry (bucket `elevation-tiles-prod`, us-east-1;
`elevation-tiles-prod-eu` in eu-central-1), free to read; their licence is the per-source
attribution in
[tilezen/joerd's attribution.md](https://github.com/tilezen/joerd/blob/master/docs/attribution.md),
which covers scenes baked from them too (next section). The bucket answers 404 for a missing tile,
as the Worker does. Bake politely there as well: the built-in limits apply to any `--tiles`.

## 6. Attribution

Every scene is drawn from AWS Terrain Tiles, which Mapzen built from many elevation sources. A
host **must** show `TERRAIN_ATTRIBUTION`, linked to `TERRAIN_ATTRIBUTION_LINK.href`, **wherever a
scene is shown**:

```ts
TERRAIN_ATTRIBUTION; // 'AWS Terrain Tiles / Mapzen (various sources)'
TERRAIN_ATTRIBUTION_LINK; // { text: TERRAIN_ATTRIBUTION, href: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' }
```

```tsx
<p>
  Elevation: <a href={TERRAIN_ATTRIBUTION_LINK.href}>{TERRAIN_ATTRIBUTION_LINK.text}</a>
</p>
```

Put it in the terrain card (in the view's box, under it, or in its note line), not only in a site
footer, so it sits next to what it credits. Vert's own About dialog credits the tiles the same way.

The linked page lists, as "Required attribution", the credit each source asks for (USGS 3DEP,
SRTM and GMTED2010 "courtesy of the U.S. Geological Survey", Copernicus EU-DEM, Geoscience
Australia, Kartverket, LINZ, and others), to "appear in a place that is reasonable to the medium".
The short credit linked to that full list is Vert's reading of that requirement for a web page
(`docs/DECISIONS.md`, "Attribution"). A host that wants to go further can also reproduce the full
list on a credits page.

## 7. Rendering

### `TerrainView`

| prop             | type                          | notes                                                                                                                       |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `scene`          | `Scene \| null`               | required; `null` draws nothing. Pass the same object while unchanged                                                        |
| `exaggeration`   | `number`                      | required; vertical exaggeration, Vert uses 1–3 (1.6 by default); changing it does not rebuild                               |
| `ariaLabel`      | `string`                      | required; the canvas's accessible name ([what to write](#9-accessibility))                                                  |
| `view`           | `'oblique' \| 'flat'`         | default `'oblique'`; `'flat'` is top-down, north up, no orbit; changes ease (a cut with reduced motion)                     |
| `scrub`          | `number \| null`              | the scrub marker, metres from the run's real start; `null`, absent or not finite hides it; off the route clamps to its ends |
| `initialCamera`  | `ViewCamera`                  | start at this pose, no intro                                                                                                |
| `onReady`        | `() => void`                  | the first frame of a new scene is drawn                                                                                     |
| `palette`        | `TerrainPalette`              | `{ surface, ink, wallShade? }`, read once at mount ([CSS](#8-css-custom-properties))                                        |
| `routePalette`   | `RoutePalette`                | `{ route, halo, ink }`                                                                                                      |
| `insets`         | `Insets`                      | px kept free along each side for your overlays                                                                              |
| `overlays`       | `readonly ScreenRect[]`       | rectangles the model keeps 12 px clear of                                                                                   |
| `className`      | `string`                      | added to the wrapper                                                                                                        |
| `ref`            | `Ref<TerrainViewHandle>`      | the handle (below)                                                                                                          |
| `createRenderer` | `(canvas) => TerrainRenderer` | **testing aid** ([Testing](#10-testing-in-the-host)); leave unset in production                                             |
| `onRenderFrame`  | `(renderMs: number) => void`  | **instrumentation aid**                                                                                                     |

The view fills its parent and its canvas is transparent: give the parent a size (an
`aspect-ratio`) and a background. It throws during mount if the browser has no WebGL, so wrap it in
an error boundary with a text fallback (the example does).

### `ElevationProfile`

| prop        | type                                 | notes                                                                                                                                                                           |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene`     | `Scene`                              | required; the drawn route's elevations and climbs                                                                                                                               |
| `scrub`     | `number \| null`                     | controlled when given (`null` included); uncontrolled when left out, starting at none and back to none (unreported) when `scene` changes; pick one for the component's lifetime |
| `onScrub`   | `(metres: number \| null) => void`   | the user moved the scrub (press, drag, slider keys), clamped to the drawn route; `null` when Escape clears it, so handle `null` ([Escape](#escape-and-your-own-key-handlers))   |
| `units`     | `'metric' \| 'imperial'`             | default `'metric'`                                                                                                                                                              |
| `height`    | `number`                             | plot height in px, default 140                                                                                                                                                  |
| `label`     | `string`                             | the slider's accessible name, default "Elevation profile"                                                                                                                       |
| `valueText` | `(d: number, ele: number) => string` | the slider's value text, default "km 12.2, 640 m"                                                                                                                               |
| `className` | `string`                             |                                                                                                                                                                                 |

### Escape and your own key handlers

When Escape on the profile's slider clears a position, the profile calls `preventDefault()` on the
keydown and nothing more: the event still propagates, so your own keydown handlers (a dialog, a
page shortcut) receive it with `event.defaultPrevented` true. **Check `event.defaultPrevented` in
your Escape handlers** before acting (a native `<dialog>` does, and stays open on that press).
Escape is left alone, not prevented, when there is no position, and on a controlled profile
without `onScrub` (read-only, where clearing could not show), so a surrounding dialog closes. If
you pass `onScrub`, handle `null`: Escape is prevented on the assumption that you clear the scrub
(the example below passes it on as `onSeconds(null)`).

### The handle and your buttons

The handle is the stable API: `rotateBy(radians)`, `resetView()`, `requestRender()`, `focus()`,
`camera()` (exactly these five). The view has no buttons; build Rotate, Flat and Reset yourself,
each at least 44 × 44 px with a visible focus ring and a text label. Flat is the `view` prop, with
`aria-pressed`; Rotate does nothing in the flat view, so disable it there. The example below has
all three.

### Scrub sync with a time chart

The scrub is a distance: **metres from the run's real start**, the scene's own distances (a route
trimmed by 200 m starts at 200). Both components take it as `scrub`; only the profile reports moves
(`onScrub`). A chart whose x axis is time maps through three pure helpers:

| helper                         | returns                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `metresAtTime(scene, seconds)` | the scrub for a time (seconds since the run's first point), or `null`             |
| `timeAtMetres(scene, metres)`  | the time for a scrub, or `null`                                                   |
| `sceneTimeRange(scene)`        | `{ start, end }`, the stretch of your time axis the drawn route covers, or `null` |

All three give `null` for a scene without times (`scene.route.time === null`), for a time or
distance off the drawn stretch (the trimmed ends: not clamped, so the scrub is hidden there rather
than parked where the runner was not), and for a non-finite input. Between points they interpolate
linearly; a stop is one long step. Use `sceneTimeRange` to shade or mute the parts of your chart
the terrain cannot show.

The time axis's 0 must be the scene's 0, the run's first point ([Time 0](#input-gpx-or-points)).
Activities' heart-rate series `w` is 48 buckets of the HR samples drawn across the elapsed time
`min`: with regular recording, x ∝ seconds, which is what the example assumes.

### A worked example: Activities' terrain card

What was checked, and how: the files below, unchanged, in a scratch host with Activities'
`tsconfig.app.json` and `tsconfig.node.json`, its ESLint rules and Prettier, its `tokens.css` and
`base.css`, and a reduced copy of its Activity page (its own `HeartRate.tsx`, `Skeleton.tsx` and
`Activity.module.css`, with the changes below): typecheck, lint, format, Vitest and build pass; in
Chromium, scrub sync both ways, Escape, Flat, the heart-rate slider with a mouse and by touch
(below), axe with no violation at 390 (touch, with a position) and 1440, and Activities' CSP with
no violation. **Layout**: the tops of `main`'s sections and of the footer, skeleton vs loaded
and while the scene loads, moved by 0 px at 320, 390, 768 and 1440 px for a session with a scene
and heart rate, with heart rate and no scene, with a scene and no heart rate, and with neither
(`e2e/polish.spec.ts` allows 2 px).

Then the whole change, as this guide gives it, applied to a copy of Activities (the vendored
`dist-lib`, `three` 0.186.1, the plugin, the files below, the patch, and the Coosa scene baked as
`8071241781.scene`, Translantau50's id): typecheck, ESLint and Prettier pass; its whole Vitest and
Playwright suites fail only where [§1's list](#1-what-you-get) says, and every `polish.spec.ts`
layout test and `home.spec.ts`'s media-query rule pass.

**The page.** `ActivityBody` keeps one position, in **seconds** (the heart-rate chart's unit; the
page must not import the library eagerly, and the helpers live in the lazy chunk), and
`ActivityGhost` renders the card's ghost. Activities' `HeartRateGhost` and `HeartRateEmpty` stay as
they are: the slider lies over the chart and takes no room, and a session without heart rate has
no slider. As a patch against Activities' current `src/pages/Activity.tsx` (`git apply --check`
passes on a copy of it):

```diff
--- a/src/pages/Activity.tsx
+++ b/src/pages/Activity.tsx
@@ -6,12 +6,13 @@
 import { useFitFigures } from '../app/useFitFigures.ts';
 import { useSettlePage } from '../app/pageSettled.ts';
 import { HeartRate, HeartRateEmpty, HeartRateGhost, NO_HR } from '../charts/HeartRate.tsx';
+import { HeartRateScrub } from '../charts/HeartRateScrub.tsx';
 import { ChipLink } from '../components/Chip.tsx';
 import { ClockKey, ClockKeyGhost } from '../components/ClockKey.tsx';
 import { Ghost, GhostBlock, GhostDot } from '../components/Skeleton.tsx';
 import { SportDot } from '../components/SportDot.tsx';
 import { StatStrip, StatTile } from '../components/StatTile.tsx';
-import { TerrainSlot } from '../components/TerrainSlot.tsx';
+import { TerrainCard, TerrainCardGhost } from '../components/TerrainCard.tsx';
 import { fmtDur, keepTogether, when } from '../data/format.ts';
 import { maskDigits } from '../data/activityHint.ts';
 import { useActivities } from '../data/load.ts';
@@ -209,7 +210,7 @@
         </div>
       </section>

-      {e.d ? <TerrainSlot activity={{ id: hint.ids[at] ?? '', d: 'M0 0' }} /> : null}
+      {e.d ? <TerrainCardGhost activityId={hint.ids[at] ?? ''} /> : null}

       <section className={styles.card} aria-labelledby={ids.hr}>
         <div className={styles.cardHead}>
@@ -315,6 +316,8 @@
   useFitFigures(text, FACT_SIZE, a.id);
   // The part of the session clock its key points at (none for a route).
   const [part, setPart] = useState<ClockPart | null>(null);
+  // One position for the terrain, its profile and the heart-rate chart: seconds into the session.
+  const [seconds, setSeconds] = useState<number | null>(null);
   return (
     <>
       <section className={styles.hero} aria-labelledby={ids.hero}>
@@ -385,7 +388,7 @@
         </div>
       </section>

-      <TerrainSlot activity={a} />
+      <TerrainCard activityId={a.id} title={a.n} seconds={seconds} onSeconds={setSeconds} />

       {/* Without an HR series the section stays, empty, saying so (Detail.dc.html). */}
       <section className={styles.card} aria-labelledby={ids.hr}>
@@ -395,7 +398,13 @@
           </h2>
           <p className={styles.sub}>{hr ? hr.range : NO_HR}</p>
         </div>
-        {hr ? <HeartRate chart={hr} sport={sport} /> : <HeartRateEmpty duration={fmtDur(a.min)} />}
+        {hr ? (
+          <HeartRateScrub durationSeconds={a.min * 60} seconds={seconds} onSeconds={setSeconds}>
+            <HeartRate chart={hr} sport={sport} />
+          </HeartRateScrub>
+        ) : (
+          <HeartRateEmpty duration={fmtDur(a.min)} />
+        )}
       </section>

       {more.length ? (
```

**The card, page-side**, which replaces `TerrainSlot` (it imports nothing from `vendor/vert`). It
renders only for an activity with a baked scene, and it is the same size in every state: a 16:9 box
(at most 420 px tall) and a row of fixed height under it, empty in the ghost, the Suspense fallback
and the error fallback, filled once the scene is drawn. `TerrainCardGhost` renders nothing without
a scene, as the loaded card does.

```tsx
// src/components/TerrainCard.tsx
import { Component, lazy, Suspense, useId, type ReactNode } from 'react';
import scenes from 'virtual:vert-scenes';
import styles from './TerrainCard.module.css';

// Only this import pulls in Vert, and with it three.js: a chunk of its own, loaded on demand.
const VertTerrain = lazy(() => import('../vert/VertTerrain.tsx'));

/** Shows `fallback` instead of a child that threw (no WebGL, a lost context, a bug). */
class TerrainBoundary extends Component<{ children: ReactNode; fallback: ReactNode }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The scene's file name base: `--id` accepts no `:`, so `f:<sha1>` was baked as `f-<sha1>`. */
export const sceneIdOf = (activityId: string) => activityId.replace(/:/g, '-');

/** The sidecar hash of the activity's scene, or undefined when none was baked. */
export const sceneHashOf = (activityId: string) => scenes[sceneIdOf(activityId)];

const NOTE = 'Vert · scrub the profile or the heart-rate chart';

/** The 16:9 box and the fixed-height row under it, empty but for a message. */
function Placeholder({ message }: { message?: string }) {
  return (
    <>
      <div className={styles.box}>
        {message ? <p className={styles.message}>{message}</p> : null}
      </div>
      <div className={styles.below} />
    </>
  );
}

export interface TerrainCardProps {
  /** Activities' id: a Strava id, or `f:<sha1>` for a bare file. */
  activityId: string;
  title: string;
  seconds: number | null;
  onSeconds: (seconds: number | null) => void;
}

/** The Terrain card, only for an activity with a baked scene; the same size in every state. */
export function TerrainCard({ activityId, title, seconds, onSeconds }: TerrainCardProps) {
  const id = useId();
  const hash = sceneHashOf(activityId);
  if (hash === undefined) return null;
  return (
    <section className={styles.card} aria-labelledby={id}>
      <div className={styles.head}>
        <h2 id={id} className={styles.h2}>
          Terrain
        </h2>
        <p className={styles.note}>{NOTE}</p>
      </div>
      <TerrainBoundary fallback={<Placeholder message="The 3D terrain could not be shown." />}>
        <Suspense fallback={<Placeholder message="Loading the terrain…" />}>
          <VertTerrain
            key={hash}
            sceneId={sceneIdOf(activityId)}
            hash={hash}
            title={title}
            seconds={seconds}
            onSeconds={onSeconds}
          />
        </Suspense>
      </TerrainBoundary>
    </section>
  );
}

/** The card while the data loads: the same boxes, hidden from assistive tech and inert. */
export function TerrainCardGhost({ activityId }: { activityId: string }) {
  if (sceneHashOf(activityId) === undefined) return null;
  return (
    <section className={styles.card} aria-hidden="true" inert data-ghost>
      <div className={styles.head}>
        <h2 className={styles.h2}>Terrain</h2>
        <p className={styles.note}>{NOTE}</p>
      </div>
      <Placeholder />
    </section>
  );
}
```

Vert's custom properties are mapped to Activities' tokens on the card, so they reach both
components and nothing else on the page ([CSS custom properties](#8-css-custom-properties)):

```css
/* src/components/TerrainCard.module.css */
/*
 * The Terrain card, in every state (ghost, loading, loaded, failed): a 16:9 box and a row of fixed
 * height under it, so the page never moves when the data, the chunk or the scene arrives.
 * Vert's custom properties are mapped to Activities' tokens here, on the card, not on :root.
 */
.card {
  --surface: var(--empty-cell);
  --surface-strong: var(--hairline);
  --ink: var(--ink-primary);
  --muted: var(--ink-muted);
  --route: var(--sport-run);
  --white: var(--ink-primary);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: 28px;
  border: var(--hairline-width) solid var(--edge-strong);
  border-radius: var(--radius-card);
  background: var(--raised);
}

.head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-2);
}

.h2 {
  font-size: 22px;
  font-weight: 700;
  font-stretch: 110%;
  line-height: 1.2;
}

.note {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-muted);
}

.box {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  max-height: 420px;
  border-radius: var(--radius-swatch);
  background: var(--ground);
}

.message {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-muted);
}

/* The controls (one 44 px row) and the profile (164 px: its 140 px plot and the ticks), a gap
   between: the same height empty or full. */
.below {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 220px;
}

@media (max-width: 640px) {
  .card {
    padding: var(--space-5);
  }
}
```

**The lazy chunk**, the only module that imports Vert. It fills the card's box and row; the credit
sits in the box, in room the view keeps free with `insets`. The host's buttons keep Activities'
own focus ring (2 px ink, `base.css`); only Vert's two widgets ring in `--route`.

```tsx
// src/vert/VertTerrain.tsx
import { useEffect, useRef, useState } from 'react';
import {
  ElevationProfile,
  TERRAIN_ATTRIBUTION_LINK,
  TerrainView,
  metresAtTime,
  timeAtMetres,
  type Scene,
  type TerrainViewHandle,
  type TerrainViewMode,
} from '../../vendor/vert/index.js';
import '../../vendor/vert/vert.css';
import frame from '../components/TerrainCard.module.css';
import { loadScene } from './loadScene.ts';
import styles from './VertTerrain.module.css';

export interface VertTerrainProps {
  /** The scene's file name base (`8071241781`, `f-<sha1>`) and its sidecar's hash. */
  sceneId: string;
  hash: string;
  /** The activity's name, for the canvas's accessible name. */
  title: string;
  /** The page's time position: seconds since the run's first point, or null for none. */
  seconds: number | null;
  /** The user scrubbed the profile: the time there, or null (cleared, or a scene without times). */
  onSeconds: (seconds: number | null) => void;
}

/** Room the model keeps free at the bottom of the box for the credit's 44 px link. */
const INSETS = { top: 0, right: 0, bottom: 48, left: 0 };

const km = (metres: number) => (metres / 1000).toFixed(1);

/** What the canvas shows, in words (rounded: no decoded value is printed as it is). */
function describe(title: string, scene: Scene): string {
  const { route, markers, summary } = scene;
  const from = km(route.distance[0] ?? 0);
  const to = km(route.distance[route.distance.length - 1] ?? 0);
  const marks = [
    markers.finish ? 'start ○, finish ◉' : 'start and finish ○ (a loop)',
    markers.summit ? `highest point ▲ at km ${km(markers.summit.distance)}` : null,
  ].filter((mark) => mark !== null);
  return (
    `3D terrain of ${title}, ${km(summary.extent.x)} by ${km(summary.extent.y)} km, ` +
    `with the route drawn from km ${from} to km ${to}; markers: ${marks.join(', ')}.`
  );
}

/**
 * Vert's terrain and profile for one activity, inside the card's box and the row under it: lazy-
 * loaded, so three.js loads only here.
 */
export default function VertTerrain({
  sceneId,
  hash,
  title,
  seconds,
  onSeconds,
}: VertTerrainProps) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<TerrainViewMode>('oblique');
  // The scrub of a scene without times, which no time axis can drive.
  const [ownScrub, setOwnScrub] = useState<number | null>(null);
  const view = useRef<TerrainViewHandle>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadScene(sceneId, hash, controller.signal).then(
      (loaded) => {
        setScene(loaded);
        setMissing(loaded === null);
      },
      () => {
        if (!controller.signal.aborted) setMissing(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [sceneId, hash]);

  // A scene with times follows the page's clock; null off the drawn stretch (the trimmed ends).
  const timed = scene?.route.time != null;
  let scrub = ownScrub;
  if (scene && timed) scrub = seconds === null ? null : metresAtTime(scene, seconds);
  const onScrub = (metres: number | null) => {
    if (scene === null) return;
    if (timed) onSeconds(metres === null ? null : timeAtMetres(scene, metres));
    else setOwnScrub(metres);
  };

  const message = missing ? 'The terrain could not be loaded.' : 'Loading the terrain…';
  return (
    <>
      <div className={frame.box}>
        {scene ? (
          <div className={styles.layer}>
            <TerrainView
              ref={view}
              scene={scene}
              view={mode}
              exaggeration={1.6}
              scrub={scrub}
              insets={INSETS}
              ariaLabel={describe(title, scene)}
            />
          </div>
        ) : (
          <p className={frame.message}>{message}</p>
        )}
        <p className={styles.credit}>
          <a href={TERRAIN_ATTRIBUTION_LINK.href}>Elevation: {TERRAIN_ATTRIBUTION_LINK.text}</a>
        </p>
      </div>
      <div className={frame.below}>
        <div role="group" aria-label="Terrain view" className={styles.controls}>
          <button
            type="button"
            className={styles.button}
            disabled={!scene || mode === 'flat'}
            onClick={() => view.current?.rotateBy(Math.PI / 4)}
          >
            Rotate
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!scene}
            aria-pressed={mode === 'flat'}
            onClick={() => {
              setMode((m) => (m === 'flat' ? 'oblique' : 'flat'));
            }}
          >
            Flat
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!scene}
            onClick={() => view.current?.resetView()}
          >
            Reset
          </button>
        </div>
        {scene ? <ElevationProfile scene={scene} scrub={scrub} onScrub={onScrub} /> : null}
      </div>
    </>
  );
}
```

```css
/* src/vert/VertTerrain.module.css */
/* The view fills the card's box; the credit sits in the room `insets` keeps free at its foot. */
.layer {
  position: absolute;
  inset: 0;
}

.credit {
  position: absolute;
  right: var(--space-3);
  bottom: 0;
  left: var(--space-3);
  font-size: 12px;
  line-height: 1.4;
  color: var(--ink-muted);
}

/* One link, at least 44 px tall, as Activities' page checks require (two lines fit at 320 px). */
.credit a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: inherit;
}

/* One row of 44 px at every width (the card reserves exactly that). */
.controls {
  display: flex;
  gap: var(--space-2);
}

/* Activities' own focus ring (base.css, 2 px ink) applies: only Vert's widgets use --route. */
.button {
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: var(--hairline-width) solid var(--control-edge);
  border-radius: var(--radius-swatch);
  background: transparent;
  color: var(--ink-primary);
  font: inherit;
}

.button:disabled {
  color: var(--ink-muted);
}
```

**The heart-rate chart becomes a slider**, still without a row of its own:

- A transparent native range input lies over the chart's 140 px plot (the plot shows through; the
  cursor line is its thumb). It is the control for keyboards and screen readers. It steps by a
  minute, as its value text (H:MM) says; PageUp / PageDown and Home / End work as on any native
  slider.
- With hover (`@media (hover: hover)`: a mouse or a trackpad) the input also takes the pointer: a
  click or drag anywhere on the plot scrubs.
- Without hover (a phone, a tablet) the input takes no pointer events, so a swipe over the chart
  scrolls the page. A 44 px strip along the plot's foot, marked by tick marks at 0, ¼, ½ and ¾ on a
  base line (`--ink-muted`, 5.30:1 on the card), scrubs on a tap or a sideways drag; a vertical
  swipe there scrolls too (`touch-action: pan-y`; the browser then cancels the gesture and the
  position stays). The strip is `aria-hidden` and not focusable: the slider is the control.
  Activities' CSS allows only its two breakpoints, `(hover: hover)` and
  `(prefers-reduced-motion: reduce)` as media queries (`e2e/home.spec.ts`), hence the switch on
  hover, not on `(pointer: coarse)`.
- **Clear** (44 px, over the plot's top-right corner, only while there is a position) removes it
  for touch and mouse users, as Escape does for keyboards, and returns focus to the slider.

A known limitation: on a device with hover that also takes touch (a touch-screen laptop), the
input takes touches over the whole plot, so a swipe that scrolls the page can also move the
position.

If Activities' plot height changes, change the 140 px (and the strip's 96 px top) with it.

```tsx
// src/charts/HeartRateScrub.tsx
import { useRef, type PointerEvent, type ReactNode } from 'react';
import styles from './HeartRateScrub.module.css';

export interface HeartRateScrubProps {
  /** The chart's time axis, 0 to this many seconds (the session's elapsed time, whole minutes). */
  durationSeconds: number;
  /** The shared position, seconds since the run's first point, or null for none. */
  seconds: number | null;
  onSeconds: (seconds: number | null) => void;
  /** The chart itself: Activities' `HeartRate`, whose 140 px plot spans the elapsed time. */
  children: ReactNode;
}

/** Seconds per step: a key moves a minute, and the value text says H:MM. */
const STEP = 60;

/** How far a finger moves sideways before the strip scrubs, px (less, then lifted: a tap). */
const SLOP = 8;

const clock = (s: number) => {
  const minutes = Math.round(s / STEP);
  return `${String(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;
};

/**
 * A time chart made a slider, taking no room of its own (so the section keeps the height of its
 * loading skeleton):
 *
 * - **The slider**: a native range input over the plot, transparent (the cursor line is its thumb).
 *   It is the control keyboards and screen readers use; with hover (a mouse) it also takes the
 *   pointer anywhere on the plot.
 * - **Without hover** (touch): the input takes no pointer events, and a 44 px strip along the
 *   plot's foot, marked with ticks, scrubs instead, on a tap or a sideways drag. A vertical swipe,
 *   there or anywhere on the chart, scrolls the page and leaves the position alone.
 * - **Clear**, over the plot's corner while there is a position, removes it, as Escape does.
 */
export function HeartRateScrub({
  durationSeconds,
  seconds,
  onSeconds,
  children,
}: HeartRateScrubProps) {
  const slider = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ x: number; scrubbing: boolean } | null>(null);
  const at = seconds === null ? null : Math.min(1, Math.max(0, seconds / durationSeconds));

  /** The time under a pointer, whole minutes, within the axis. */
  const timeAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    return Math.round((share * durationSeconds) / STEP) * STEP;
  };

  return (
    <div className={styles.wrap}>
      {children}
      {at === null ? null : (
        <div
          className={styles.cursor}
          style={{ left: `${String(at * 100)}%` }}
          aria-hidden="true"
        />
      )}
      <input
        ref={slider}
        type="range"
        className={styles.slider}
        aria-label="Time in the session"
        min={0}
        max={durationSeconds}
        step={STEP}
        value={seconds === null ? 0 : Math.round(seconds / STEP) * STEP}
        aria-valuetext={seconds === null ? 'No position selected' : clock(seconds)}
        onChange={(event) => {
          onSeconds(Number(event.currentTarget.value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && seconds !== null) {
            event.preventDefault();
            onSeconds(null);
          }
        }}
      />
      {/* Without hover only: a gesture surface beside the slider, not a control. */}
      <div
        className={styles.strip}
        aria-hidden="true"
        onPointerDown={(event) => {
          gesture.current = { x: event.clientX, scrubbing: false };
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g) return;
          if (!g.scrubbing && Math.abs(event.clientX - g.x) > SLOP) {
            g.scrubbing = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          if (g.scrubbing) onSeconds(timeAt(event));
        }}
        onPointerUp={(event) => {
          if (gesture.current) onSeconds(timeAt(event));
          gesture.current = null;
        }}
        // The browser took the gesture (a vertical swipe scrolls the page): no change.
        onPointerCancel={() => {
          gesture.current = null;
        }}
      />
      {seconds === null ? null : (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear the position"
          onClick={() => {
            onSeconds(null);
            slider.current?.focus();
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
```

```css
/* src/charts/HeartRateScrub.module.css */
/* It all lies over the chart's 140 px plot (HeartRate.module.css `.svg`): no added height. */
.wrap {
  position: relative;
}

.cursor {
  position: absolute;
  top: 0;
  height: 140px;
  width: 2px;
  margin-left: -1px;
  background: var(--ink-primary);
  pointer-events: none;
}

/* The slider: keys and assistive technology everywhere; pointers only with hover (below). */
.slider {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 140px;
  margin: 0;
  appearance: none;
  background: transparent;
  pointer-events: none;
}

.slider::-webkit-slider-runnable-track {
  height: 100%;
  background: transparent;
}

.slider::-webkit-slider-thumb {
  width: 2px;
  height: 100%;
  appearance: none;
  background: transparent;
}

.slider::-moz-range-track {
  background: transparent;
}

.slider::-moz-range-thumb {
  width: 2px;
  height: 100%;
  border: 0;
  background: transparent;
}

/* Without hover (a phone, a tablet): the strip along the plot's foot scrubs, on a tap or a sideways
   drag, and a vertical swipe anywhere scrolls the page. Its ticks (at 0, ¼, ½ and ¾, on a base line)
   say where it is. */
.strip {
  position: absolute;
  top: 96px;
  left: 0;
  width: 100%;
  height: 44px;
  touch-action: pan-y;
  background:
    linear-gradient(var(--ink-muted), var(--ink-muted)) bottom / 100% 1px no-repeat,
    repeating-linear-gradient(to right, var(--ink-muted) 0 1px, transparent 1px 25%) bottom / 100%
      8px no-repeat;
}

/* With hover (a mouse, a trackpad): the slider takes the pointer anywhere on the plot; no strip.
   Activities' CSS allows this query, besides its two breakpoints. */
@media (hover: hover) {
  .slider {
    pointer-events: auto;
    cursor: col-resize;
  }

  .strip {
    display: none;
  }
}

.clear {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: var(--hairline-width) solid var(--control-edge);
  border-radius: var(--radius-swatch);
  background: var(--raised);
  color: var(--ink-primary);
  font: inherit;
}
```

What it does, as checked in the browser on the Coosa scene (a 3:07 session):

- With a mouse (1440 px): 1:00 on the heart-rate slider moves the profile to "km 7.6, 783 m" and
  the marker on the terrain with it; a click in the middle of the plot gives 1:34 (value 5640)
  and ArrowRight 1:35 (5700); 0:01 (inside the trimmed start) hides both ("No
  position selected"); End on the profile moves the heart-rate slider to 3:06 (11160); Escape on
  either, or Clear, clears both.
- On a phone (390 px, touch): a tap on the strip at its middle gives 1:34 and "km 10.4, 1,146 m";
  a tap higher on the plot changes nothing; vertical swipes on the upper plot and on the strip,
  both directions, scroll the page and leave the value as it was; a sideways drag on the strip
  from 20% to 70% gives 2:11; Clear (64 × 44 px) clears both and focuses the slider.

## 8. CSS custom properties

Vert reads these, each with a fallback (its value in Vert's style A, which suits a light page):

| property           | fallback                      | drives                                                                                                           |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--surface`        | `#e6eaee`                     | terrain fill and walls (read by the view at mount); climb bands in the profile                                   |
| `--surface-strong` | `#dce2e8`                     | the steepest climb's band                                                                                        |
| `--ink`            | `#1b2a3a`                     | terrain ridge lines, start ring and summit fill (view); profile line and fill (12%); the steepest climb's number |
| `--muted`          | `#5b6b7a`                     | distance ticks and climb numbers in the profile                                                                  |
| `--route`          | `#d9480f`                     | the route and scrub marker (view); the profile's scrub line and dot; the focus ring of both                      |
| `--white`          | `#ffffff`                     | the route's halo, start fill, summit edge, scrub ring (view); the profile dot's ring                             |
| `--font-mono`      | IBM Plex Mono, …, `monospace` | ticks and climb numbers (Vert loads no fonts)                                                                    |
| `--space-1`        | `4px`                         | climb numbers' inset                                                                                             |

- **Scope them to a wrapper** around both components (the example's card), not `:root`: the view
  reads its colours from the properties as they reach its own element, and the profile's CSS
  inherits them, so both follow the wrapper. A page that uses these names for something else keeps
  its meaning everywhere else. Activities already defines `--font-mono` (JetBrains Mono) and
  `--space-1` (4 px) on `:root`, which Vert then uses; it defines none of the colour names.
- **A dark page must set them.** The fallbacks are dark ink on light paper; the profile is
  transparent, so on a dark page they fail contrast. Map them to the page's own tokens. The
  example's mapping onto Activities' `tokens.css`, with its contrast:

  | Vert               | Activities token        | contrast                                                                                                 |
  | ------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------- |
  | `--surface`        | `--empty-cell` #1b1c1f  | terrain fill and climb bands; `--muted` climb numbers on it 4.99:1                                       |
  | `--surface-strong` | `--hairline` #26272b    | the steepest climb's band; its `--ink` number 12.98:1                                                    |
  | `--ink`            | `--ink-primary` #f0efec | profile line and ridge lines; 15.73:1 on the card (`--raised` #151619)                                   |
  | `--muted`          | `--ink-muted` #8c8b85   | ticks: 5.30:1 on the card; the credit in the box: 5.49:1 on `--ground` #111214                           |
  | `--route`          | `--sport-run` #d95926   | route, scrub marker, Vert's focus ring (non-text, 3:1 needed): 4.66:1 on the card, 4.39:1 on `--surface` |
  | `--white`          | `--ink-primary` #f0efec | the route's halo and the markers' rings                                                                  |

  `--sport-run` is the run colour, as identity: a page showing another sport can map `--route` to
  that sport's token instead (check it at 3:1 against `--raised` and `--empty-cell`).

- **`palette` and `routePalette`** props override the view's colours (`palette` is read once, at
  mount); the profile has no such props and follows the properties only. Prefer the properties, so
  the two stay in step.
- **Focus ring**: Vert's is `2px solid var(--route)`, offset 2px, on the view's wrapper and the
  profile's slider, and only there (its CSS scopes it to those two). Your own controls keep your
  page's ring: in the example, Activities' 2 px ink outline from `base.css`.

## 9. Accessibility

- **The canvas** is `role="img"` with your `ariaLabel`. Say what it shows: the activity, the
  ground's extent, the drawn stretch and the markers by shape (the example: "3D terrain of Coosa
  Backcountry Trail, 4.4 by 6.7 km, with the route drawn from km 0.2 to km 21.3; markers: start and
  finish ○ (a loop), highest point ▲ at km 11.3."). Not "3D terrain" alone.
- **Text alternative**: the canvas cannot hold data, so the page shows it as text: the activity's
  stats (Activities' hero already does). The profile numbers and shades each climb, and its slider
  describes them in words to screen readers; a page with room to spare can also list them (round
  the values, as in `describe` above).
- **Colour is never alone**: markers differ by shape (start ○, finish ◉, summit ▲, scrub ● with a
  white ring); climbs are shaded and numbered in the profile, the steepest also in a stronger band
  and ink. Keep it so in your own text (name the shapes, as above).
- **Keyboard**: the view's wrapper is in the tab order as soon as it has a scene (before the first
  frame is drawn); arrow keys orbit (Shift for bigger steps; not in the flat view), `+` / `-` zoom,
  and a visually hidden hint says so. The profile is one ARIA slider: arrows ±1% of the drawn
  route (Shift ±10%), PageUp / PageDown ±10%, Home / End to the drawn ends, Escape clears the
  position ([Escape](#escape-and-your-own-key-handlers) says when it is left to your page).
  Pointer: drag orbits, wheel or pinch zooms; press or drag on the profile scrubs.
- **No position**: with `scrub={null}` the slider's `aria-valuetext` is "No position selected"
  (its `aria-valuenow` is the drawn start, where the first key moves from).
- **Reduced motion**: with `prefers-reduced-motion: reduce` the intro camera move is a fade, and
  `rotateBy`, Flat and Reset cut instead of easing.
- **Your side**: buttons at least 44 × 44 px with text labels and a visible focus ring; the credit
  link and any text you add at 4.5:1 on its background; the view's box background is yours (the
  canvas is transparent).

## 10. Testing in the host

**jsdom.** jsdom has no WebGL, so pass `createRenderer` a stub; it also has no 2D canvas, which the
view does without. Query by role and name, as everywhere. In Activities this test lives in `src/`
(say `src/vert/VertTerrain.test.tsx`: Vitest collects `.tsx` tests only there), where
`tsconfig.app.json` has only `vite/client` types, so it references Node's types itself for
`node:fs`:

```tsx
// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ElevationProfile,
  TerrainView,
  VERT_LIB_VERSION,
  decodeScene,
  type TerrainRenderer,
} from '../../vendor/vert/index.js';

const scene = decodeScene(readFileSync('public/scenes/8071241781.scene'));

/** jsdom has no WebGL: the view draws into this stub instead. */
const createRenderer = (): TerrainRenderer => ({
  setPixelRatio: () => undefined,
  getPixelRatio: () => 1,
  setSize: () => undefined,
  render: () => undefined,
  dispose: () => undefined,
  forceContextLoss: () => undefined,
});

beforeEach(() => {
  // No 2D canvas in jsdom either (the view's labels use one); the view draws without it.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function Host({ onScrub }: { onScrub: (metres: number | null) => void }) {
  const [scrub, setScrub] = useState<number | null>(null);
  return (
    <>
      <TerrainView
        scene={scene}
        exaggeration={1.6}
        scrub={scrub}
        ariaLabel="3D terrain of a test run"
        createRenderer={createRenderer}
      />
      <ElevationProfile
        scene={scene}
        scrub={scrub}
        onScrub={(metres) => {
          setScrub(metres);
          onScrub(metres);
        }}
      />
    </>
  );
}

it('renders the terrain and drives the scrub from the profile', async () => {
  const onScrub = vi.fn();
  render(<Host onScrub={onScrub} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(screen.getByRole('img', { name: '3D terrain of a test run' })).toBeTruthy();
  const slider = screen.getByRole('slider', { name: 'Elevation profile' });
  expect(slider.getAttribute('aria-valuetext')).toBe('No position selected');
  fireEvent.keyDown(slider, { key: 'End' });
  expect(onScrub).toHaveBeenLastCalledWith(scene.route.distance[scene.route.distance.length - 1]);
  fireEvent.keyDown(slider, { key: 'Escape' });
  expect(onScrub).toHaveBeenLastCalledWith(null);
  expect(VERT_LIB_VERSION).toMatch(/^0\.1\.0\+/);
});
```

A committed scene is fine as a fixture (it holds no coordinates). Building one needs Vert's
repository, so tests use a baked file.

**axe.** Run it in a real browser, where the canvas draws and colours resolve: Activities'
Playwright suite (`@axe-core/playwright`, 0 violations at 1440, 768 and 390) covers the Activity
page once the card is there. Headless Chromium draws WebGL (software), which Vert's own end-to-end
tests rely on; wait for `canvas[role="img"][data-visible]` (set after the first frame) before
checking.

**Do not snapshot**: canvas pixels (they depend on the GPU, the device pixel ratio and three.js);
Vert's class names (`vert-<name>-<hash>`, which change with any CSS change); Vert's internal DOM
(only the roles, names, slider values and the handle are stable); decoded floats printed in full;
`VERT_LIB_VERSION` anywhere but the one pin test.

## 11. Changelog

Newest first. Each entry: the version, the date, then **breaking changes first** (what a host must
change: a new scene format version and the re-bake it needs, a new `three` version, a changed prop
or handle method), then additions, then fixes. A host updating across several versions reads every
entry in between.

### 0.1.0 (2026-10-19)

The first release of Vert as a library.

- **Scene format version 1** (`docs/SCENE.md`): height grid, drawn route with times, markers,
  climbs, whole-run totals, and the sidecar; no georeference.
- **`pnpm bake`**: GPX or points file to scene and sidecar, offline, deterministic, with id,
  privacy and pixel-pitch checks and the trim (200 m by default).
- **`dist-lib/`**: `TerrainView` (scenes only) and its five-method handle, `ElevationProfile`,
  `decodeScene` and `SceneError`, the custom-property contract, `VERT_LIB_VERSION`,
  `TERRAIN_ATTRIBUTION` and `TERRAIN_ATTRIBUTION_LINK`. Built against `three` 0.186.1 and React
  19.3.
- **Scrub sync**: `scrub` on both components (`null` for none), `onScrub` on the profile (`null`
  on Escape), controlled or uncontrolled, and `metresAtTime`, `timeAtMetres`, `sceneTimeRange`.
