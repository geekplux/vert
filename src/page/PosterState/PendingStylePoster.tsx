import type { CSSProperties } from 'react';
import { posterLayout } from '../../poster/layout';
import type { PosterSize } from '../../poster/sizes';
import type { PosterStyleOption } from '../../poster/styles';
import { styleTitle } from './posterCopy';
import styles from './PosterState.module.css';

export interface PendingStylePosterProps {
  style: PosterStyleOption;
  size: PosterSize;
}

/**
 * PHASE 2 PLACEHOLDER for the styles not built yet (B Night Ridge, E Survey Quad; phase 3 task 7
 * replaces it with the real posters): a plain card in the style's paper and ink at the poster's
 * logical size, saying so, so the preview never pretends to show a poster that does not exist.
 */
export function PendingStylePoster({ style, size }: PendingStylePosterProps) {
  const layout = posterLayout(size);
  const title = styleTitle(style);
  const box = {
    width: layout.width,
    height: layout.height,
    background: style.paper,
    color: style.ink,
    // Lengths scale with the logical width, so print (720) and social (1080) read alike.
    '--pending-unit': `${String(layout.width / 720)}px`,
  } as CSSProperties;

  return (
    <div
      role="img"
      aria-label={`${title} preview: this poster style is not built yet.`}
      className={styles.pending}
      style={box}
    >
      <div aria-hidden="true" className={styles.pendingText}>
        <span className={styles.pendingTitle}>{title} preview</span>
        <span className={styles.pendingNote}>This style arrives in a later build.</span>
      </div>
    </div>
  );
}
