# Vert library

Vert's 3D terrain view and elevation profile for a page that shows a baked `.scene` file (the
format is in Vert's `docs/SCENE.md`). The full guide for a host (vendoring, baking scenes, caching,
scrub sync with a time chart, a worked example, testing, the changelog) is
[docs/INTEGRATION.md](https://github.com/geekplux/vert/blob/main/docs/INTEGRATION.md); this
file is the reference that travels with the build.

These are the files `pnpm build:lib` writes to `dist-lib/`:

- `index.js`: one ES module. It imports `react`, `react/jsx-runtime`, `three` and
  `three/examples/jsm/…` modules, and the host installs those. Nothing else is imported, nothing
  is fetched, and nothing reads a latitude or longitude.
- `vert.css`: the components' styles. Load it once. Its class names are prefixed `vert-` and
  hashed. It loads no fonts.
- `index.d.ts` and `types/`: the type declarations. Relative imports carry `.js` extensions, so
  they resolve under `moduleResolution` `bundler`, `node16` and `nodenext`.

```tsx
import { ElevationProfile, TerrainView, decodeScene, type Scene } from './vendor/vert/index.js';
import './vendor/vert/vert.css';

const scene: Scene = decodeScene(new Uint8Array(await (await fetch(url)).arrayBuffer()));
// One scrub for both, in metres from the run's real start (null: none):
const [scrub, setScrub] = useState<number | null>(null);
<div className="vert-host">
  <div style={{ aspectRatio: '16 / 9', background: 'var(--surface)' }}>
    <TerrainView scene={scene} exaggeration={1.6} scrub={scrub} ariaLabel="3D terrain of …" />
  </div>
  <ElevationProfile scene={scene} scrub={scrub} onScrub={setScrub} />
</div>;
```

`TerrainView` fills its parent, and its canvas is transparent: give the box a size and a
background. The profile is transparent too: it draws on whatever is behind it.

## The stable API

These are the parts a host may rely on: the exports of `index.js` and their types, the five
methods of the view's handle, and the keyboard model below. `createRenderer` and `onRenderFrame`
are testing and instrumentation aids: `createRenderer` lets your jsdom tests render the view
without WebGL.

### The view's handle

`ref` on `TerrainView` gives a `TerrainViewHandle` with exactly these methods (a test pins their
names and arities):

| Method              | What it does                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `rotateBy(radians)` | Orbits around the vertical axis (eased; instant with reduced motion). Ignored in the flat view. |
| `resetView()`       | Back to the default framing of the current view (oblique or flat).                              |
| `requestRender()`   | Draws again on the next frame (the view draws only while something moves).                      |
| `focus()`           | Moves keyboard focus to the view, whose keys orbit and zoom (below).                            |
| `camera()`          | The camera as the user left it (`azimuth`, `polar`, `zoom`, `view`); null before mount.         |

The view has no buttons of its own. A host builds its own, at least 44 × 44 px, with a visible
focus ring and a text label or accessible name:

```tsx
const view = useRef<TerrainViewHandle>(null);
const [mode, setMode] = useState<TerrainViewMode>('oblique');

<TerrainView ref={view} view={mode} scene={scene} exaggeration={1.6} scrub={scrub} ariaLabel="…" />
<button type="button" onClick={() => view.current?.rotateBy(Math.PI / 4)}>Rotate</button>
<button type="button" aria-pressed={mode === 'flat'}
  onClick={() => setMode((m) => (m === 'flat' ? 'oblique' : 'flat'))}>Flat</button>
<button type="button" onClick={() => view.current?.resetView()}>Reset</button>
```

Flat is the `view` prop, not a method: `'flat'` is top-down and north up, with no orbit;
`'oblique'` is the 3D view. Changing it eases between the two (a cut with reduced motion).
`focus()` suits a "Rotate with the keyboard" link or a shortcut that hands the keys to the view.

### Keyboard

- **The view**: a focusable wrapper around the canvas (`role="img"` with your `ariaLabel`), in the
  tab order as soon as it has a scene (before the first frame). Arrow keys orbit (← → around,
  ↑ ↓ up and down; Shift for steps three times as big; not in the flat view), `+` and `-` (or `=`
  and `_`) zoom. A visually hidden hint says so to screen readers. Pointer: drag orbits, wheel or
  pinch zooms. Touch: a vertical one-finger swipe scrolls the page (`touch-action: pan-y`), a
  sideways drag orbits (and tilts once it has started sideways), two fingers zoom.
- **The profile**: one ARIA slider (`role="slider"`). Arrow keys move ±1% of the drawn route
  (Shift ±10%), PageUp / PageDown ±10%, Home / End to the drawn ends, Escape clears the position.
  Pointer: press or drag anywhere on the plot. Touch: a tap, or a sideways drag past 8 px, sets the
  position; a vertical swipe scrolls the page and sets nothing.

Both show a 2px focus ring, offset 2px, in `--vert-focus` (default `--route`).

## Scrub sync

The scrub is a position along the run in **metres from its real start** (the scene's distances:
a drawn route trimmed by 200 m starts at 200). Both components take it as `scrub`. Only the
profile takes input: the view's drags and keys orbit, so it has no scrub input of its own and no
`onScrub`.

- **`scrub: number | null`** on both. `null` is "no position": the view hides its scrub marker and
  the profile draws no scrub line or dot. A number off the drawn route shows at its nearer end; a
  number that is not finite counts as `null`.
- **`onScrub(metres: number | null)`** on `ElevationProfile` is called whenever the user moves the
  scrub there: on pointer press and while dragging, and on the slider's keys (arrows, Shift +
  arrows, PageUp / PageDown, Home / End), with the new position clamped to the drawn route. It is
  called with **`null` when the user presses Escape** on the slider while there is a position.
  Nothing else calls it: not the pointer leaving the plot (the profile scrubs on press and drag,
  not on hover, so the position stays where it was put), not blur, and not your own changes of
  `scrub` or `scene`.
