/**
 * Google Analytics, on the live site only (DECISIONS.md "Google Analytics"). It counts page views:
 * the app sends no events of its own, and nothing about a run (file, name, coordinates, stats)
 * reaches it.
 *
 * - Only on {@link ANALYTICS_HOST}: local dev, the e2e run and branch Previews never load it.
 * - The page view names the origin and path only, and the page's fixed title: a `?scene=<url>`
 *   link's query string (the scene's address, `&title=`) and the scene's name in
 *   `document.title` are not sent.
 * - Google signals and ad personalisation are off.
 */

export const ANALYTICS_HOST = 'vert.geekplux.com';
export const MEASUREMENT_ID = 'G-CN7CN5MXMR';
/** index.html's `<title>`; a scene renames the tab, and that name stays out of the page view. */
const PAGE_TITLE = 'Vert · Drop a GPX. Get a poster.';

type Where = Pick<Location, 'hostname' | 'origin' | 'pathname'>;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Starts Google Analytics when the page is on the live site. Returns whether it did. */
export function startAnalytics(where: Where = window.location): boolean {
  if (where.hostname !== ANALYTICS_HOST) return false;

  const dataLayer = (window.dataLayer ??= []);
  // gtag.js reads `arguments` objects off the data layer, not arrays.
  const gtag: (...args: unknown[]) => void = function () {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, {
    page_location: `${where.origin}${where.pathname}`,
    page_title: PAGE_TITLE,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);
  return true;
}
