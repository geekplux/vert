import type { Plugin } from 'vite';

/** The 404 page's title: never the home page's, so an unknown path cannot pass for it. */
export const NOT_FOUND_TITLE = 'Page not found · Vert';

const TITLE_RE = /<title>[^<]*<\/title>/;

/**
 * The 404 page from the built index.html: the same app shell (a mistyped link still opens Vert),
 * with its own title, `noindex` and no canonical, so search engines neither index it nor fold it
 * into the home page.
 */
export function notFoundHtml(html: string, title: string): string {
  if (!TITLE_RE.test(html)) throw new Error('index.html has no <title> to replace');
  return html
    .replace(TITLE_RE, `<meta name="robots" content="noindex" />\n    <title>${title}</title>`)
    .replace(/\s*<link rel="canonical"[^>]*>/, '');
}

/**
 * Writes dist/404.html next to index.html (build only). Workers static assets answer any path
 * that is not a file with it, at status 404 (wrangler.jsonc `not_found_handling: "404-page"`);
 * the app has one route, `/`, and keeps its state in the query and hash.
 */
export function notFoundPage(title = NOT_FOUND_TITLE): Plugin {
  return {
    name: 'not-found-page',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const index = bundle['index.html'];
        if (index?.type !== 'asset') return;
        this.emitFile({
          type: 'asset',
          fileName: '404.html',
          source: notFoundHtml(String(index.source), title),
        });
      },
    },
  };
}
