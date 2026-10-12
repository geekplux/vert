/**
 * Export failures. `ExportError` lives here, not in the page, so the export engine never imports
 * page code; `page/PosterState/exporter.ts` re-exports it for the page.
 */

/** A failure whose message is fit to show the user (any other rejection shows a generic one). */
export class ExportError extends Error {
  override name = 'ExportError';
}

/** What the user is told when the browser cannot hold or encode the poster's canvas. */
export const TOO_LARGE_MESSAGE = 'This poster is too large for this browser. Try a smaller size.';
