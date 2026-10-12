import type { Climb, ProfilePoint } from './profileGeometry';

/**
 * The canvas's sample profile (frame "Main"), for stories and tests: the drawn polyline's x/1000 ×
 * 21,400 m, and y mapped back from 110…15 to 300…820 m. Resampled to 429 points (every 50 m) the
 * way the page will feed the component.
 */
const CANVAS_Y =
  '84 83 82 84 88 91 92 90 87 86 87 89 92 94 95 95 93 91 89 86 82 78 74 69 65 60 56 52 50 52 60 73 87 99 107 110 109 103 93 81 68 54 41 30 21 17 19 23 30 37 43 49 55 59 63 64 64 61 55 46 35 23 15 16 27 45 63 75 82 84 84';
const CANVAS_X =
  '0 14 29 43 57 71 86 100 114 129 143 157 171 186 200 214 229 243 257 271 286 300 314 329 343 357 371 386 400 414 429 443 457 471 486 500 514 529 543 557 571 586 600 614 629 643 657 671 686 700 714 729 743 757 771 786 800 814 829 843 857 871 886 900 914 929 943 957 971 986 1000';

export const SAMPLE_TOTAL = 21_400;

const xs = CANVAS_X.split(' ').map(Number);
const ys = CANVAS_Y.split(' ').map(Number);
const anchors: ProfilePoint[] = xs.map((x, i) => ({
  d: (x / 1000) * SAMPLE_TOTAL,
  ele: 300 + ((110 - (ys[i] ?? 110)) / 95) * 520,
}));

function resample(source: readonly ProfilePoint[], step: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  let j = 0;
  for (let d = 0; d <= SAMPLE_TOTAL + 1e-6; d += step) {
    while (j < source.length - 2 && (source[j + 1]?.d ?? Infinity) < d) j += 1;
    const a = source[j];
    const b = source[j + 1];
    if (!a || !b) break;
    const t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    out.push({ d, ele: a.ele + Math.min(1, Math.max(0, t)) * (b.ele - a.ele) });
  }
  return out;
}

export const SAMPLE_POINTS: ProfilePoint[] = resample(anchors, 50);

/** The aside's climbs list in the Main frame. */
export const SAMPLE_CLIMBS: Climb[] = [
  { start: 5_600, end: 8_400 },
  { start: 10_700, end: 13_700, steepest: true },
  { start: 16_800, end: 19_000 },
];
