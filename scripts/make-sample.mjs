#!/usr/bin/env node
/* global console, process, fetch, URLSearchParams, Buffer, setTimeout */
// Builds public/samples/coosa-backcountry.gpx: the Coosa Backcountry Trail loop (Vogel State Park,
// Georgia) as if recorded by a GPS watch on a trail run.
//
//   1. Route geometry from OpenStreetMap (Overpass API), stitched into one loop from the trailhead.
//   2. Resampled to ~6 m, elevation from AWS Terrain Tiles (Terrarium PNG, z14), lightly smoothed.
//   3. Timestamps from a trail-running pace model (grade-dependent), with two short stops.
//   4. Deterministic GPS-like horizontal noise, then written as GPX 1.1.
//
// Network responses are cached in scripts/.cache/ so reruns are offline and byte-for-byte
// deterministic. Delete that folder to refetch. Node 22+, no dependencies.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache');
const OUT = join(ROOT, 'public', 'samples', 'coosa-backcountry.gpx');
const USER_AGENT = 'vert-sample/0.1 (github.com/geekplux)';

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

const TRAIL_NAME = 'Coosa Backcountry Trail';
/** Approximate trailhead by the Vogel State Park visitor centre; the real one is taken from data. */
const TRAILHEAD_HINT = { lat: 34.766, lon: -83.925 };
const ENDPOINT_SNAP_M = 30; // way ends closer than this are the same junction
const MAX_BRIDGE_M = 400; // gaps up to this are bridged with a straight line
const DIRECTION = 'ccw'; // loop direction as seen on a north-up map
const SPACING_M = 6; // resampling interval
// Light elevation smoothing: a moving average over ~80 m (15 points), which removes DEM pixel
// noise on side-hill trail much as a watch's barometric altimeter would.
const SMOOTH_POINTS = 2 * Math.round(40 / SPACING_M) + 1;
const TILE_ZOOM = 14;
const RECORD_INTERVAL_S = 2;
// Saturday 2026-10-03 07:10 in America/New_York (EDT, UTC-4).
const START_UTC_MS = Date.UTC(2026, 9, 3, 11, 10, 0);
const SEED = 0x5ea1c0;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_QUERY = `[out:json][timeout:90];
(
  way["highway"]["name"~"Coosa Backcountry"](34.6,-84.2,35.0,-83.7);
  way["highway"~"^(trunk|primary|secondary|tertiary)$"](34.72,-84.0,34.80,-83.90);
);
out geom;`;
const TERRARIUM_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const ATTRIBUTION =
  'Route geometry © OpenStreetMap contributors (ODbL). ' +
  'Elevation: AWS Terrain Tiles (Mapzen terrain, various sources). ' +
  'Times are synthetic sample data.';

// ---------------------------------------------------------------------------------------------
// Geodesy helpers
// ---------------------------------------------------------------------------------------------

const R_EARTH = 6371008.8;
const RAD = Math.PI / 180;

function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

function polylineLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}

/** Equirectangular projection around a reference latitude, in metres. Fine at trail scale. */
function projector(lat0) {
  const kx = R_EARTH * RAD * Math.cos(lat0 * RAD);
  const ky = R_EARTH * RAD;
  return {
    toXY: (p) => ({ x: p.lon * kx, y: p.lat * ky }),
    offset: (p, dx, dy) => ({ lat: p.lat + dy / ky, lon: p.lon + dx / kx }),
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// Cache + network
// ---------------------------------------------------------------------------------------------

async function fetchWithRetry(url, init, label) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) {
      throw new Error(`${label}: HTTP ${res.status} ${res.statusText}`);
    }
    const wait = 5000 * attempt;
    console.warn(`${label}: HTTP ${res.status}, retrying in ${wait / 1000} s`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function cached(relPath, load) {
  const file = join(CACHE, relPath);
  if (existsSync(file)) return readFileSync(file);
  const data = await load();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return data;
}

async function overpass(query) {
  const key = createHash('sha1').update(query).digest('hex').slice(0, 12);
  const raw = await cached(`overpass-${key}.json`, () => {
    console.log('Fetching OpenStreetMap data from Overpass…');
    return fetchWithRetry(
      OVERPASS_URL,
      {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ data: query }).toString(),
      },
      'Overpass',
    );
  });
  return JSON.parse(raw.toString('utf8'));
}

