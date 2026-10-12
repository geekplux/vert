/**
 * Vert tile proxy.
 *
 * GET /tiles/:z/:x/:y.png will return an AWS Terrain Tiles (Terrarium) PNG, served from R2 when
 * cached and fetched from the public bucket otherwise. Requests carry only z/x/y, never GPX data
 * or coordinates. For now every valid tile request answers 501.
 */

import { MAX_ZOOM, parseTilePath } from './tiles';

// workerd treats every named export of the main module as an entrypoint: export only the handler.

function json(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/tiles/')) {
      return json(404, { error: 'not_found' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
    }
    const tile = parseTilePath(pathname);
    if (!tile) {
      return json(400, {
        error: 'invalid_tile',
        message: `Expected /tiles/:z/:x/:y.png with z ≤ ${String(MAX_ZOOM)} and x, y < 2^z.`,
      });
    }
    return json(501, {
      error: 'not_implemented',
      message: 'The tile proxy is not implemented yet.',
      tile,
    });
  },
} satisfies ExportedHandler<Env>;
