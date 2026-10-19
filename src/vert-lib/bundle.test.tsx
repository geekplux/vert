/// <reference types="node" />
/**
 * The library as a host gets it: `vite.lib.config.ts` is built here (Vite's `build()`, into
 * node_modules/.tmp so the bundle's bare `react` / `three` imports resolve), then the built
 * `index.js` is imported and rendered with a decoded scene, and its files are checked: one ES
 * module importing nothing but React and three.js, no network code, one stylesheet that reads only
 * custom properties with fallbacks under `vert-` class names, and declarations that type a host's
 * use of the public API.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { useState } from 'react';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BufferGeometry, Camera, Color, Mesh, Object3D, ShaderMaterial } from 'three';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import type { TerrainRenderer, TerrainViewHandle } from './index';
import { expectNoAxeViolations } from '../test/axe';

type Library = typeof import('./index');

// Paths, not URLs: under jsdom the global `URL` is jsdom's, which Node's fs and url do not take.
const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'node_modules', '.tmp', `vert-lib-test-${String(process.pid)}`);
const read = (name: string) => readFileSync(join(OUT, name), 'utf8');

/** The committed Coosa scene (`pnpm bake` of the sample, trimmed 200 m), as a host loads it. */
function coosaSceneBytes(): Uint8Array {
  return readFileSync(join(ROOT, 'src', 'scene', 'fixtures', 'coosa-backcountry.scene'));
}

