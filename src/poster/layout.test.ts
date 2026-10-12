import { describe, expect, it } from 'vitest';
import { figureBoxRule, posterLayout } from './layout';
import { posterSizeById } from './sizes';
import { POSTER_SIZES } from './sizes';

describe('posterLayout', () => {
  it('lays print sizes out at 720 wide and social sizes at 1080 wide', () => {
    expect(POSTER_SIZES.map((size) => [size.id, posterLayout(size)])).toEqual([
      ['18x24', { kind: 'print', width: 720, height: 960, scale: 7.5 }],
      ['a3', { kind: 'print', width: 720, height: (720 * 4961) / 3508, scale: 3508 / 720 }],
      ['4x5', { kind: 'social', width: 1080, height: 1350, scale: 1 }],
      ['9x16', { kind: 'social', width: 1080, height: 1920, scale: 1 }],
    ]);
  });

  it('scales back to the exact pixel target', () => {
    for (const size of POSTER_SIZES) {
      const layout = posterLayout(size);
      expect(layout.width * layout.scale).toBeCloseTo(size.width, 6);
      expect(layout.height * layout.scale).toBeCloseTo(size.height, 6);
    }
  });
});

describe('figureBoxRule', () => {
  const aspect = 1000 / 680;
  const rule = (id: Parameters<typeof posterSizeById>[0]) =>
    figureBoxRule(posterLayout(posterSizeById(id)), aspect);

  it('print: the figure fills the free height, never below 75% of its natural height', () => {
    for (const id of ['18x24', 'a3'] as const) {
      expect(rule(id)).toEqual({
        grow: true,
        minHeight: (624 / aspect) * 0.75,
        maxHeight: null,
        profile: false,
        tall: false,
      });
    }
  });

  it('4:5: natural height, capped at the box width', () => {
    expect(rule('4x5')).toEqual({
      grow: false,
      minHeight: null,
      maxHeight: 936,
      profile: false,
      tall: false,
    });
  });

  it('9:16: grows up to square and adds the elevation strip', () => {
    expect(rule('9x16')).toEqual({
      grow: true,
      minHeight: null,
      maxHeight: 936,
      profile: true,
      tall: true,
    });
  });
});
