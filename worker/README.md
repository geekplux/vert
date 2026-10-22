# Vert Worker: the elevation tile proxy

`GET`/`HEAD /tiles/:z/:x/:y.png` returns an AWS Terrain Tiles PNG (Terrarium encoding), for
`6 ≤ z ≤ 15` and `x, y < 2^z`. The client asks for 12–14 on ordinary routes and goes lower for very
long ones (about 8 past 100 km); 6 leaves headroom.

| Request                                      | Answer                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| valid tile, cached                           | 200 `image/png`, `Cache-Control: public, max-age=31536000, immutable`, `ETag` |
| valid tile, `If-None-Match` matches the ETag | 304                                                                           |
| valid tile, not in the bucket upstream       | 404 JSON, `Cache-Control: public, max-age=3600`                               |
| upstream 5xx, other status, or unreachable   | 502 JSON, `no-store`                                                          |
| any query string (even a bare `?`)           | 400 JSON                                                                      |
| bad path, z outside 6–15, x/y out of range   | 400 JSON                                                                      |
| method other than GET/HEAD                   | 405 JSON, `Allow: GET, HEAD`                                                  |
| outside `/tiles/`                            | 404 JSON (never reached in production: assets are served first)               |

`X-Tile-Source` says where the tile came from: `edge`, `r2` or `upstream`.

## How a tile is found

1. **Workers Cache API** (`caches.default`), local to the data centre. Filled from R2 hits, and
   with upstream 404s for an hour. An optimisation only: where it does nothing (some `workers.dev`
   setups, or `wrangler dev` without a zone), lookups fall through to R2.
2. **R2**, binding `TILES`, bucket `vert-tiles`, key `terrarium/{z}/{x}/{y}.png`. Conditional
   requests are evaluated by R2 (`onlyIf`), so a 304 never reads the body.
3. **Upstream**, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. On a 200
   PNG the body is teed: one branch streams to the client, the other goes to R2 through
   `ctx.waitUntil`. R2 needs a stream of known length; S3 always sends `Content-Length`, so the
   teed branch qualifies. A failed write is logged and the client still gets the tile.

Two concurrent misses for the same tile both fetch upstream and both write R2. Accepted: tiles are
immutable, the writes are identical, and a lock would cost more than the rare duplicate fetch.

## Privacy

- Only z/x/y leave the Worker. The upstream request is built from scratch (our `User-Agent`,
  `Accept: image/png`); no client header is forwarded. Query strings are rejected, not stripped.
- Logs are structured JSON from the Worker: event, method, zoom, source, status, duration. Never
  x/y, paths, IPs or headers. Invocation logs (request metadata) are off and query strings are
  redacted (`observability.logs.invocation_logs = false`, `redact_query_string = true`).

## Files

- `src/index.ts`: the entry point. Exports only the default handler: workerd treats every named
  export of the main module as an entrypoint.
- `src/proxy.ts`: the proxy. `src/tiles.ts`: path parsing, R2 key, upstream URL.
- `wrangler.toml`: local development of the proxy alone. `../wrangler.jsonc`: production,
  the app and the proxy as one Worker. Both bind `TILES` to `vert-tiles`, so they produce the same
  `Env`; `pnpm worker:types` regenerates `worker-configuration.d.ts` from `wrangler.toml`. Keep the
  bindings and observability settings of the two files in step.

## Local development

```sh
pnpm worker:dev                     # proxy alone on :8787, R2 simulated in .wrangler/state
pnpm test                           # unit tests with a fake R2, a fake cache and a fake fetch
pnpm build && pnpm exec wrangler dev --local                                 # app + proxy
pnpm build && pnpm exec wrangler deploy --dry-run --outdir /tmp/vert-dry
```

## Production

Cloudflare Workers Builds deploys this repo on every push to `main`, from the root `wrangler.jsonc`
(the app's `dist/` plus `/tiles/*` through this proxy, one Worker named `vert`). The R2 bucket
`vert-tiles` was created on 2026-10-13. The config's `name` must stay `vert`, matching the connected
Worker; Workers Builds fails if they differ.

Every other branch (a pull request) gets a Preview instead: Workers Builds runs `pnpm build`, then
`npx wrangler preview`, and comments the preview URL on the PR. Previews take their bindings from
the `previews` block in `wrangler.jsonc`, which points `TILES` at the bucket `vert-tiles-preview`
(created on 2026-10-18), so a preview fills its own tile cache and never writes into production's.
Without that block the preview build fails before it deploys anything.

The Worker answers at https://vert.geekplux.com, the main custom domain, and at
https://vert.geekplux.org, a second custom domain on the same Worker; `vert.fum.workers.dev`, the
Worker's own address, still answers too.

After a deploy, check:
`curl -sI https://vert.geekplux.com/tiles/12/655/1582.png` twice (`X-Tile-Source: upstream`,
then `r2` or `edge`), `curl -sI 'https://vert.geekplux.com/tiles/12/655/1582.png?a=1'` (400),
and that `/` still serves the app.
