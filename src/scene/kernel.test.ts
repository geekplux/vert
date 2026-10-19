// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
/**
 * The kernel-width attack (pitchAttack.ts, `kernelWidth`): fitting the roll-off of a scene grid's
 * spectrum recovers the smoothing kernel's width in samples. The width must be what the published
 * zoom and spacing predict (`publishedKernelWidth`), not what the true pixel size would give
 * (1.5 real pixels, smaller by cos(latitude)), so it adds nothing to what the zoom band says.
 * Synthetic tiles at 0°, 35°, 46° and 60° through the real mosaic → sampler path; real Coosa and
 * Lavaredo terrain when its tiles are in the local cache (testTiles.ts; never fetched).
 */
import { describe, expect, it } from 'vitest';
import { haversine, lonLatToWorld, worldToLonLat, type Bounds } from '../lib/geo';
import type { RunTrack } from '../page/types';
import { kernelWidthFactor } from '../lib/smoothSample';
import { buildHeightfield, type Heightfield } from '../terrain/heightfield';
import { SCENE_HEIGHTFIELD_OPTIONS, buildScene, type SceneRun } from './build';
import { decodeScene } from './decode';
import { encodeScene } from './encode';
import { PIXEL_M_Z0, kernelSigma, kernelWidth } from './pitchAttack';
import { syntheticTiles } from './testing';
import { cachedSceneHeightfield, hasCachedTiles, realRoutes, trackBounds } from './testTiles';
import type { SceneGrid } from './types';

const NO_RUN: SceneRun = { distance: 0, vert: NaN, startTime: NaN, climbs: [] };

function centreLatitude(hf: Heightfield): number {
  const nw = lonLatToWorld(hf.bounds.west, hf.bounds.north);
  const se = lonLatToWorld(hf.bounds.east, hf.bounds.south);
  return worldToLonLat(0, (nw.y + se.y) / 2).lat;
}

function sceneGrid(hf: Heightfield, track: RunTrack, run: SceneRun = NO_RUN): SceneGrid {
  const distance = Math.max(run.distance, track.cumulative.at(-1) ?? 0);
  return decodeScene(encodeScene(buildScene(hf, track, { ...run, distance }))).grid;
}

function lineAcross(b: Bounds): RunTrack {
  const p = { lat: (2 * b.north + b.south) / 3, lon: 0.8 * b.west + 0.2 * b.east };
  const q = { lat: (b.north + 2 * b.south) / 3, lon: 0.2 * b.west + 0.8 * b.east };
  return {
    lat: Float64Array.of(p.lat, q.lat),
    lon: Float64Array.of(p.lon, q.lon),
    ele: null,
    cumulative: Float64Array.of(0, haversine(p, q)),
    time: null,
  };
}

/**
 * The kernel width the roll-off fit finds (geometric mean of the axes it can fit; `NaN` when it
 * can fit neither), what the published zoom and spacing predict, what a kernel of 1.5 real
 * pixels (the leaking rule) would give, and the latitude an attacker assuming that rule reads.
 */
function examine(grid: SceneGrid, latitude: number) {
  const cos = Math.cos((latitude * Math.PI) / 180);
  const fits = (['x', 'y'] as const).map((axis) => kernelWidth(grid, axis));
  const usable = fits.filter((f) => Number.isFinite(f) && f > 0);
  const fitted =
    usable.length > 0 ? Math.exp(usable.reduce((a, f) => a + Math.log(f), 0) / usable.length) : NaN;
  const mean = (cosine: number) =>
    Math.sqrt(kernelSigma(grid, 'x', cosine) * kernelSigma(grid, 'y', cosine)) *
    kernelWidthFactor();
  const published = mean(1);
  const realPixels = mean(cos);
  const implied = (Math.acos(Math.min(1, fitted / published)) * 180) / Math.PI;
  return { fits, fitted, published, realPixels, implied };
}

function report(label: string, latitude: number, r: ReturnType<typeof examine>) {
  console.log(
    `${label}: fitted ${r.fits.map((f) => f.toFixed(3)).join('/')} (mean ${r.fitted.toFixed(3)}) samples; published ${r.published.toFixed(3)}; 1.5 real px ${r.realPixels.toFixed(3)}; old-rule latitude ${r.implied.toFixed(1)}° (true ${latitude.toFixed(1)}°)`,
  );
}

/**
 * The fit is consistent with the published width (within `tolerance` in log), and where the
 * leaking rule would differ from it by more than 15%, it is nearer the published width.
 */
function expectNoLatitude(r: ReturnType<typeof examine>, tolerance: number) {
  if (!Number.isFinite(r.fitted)) return; // nothing to fit: the attack gets nothing either
  const toPublished = Math.abs(Math.log(r.fitted / r.published));
  expect(toPublished).toBeLessThan(tolerance);
  if (r.published / r.realPixels > 1.15) {
    expect(toPublished).toBeLessThan(Math.abs(Math.log(r.fitted / r.realPixels)));
  }
}

