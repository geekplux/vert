/**
 * Test helpers for the bake: PNG and Terrarium tile encoders, a synthetic route, and a local tile
 * server (`node:http`), so no test touches the network.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';
import { worldToLonLat, type TileCoord } from '../../src/lib/geo';
import { TILE_SIZE } from '../../src/terrain/tiles';
import { PNG_SIGNATURE } from './png';

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** Applies PNG filter `filter` to one row (`prior` is the row above, unfiltered). */
function filterRow(row: Uint8Array, prior: Uint8Array | null, bpp: number, filter: number) {
  const out = new Uint8Array(row.length + 1);
  out[0] = filter;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? (row[i - bpp] ?? 0) : 0;
    const b = prior?.[i] ?? 0;
    const c = i >= bpp ? (prior?.[i - bpp] ?? 0) : 0;
    let predictor = 0;
    if (filter === 1) predictor = a;
    else if (filter === 2) predictor = b;
    else if (filter === 3) predictor = (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i + 1] = ((row[i] ?? 0) - predictor) & 0xff;
  }
  return out;
}

/**
 * An 8-bit RGB (3 channels) or RGBA (4) PNG of `width` × `height`; row r uses filter r mod 5
 * unless `filter` is given, so a decoder sees every filter.
 */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
  { channels = 3, filter }: { channels?: 3 | 4; filter?: number } = {},
): Buffer {
  const rows: Uint8Array[] = [];
  let prior: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width * channels);
    for (let x = 0; x < width; x++) {
      const values = pixel(x, y);
      for (let k = 0; k < channels; k++) row[x * channels + k] = values[k] ?? 255;
    }
    rows.push(filterRow(row, prior, channels, filter ?? y % 5));
    prior = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 3 ? 2 : 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Terrarium RGB of an elevation: value = metres + 32768; r, g, b = its 256s, units, 256ths. */
export function terrariumRgb(metres: number): [number, number, number] {
  const value = metres + 32_768;
  return [Math.floor(value / 256), Math.floor(value) % 256, Math.floor((value % 1) * 256)];
}

/** A deterministic hash of a pixel into [−0.5, 0.5). */
function pixelNoise(x: number, y: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 2 ** 32 - 0.5;
}

/** Synthetic ground: rolling hills a few hundred metres high, plus a metre of pixel noise. */
export function syntheticElevation(lon: number, lat: number): number {
  return 900 + 250 * Math.sin(lon * 140) * Math.cos(lat * 110) + 80 * Math.sin(lat * 400);
}

const syntheticPngs = new Map<string, Buffer>();

/** The Terrarium PNG of tile z/x/y over {@link syntheticElevation} (memoised). */
export function syntheticTilePng({ z, x, y }: TileCoord): Buffer {
  const key = `${String(z)}/${String(x)}/${String(y)}`;
  let png = syntheticPngs.get(key);
  if (!png) {
    png = renderSyntheticTile({ z, x, y });
    syntheticPngs.set(key, png);
  }
  return png;
}

function renderSyntheticTile({ z, x, y }: TileCoord): Buffer {
  const n = 2 ** z * TILE_SIZE;
  return encodePng(TILE_SIZE, TILE_SIZE, (px, py) => {
    const X = x * TILE_SIZE + px;
    const Y = y * TILE_SIZE + py;
    const { lon, lat } = worldToLonLat((X + 0.5) / n, (Y + 0.5) / n);
    return terrariumRgb(syntheticElevation(lon, lat) + pixelNoise(X, Y));
  });
}

/** A recorded point of the synthetic route. */
export interface RoutePoint {
  readonly lat: number;
  readonly lon: number;
  readonly ele: number;
  /** Epoch milliseconds. */
  readonly t: number;
}

/** Where the synthetic route runs: an Alpine-looking place, made up. */
export const ROUTE_ORIGIN = { lat: 46.512, lon: 7.873 } as const;

/**
 * A synthetic run of about 3.5 km: a winding line north from {@link ROUTE_ORIGIN}, a point every
 * ~10 m and 4 s, elevations a few metres off the synthetic ground (as a watch reads it).
 */
export function syntheticRoute(count = 360): RoutePoint[] {
  const start = Date.UTC(2026, 5, 1, 6, 30, 0);
  return Array.from({ length: count }, (_, i) => {
    const f = i / (count - 1);
    const lat = ROUTE_ORIGIN.lat + 0.03 * f;
    const lon = ROUTE_ORIGIN.lon + 0.006 * Math.sin(f * 9);
    return {
      lat: Number(lat.toFixed(7)),
      lon: Number(lon.toFixed(7)),
      ele: Number((syntheticElevation(lon, lat) + 4 * Math.sin(f * 31)).toFixed(1)),
      t: start + i * 4000,
    };
  });
}

/**
 * The e2e "Taveuni Dateline" run (e2e/terrain.spec.ts): a ~13 km loop on Taveuni, Fiji, centred on
 * 180°, longitudes as a GPX stores them (±180, jumping across the line), one point every 4 s.
 */
