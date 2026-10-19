# Vert library

Vert's 3D terrain view and elevation profile for a page that shows a baked `.scene` file (the
format is in Vert's `docs/SCENE.md`). These are the files `pnpm build:lib` writes to `dist-lib/`:

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
// One scrub for both, in metres from the run's real start:
<div className="vert-host">
  <div style={{ aspectRatio: '16 / 9', background: 'var(--surface)' }}>
    <TerrainView scene={scene} exaggeration={1.6} scrub={scrub} ariaLabel="3D terrain of …" />
  </div>
  <ElevationProfile scene={scene} scrub={scrub} onScrub={setScrub} />
</div>;
```

`TerrainView` fills its parent, and its canvas is transparent: give the box a size and a
background. The handle (`ref`) offers `rotateBy(radians)`, `resetView()`, `requestRender()`,
`focus()` and `camera()`. Those five are the stable API. `createRenderer` and `onRenderFrame` are
testing and instrumentation aids: `createRenderer` lets your jsdom tests render the view without
WebGL.

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
| `--white`          | `#ffffff`                     | the route's halo, start fill, summit edge, scrub ring (JS); the profile dot's ring                                  |
| `--font-mono`      | IBM Plex Mono, …, `monospace` | ticks and climb numbers                                                                                             |
| `--space-1`        | `4px`                         | climb numbers' inset                                                                                                |

"JS" marks the colours the terrain reads when it mounts. Its `palette` (`surface`, `ink`) and
`routePalette` (`route`, `halo`, `ink`) props override them.

Contrast is yours to keep on your colours: `--muted` and `--ink` on your page and on `--surface`,
at least 4.5:1; `--route` on your page, at least 3:1. The focus ring is a 2px `--route` outline,
offset 2px.

### A dark page

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

Show `TERRAIN_ATTRIBUTION` ("AWS Terrain Tiles / Mapzen (various sources)") wherever the terrain
appears. `TERRAIN_ATTRIBUTION_LINK.href` links Mapzen's list of the sources. `VERT_LIB_VERSION`
(`0.1.0+<git sha>`) says which build you vendored.
