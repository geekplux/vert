/**
 * Height grid for a route's area: covering Terrarium tiles stitched into one mosaic, resampled
 * onto a regular grid in Web Mercator space.
 */
import {
  MERCATOR_RADIUS_M,
  chooseZoom,
  lonLatToWorld,
  tileCount,
  tilesForBounds,
  worldToLonLat,
  wrapTile,
  type Bounds,
  type TileCoord,
} from '../lib/geo';
import { sampleBilinear } from '../lib/terrarium';
import {
  TILE_SIZE,
  TileDecodeError,
  fetchTile as defaultFetchTile,
  isAbortError,
  type TileElevations,
} from './tiles';

/**
 * A regular grid of elevations. Samples sit on grid nodes: column 0 is the west edge of `bounds`,
 * column `width − 1` the east edge, row 0 the north edge, row `height − 1` the south edge, evenly
 * spaced in Web Mercator x and y (so very nearly square on the ground).
 */
export interface Heightfield {
  readonly bounds: Bounds;
  /** Zoom of the tiles the grid was sampled from. */
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  /** Metres, row-major from the north-west corner, `width * height` values. */
  readonly elevations: Float32Array;
  readonly min: number;
  readonly max: number;
  /** Ground distance between neighbouring samples at the grid's centre latitude. */
  readonly metresPerSample: { readonly x: number; readonly y: number };
  /** Tiles that could not be loaded; their area was filled from neighbouring tiles. */
  readonly failedTiles: readonly TileCoord[];
}

/** Fraction of the track bbox's width and height added to each side by default. */
export const DEFAULT_PADDING = 0.15;

/** Most samples along either side of a heightfield, and the native-resolution budget for zoom. */
export const MAX_GRID_SIZE = 512;

/** Preferred tile zoom range (~30 m to ~8 m per pixel at mid latitudes). */
export const MIN_PREFERRED_ZOOM = 12;
export const MAX_PREFERRED_ZOOM = 14;

export interface BuildHeightfieldOptions {
  /** Most tiles to fetch at the zoom whose native extent fits the grid. */
  maxTiles?: number;
  /**
   * Most tiles to fetch when a long route samples one zoom finer ({@link chooseHeightfieldZoom});
   * {@link MAX_LONG_ROUTE_TILES} by default.
   */
  maxLongRouteTiles?: number;
  /**
   * Samples along the longer side of the grid. Defaults to the area's extent in native pixels at
   * the chosen zoom, capped at {@link MAX_GRID_SIZE}.
   */
  gridSize?: number;
  /** Fraction of the width and height added to every side of `bounds` before sampling. */
  padding?: number;
  /** Parallel tile requests. */
  concurrency?: number;
  signal?: AbortSignal;
  /** Tile source; defaults to the cached same-origin {@link defaultFetchTile}. */
  fetchTile?: (coord: TileCoord, options: { signal?: AbortSignal }) => Promise<TileElevations>;
}

/**
 * Every tile failed: there is nothing to build a grid from. `kind` is `'decode'` when every tile
 * arrived but none could be decoded ({@link TileDecodeError}: a browser problem, so "check your
 * connection" would mislead), else `'network'` (offline, HTTP errors, the tile server down).
 */
export class HeightfieldError extends Error {
  readonly failedTiles: readonly TileCoord[];
  readonly kind: 'network' | 'decode';
  constructor(
    failedTiles: readonly TileCoord[],
    cause: unknown,
    kind: 'network' | 'decode' = 'network',
  ) {
    super(`No elevation tiles could be loaded (${String(failedTiles.length)} failed)`, { cause });
    this.name = 'HeightfieldError';
    this.failedTiles = failedTiles;
    this.kind = kind;
  }
}

/** Smallest span a grid covers, degrees (~110 m of latitude), so a single point still works. */
const MIN_SPAN_DEG = 0.001;

/** Latitude limit of a grid, degrees: just inside Web Mercator's (`MAX_MERCATOR_LAT`, 85.05°). */
const MAX_GRID_LAT = 85;

