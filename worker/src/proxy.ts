/**
 * The tile proxy: `GET`/`HEAD /tiles/:z/:x/:y.png` → an AWS Terrain Tiles (Terrarium) PNG.
 *
 * Lookup order, cheapest first:
 * 1. the Workers Cache API (`caches.default`), local to the data centre that took the request;
 * 2. R2 (`env.TILES`, key `terrarium/{z}/{x}/{y}.png`), the durable copy shared by every location;
 * 3. the public AWS bucket. A 200 is streamed to the client and, in parallel, stored in R2.
 *
 * The edge cache is filled from R2 hits (and with upstream 404s, for an hour). It is an
 * optimisation only: where the Cache API does nothing (wrangler dev without a zone, or a
 * `workers.dev` host), every lookup simply falls through to R2.
 *
 * Two concurrent misses for the same tile both go upstream and both write R2. That is accepted:
 * tiles are immutable, so the writes are identical and the last one wins; a lock would cost more
 * than the rare duplicate fetch.
 *
 * Privacy: the request may carry nothing but z/x/y. A query string is rejected, and the upstream
 * request is built from scratch, so no client header (cookie, referrer, IP, user agent) is
 * forwarded. Logs carry the zoom, source and status, never x/y, IPs or headers.
 */

import { MAX_ZOOM, MIN_ZOOM, parseTilePath, r2Key, upstreamUrl, type Tile } from './tiles';

/** Tiles never change, so every cache may keep them for a year. */
export const TILE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** A tile the bucket does not have; short, in case that is a transient upstream state. */
export const NOT_FOUND_CACHE_CONTROL = 'public, max-age=3600';

export const USER_AGENT = 'vert-tile-proxy/1.0 (+https://vert.geekplux.org)';

type Source = 'edge' | 'r2' | 'upstream';

function log(fields: Record<string, string | number>): void {
  console.log(JSON.stringify({ service: 'vert-tiles', ...fields }));
}

function logError(event: string, error: unknown, fields: Record<string, string | number> = {}) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ service: 'vert-tiles', event, message, ...fields }));
}

function json(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function reject(
  status: number,
  reason: string,
  message: string,
  headers?: Record<string, string>,
): Response {
  log({ event: 'tile_rejected', reason, status });
  return json(status, { error: reason, message }, headers);
}

function tileHeaders(etag: string | null): Headers {
  const headers = new Headers({
    'Content-Type': 'image/png',
    'Cache-Control': TILE_CACHE_CONTROL,
    'X-Content-Type-Options': 'nosniff',
  });
  if (etag) headers.set('ETag', etag);
  return headers;
}

/** True when an `If-None-Match` header names `etag` (weak comparison, as RFC 9110 asks). */
export function etagMatches(ifNoneMatch: string | null, etag: string | null): boolean {
  if (!ifNoneMatch || !etag) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  const wanted = opaque(etag);
  return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === wanted);
}

/**
 * Turns a full tile (or negative) response into the answer to this request: 304 when the client's
 * `If-None-Match` matches, headers only for `HEAD`, otherwise the body as is.
 */
