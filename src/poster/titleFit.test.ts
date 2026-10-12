import { describe, expect, it } from 'vitest';
import {
  TRAIL_SIGN_TITLE,
  countLines,
  fitTitle,
  SHARE_TITLE,
  fitTitleSize,
  hasWide,
  isWide,
  tableMeasure,
  titleWidthEm,
} from './titleFit';

describe('titleWidthEm', () => {
  it('matches the measured width of the canvas title within 1%', () => {
    // Measured in Chromium: "[ROUTE NAME]" at Archivo 800 wdth 62% is 5.405em.
    expect(titleWidthEm('[Route name]')).toBeCloseTo(5.405, 1);
  });

  it('applies letter-spacing per character', () => {
    expect(titleWidthEm('AB', -0.01)).toBeCloseTo(0.5 + 0.482 - 0.02, 6);
  });
});

describe('countLines', () => {
  it('wraps greedily at word boundaries', () => {
    const width = 624 / 104;
    expect(countLines('[Route name] Loop', width)).toBe(2);
    expect(countLines('Coosa Backcountry Loop', width)).toBe(3);
    expect(countLines('Loop', width)).toBe(1);
    expect(countLines('   ', width)).toBe(0);
  });

  it('counts a word longer than the line as several lines', () => {
    expect(countLines('W'.repeat(30), 5)).toBe(5);
  });
});

describe('fitTitleSize', () => {
  it('keeps 104px for titles of up to three lines', () => {
    expect(fitTitleSize('[Route name] Loop')).toBe(104);
    expect(fitTitleSize('Coosa Backcountry Loop')).toBe(104);
  });

  it('shrinks a long title until it fits in three lines', () => {
    const title = 'Chattahoochee National Forest Backcountry Ridge Traverse and Return Loop';
    const size = fitTitleSize(title);
    expect(size).toBeLessThan(104);
    expect(size % 2).toBe(0);
    const usable = TRAIL_SIGN_TITLE.width * 0.98;
    expect(countLines(title, usable / size, -0.01)).toBeLessThanOrEqual(3);
    expect(countLines(title, usable / (size + 2), -0.01)).toBeGreaterThan(3);
  });

  it('stops at the minimum size', () => {
    expect(fitTitleSize('Supercalifragilistic'.repeat(6))).toBe(TRAIL_SIGN_TITLE.minSize);
  });
});

describe('wide scripts', () => {
  const CJK = '高尾山から陣馬山への縦走トレイルランニング大会コース';
  const usable = TRAIL_SIGN_TITLE.width * 0.98;

  it('counts CJK, kana, hangul and fullwidth forms as 1em', () => {
    for (const char of ['高', 'か', 'ト', '한', 'Ａ', '。']) expect(isWide(char)).toBe(true);
    for (const char of ['A', 'é', '-', ' ']) expect(isWide(char)).toBe(false);
    expect(tableMeasure('高尾山')).toBe(3);
  });

  it('breaks between wide characters without spaces', () => {
    // 26 characters at 0.99em each (letter-spacing −0.01em) in a 9em line: 3 lines.
    expect(countLines(CJK, 9, -0.01)).toBe(3);
    expect(countLines('高尾山 Trail', 100)).toBe(1);
  });

  it('keeps line-start-prohibited characters with the character before', () => {
    // "コー" cannot break before "ー": with room for exactly one more character after "コ",
    // the pair moves to the next line together.
    expect(countLines('ココー', 2)).toBe(2);
    expect(countLines('ココ', 2)).toBe(1);
  });

  it('fits the long Japanese course name in ≤ 3 lines and never overflows, 104 → 48px', () => {
    const fit = fitTitle(CJK);
    expect(fit.size).toBe(68);
    expect(fit.lines).toBeLessThanOrEqual(3);
    for (let size = TRAIL_SIGN_TITLE.maxSize; size >= TRAIL_SIGN_TITLE.minSize; size -= 2) {
      // No single unbreakable token is wider than the line at any size.
      const widest = Math.max(...Array.from(CJK, (char) => titleWidthEm(char, -0.01)));
      expect(widest * size).toBeLessThanOrEqual(usable);
    }
  });

  it('allows four lines at 48px when even 48px needs more than three', () => {
    const title = '高尾山から陣馬山への縦走トレイルランニング大会コース'.repeat(2).slice(0, 42);
    const fit = fitTitle(title);
    expect(fit.size).toBe(TRAIL_SIGN_TITLE.minSize);
    expect(fit.lines).toBe(4);
  });

  it('uses the measure it is given (canvas in the browser)', () => {
    const wide = () => 100;
    expect(fitTitle('Loop', TRAIL_SIGN_TITLE, wide).size).toBe(TRAIL_SIGN_TITLE.minSize);
  });
});

describe('SHARE_TITLE', () => {
  it('starts at 160px on the 936px share column and keeps ≤ 3 lines', () => {
    expect(fitTitle('UTMB', SHARE_TITLE)).toEqual({ size: 160, lines: 1 });
    const long = fitTitle('Chattahoochee National Forest Backcountry Ridge Traverse', SHARE_TITLE);
    expect(long.size).toBeLessThan(160);
    expect(long.lines).toBeLessThanOrEqual(3);
  });

  it('detects wide-script titles', () => {
    expect(hasWide('高尾山 Trail')).toBe(true);
    expect(hasWide('Coosa Backcountry Trail')).toBe(false);
  });
});