describe('kernel-width attack on synthetic tiles', () => {
  // Strong pixel noise, so the spectrum stands above the quantisation floor long enough to fit.
  const tiles = syntheticTiles({ noise: 40 });
  const grids = async (latitude: number) => {
    // About 5 × 4 km on the ground: zoom 13 up to 46°, zoom 12 at 60°.
    const dLon = 5000 / (111_320 * Math.cos((latitude * Math.PI) / 180));
    const bounds = { west: 10, east: 10 + dLon, south: latitude, north: latitude + 4000 / 111_320 };
    const hf = await buildHeightfield(bounds, { ...SCENE_HEIGHTFIELD_OPTIONS, fetchTile: tiles });
    return { grid: sceneGrid(hf, lineAcross(bounds)), latitude: centreLatitude(hf), zoom: hf.zoom };
  };

  it('finds the same width at 0°, 35° and 46° (same zoom and spacing): the published one', async () => {
    const results = [];
    for (const latitude of [0, 35, 46]) {
      const { grid, latitude: centre, zoom } = await grids(latitude);
      const r = examine(grid, centre);
      report(`${String(latitude)}° z${String(zoom)}`, centre, r);
      expectNoLatitude(r, 0.15);
      results.push(r.fitted);
    }
    // A width that followed the real pixel would shrink by cos(46°) = 0.69 across these.
    const spread = Math.max(...results) / Math.min(...results);
    expect(spread).toBeLessThan(1.08);
  });

  it('at 60° (zoom 12) the width is the published one, not 1.5 real pixels', async () => {
    const { grid, latitude, zoom } = await grids(60);
    const r = examine(grid, latitude);
    report(`60° z${String(zoom)}`, latitude, r);
    expectNoLatitude(r, 0.3);
  });
});

/** The stretch of `track` between two distances. */
function stretch(track: RunTrack, from: number, to: number): RunTrack {
  const first = track.cumulative.findIndex((d) => d >= from);
  let last = track.cumulative.findIndex((d) => d > to);
  if (last < 0) last = track.cumulative.length;
  const cut = (a: Float64Array | null) => (a ? a.slice(first, last) : null);
  return {
    lat: track.lat.slice(first, last),
    lon: track.lon.slice(first, last),
    ele: cut(track.ele),
    cumulative: track.cumulative.slice(first, last),
    time: cut(track.time),
  };
}

/** The latitude band in which `buildHeightfield` would choose the grid's zoom (degrees). */
function zoomBand(grid: SceneGrid): [number, number] {
  const spacing = (grid.metresPerSample.x + grid.metresPerSample.y) / 2;
  const extent = spacing * (Math.max(grid.width, grid.height) - 1);
  const low = (extent * 2 ** grid.zoom) / (PIXEL_M_Z0 * 512);
  const high = grid.zoom >= 14 ? 1 : Math.min(1, 2 * low);
  const deg = (c: number) => (Math.acos(Math.min(1, c)) * 180) / Math.PI;
  return [deg(high), deg(low)];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
};

/**
 * Real relief is no power law times a Gaussian, so single fits spread by ±30% or more (and fail
 * on some grids); a kernel tied to the real pixel would still pull them towards
 * `realPixels`. So the real cases are judged together, over every stretch whose tiles are cached.
 */
describe('kernel-width attack on real terrain (cached tiles)', () => {
  const cases = realRoutes().flatMap(({ name, run, drawn }) =>
    (
      [
        ['whole route', 0, 0],
        ['3.0–3.6 km', 3000, 3600],
        ['3.0–4.5 km', 3000, 4500],
        ['3.0–9.0 km', 3000, 9000],
        ['8–12 km', 8000, 12_000],
        ['10–13 km', 10_000, 13_000],
        ['12–18 km', 12_000, 18_000],
        ['15–19 km', 15_000, 19_000],
        ['20–30 km', 20_000, 30_000],
        ['20–40 km', 20_000, 40_000],
        ['35–45 km', 35_000, 45_000],
        ['50–60 km', 50_000, 60_000],
        ['70–90 km', 70_000, 90_000],
      ] as const
    )
      .map(([label, from, to]) => {
        const t = from === 0 ? drawn : stretch(drawn, from, to);
        return { label: `${name} ${label}`, t, sceneRun: from === 0 ? run : NO_RUN };
      })
      .filter(({ t }) => t.lat.length > 1 && hasCachedTiles(trackBounds(t))),
  );

  it.skipIf(cases.length < 5)(
    'the widths follow the published rule, and give no better latitude than the zoom band',
    async () => {
      const toPublished: number[] = [];
      const toRealPixels: number[] = [];
      const attackError: number[] = [];
      const bandError: number[] = [];
      for (const { label, t, sceneRun } of cases) {
        const hf = await cachedSceneHeightfield(trackBounds(t));
        const latitude = centreLatitude(hf);
        const grid = sceneGrid(hf, t, sceneRun);
        const r = examine(grid, latitude);
        const [south, north] = zoomBand(grid);
        report(
          `${label} z${String(hf.zoom)} (band ${south.toFixed(1)}–${north.toFixed(1)}°)`,
          latitude,
          r,
        );
        if (!Number.isFinite(r.fitted)) continue;
        toPublished.push(Math.abs(Math.log(r.fitted / r.published)));
        toRealPixels.push(Math.abs(Math.log(r.fitted / r.realPixels)));
        // The old-rule reading, kept inside the band (an attacker knows the band anyway).
        const implied = Math.min(north, Math.max(south, r.implied));
        attackError.push(Math.abs(implied - latitude));
        bandError.push(Math.abs((south + north) / 2 - latitude));
      }
      console.log(
        `${String(toPublished.length)} fits: median |log| to published ${median(toPublished).toFixed(3)}, to 1.5 real px ${median(toRealPixels).toFixed(3)}; median latitude error ${median(attackError).toFixed(1)}° (zoom band's middle alone ${median(bandError).toFixed(1)}°)`,
      );
      expect(median(toPublished)).toBeLessThan(median(toRealPixels));
      expect(median(attackError)).toBeGreaterThanOrEqual(median(bandError));
    },
  );
});
