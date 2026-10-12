import { describe, expect, it } from 'vitest';
import { TITLE_MIN_PX, TITLE_PX, fitTitle } from './useTitleFit';

/** A title whose widest word is `em` em wide, in a column `column` px wide. */
const overflow = (em: number, column: number) => (size: number) => em * size > column;

describe('fitTitle', () => {
  it('keeps 44 px when every word fits the column', () => {
    expect(fitTitle(overflow(5, 228))).toEqual({ size: TITLE_PX, breakWords: false });
  });

  it('steps down 2 px at a time until the widest word fits ("Longyearbyen" at 1440)', () => {
    // 5.6 em: 246 px at 44 px, too wide for 228; 40 px gives 224.
    expect(fitTitle(overflow(5.6, 228))).toEqual({ size: 40, breakWords: false });
  });

  it('breaks the word only when it is too wide even at the smallest size', () => {
    expect(fitTitle(overflow(12, 228))).toEqual({ size: TITLE_MIN_PX, breakWords: true });
  });
});