function padBounds(bounds: Bounds, padding: number): Bounds {
  let { west, south, east, north } = bounds;
  const padX = (east - west) * padding;
  const padY = (north - south) * padding;
  west -= padX;
  east += padX;
  south -= padY;
  north += padY;
  if (east - west < MIN_SPAN_DEG) {
    const mid = (west + east) / 2;
    west = mid - MIN_SPAN_DEG / 2;
    east = mid + MIN_SPAN_DEG / 2;
  }
  if (north - south < MIN_SPAN_DEG) {
    const mid = (south + north) / 2;
    south = mid - MIN_SPAN_DEG / 2;
    north = mid + MIN_SPAN_DEG / 2;
  }
  // Longitudes stay continuous past ±180 (a run across the antimeridian; tiles wrap when fetched),
  // up to one turn. Latitudes stay inside the Mercator square, a minimum span apart even for a run
  // beyond it (terrain there is drawn at the limit).
  if (east - west > 360) {
    const mid = (west + east) / 2;
    west = mid - 180;
    east = mid + 180;
  }
  south = Math.min(Math.max(-MAX_GRID_LAT, south), MAX_GRID_LAT - MIN_SPAN_DEG);
  north = Math.min(Math.max(south + MIN_SPAN_DEG, north), MAX_GRID_LAT);
  return { west, east, south, north };
}

/** Extent of `area` in pixels at zoom `z` (Web Mercator, 256 px tiles). */
function nativeExtent(area: Bounds, z: number): { width: number; height: number } {
  const nw = lonLatToWorld(area.west, area.north);
  const se = lonLatToWorld(area.east, area.south);
  const scale = 2 ** z * TILE_SIZE;
  return { width: (se.x - nw.x) * scale, height: (se.y - nw.y) * scale };
}

/**
 * Most tiles a long route's heightfield fetches when it samples one zoom finer than its grid
 * needs (see {@link chooseHeightfieldZoom}): within the tile cache (64), and a few seconds' load.
 */
export const MAX_LONG_ROUTE_TILES = 32;

/**
 * Tile zoom for a (padded) area: the highest zoom from {@link MAX_PREFERRED_ZOOM} down whose
 * covering needs at most `maxTiles` tiles and whose native extent fits `maxSamples` pixels on its
 * longer side. Normally that lands in 12–14. For an area too large for z12 (a long route, roughly
 * > 14 km across at 45° with the default budget) the native fit drops below 12; the grid is then
 * sampled from one zoom finer and downsampled to `maxSamples` (2× finer source data, so ridges stay
 * sharp instead of blobby), as long as that needs at most `maxLongRouteTiles` tiles. Down to 0 at
 * the most.
 */
export function chooseHeightfieldZoom(
  area: Bounds,
  {
    maxTiles = 16,
    maxSamples = MAX_GRID_SIZE,
    maxLongRouteTiles = MAX_LONG_ROUTE_TILES,
  }: { maxTiles?: number; maxSamples?: number; maxLongRouteTiles?: number } = {},
): number {
  for (let z = Math.min(MAX_PREFERRED_ZOOM, chooseZoom(area, maxTiles)); z > 0; z--) {
    const { width, height } = nativeExtent(area, z);
    if (Math.max(width, height) > maxSamples) continue;
    if (z < MIN_PREFERRED_ZOOM && tileCount(area, z + 1) <= maxLongRouteTiles) return z + 1;
    return z;
  }
  return 0;
}

/** Runs `task` over `items` with at most `limit` running at once. */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/**
 * Fills the pixels of missing tiles in a mosaic. Each missing tile takes, per pixel, an
 * inverse-distance blend of the facing edge pixels of its loaded (or already filled) four
 * neighbours, so the fill meets them without a step. Tiles with no such neighbour wait for a later
 * pass; whatever remains is set to `fallback`.
 */