- **Escape**: when it clears a position, the profile calls `preventDefault()` on the keydown. It
  does not stop the event: your own keydown handlers still get it, with `event.defaultPrevented`
  true, so **check `event.defaultPrevented` in your Escape handlers** before acting on it (a
  native `<dialog>` does: it stays open on that press). Escape is left alone (not prevented) when
  there is no position, and on a controlled profile without `onScrub` (read-only), where clearing
  could not show, so a dialog around Vert closes. If you pass `onScrub`, handle `null`: Escape is
  prevented on the assumption that you clear the scrub.
- **Controlled**: pass `scrub` (a number or `null`) and the profile shows your value, always. A
  move reaches the screen when you pass the reported metres back as `scrub`; if you do not, the
  profile stays where you put it. **Uncontrolled**: leave `scrub` out (`undefined`) and the
  profile keeps its own position, starting at none, and still reports every move through
  `onScrub`; a new `scene` starts it at none again (without calling `onScrub`). Choose one for the
  component's lifetime.
- **No position, for screen readers**: an ARIA slider must have a value, so with `scrub={null}`
  the slider's `aria-valuenow` is the drawn route's start (where the first key moves from) and its
  `aria-valuetext` is "No position selected", which is what screen readers announce. The first key
  or press always reports, even a move to the start.

### Time and distance

A scene baked from a run with times carries them per point (seconds since the run's first point,
`scene.route.time`). Three pure functions map between your time axis and the scrub:

- `metresAtTime(scene, seconds): number | null`: the scrub for a time on your chart.
- `timeAtMetres(scene, metres): number | null`: the time for a scrub `onScrub` reported.
- `sceneTimeRange(scene): { start, end } | null`: the stretch of your time axis that the drawn
  route covers. Your chart spans the whole run from 0; outside this stretch (the trimmed ends)
  there is no scrub, so you can shade those parts of your chart or skip them.

