import { describe, expect, it } from 'vitest';
import { POSTER_SIZES, posterSizeById } from './sizes';
import type { PosterSizeId } from './sizes';

describe('POSTER_SIZES', () => {
  it('lists the four sizes in display order with their pixel targets', () => {
    expect(POSTER_SIZES.map(({ id, use, width, height }) => [id, use, width, height])).toEqual([
      ['18x24', 'print', 5400, 7200],
      ['a3', 'print', 3508, 4961],
      ['4x5', 'social', 1080, 1350],
      ['9x16', 'story', 1080, 1920],
    ]);
  });
});

describe('posterSizeById', () => {
  it('finds each size by its id', () => {
    for (const size of POSTER_SIZES) expect(posterSizeById(size.id)).toBe(size);
    expect(posterSizeById('a3').width).toBe(3508);
  });

  it('throws on an id that is not a size', () => {
    expect(() => posterSizeById('letter' as PosterSizeId)).toThrow(RangeError);
  });
});