function fillMissingTiles(
  mosaic: Float32Array,
  cols: number,
  rows: number,
  loaded: boolean[],
  fallback: number,
): void {
  const stride = cols * TILE_SIZE;
  const isLoaded = (c: number, r: number) =>
    c >= 0 && c < cols && r >= 0 && r < rows && loaded[r * cols + c] === true;
  const at = (x: number, y: number) => mosaic[y * stride + x] ?? fallback;

  for (let progress = true; progress;) {
    progress = false;
    const filledThisPass: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isLoaded(c, r)) continue;
        const left = isLoaded(c - 1, r);
        const right = isLoaded(c + 1, r);
        const top = isLoaded(c, r - 1);
        const bottom = isLoaded(c, r + 1);
        if (!left && !right && !top && !bottom) continue;
        const x0 = c * TILE_SIZE;
        const y0 = r * TILE_SIZE;
        for (let py = 0; py < TILE_SIZE; py++) {
          for (let px = 0; px < TILE_SIZE; px++) {
            let sum = 0;
            let weight = 0;
            const add = (value: number, distance: number) => {
              sum += value / distance;
              weight += 1 / distance;
            };
            if (left) add(at(x0 - 1, y0 + py), px + 1);
            if (right) add(at(x0 + TILE_SIZE, y0 + py), TILE_SIZE - px);
            if (top) add(at(x0 + px, y0 - 1), py + 1);
            if (bottom) add(at(x0 + px, y0 + TILE_SIZE), TILE_SIZE - py);
            mosaic[(y0 + py) * stride + x0 + px] = sum / weight;
          }
        }
        filledThisPass.push(r * cols + c);
      }
    }
    for (const index of filledThisPass) loaded[index] = true;
    progress = filledThisPass.length > 0;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isLoaded(c, r)) continue;
      for (let py = 0; py < TILE_SIZE; py++) {
        const start = (r * TILE_SIZE + py) * stride + c * TILE_SIZE;
        mosaic.fill(fallback, start, start + TILE_SIZE);
      }
    }
  }
}

/**
 * Fetches the tiles covering `bounds` (plus `padding`, 15% by default) at the zoom
 * {@link chooseHeightfieldZoom} picks, and resamples them onto a grid whose longer side has
 * `gridSize` samples (native resolution, ≤ 512, by default) and whose shorter side keeps the
 * ground aspect ratio. Tiles are treated as one mosaic, so bilinear sampling is continuous across
 * tile seams.
 *
 * Failed tiles (404, network) are filled from their neighbours and listed in `failedTiles`.
 *
 * @throws AbortError when `signal` aborts; {@link HeightfieldError} when no tile loads.
 */