async function answer(request: Request, response: Response, source: Source): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set('X-Tile-Source', source);
  const etag = headers.get('ETag');
  if (response.status === 200 && etagMatches(request.headers.get('If-None-Match'), etag)) {
    await response.body?.cancel();
    return notModified(etag, source);
  }
  if (request.method === 'HEAD') {
    await response.body?.cancel();
    return new Response(null, { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

function notModified(etag: string | null, source: Source): Response {
  const headers = new Headers({ 'Cache-Control': TILE_CACHE_CONTROL, 'X-Tile-Source': source });
  if (etag) headers.set('ETag', etag);
  return new Response(null, { status: 304, headers });
}

/** The edge cache, or undefined where the runtime has none (unit tests, other hosts). */
function edgeCache(): Cache | undefined {
  return 'caches' in globalThis ? caches.default : undefined;
}

async function matchEdge(cache: Cache | undefined, key: Request): Promise<Response | undefined> {
  if (!cache) return undefined;
  try {
    return await cache.match(key);
  } catch (error) {
    logError('edge_match_failed', error);
    return undefined;
  }
}

async function putEdge(cache: Cache, key: Request, response: Response): Promise<void> {
  try {
    await cache.put(key, response);
  } catch (error) {
    logError('edge_put_failed', error);
  }
}

async function putR2(env: Env, key: string, body: ReadableStream, z: number): Promise<void> {
  try {
    await env.TILES.put(key, body, { httpMetadata: { contentType: 'image/png' } });
    log({ event: 'tile_stored', z });
  } catch (error) {
    logError('r2_put_failed', error, { z });
  }
}

/** Only the conditional header R2 should evaluate; nothing else from the client goes to storage. */
function r2Conditions(request: Request): { onlyIf: Headers } | undefined {
  const ifNoneMatch = request.headers.get('If-None-Match');
  return ifNoneMatch ? { onlyIf: new Headers({ 'If-None-Match': ifNoneMatch }) } : undefined;
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  // With run_worker_first = ["/tiles/*"] nothing else reaches this code; static assets are served
  // by the platform. Answer 404 rather than guess.
  if (!url.pathname.startsWith('/tiles/')) {
    return json(404, { error: 'not_found' });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return reject(405, 'method_not_allowed', 'Only GET and HEAD are allowed.', {
      Allow: 'GET, HEAD',
    });
  }
  // `url.search` is empty for a bare `?`, so look at the raw URL.
  if (request.url.includes('?')) {
    return reject(400, 'query_not_allowed', 'Tile requests take no query string.');
  }
  const tile = parseTilePath(url.pathname);
  if (!tile) {
    return reject(
      400,
      'invalid_tile',
      `Expected /tiles/:z/:x/:y.png with ${String(MIN_ZOOM)} ≤ z ≤ ${String(MAX_ZOOM)} and x, y < 2^z.`,
    );
  }

  const started = Date.now();
  const response = await serveTile(request, env, ctx, tile, url.origin);
  log({
    event: 'tile_request',
    method: request.method,
    z: tile.z,
    source: response.headers.get('X-Tile-Source') ?? 'none',
    status: response.status,
    ms: Date.now() - started,
  });
  return response;
}

async function serveTile(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tile: Tile,
  origin: string,
): Promise<Response> {
  const key = r2Key(tile);
  // A bare GET keyed on the canonical path: the client's headers never enter the cache key.
  const cacheKey = new Request(
    `${origin}/tiles/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}.png`,
  );
  const cache = edgeCache();

  // 1. Edge cache.
  const cached = await matchEdge(cache, cacheKey);
  if (cached) return answer(request, cached, 'edge');

  // 2. R2.
  let object: R2ObjectBody | R2Object | null = null;
  try {
    object = await env.TILES.get(key, r2Conditions(request));
  } catch (error) {
    // Treat a storage failure as a miss: the tile can still come from upstream.
    logError('r2_get_failed', error, { z: tile.z });
  }
  if (object) {
    // A failed precondition returns the object without a body: the client's copy is current.
    if (!('body' in object)) return notModified(object.httpEtag, 'r2');
    const headers = tileHeaders(object.httpEtag);
    let body = object.body;
    if (cache && request.method === 'GET') {
      const [toClient, toEdge] = body.tee();
      body = toClient;
      ctx.waitUntil(putEdge(cache, cacheKey, new Response(toEdge, { headers })));
    }
    return answer(request, new Response(body, { headers }), 'r2');
  }

  // 3. Upstream. A fresh request: only z/x/y and our own headers leave the Worker.
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(tile), {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' },
      redirect: 'manual',
    });
  } catch (error) {
    logError('upstream_fetch_failed', error, { z: tile.z });
    return json(502, {
      error: 'upstream_unavailable',
      message: 'The elevation source is unreachable.',
    });
  }

  if (upstream.status === 404) {
    await upstream.body?.cancel();
    const notFound = json(
      404,
      { error: 'tile_not_found', message: 'The elevation source has no such tile.' },
      { 'Cache-Control': NOT_FOUND_CACHE_CONTROL },
    );
    if (cache) ctx.waitUntil(putEdge(cache, cacheKey, notFound.clone()));
    return answer(request, notFound, 'upstream');
  }

  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (upstream.status !== 200 || !upstream.body || !contentType.startsWith('image/png')) {
    await upstream.body?.cancel();
    logError('upstream_bad_response', `HTTP ${String(upstream.status)} ${contentType}`, {
      z: tile.z,
    });
    return json(502, {
      error: 'upstream_error',
      message: 'The elevation source answered with an error.',
      upstreamStatus: upstream.status,
    });
  }

  const [toClient, toR2] = upstream.body.tee();
  ctx.waitUntil(putR2(env, key, toR2, tile.z));
  const headers = tileHeaders(upstream.headers.get('ETag'));
  return answer(request, new Response(toClient, { headers }), 'upstream');
}