// ---------------------------------------------------------------------------------------------
// Step 1: stitch OSM ways into one loop
// ---------------------------------------------------------------------------------------------

function stitchLoop(ways) {
  // Junctions: cluster way endpoints that lie within ENDPOINT_SNAP_M of each other.
  const nodes = [];
  const nodeAt = (p) => {
    for (const n of nodes) if (haversine(n, p) <= ENDPOINT_SNAP_M) return n.id;
    nodes.push({ id: nodes.length, lat: p.lat, lon: p.lon });
    return nodes.length - 1;
  };
  let edges = ways.map((w) => ({
    label: `way ${w.id}`,
    wayId: w.id,
    name: w.tags.name,
    pts: w.geometry.map((g) => ({ lat: g.lat, lon: g.lon })),
    a: nodeAt(w.geometry[0]),
    b: nodeAt(w.geometry[w.geometry.length - 1]),
  }));
  const adjacency = () => {
    const adj = nodes.map(() => []);
    edges.forEach((e, i) => {
      adj[e.a].push(i);
      adj[e.b].push(i);
    });
    return adj;
  };

  // Trailhead: the junction nearest the hint.
  let start = 0;
  for (const n of nodes) {
    if (haversine(n, TRAILHEAD_HINT) < haversine(nodes[start], TRAILHEAD_HINT)) start = n.id;
  }
  const startDist = haversine(nodes[start], TRAILHEAD_HINT);
  if (startDist > 1000) {
    throw new Error(
      `No trail endpoint within 1 km of the trailhead hint (nearest ${startDist} m).`,
    );
  }

  // Keep only the connected component that contains the trailhead.
  let adj = adjacency();
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const n = queue.shift();
    for (const i of adj[n]) {
      for (const m of [edges[i].a, edges[i].b]) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
  }
  const dropped = edges.filter((e) => !seen.has(e.a));
  if (dropped.length) {
    console.log(`Ignoring ways not connected to the trailhead: ${dropped.map((e) => e.wayId)}`);
  }
  edges = edges.filter((e) => seen.has(e.a));
  adj = adjacency();

  // A dead-end access spur at the trailhead is run out and back: double it up to the first fork.
  const doubled = [];
  if (adj[start].length === 1) {
    let node = start;
    let prev = -1;
    while (adj[node].length <= 2) {
      const next = adj[node].find((i) => i !== prev);
      if (next === undefined) break;
      doubled.push(next);
      prev = next;
      node = edges[next].a === node ? edges[next].b : edges[next].a;
      if (node === start) break;
    }
    for (const i of doubled) edges.push({ ...edges[i], label: `${edges[i].label} (back)` });
  }

  // Remaining odd junctions are gaps in the data: bridge close pairs with a straight line.
  adj = adjacency();
  const bridges = [];
  let odd = nodes.filter((n) => seen.has(n.id) && adj[n.id].length % 2 === 1);
  while (odd.length >= 2) {
    let best = null;
    for (let i = 0; i < odd.length; i++) {
      for (let j = i + 1; j < odd.length; j++) {
        const d = haversine(odd[i], odd[j]);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    if (best.d > MAX_BRIDGE_M) break;
    const [p, q] = [odd[best.i], odd[best.j]];
    edges.push({ label: 'bridge', pts: [p, q], a: p.id, b: q.id });
    bridges.push({ from: p, to: q, m: best.d });
    odd = odd.filter((_, k) => k !== best.i && k !== best.j);
  }
  if (odd.length) {
    const where = odd.map((n) => `${n.lat.toFixed(5)},${n.lon.toFixed(5)}`).join('; ');
    throw new Error(
      `OSM ways do not close into a loop: dead ends with no partner within ${MAX_BRIDGE_M} m at ${where}. ` +
        'A connecting way (or a junction at an interior node) is missing.',
    );
  }

  // Hierholzer: an Eulerian circuit through every edge, starting and ending at the trailhead.
  adj = adjacency();
  const used = new Array(edges.length).fill(false);
  const stack = [{ node: start, edge: -1 }];
  const circuit = [];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const next = adj[top.node].find((i) => !used[i]);
    if (next === undefined) {
      circuit.push(stack.pop());
    } else {
      used[next] = true;
      const e = edges[next];
      stack.push({ node: e.a === top.node ? e.b : e.a, edge: next });
    }
  }
  circuit.reverse(); // circuit[k].edge leads from circuit[k-1].node to circuit[k].node

  const route = [];
  const legs = [];
  for (let k = 1; k < circuit.length; k++) {
    const e = edges[circuit[k].edge];
    const forward = e.a === circuit[k - 1].node;
    const pts = forward ? e.pts : [...e.pts].reverse();
    legs.push(`${e.label}${e.name ? ` "${e.name}"` : ''}${forward ? '' : ' reversed'}`);
    for (const p of pts) {
      const last = route[route.length - 1];
      if (!last || haversine(last, p) > 0.01) route.push(p);
    }
  }

  // Orientation by the shoelace formula (positive area = counter-clockwise).
  const proj = projector(nodes[start].lat);
  let area = 0;
  for (let i = 1; i < route.length; i++) {
    const p = proj.toXY(route[i - 1]);
    const q = proj.toXY(route[i]);
    area += p.x * q.y - q.x * p.y;
  }
  if (area > 0 !== (DIRECTION === 'ccw')) {
    route.reverse();
    legs.reverse();
  }
  return { route, legs, bridges, trailhead: nodes[start], startDist };
}

// ---------------------------------------------------------------------------------------------
// Step 2: resample, elevation
// ---------------------------------------------------------------------------------------------

function resample(pts, spacing) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const n = Math.round(total / spacing);
  const step = total / n;
  const out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const d = k === n ? total : k * step;
    while (j < pts.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? (d - cum[j]) / seg : 0;
    out.push({
      lat: lerp(pts[j].lat, pts[j + 1].lat, t),
      lon: lerp(pts[j].lon, pts[j + 1].lon, t),
    });
  }
  return out;
}

/** Minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced, all five filter types. */
function decodePng(buf) {
  const SIG = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== SIG) throw new Error('Not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [bitDepth, colorType, , , interlace] = data.subarray(8, 13);
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(
          `Unsupported PNG: depth ${bitDepth}, colour ${colorType}, interlace ${interlace}`,
        );
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= channels ? px[dst + x - channels] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? px[dst - stride + x - channels] : 0;
      let pred;
      switch (filter) {
        case 0:
          pred = 0;
          break;
        case 1:
          pred = a;
          break;
        case 2:
          pred = b;
          break;
        case 3:
          pred = (a + b) >> 1;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new Error(`Bad PNG filter ${filter}`);
      }
      px[dst + x] = (v + pred) & 0xff;
    }
  }
  return { width, height, channels, px };
}

/** Global Web Mercator pixel coordinates at zoom z (256 px tiles). */
function mercatorPixel(p, z) {
  const scale = 256 * 2 ** z;
  const s = Math.sin(p.lat * RAD);
  return {
    x: ((p.lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

async function sampleElevations(pts, z) {
  // Pixel centres sit at +0.5, so bilinear samples use the four pixels around (x-0.5, y-0.5).
  const coords = pts.map((p) => {
    const m = mercatorPixel(p, z);
    return { x: m.x - 0.5, y: m.y - 0.5 };
  });
  const needed = new Set();
  for (const c of coords) {
    for (const dx of [0, 1]) {
      for (const dy of [0, 1]) {
        needed.add(
          `${Math.floor((Math.floor(c.x) + dx) / 256)}/${Math.floor((Math.floor(c.y) + dy) / 256)}`,
        );
      }
    }
  }
  const tiles = new Map();
  for (const key of [...needed].sort()) {
    const [x, y] = key.split('/').map(Number);
    const png = await cached(`terrarium/${z}/${x}/${y}.png`, () => {
      console.log(`Fetching Terrarium tile ${z}/${x}/${y}…`);
      return fetchWithRetry(
        TERRARIUM_URL(z, x, y),
        { headers: { 'User-Agent': USER_AGENT } },
        'Terrarium',
      );
    });
    tiles.set(key, decodePng(png));
  }
  const height = (gx, gy) => {
    const t = tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
    const i = ((gy & 255) * t.width + (gx & 255)) * t.channels;
    return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768;
  };
  const elevations = coords.map(({ x, y }) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const top = lerp(height(x0, y0), height(x0 + 1, y0), fx);
    const bottom = lerp(height(x0, y0 + 1), height(x0 + 1, y0 + 1), fx);
    return lerp(top, bottom, fy);
  });
  return { elevations, tileCount: tiles.size };
}

function movingAverage(values, window) {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(values.length - 1, i + half); k++) {
      sum += values[k];
      n++;
    }
    return sum / n;
  });
}

