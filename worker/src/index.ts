/**
 * Vert's Worker entry point.
 *
 * Deployed as one Worker with the app (wrangler.jsonc): the platform serves the static
 * assets from dist/, and only `/tiles/*` runs this code (`run_worker_first`). See proxy.ts for the
 * tile proxy itself.
 */

import { handleRequest } from './proxy';

// workerd treats every named export of the main module as an entrypoint: export only the handler.

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