Their rules: `null` for a scene without times, for a time or distance off the drawn stretch (not
clamped, so the scrub is hidden rather than parked at an end where the runner was not), and for a
non-finite input. They interpolate linearly between the route's points. A stop is one long step
of the evenly spaced route, so the scrub moves slowly through it; where a route repeats a distance
while time goes on, `metresAtTime` stays at that distance and `timeAtMetres` gives the first time
there. Each call is a binary search (O(log n)) and allocates nothing.

```tsx
const [scrub, setScrub] = useState<number | null>(null);
// Your chart's position, seconds since the run's first point, drives Vert:
const onChartPosition = (seconds: number | null) =>
  setScrub(seconds === null ? null : metresAtTime(scene, seconds));
// Vert's profile drives your chart's highlight:
const chartTime = scrub === null ? null : timeAtMetres(scene, scrub);

<TerrainView scene={scene} exaggeration={1.6} scrub={scrub} ariaLabel="…" />
<ElevationProfile scene={scene} scrub={scrub} onScrub={setScrub} />
<HeartRateChart highlight={chartTime} onPosition={onChartPosition} />
```

## Custom properties

Vert draws in its own colours, Style A: light paper and dark ink. It reads these CSS custom
properties, each with a fallback (its value in Vert), so a page that sets none of them still gets
Style A. The terrain reads its colours from the properties as they reach the view, and the
profile's CSS reads them the same way. **Set them on a wrapper around Vert**, not on `:root`, when
your page already uses these names for something else, and both components follow.

| Property           | Fallback                      | Drives                                                                                                              |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--surface`        | `#e6eaee`                     | terrain fill and walls (JS); climb bands in the profile                                                             |
| `--surface-strong` | `#dce2e8`                     | the steepest climb's band                                                                                           |
| `--ink`            | `#1b2a3a`                     | terrain ridge lines (JS); start ring and summit fill (JS); profile line and fill (12%); the steepest climb's number |
| `--muted`          | `#5b6b7a`                     | distance ticks and climb numbers in the profile                                                                     |
| `--route`          | `#d9480f`                     | the route and scrub marker on the terrain (JS); the profile's scrub line and dot; the focus ring                    |
| `--vert-focus`     | `--route`                     | the focus ring of the view and the profile (set it to your page's own focus colour)                                 |
| `--white`          | `#ffffff`                     | the route's halo, start fill, summit edge, scrub ring (JS); the profile dot's ring                                  |
| `--font-mono`      | IBM Plex Mono, …, `monospace` | ticks and climb numbers                                                                                             |
| `--space-1`        | `4px`                         | climb numbers' inset                                                                                                |

"JS" marks the colours the terrain reads when it mounts. Its `palette` (`surface`, `ink`) and
`routePalette` (`route`, `halo`, `ink`) props override them.

Contrast is yours to keep on your colours: `--muted` and `--ink` on your page and on `--surface`,
at least 4.5:1; `--route` (or `--vert-focus`) on your page, at least 3:1. The focus ring is a 2px
outline in `--vert-focus`, falling back to `--route`, offset 2px.

### A dark page

The fallbacks suit a light page only. The profile is transparent, so on a dark page Style A's
`--ink` and `--muted` fallbacks fail contrast against your background: a dark page must set the
properties, as in this worked example.

```css
.vert-host {
  --surface: #1d2a36;
  --surface-strong: #2a3a48;
  --ink: #e6edf3;
  --muted: #9aa8b5;
  --route: #ff8a3d;
  --white: #ffffff;
}
```

On a `#111214` page these colours give `--muted` 7.7:1 on the page and 6.0:1 on `--surface`, and
`--ink` 9.9:1 on `--surface-strong`. Vert's end-to-end test renders this example
(`e2e/library-host.spec.ts`) and runs axe on it, contrast included.

## Credit

You must show `TERRAIN_ATTRIBUTION` ("AWS Terrain Tiles / Mapzen (various sources)") wherever
the terrain appears, linked to `TERRAIN_ATTRIBUTION_LINK.href`, Mapzen's list of the sources and
the credit each asks for. `VERT_LIB_VERSION` (`0.1.0+<git sha>`) says which build you vendored.