export function antimeridianRoute(): RoutePoint[] {
  const start = Date.UTC(2026, 5, 1, 18, 0, 0);
  return Array.from({ length: 601 }, (_, i) => {
    const a = (i / 600) * 2 * Math.PI;
    const lat = -16.86 + 0.0165 * Math.sin(a);
    let lon = 180 + 0.0225 * Math.cos(a);
    if (lon >= 180) lon -= 360;
    return {
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      ele: 300,
      t: start + i * 4000,
    };
  });
}

/**
 * Laps: `laps` times round a ~1.6 km circle by {@link ROUTE_ORIGIN} (a track session), so the real
 * start and finish lie on the stretch a 200 m trim leaves drawn.
 */
export function lapsRoute(laps = 3): RoutePoint[] {
  const start = Date.UTC(2026, 5, 2, 6, 0, 0);
  const perLap = 160;
  return Array.from({ length: laps * perLap + 1 }, (_, i) => {
    const a = (i / perLap) * 2 * Math.PI;
    const lat = ROUTE_ORIGIN.lat + 0.0023 * Math.sin(a);
    const lon = ROUTE_ORIGIN.lon + 0.0033 * (1 - Math.cos(a));
    return {
      lat: Number(lat.toFixed(7)),
      lon: Number(lon.toFixed(7)),
      ele: Number(syntheticElevation(lon, lat).toFixed(1)),
      t: start + i * 3000,
    };
  });
}

/** A GPX 1.1 track of `points`; without elevations when `ele` is false. */
export function gpxOf(points: readonly RoutePoint[], { ele = true, time = true } = {}): string {
  const body = points
    .map((p) => {
      const children = [
        ele ? `<ele>${String(p.ele)}</ele>` : '',
        time ? `<time>${new Date(p.t).toISOString()}</time>` : '',
      ].join('');
      return `<trkpt lat="${String(p.lat)}" lon="${String(p.lon)}">${children}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="vert-test" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Test run</name><trkseg>
${body}
</trkseg></trk>
</gpx>
`;
}

/** A points file (`pnpm bake` JSON input) of `points`. */
export function pointsJsonOf(
  points: readonly RoutePoint[],
  { ele = true, time = 'iso' }: { ele?: boolean; time?: 'iso' | 'ms' | false } = {},
): string {
  return JSON.stringify({
    points: points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      ...(ele ? { ele: p.ele } : {}),
      ...(time === 'iso' ? { t: new Date(p.t).toISOString() } : time === 'ms' ? { t: p.t } : {}),
    })),
  });
}

/** One request the tile server saw. */
export interface SeenRequest {
  readonly url: string;
  readonly userAgent: string | undefined;
}

export interface TileServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  readonly requests: SeenRequest[];
  /** Most requests the server was handling at once. */
  readonly maxInFlight: () => number;
  readonly close: () => Promise<void>;
}

/**
 * Answers a request with a status, headers and a body; `null` leaves it unanswered (a timeout).
 * May be async (to hold a request open).
 */
export type TileHandler = (
  request: IncomingMessage,
  coord: TileCoord | null,
  attempt: number,
) =>
  | { status: number; type?: string; body?: Uint8Array | string }
  | null
  | Promise<{ status: number; type?: string; body?: Uint8Array | string } | null>;

/** Serves synthetic tiles at `/tiles/{z}/{x}/{y}.png`; anything else is 404. */
export const syntheticTiles: TileHandler = (_request, coord) =>
  coord ? { status: 200, type: 'image/png', body: syntheticTilePng(coord) } : { status: 404 };

/** A local tile server on a free port; `attempt` counts requests per path from 1. */
export async function startTileServer(handler: TileHandler = syntheticTiles): Promise<TileServer> {
  const requests: SeenRequest[] = [];
  const attempts = new Map<string, number>();
  const hanging = new Set<ServerResponse>();
  let inFlight = 0;
  let peak = 0;
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    requests.push({ url, userAgent: request.headers['user-agent'] });
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    const match = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
    const coord = match ? { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) } : null;
    inFlight++;
    peak = Math.max(peak, inFlight);
    void Promise.resolve(handler(request, coord, attempt)).then((answer) => {
      if (!answer) {
        hanging.add(response);
        return;
      }
      inFlight--;
      response.writeHead(answer.status, answer.type ? { 'Content-Type': answer.type } : {});
      response.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    maxInFlight: () => peak,
    close: () =>
      new Promise<void>((resolve) => {
        for (const response of hanging) response.destroy();
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** A `fetch` for the tile source that serves synthetic tiles in-process; `calls` counts requests. */
export function syntheticFetch() {
  const state = { calls: 0 };
  const fetchTiles = (url: string): Promise<Response> => {
    state.calls++;
    const match = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
    if (!match) return Promise.resolve(new Response(null, { status: 404 }));
    const png = syntheticTilePng({ z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) });
    return Promise.resolve(
      new Response(new Uint8Array(png), { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );
  };
  return { fetch: fetchTiles, state };
}

/** A promise that resolves after `ms`. */
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