/** A renderer for jsdom (no WebGL), as a host's tests would pass it; it keeps what it drew. */
function fakeRenderer() {
  let pixelRatio = 1;
  const renderer = {
    setPixelRatio: (value: number) => {
      pixelRatio = value;
    },
    getPixelRatio: () => pixelRatio,
    setSize: vi.fn(),
    render: vi.fn<(scene: Object3D, camera: Camera) => void>(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
  return {
    createRenderer: () => renderer as unknown as TerrainRenderer,
    /** The three.js scene of the latest frame. */
    drawn: () => renderer.render.mock.lastCall?.[0],
  };
}

/** The colours the terrain mesh and the route were drawn in, as hex. */
function drawnColours(scene: Object3D | undefined) {
  const mesh = scene?.getObjectByName('terrain') as
    Mesh<BufferGeometry, ShaderMaterial> | undefined;
  const uniform = (name: string) => (mesh?.material.uniforms[name]?.value as Color).getHexString();
  const route = scene?.getObjectByName('route') as Line2 | undefined;
  return {
    surface: uniform('uSurface'),
    ink: uniform('uInk'),
    route: route?.material.color.getHexString(),
  };
}

/** The dark host of README.md, its tokens on a wrapper around Vert (the page keeps its own). */
const DARK_TOKENS: Record<string, string> = {
  '--surface': '#1d2a36',
  '--surface-strong': '#2a3a48',
  '--ink': '#e6edf3',
  '--muted': '#9aa8b5',
  '--route': '#ff8a3d',
  '--white': '#ffffff',
};

/** Every custom property vert.css reads (README.md lists them all). */
const CSS_PROPERTIES = [
  '--font-mono',
  '--ink',
  '--muted',
  '--route',
  '--space-1',
  '--surface',
  '--surface-strong',
  '--vert-focus',
  '--white',
];

let lib: Library;

beforeAll(async () => {
  await build({
    configFile: join(ROOT, 'vite.lib.config.ts'),
    root: ROOT,
    logLevel: 'silent',
    build: { outDir: OUT, emptyOutDir: true },
  });
  lib = (await import(/* @vite-ignore */ pathToFileURL(join(OUT, 'index.js')).href)) as Library;
}, 60_000);

afterAll(() => {
  rmSync(OUT, { recursive: true, force: true });
});

describe('the built library', () => {
  it('is one ES module, one stylesheet, the README, LICENSE, VERSION, the sample scene and the declarations of the public API only', () => {
    expect(readdirSync(OUT).sort()).toEqual([
      'LICENSE',
      'README.md',
      'VERSION',
      'fixtures',
      'index.d.ts',
      'index.js',
      'types',
      'vert.css',
    ]);
    // All a host copies: Vert's licence, the version as the bundle has it, the sample scene pair.
    expect(read('LICENSE')).toBe(readFileSync(join(ROOT, 'LICENSE'), 'utf8'));
    expect(read('VERSION')).toBe(`${lib.VERT_LIB_VERSION}\n`);
    expect(readdirSync(join(OUT, 'fixtures')).sort()).toEqual([
      'coosa-backcountry.scene',
      'coosa-backcountry.scene.json',
    ]);
    for (const name of ['coosa-backcountry.scene', 'coosa-backcountry.scene.json']) {
      const built = readFileSync(join(OUT, 'fixtures', name));
      expect(built.equals(readFileSync(join(ROOT, 'src', 'scene', 'fixtures', name)))).toBe(true);
    }
    // Every declaration the entry reaches, and nothing else: no renderer internals.
    const types = readdirSync(join(OUT, 'types'), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.d.ts'))
      .sort();
    expect(types).toEqual([
      'scene/decode.d.ts',
      'scene/error.d.ts',
      'scene/time.d.ts',
      'scene/types.d.ts',
      'terrain/attribution.d.ts',
      'vert-lib/ElevationProfile.d.ts',
      'vert-lib/TerrainView.d.ts',
      'vert-lib/index.d.ts',
      'vert-lib/types.d.ts',
      'vert-lib/version.d.ts',
    ]);
    // Relative imports carry their extensions (node16 / nodenext); packages are React and three.
    for (const name of types) {
      const source = read(join('types', name));
      for (const [, specifier = ''] of source.matchAll(
        /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g,
      )) {
        expect(specifier).toMatch(/^(\.{1,2}\/.*\.js|react|three)$/);
      }
    }
    expect(read('index.d.ts')).toBe("export * from './types/vert-lib/index.js';\n");
    // The README documents every custom property the CSS reads.
    const readme = read('README.md');
    for (const property of CSS_PROPERTIES) expect(readme).toContain(`\`${property}\``);
  });

  it('imports nothing but React and three.js, and holds no network code', () => {
    const js = read('index.js');
    const imports = [
      ...js.matchAll(/^import\s[^;]*?from\s*"([^"]+)"/gm),
      ...js.matchAll(/^import\s*"([^"]+)"/gm),
    ].map((m) => m[1] ?? '');
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier).toMatch(/^(react|react\/jsx-runtime|three|three\/examples\/jsm\/.+)$/);
    }
    // No other chunk to load, and nothing that talks to a network.
    expect(js).not.toMatch(/\bimport\s*\(/);
    for (const forbidden of [
      /\bfetch\s*\(/,
      /\/tiles\//,
      /XMLHttpRequest/,
      /TileLoader/,
      /sendBeacon/,
      /WebSocket/,
      /EventSource/,
      /createImageBitmap/,
    ]) {
      expect(js).not.toMatch(forbidden);
    }
    // Nor the code that reads coordinates or builds a heightfield.
    for (const name of ['gridTrackFromRun', 'buildHeightfield', 'lonLatToWorld', 'haversine']) {
      expect(js).not.toContain(name);
    }
  });

  it('reads only documented custom properties, each with a fallback, under vert- classes', () => {
    const css = read('vert.css');
    expect(css).not.toMatch(/var\(\s*--[\w-]+\s*\)/);
    const read_ = [...css.matchAll(/var\(\s*(--[\w-]+)\s*,/g)].map((m) => m[1]);
    expect([...new Set(read_)].sort()).toEqual(CSS_PROPERTIES);
    const classes = [...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? '');
    expect(classes.length).toBeGreaterThan(10);
    for (const name of classes) expect(name).toMatch(/^vert-/);
    // Focus ring: 2px outline in the host's --vert-focus, else --route, offset 2; both components.
    const ring = /outline:2px solid var\(--vert-focus,var\(--route,#d9480f\)\);outline-offset:2px/g;
    expect(css.match(ring)).toHaveLength(2);
    // Touch: the view, its canvas and the profile's plot let a vertical swipe scroll the page.
    expect(css.match(/touch-action:pan-y/g)).toHaveLength(3);
    expect(css).not.toMatch(/touch-action:none/);
    // No fonts or other files.
    expect(css).not.toMatch(/@font-face|url\(/);
  });

  it('exports its version and the elevation credit', () => {
    // `.dirty` when built from a checkout with uncommitted changes (as while developing).
    expect(lib.VERT_LIB_VERSION).toMatch(/^0\.2\.0\+([0-9a-f]{7,}(\.dirty)?|nogit)$/);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(lib.VERT_LIB_VERSION.startsWith(`${pkg.version}+`)).toBe(true);
    expect(lib.TERRAIN_ATTRIBUTION).toBe('AWS Terrain Tiles / Mapzen (various sources)');
    expect(lib.TERRAIN_ATTRIBUTION_LINK.text).toBe(lib.TERRAIN_ATTRIBUTION);
  });

  it('renders a decoded scene: the terrain as a labelled image and the profile slider', async () => {
    const { TerrainView, ElevationProfile, decodeScene, SceneError } = lib;
    expect(() => decodeScene(new Uint8Array(4))).toThrow(SceneError);
    const scene = decodeScene(coosaSceneBytes());
    // The fixture as its sidecar describes it: 21.1 km drawn of 21.5 km, 200 m off each end.
    const sidecar = JSON.parse(
      readFileSync(join(ROOT, 'src', 'scene', 'fixtures', 'coosa-backcountry.scene.json'), 'utf8'),
    ) as { summary: { drawnLength: number; trim: { start: number } } };
    expect(Math.round(scene.summary.drawnLength)).toBe(sidecar.summary.drawnLength);
    expect(scene.route.distance[0]).toBe(sidecar.summary.trim.start);
    const { createRenderer, drawn } = fakeRenderer();
    const ref = { current: null as TerrainViewHandle | null };
    function Host() {
      const [scrub, setScrub] = useState<number | null>(scene.route.distance[0] ?? 0);
      return (
        <main>
          <TerrainView
            ref={ref}
            scene={scene}
            exaggeration={1.6}
            scrub={scrub}
            ariaLabel="3D terrain of the run"
            createRenderer={createRenderer}
          />
          <ElevationProfile scene={scene} scrub={scrub} onScrub={setScrub} />
        </main>
      );
    }
    const { container } = render(<Host />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const canvas = screen.getByRole('img', { name: '3D terrain of the run' });
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.className).toMatch(/^vert-canvas-/);
    expect(drawn()?.getObjectByName('route')).toBeDefined();
    // The handle is the five stable methods, nothing of the renderer.
    expect(Object.keys(ref.current ?? {}).sort()).toEqual([
      'camera',
      'focus',
      'requestRender',
      'resetView',
      'rotateBy',
    ]);
    expect(ref.current?.camera()).toMatchObject({ view: 'oblique', zoom: 1 });
    const slider = screen.getByRole('slider', { name: 'Elevation profile' });
    expect(slider.getAttribute('aria-valuemin')).toBe('200');
    expect(slider.getAttribute('aria-valuetext')).toMatch(/^km 0\.2, \d+ m$/);
    await expectNoAxeViolations(container);
  });

  it('syncs a host’s time axis with the scrub: the time helpers, onScrub and null', async () => {
    const {
      TerrainView,
      ElevationProfile,
      decodeScene,
      metresAtTime,
      timeAtMetres,
      sceneTimeRange,
    } = lib;
    const scene = decodeScene(coosaSceneBytes());
    const range = sceneTimeRange(scene);
    if (!range) throw new Error('the fixture has times');
    expect(range.start).toBeGreaterThan(0);
    // Inside the drawn stretch, a time maps to metres and back; in the trimmed start, to nothing.
    const half = (range.start + range.end) / 2;
    const metres = metresAtTime(scene, half);
    expect(metres).toBeGreaterThan(200);
    expect(timeAtMetres(scene, metres ?? Number.NaN)).toBeCloseTo(half, 6);
    expect(metresAtTime(scene, range.start / 2)).toBeNull();
    expect(timeAtMetres(scene, 100)).toBeNull();

    const { createRenderer, drawn } = fakeRenderer();
    const reported: (number | null)[] = [];
    // A host driving the scrub from its own time (half-way), and following the profile back.
    function Host() {
      const [scrub, setScrub] = useState<number | null>(metres);
      return (
        <main>
          <TerrainView
            scene={scene}
            exaggeration={1.6}
            scrub={scrub}
            ariaLabel="3D terrain of the run"
            createRenderer={createRenderer}
          />
          <ElevationProfile
            scene={scene}
            scrub={scrub}
            onScrub={(m) => {
              reported.push(m);
              setScrub(m);
            }}
          />
          <p>
            {scrub === null
              ? 'No time'
              : `${String(Math.round(timeAtMetres(scene, scrub) ?? 0))} s`}
          </p>
        </main>
      );
    }
    const { container } = render(<Host />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const marker = () => drawn()?.getObjectByName('marker-scrub');
    expect(marker()?.visible).toBe(true);
    expect(screen.getByText(`${String(Math.round(half))} s`)).toBeDefined();
    const slider = screen.getByRole('slider', { name: 'Elevation profile' });
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(reported).toEqual([200]);
    expect(screen.getByText(`${String(Math.round(range.start))} s`)).toBeDefined();
    fireEvent.keyDown(slider, { key: 'Escape' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(reported).toEqual([200, null]);
    expect(marker()?.visible).toBe(false);
    expect(slider.getAttribute('aria-valuetext')).toBe('No position selected');
    expect(slider.getAttribute('aria-valuenow')).toBe('200');
    await expectNoAxeViolations(container);
  });

  it('takes Vert’s tokens from a wrapper around it, and a host’s palette over them', async () => {
    const { TerrainView, ElevationProfile, decodeScene } = lib;
    const scene = decodeScene(coosaSceneBytes());
    // The page's own --ink means something else; Vert's tokens sit on its wrapper only.
    document.documentElement.style.setProperty('--ink', '#000000');
    const views = [fakeRenderer(), fakeRenderer()];
    const { container } = render(
      <main style={{ background: '#111214', color: '#e6edf3' }}>
        <div className="vert-host" style={DARK_TOKENS}>
          <TerrainView
            scene={scene}
            exaggeration={1.6}
            ariaLabel="Terrain from the wrapper's tokens"
            createRenderer={views[0]?.createRenderer}
          />
          <ElevationProfile scene={scene} scrub={0} onScrub={() => undefined} />
        </div>
        <TerrainView
          scene={scene}
          exaggeration={1.6}
          ariaLabel="Terrain in the host's palette"
          createRenderer={views[1]?.createRenderer}
          palette={{ surface: '#203040', ink: '#d0e0f0' }}
          routePalette={{ route: '#ffaa00', halo: '#ffffff', ink: '#000000' }}
        />
      </main>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(drawnColours(views[0]?.drawn())).toEqual({
      surface: '1d2a36',
      ink: 'e6edf3',
      route: 'ff8a3d',
    });
    expect(drawnColours(views[1]?.drawn())).toEqual({
      surface: '203040',
      ink: 'd0e0f0',
      route: 'ffaa00',
    });
    // jsdom has no layout, so axe skips contrast here; e2e/library-host.spec.ts checks it in a browser.
    await expectNoAxeViolations(container);
    document.documentElement.style.removeProperty('--ink');
  });

  it('declares every exported type for a host, under bundler and nodenext resolution', () => {
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    const host = join(OUT, 'host');
    mkdirSync(host, { recursive: true });
    writeFileSync(
      join(host, 'host.tsx'),
      `import { useRef, useState } from 'react';
import {
  ElevationProfile,
  SceneError,
  TERRAIN_ATTRIBUTION,
  TERRAIN_ATTRIBUTION_LINK,
  TerrainView,
  VERT_LIB_VERSION,
  decodeScene,
  metresAtTime,
  sceneTimeRange,
  timeAtMetres,
  type ElevationProfileProps,
  type RoutePalette,
  type Scene,
  type SceneErrorReason,
  type SceneTimeRange,
  type TerrainPalette,
  type TerrainViewHandle,
  type TerrainViewProps,
} from '../index.js';

export function Host({ bytes }: { bytes: Uint8Array }) {
  let scene: Scene | null = null;
  let reason: SceneErrorReason | null = null;
  try {
    scene = decodeScene(bytes);
  } catch (error) {
    if (error instanceof SceneError) reason = error.reason;
  }
  const ref = useRef<TerrainViewHandle>(null);
  const [scrub, setScrub] = useState<number | null>(scene?.route.distance[0] ?? 0);
  const palette: TerrainPalette = { surface: '#203040', ink: '#e0e8f0' };
  const routePalette: RoutePalette = { route: '#ff8a3d', halo: '#ffffff', ink: '#0b1620' };
  const view: TerrainViewProps = {
    scene,
    exaggeration: 1.6,
    ariaLabel: 'Terrain',
    palette,
    routePalette,
    scrub,
  };
  const version: string = VERT_LIB_VERSION;
  const credit: string = TERRAIN_ATTRIBUTION + TERRAIN_ATTRIBUTION_LINK.href;
  const length: number = scene ? scene.summary.drawnLength : 0;
  ref.current?.rotateBy(1);
  ref.current?.resetView();
  ref.current?.requestRender();
  ref.current?.focus();
  const azimuth: number | undefined = ref.current?.camera()?.azimuth;
  // A host's own time axis: its position drives the scrub, the profile's moves come back.
  const range: SceneTimeRange | null = scene ? sceneTimeRange(scene) : null;
  const fromChart: number | null = scene && range ? metresAtTime(scene, range.start) : null;
  const [seconds, setSeconds] = useState<number | null>(null);
  const onScrub = (metres: number | null): void => {
    setScrub(metres);
    setSeconds(scene && metres !== null ? timeAtMetres(scene, metres) : null);
  };
  const profile: ElevationProfileProps | null = scene ? { scene, scrub, onScrub } : null;
  // Uncontrolled: no scrub, onScrub optional.
  const loose: ElevationProfileProps | null = scene ? { scene } : null;
  return (
    <>
      <TerrainView ref={ref} {...view} />
      {profile && <ElevationProfile {...profile} />}
      {loose && <ElevationProfile {...loose} onScrub={setScrub} />}
      <p>{[version, credit, length, reason, azimuth, fromChart, seconds].join(' ')}</p>
    </>
  );
}
`,
    );
    for (const resolution of ['bundler', 'nodenext'] as const) {
      writeFileSync(
        join(host, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            lib: ['ES2023', 'DOM', 'DOM.Iterable'],
            module: resolution === 'bundler' ? 'ESNext' : 'NodeNext',
            moduleResolution: resolution,
            jsx: 'react-jsx',
            strict: true,
            noEmit: true,
            types: [],
            typeRoots: [join(ROOT, 'node_modules', '@types')],
          },
          files: ['host.tsx'],
        }),
      );
      // Throws, with tsc's output, on any error: an unresolved type fails the host's code.
      execFileSync(process.execPath, [tsc, '-p', join(host, 'tsconfig.json')], {
        cwd: ROOT,
        encoding: 'utf8',
      });
    }
  }, 60_000);
});
