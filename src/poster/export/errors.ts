/**
 * Export failures. `ExportError` lives here, not in the page, so the export engine never imports
 * page code; `page/PosterState/exporter.ts` re-exports it for the page.
 */

/** A failure whose message is fit to show the user (any other rejection shows a generic one). */
export class ExportError extends Error {
  override name = 'ExportError';
}

import { hasSmallerSize } from '../sizes';
import type { PosterSize } from '../sizes';

/** What the user is told when the browser cannot hold or encode the poster's canvas. */
export const TOO_LARGE_MESSAGE = 'This poster is too large for this browser. Try a smaller size.';
/** The same, at the smallest size, where there is no smaller one to suggest. */
export const TOO_LARGE_SMALLEST_MESSAGE = 'This poster is too large for this browser.';

/** {@link TOO_LARGE_MESSAGE}, suggesting a smaller size only when one exists. */
export function tooLargeMessage(size: Pick<PosterSize, 'width' | 'height'>): string {
  return hasSmallerSize(size) ? TOO_LARGE_MESSAGE : TOO_LARGE_SMALLEST_MESSAGE;
}