// ---------------------------------------------------------------------------------------------
// Step 3: pace model
// ---------------------------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const FLAT_SPEED = 1000 / 360; // 6:00 /km
const HIKE_GRADE = 0.12; // above this the runner power-hikes
const HIKE_SPEED_CAP = 1.2; // m/s (4.3 km/h)
const MIN_SPEED = 0.75; // m/s

/** Tobler's hiking function, scaled so that flat ground gives FLAT_SPEED. */
function speedForGrade(g) {
  let v = (FLAT_SPEED * Math.exp(-3.5 * Math.abs(g + 0.05))) / Math.exp(-3.5 * 0.05);
  if (g > HIKE_GRADE) v = Math.min(v, HIKE_SPEED_CAP);
  return Math.max(v, MIN_SPEED);
}

function paceModel(pts, ele, rand) {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[n - 1];
  // Grade over a ~50 m window so the pace follows the hill, not the pixel noise.
  const k = Math.max(1, Math.round(25 / SPACING_M));
  // Day-to-day variation: a smooth random wobble of ±4 % with a ~1 km period, plus fatigue.
  const knots = Array.from(
    { length: Math.ceil(total / 1000) + 2 },
    () => 1 + 0.04 * (2 * rand() - 1),
  );
  const segTime = [0];
  for (let i = 1; i < n; i++) {
    const lo = Math.max(0, i - 1 - k);
    const hi = Math.min(n - 1, i + k);
    const g = (ele[hi] - ele[lo]) / Math.max(1, cum[hi] - cum[lo]);
    const km = cum[i] / 1000;
    const f = Math.floor(km);
    const t = km - f;
    const wobble = lerp(knots[f], knots[f + 1], (1 - Math.cos(Math.PI * t)) / 2);
    const fatigue = 1 - 0.12 * (cum[i] / total);
    segTime.push((cum[i] - cum[i - 1]) / (speedForGrade(g) * wobble * fatigue));
  }
  return { cum, segTime };
}

// ---------------------------------------------------------------------------------------------
// Road crossings (for the second stop)
// ---------------------------------------------------------------------------------------------

