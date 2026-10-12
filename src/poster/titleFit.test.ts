import { describe, expect, it } from 'vitest';
import {
  TRAIL_SIGN_TITLE,
  countLines,
  fitTitle,
  SHARE_TITLE,
  fitTitleSize,
  CAP_HEIGHT_EM,
  CAP_OVERSHOOT_EM,
  breakLines,
  canvasInk,
  createCanvasInk,
  neededLineHeight,
  SHARE_STACKED_LINE_GAP_PX,
  STACKED_ACCENT_ASCENT_EM,
  STACKED_LINE_GAP_PX,
  hasStackedDiacritics,
  hasWide,
  fitTitleSetting,
  titleLineHeight,
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

describe('titleLineHeight', () => {
  it('finds accented capitals whose mark stacks above the cap height, uppercased as shown', () => {
    for (const title of [
      'Żółta Pętla',
      'Mont Blanc Été',
      'Åre Fjällmaraton',
      'ruta ñandú',
      'İstanbul',
    ]) {
      expect(hasStackedDiacritics(title), title).toBe(true);
    }
    // Marks below (cedilla, ogonek) and letters with no mark above stay as they are.
    for (const title of ['Coosa Backcountry Trail', 'Façade Ęą', 'Łodz ØĐ', '高尾山']) {
      expect(hasStackedDiacritics(title), title).toBe(false);
    }
  });

  it('leaves Latin-only titles to the stylesheet, and sets wide scripts at 1', () => {
    expect(titleLineHeight('Coosa Backcountry Trail', 104)).toBeUndefined();
    expect(titleLineHeight('Lavaredo Ultra Trail 20K', 48)).toBeUndefined();
    expect(titleLineHeight('高尾山 Trail', 104)).toBe(1);
  });

  it(`keeps an accent ${String(STACKED_LINE_GAP_PX)} px clear of the line above at any size`, () => {
    // Worst case without the breaks: accents (0.937 em) under round capitals' overshoot (0.012).
    expect(titleLineHeight('Żółta Ósemka', 104)).toBe(1);
    expect(titleLineHeight('Żółta Ósemka', 48)).toBe(1.06);
    for (const size of [48, 64, 80, 104, 160]) {
      const lineHeight = titleLineHeight('Grand Raid Été Énorme', size) ?? 0;
      // Baseline to baseline, less the accent above and the overshoot below.
      const gap = (lineHeight - STACKED_ACCENT_ASCENT_EM - CAP_OVERSHOOT_EM) * size;
      expect(gap).toBeGreaterThanOrEqual(STACKED_LINE_GAP_PX);
      // 3.5 px or more at the A3 preview's scale (566 / 720), the smallest print preview.
      expect(gap * (566 / 720)).toBeGreaterThanOrEqual(3.5);
      expect(lineHeight).toBeGreaterThan(0.88);
    }
    expect(titleLineHeight('高尾山 Été', 104)).toBe(1);
  });

  it('also clears an ogonek, a cedilla or a Q tail hanging from the line above', () => {
    // "WIELKA PĘTLA / ŻÓŁTA": the Ę's ogonek (0.205 em) sits over the Ż's dot.
    expect(titleLineHeight('Wielka Pętla Żółta', 104)).toBe(1.2);
    expect(titleLineHeight('Façade Été', 104)).toBe(1.2);
    expect(titleLineHeight('Quatre Été', 104)).toBe(1.12);
    // Marks below alone: a cedilla stays clear of the next line's capitals (0.700 em, round).
    expect(titleLineHeight('Façade Ęą', 104)).toBe(0.96);
    const below = (titleLineHeight('Façade Ęą', 48) ?? 0) * 48;
    expect(below - (CAP_HEIGHT_EM + 0.205) * 48).toBeGreaterThanOrEqual(STACKED_LINE_GAP_PX);
  });

  it('counts only neighbouring lines that meet, given the breaks', () => {
    // One line: nothing to touch.
    expect(titleLineHeight('Żółta Ósemka', 104, { lines: ['ŻÓŁTA ÓSEMKA'] })).toBeUndefined();
    expect(titleLineHeight('Façade Ęą', 104, { lines: ['FAÇADE ĘĄ'] })).toBeUndefined();
    // Accents only on the first line, a cedilla only on the last: clear at 0.88.
    expect(
      titleLineHeight('Été Grand Raid', 104, { lines: ['ÉTÉ GRAND', 'RAID'] }),
    ).toBeUndefined();
    expect(titleLineHeight('Trail Façade', 104, { lines: ['TRAIL', 'FAÇADE'] })).toBeUndefined();
    // An accent under a line, a cedilla over one: looser.
    expect(titleLineHeight('Grand Été', 104, { lines: ['GRAND', 'ÉTÉ'] })).toBe(1);
    expect(titleLineHeight('Façade Trail', 104, { lines: ['FAÇADE', 'TRAIL'] })).toBe(0.96);
    expect(neededLineHeight(['A'], 104, 4)).toBe(0);
  });
});

describe('breakLines', () => {
  it('breaks as countLines counts', () => {
    for (const title of [
      'Coosa Backcountry Trail Loop Run',
      'Wielka Pętla Żółta Ósemka Tatr',
      '高尾山トレイルランニング大会',
      'Supercalifragilisticexpialidocious Trail',
    ]) {
      for (const width of [3, 6, 9]) {
        const lines = breakLines(title, width, -0.01);
        expect(lines.length, `${title} @ ${String(width)}`).toBe(countLines(title, width, -0.01));
      }
    }
    expect(breakLines('Grand Raid Été', 6)).toEqual(['Grand Raid', 'Été']);
  });
});

describe('fitTitleSetting', () => {
  const TITLES = [
    'Wielka Pętla Żółta Ósemka Tatr',
    'Jérôme Quatre Été Quiberon Jura',
    'ŻÓŁTA GÓRA ÉCLAT ÅNGSTRÖM',
    'Đường Mòn Núi Bà Đen Tây Ninh',
    'Ça Été Ęą Façade Junquera',
    'Façade Ęą Çaçe Junquera Quinta',
  ];

  it('leaves titles without diacritics, and one-line titles, exactly as fitTitle sets them', () => {
    for (const title of [
      'Coosa',
      'Lavaredo Ultra Trail 20K',
      'Coosa Backcountry Trail Loop Run',
      'Żółta Ósemka',
      'Façade Ęą',
    ]) {
      expect(fitTitleSetting(title), title).toEqual(fitTitle(title));
    }
    for (const title of ['Coosa', 'Lavaredo Ultra Trail 20K', 'Façade Ęą']) {
      expect(fitTitleSetting(title, SHARE_TITLE), title).toEqual(fitTitle(title, SHARE_TITLE));
    }
    expect(fitTitle('Żółta Ósemka').lines).toBe(1);
    // On the share card it breaks ŻÓŁTA / ÓSEMKA at 160 px: an accent under a line, so it is set
    // looser (here one line at 156 px) in the same box.
    expect(fitTitle('Żółta Ósemka', SHARE_TITLE)).toEqual({ size: 160, lines: 2 });
    expect(
      fitTitleSetting('Żółta Ósemka', SHARE_TITLE, undefined, SHARE_STACKED_LINE_GAP_PX),
    ).toMatchObject({
      size: 156,
      lines: 1,
      boxHeight: 2 * 160 * 0.88,
    });
    expect(fitTitleSetting('高尾山 Trail')).toEqual({ ...fitTitle('高尾山 Trail'), lineHeight: 1 });
  });

  it.each([
    ['print', TRAIL_SIGN_TITLE, STACKED_LINE_GAP_PX],
    ['share', SHARE_TITLE, SHARE_STACKED_LINE_GAP_PX],
  ] as const)(
    'keeps the plain fit’s box height and fits the looser lines inside it (%s)',
    (_name, options, gap) => {
      for (const title of TITLES) {
        const plain = fitTitle(title, options);
        const set = fitTitleSetting(title, options, undefined, gap);
        expect(set.boxHeight, title).toBeCloseTo(plain.lines * plain.size * 0.88, 9);
        const lineHeight = set.lineHeight ?? 0;
        expect(set.lines * set.size * lineHeight, title).toBeLessThanOrEqual(
          (set.boxHeight ?? 0) + 1e-6,
        );
        const lines = breakLines(title, (options.width * 0.98) / set.size, options.letterSpacing);
        expect(lines.length, title).toBe(set.lines);
        expect(neededLineHeight(lines, set.size, gap), title).toBeLessThanOrEqual(lineHeight);
        expect(set.size, title).toBeLessThanOrEqual(plain.size);
      }
    },
  );
});

describe('titleLineHeight, marks below', () => {
  it('needs nothing for Latin capitals with tails', () => {
    expect(titleLineHeight('Quinta Junquera', 48)).toBeUndefined();
  });
});

describe('ink extents from TextMetrics', () => {
  /** A fake 2D context: ink per character, the line's extent the extremes of its characters. */
  function fakeContext(extents: Record<string, [number, number]>, metrics = true) {
    const ctx = {
      font: '',
      fontStretch: 'normal' as CanvasFontStretch,
      measured: [] as string[],
      measureText(text: string) {
        ctx.measured.push(text);
        let ascent = 0;
        let descent = 0;
        for (const ch of text) {
          const [a, d] = extents[ch] ?? [70, 1.2];
          ascent = Math.max(ascent, a);
          descent = Math.max(descent, d);
        }
        return (
          metrics
            ? { width: 0, actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent }
            : { width: 0 }
        ) as TextMetrics;
      },
    };
    return ctx;
  }
  // At 100 px: doubled Vietnamese marks reach 104 px (past the table's 93.7), Ó 93.7, Ę hangs 20.5.
  const VIETNAMESE: Record<string, [number, number]> = {
    Ề: [104, 0],
    Ỗ: [104, 1.2],
    Ấ: [102, 0],
    Ó: [93.7, 1.2],
    Ę: [70, 20.5],
    ' ': [0, 0],
  };

  it('reads actualBoundingBoxAscent / Descent at the title face, in em, cached per line', () => {
    const ctx = fakeContext(VIETNAMESE);
    const ink = createCanvasInk(ctx, "'Archivo', sans-serif");
    if (!ink) throw new Error('no ink measure');
    expect(ctx.font).toBe("800 100px 'Archivo', sans-serif");
    expect(ctx.fontStretch).toBe('extra-condensed');
    expect(ink('ỀNH ỖI')).toEqual({ ascent: 1.04, descent: 0.012 });
    expect(ink('PĘTLA')).toEqual({ ascent: 0.7, descent: 0.205 });
    const calls = ctx.measured.length;
    ink('ỀNH ỖI');
    expect(ctx.measured.length).toBe(calls);
  });

  it('is unavailable without ink bounds in TextMetrics (the table is used instead)', () => {
    expect(createCanvasInk(fakeContext({}, false), 'Archivo')).toBeNull();
    // jsdom: no 2D context at all.
    expect(canvasInk()).toBeNull();
  });

  it('clears the real marks: a doubled mark on line 2 under line 1', () => {
    const ink = createCanvasInk(fakeContext(VIETNAMESE), 'Archivo');
    if (!ink) throw new Error('no ink measure');
    const lines = ['ĐỈNH FANSIPAN', 'ẤN TƯỢNG ỀNH ỖI'];
    const measured = neededLineHeight(lines, 104, STACKED_LINE_GAP_PX, ink);
    const table = neededLineHeight(lines, 104, STACKED_LINE_GAP_PX);
    // 0.012 em overshoot above + 1.04 em marks below + 5 px gap at 104 px.
    expect(measured).toBe(Math.ceil((0.012 + 1.04 + 5 / 104) * 100) / 100);
    expect(measured).toBeGreaterThan(table);
    // Lines without marks meeting: the measure decides nothing extra.
    expect(neededLineHeight(['ÓSEMKA', 'TATR'], 104, 5, ink)).toBeLessThan(0.88);
  });

  it('sets the title from the measured extents, still inside the plain fit’s box', () => {
    const ink = createCanvasInk(fakeContext(VIETNAMESE), 'Archivo');
    if (!ink) throw new Error('no ink measure');
    const title = 'Đỉnh Fansipan Ấn Tượng Ềnh Ỗi';
    const plain = fitTitle(title);
    const table = fitTitleSetting(title);
    const set = fitTitleSetting(title, TRAIL_SIGN_TITLE, undefined, STACKED_LINE_GAP_PX, ink);
    expect(set.boxHeight).toBeCloseTo(plain.lines * plain.size * 0.88, 9);
    expect(set.lines * set.size * (set.lineHeight ?? 0)).toBeLessThanOrEqual(
      (set.boxHeight ?? 0) + 1e-6,
    );
    const lines = breakLines(title, (TRAIL_SIGN_TITLE.width * 0.98) / set.size, -0.01);
    expect(neededLineHeight(lines, set.size, STACKED_LINE_GAP_PX, ink)).toBeLessThanOrEqual(
      set.lineHeight ?? 0,
    );
    expect(set.lineHeight ?? 0).toBeGreaterThan(table.lineHeight ?? 0);
    // A Latin title is left alone whatever the measure says.
    expect(fitTitleSetting('Coosa Backcountry Trail', undefined, undefined, 5, ink)).toEqual(
      fitTitle('Coosa Backcountry Trail'),
    );
  });
});