export async function buildHeightfield(
  bounds: Bounds,
  {
    maxTiles = 16,
    maxLongRouteTiles = MAX_LONG_ROUTE_TILES,
    gridSize,
    padding = DEFAULT_PADDING,
    concurrency = 6,
    signal,
    fetchTile = defaultFetchTile,
  }: BuildHeightfieldOptions = {},
): Promise<Heightfield> {
  signal?.throwIfAborted();
  const area = padBounds(bounds, padding);
  const zoom = chooseHeightfieldZoom(area, { maxTiles, maxLongRouteTiles });
  const tiles = tilesForBounds(area, zoom);
  const first = tiles[0];
  const last = tiles.at(-1);
  // tilesForBounds always returns at least one tile.
  if (!first || !last) throw new RangeError('No tiles cover the bounds');
  const cols = last.x - first.x + 1;
  const rows = last.y - first.y + 1;
  const stride = cols * TILE_SIZE;
  const mosaic = new Float32Array(stride * rows * TILE_SIZE);
  const loaded = new Array<boolean>(tiles.length).fill(false);
  const failedTiles: TileCoord[] = [];
  let firstError: unknown;
  let decodeFailures = 0;
  let loadedMin = Infinity;

  await forEachLimited(tiles, concurrency, async (tile) => {
    signal?.throwIfAborted();
    let data: TileElevations;
    try {
      // Columns past ±180° (a run across the antimeridian) are fetched as the tile they wrap to.
      data = await fetchTile(wrapTile(tile), { signal });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      failedTiles.push(tile);
      firstError ??= error;
      if (error instanceof TileDecodeError) decodeFailures++;
      return;
    }
    const c = tile.x - first.x;
    const r = tile.y - first.y;
    for (let py = 0; py < TILE_SIZE; py++) {
      const row = data.subarray(py * TILE_SIZE, (py + 1) * TILE_SIZE);
      mosaic.set(row, (r * TILE_SIZE + py) * stride + c * TILE_SIZE);
    }
    for (const value of data) if (value < loadedMin) loadedMin = value;
    loaded[r * cols + c] = true;
  });
  signal?.throwIfAborted();
  if (failedTiles.length === tiles.length) {
    const kind = decodeFailures === tiles.length ? 'decode' : 'network';
    throw new HeightfieldError(failedTiles, firstError, kind);
  }
  if (failedTiles.length > 0) fillMissingTiles(mosaic, cols, rows, loaded, loadedMin);

  // Grid extent in world coordinates and its shape: longest side = gridSize, square-ish samples.
  // Web Mercator is conformal, so equal world spans are equal ground spans at one latitude.
  const nw = lonLatToWorld(area.west, area.north);
  const se = lonLatToWorld(area.east, area.south);
  const spanX = se.x - nw.x;
  const spanY = se.y - nw.y;
  const native = nativeExtent(area, zoom);
  const longest = Math.max(
    2,
    Math.round(gridSize ?? Math.min(MAX_GRID_SIZE, Math.max(native.width, native.height))),
  );
  const shortest = (span: number) => Math.max(2, Math.round(1 + (longest - 1) * span));
  const width = spanX >= spanY ? longest : shortest(spanX / spanY);
  const height = spanX >= spanY ? shortest(spanY / spanX) : longest;

  const n = 2 ** zoom;
  const elevations = new Float32Array(width * height);
  const mosaicRows = rows * TILE_SIZE;
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < height; j++) {
    const wy = nw.y + (spanY * j) / (height - 1);
    // Mosaic pixel coordinates: integer values are pixel centres (hence the −0.5).
    const fy = (wy * n - first.y) * TILE_SIZE - 0.5;
    for (let i = 0; i < width; i++) {
      const wx = nw.x + (spanX * i) / (width - 1);
      const fx = (wx * n - first.x) * TILE_SIZE - 0.5;
      const index = j * width + i;
      elevations[index] = sampleBilinear(mosaic, stride, mosaicRows, fx, fy);
      const value = elevations[index] ?? NaN; // the stored float32, so min/max match the grid
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  const centreLat = worldToLonLat(0, (nw.y + se.y) / 2).lat;
  const metresPerWorldUnit =
    2 * Math.PI * MERCATOR_RADIUS_M * Math.cos((centreLat * Math.PI) / 180);
  return {
    bounds: area,
    zoom,
    width,
    height,
    elevations,
    min,
    max,
    metresPerSample: {
      x: (spanX / (width - 1)) * metresPerWorldUnit,
      y: (spanY / (height - 1)) * metresPerWorldUnit,
    },
    failedTiles,
  };
}

/** Ground the grid spans on its longer side, metres (at its centre latitude). */
export function groundExtent(heightfield: Heightfield): number {
  const { width, height, metresPerSample } = heightfield;
  return Math.max(metresPerSample.x * (width - 1), metresPerSample.y * (height - 1));
}

/**
 * Fractional grid position (column, row) of a lon/lat in `heightfield`; outside the bounds the
 * values fall outside [0, width − 1] × [0, height − 1].
 */
export function gridPosition(heightfield: Heightfield, lon: number, lat: number) {
  const { bounds, width, height } = heightfield;
  const nw = lonLatToWorld(bounds.west, bounds.north);
  const se = lonLatToWorld(bounds.east, bounds.south);
  const p = lonLatToWorld(lon, lat);
  return {
    x: ((p.x - nw.x) / (se.x - nw.x)) * (width - 1),
    y: ((p.y - nw.y) / (se.y - nw.y)) * (height - 1),
  };
}

/** Bilinear elevation at a lon/lat, in metres; positions outside the grid take its edge value. */
export function elevationAt(heightfield: Heightfield, lon: number, lat: number): number {
  const { x, y } = gridPosition(heightfield, lon, lat);
  return sampleBilinear(heightfield.elevations, heightfield.width, heightfield.height, x, y);
}