function segmentIntersection(p1, p2, q1, q2) {
  const r = { x: p2.x - p1.x, y: p2.y - p1.y };
  const s = { x: q2.x - q1.x, y: q2.y - q1.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const qp = { x: q1.x - p1.x, y: q1.y - p1.y };
  const t = (qp.x * s.y - qp.y * s.x) / den;
  const u = (qp.x * r.y - qp.y * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

function roadCrossings(pts, cum, roads, proj) {
  const xy = pts.map(proj.toXY);
  const found = [];
  for (const road of roads) {
    const rxy = road.geometry.map(proj.toXY);
    for (let i = 1; i < xy.length; i++) {
      for (let j = 1; j < rxy.length; j++) {
        const t = segmentIntersection(xy[i - 1], xy[i], rxy[j - 1], rxy[j]);
        if (t !== null) {
          const label =
            [road.tags.name, road.tags.ref].filter(Boolean).join(' / ') || `way ${road.id}`;
          found.push({ index: t < 0.5 ? i - 1 : i, at: lerp(cum[i - 1], cum[i], t), label });
        }
      }
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------------------------
// Steps 3–4: record like a watch
// ---------------------------------------------------------------------------------------------

function record(pts, ele, segTime, stops, rand, proj) {
  const n = pts.length;
  const stopAt = new Map(stops.map((s) => [s.index, s.seconds]));
  const arrive = [0];
  const depart = [stopAt.get(0) ?? 0];
  for (let i = 1; i < n; i++) {
    arrive.push(depart[i - 1] + segTime[i]);
    depart.push(arrive[i] + (stopAt.get(i) ?? 0));
  }
  const end = Math.ceil(arrive[n - 1] / RECORD_INTERVAL_S) * RECORD_INTERVAL_S;

  // GPS error is correlated in time: an AR(1) process per axis, σ ≈ 1.5 m.
  const SIGMA = 1.5;
  const RHO = 0.92;
  const innovation = SIGMA * Math.sqrt(1 - RHO * RHO);
  let nx = SIGMA * gaussian(rand);
  let ny = SIGMA * gaussian(rand);

  const out = [];
  let i = 0;
  for (let t = 0; t <= end; t += RECORD_INTERVAL_S) {
    while (i < n - 1 && arrive[i + 1] <= t) i++;
    let p;
    let e;
    if (i >= n - 1 || t <= depart[i]) {
      const v = Math.min(i, n - 1);
      p = pts[v];
      e = ele[v];
    } else {
      const f = (t - depart[i]) / (arrive[i + 1] - depart[i]);
      p = { lat: lerp(pts[i].lat, pts[i + 1].lat, f), lon: lerp(pts[i].lon, pts[i + 1].lon, f) };
      e = lerp(ele[i], ele[i + 1], f);
    }
    nx = RHO * nx + innovation * gaussian(rand);
    ny = RHO * ny + innovation * gaussian(rand);
    const q = proj.offset(p, nx, ny);
    out.push({
      lat: Number(q.lat.toFixed(7)),
      lon: Number(q.lon.toFixed(7)),
      ele: Number(e.toFixed(1)),
      t,
    });
  }
  return { points: out, moving: arrive[n - 1] - stops.reduce((s, x) => s + x.seconds, 0), end };
}

// ---------------------------------------------------------------------------------------------
// Step 5: GPX
// ---------------------------------------------------------------------------------------------

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toGpx(points) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Vert sample generator" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${xmlEscape(TRAIL_NAME)}</name>`,
    `    <desc>${xmlEscape(ATTRIBUTION)}</desc>`,
    '    <copyright author="OpenStreetMap contributors">',
    '      <license>https://opendatacommons.org/licenses/odbl/</license>',
    '    </copyright>',
    `    <time>${iso(START_UTC_MS)}</time>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${xmlEscape(TRAIL_NAME)}</name>`,
    '    <type>trail_running</type>',
    '    <trkseg>',
  ];
  for (const p of points) {
    lines.push(
      `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`,
      `        <ele>${p.ele.toFixed(1)}</ele>`,
      `        <time>${iso(START_UTC_MS + p.t * 1000)}</time>`,
      '      </trkpt>',
    );
  }
  lines.push('    </trkseg>', '  </trk>', '</gpx>', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------

function ascentWithHysteresis(values, threshold) {
  let gain = 0;
  let loss = 0;
  let ref = values[0];
  for (const v of values) {
    if (v - ref >= threshold) {
      gain += v - ref;
      ref = v;
    } else if (ref - v >= threshold) {
      loss += ref - v;
      ref = v;
    }
  }
  return { gain, loss };
}

const hms = (s) => {
  const r = Math.round(s);
  return `${Math.floor(r / 3600)}:${String(Math.floor((r % 3600) / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  // Sanity check on the hard-coded start instant.
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(START_UTC_MS);
  if (local !== 'Sat 07:10')
    throw new Error(`Start time is ${local} in New York, expected Sat 07:10`);

  const osm = await overpass(OVERPASS_QUERY);
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry);
  const trailWays = ways
    .filter((w) => /Coosa Backcountry/.test(w.tags.name ?? ''))
    .sort((a, b) => a.id - b.id);
  const roads = ways.filter((w) => !/Coosa Backcountry/.test(w.tags.name ?? ''));
  console.log(`OSM: ${trailWays.length} trail ways, ${roads.length} road ways`);
  for (const w of trailWays) {
    console.log(
      `  way ${w.id} "${w.tags.name}" ${(polylineLength(w.geometry) / 1000).toFixed(2)} km`,
    );
  }

  const { route, legs, bridges, trailhead, startDist } = stitchLoop(trailWays);
  console.log(
    `Trailhead ${trailhead.lat.toFixed(5)}, ${trailhead.lon.toFixed(5)} ` +
      `(${Math.round(startDist)} m from the visitor-centre hint)`,
  );
  console.log(`Stitched ${DIRECTION.toUpperCase()} loop:\n  ${legs.join('\n  ')}`);
  if (bridges.length === 0) console.log('Bridged gaps: none');
  for (const b of bridges) {
    console.log(
      `Bridged gap of ${b.m.toFixed(0)} m: ${b.from.lat.toFixed(5)},${b.from.lon.toFixed(5)} → ` +
        `${b.to.lat.toFixed(5)},${b.to.lon.toFixed(5)}`,
    );
  }
  console.log(`Stitched length: ${(polylineLength(route) / 1000).toFixed(2)} km`);

  const pts = resample(route, SPACING_M);
  const { elevations, tileCount } = await sampleElevations(pts, TILE_ZOOM);
  const ele = movingAverage(elevations, SMOOTH_POINTS);
  console.log(`Resampled to ${pts.length} points; elevation from ${tileCount} Terrarium tiles`);

  const rand = mulberry32(SEED);
  const { cum, segTime } = paceModel(pts, ele, rand);
  const proj = projector(trailhead.lat);

  // Stops: 90 s at the high point, 60 s at the first paved-road crossing away from the trailhead.
  const summit = ele.indexOf(Math.max(...ele));
  const total = cum[cum.length - 1];
  const crossings = roadCrossings(pts, cum, roads, proj);
  for (const c of crossings)
    console.log(`Road crossing at km ${(c.at / 1000).toFixed(2)}: ${c.label}`);
  const crossing = crossings.find((c) => c.at > 1000 && c.at < total - 1000);
  const stops = [
    { index: summit, seconds: 90, label: `high point, km ${(cum[summit] / 1000).toFixed(2)}` },
  ];
  if (crossing) {
    stops.push({
      index: crossing.index,
      seconds: 60,
      label: `${crossing.label}, km ${(crossing.at / 1000).toFixed(2)}`,
    });
  } else {
    console.warn('No road crossing found; using a 60 s stop at the half-way point instead.');
    const half = cum.findIndex((d) => d >= total / 2);
    stops.push({
      index: half,
      seconds: 60,
      label: `half-way, km ${(cum[half] / 1000).toFixed(2)}`,
    });
  }
  for (const s of stops) console.log(`Stop ${s.seconds} s: ${s.label}`);

  const { points, moving, end } = record(pts, ele, segTime, stops, rand, proj);
  const gpx = toGpx(points);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, gpx);

  const distance = polylineLength(points);
  const { gain, loss } = ascentWithHysteresis(
    points.map((p) => p.ele),
    3,
  );
  const eles = points.map((p) => p.ele);
  let movingFromPoints = 0;
  for (let k = 1; k < points.length; k++) {
    const dt = points[k].t - points[k - 1].t;
    if (haversine(points[k - 1], points[k]) / dt > 0.5) movingFromPoints += dt;
  }
  console.log(`
Wrote ${OUT.slice(ROOT.length + 1)} (${(Buffer.byteLength(gpx) / 1024).toFixed(0)} KiB)
  points         ${points.length}
  distance       ${(distance / 1000).toFixed(2)} km
  total ascent   +${Math.round(gain)} m  (descent −${Math.round(loss)} m, 3 m hysteresis)
  high point     ${Math.max(...eles).toFixed(1)} m
  low point      ${Math.min(...eles).toFixed(1)} m
  moving time    ${hms(moving)}  (from points at > 0.5 m/s: ${hms(movingFromPoints)})
  elapsed time   ${hms(end)}
  start          ${iso(START_UTC_MS)} (Sat 07:10 America/New_York)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
