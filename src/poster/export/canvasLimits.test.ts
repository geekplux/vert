import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canvasDiagnostics,
  FAILURES_TO_GIVE_UP,
  canvasWorks,
  knownCanvasResult,
  recordCanvasResult,
  resetCanvasResults,
  verifyCanvas,
} from './canvasLimits';
import { fakeCanvas } from './testFakes';

afterEach(() => {
  resetCanvasResults();
});

describe('verifyCanvas', () => {
  it('passes when the far-corner pixel reads back, and records the size', () => {
    expect(verifyCanvas(fakeCanvas(5400, 7200), 5400, 7200)).toBe(true);
    expect(knownCanvasResult(5400, 7200)).toBe(true);
    expect(canvasDiagnostics()).toEqual({ working: ['5400x7200'], failing: [] });
  });

  it('fails when the pixel stays blank, there is no context, or the size was refused', () => {
    expect(verifyCanvas(fakeCanvas(5400, 7200, { works: false }), 5400, 7200)).toBe(false);
    expect(verifyCanvas(fakeCanvas(3508, 4961, { context: false }), 3508, 4961)).toBe(false);
    expect(verifyCanvas(fakeCanvas(0, 0), 1080, 1920)).toBe(false);
    expect(canvasDiagnostics().failing).toEqual(['5400x7200', '3508x4961', '1080x1920']);
  });
});

describe('knownCanvasResult', () => {
  it('infers smaller sizes from one that worked and larger ones from one given up', () => {
    expect(knownCanvasResult(1080, 1350)).toBeUndefined();
    verifyCanvas(fakeCanvas(3508, 4961), 3508, 4961);
    verifyCanvas(fakeCanvas(5400, 7200, { works: false }), 5400, 7200);
    // One failure is worth another try, for that size and for larger ones.
    expect(knownCanvasResult(5400, 7200)).toBeUndefined();
    expect(knownCanvasResult(6000, 8000)).toBeUndefined();
    verifyCanvas(fakeCanvas(5400, 7200, { works: false }), 5400, 7200);
    expect(knownCanvasResult(5400, 7200)).toBe(false);
    expect(knownCanvasResult(1080, 1920)).toBe(true);
    expect(knownCanvasResult(6000, 8000)).toBe(false);
    // Neither smaller than the working size nor larger than the failing one: unknown.
    expect(knownCanvasResult(4000, 4000)).toBeUndefined();
  });

  it(`gives a size up after ${String(FAILURES_TO_GIVE_UP)} failures in a row, and a success resets the count`, () => {
    recordCanvasResult(1080, 1920, false);
    recordCanvasResult(1080, 1920, true);
    expect(knownCanvasResult(1080, 1920)).toBe(true);
    recordCanvasResult(1080, 1920, false);
    expect(knownCanvasResult(1080, 1920)).toBeUndefined();
    recordCanvasResult(1080, 1920, false);
    expect(knownCanvasResult(1080, 1920)).toBe(false);
    expect(canvasDiagnostics().failing).toEqual(['1080x1920 ×2']);
  });
});

describe('a larger size working', () => {
  it('clears the failures of every size no larger in both sides', () => {
    // A3 fails, then 18×24 works: A3 fits in it, so its count starts over.
    recordCanvasResult(3508, 4961, false);
    recordCanvasResult(5400, 7200, true);
    expect(knownCanvasResult(3508, 4961)).toBe(true);
    expect(canvasDiagnostics().failing).toEqual([]);
    // A3 fails again: one failure since the success, so it is not given up.
    recordCanvasResult(3508, 4961, false);
    expect(knownCanvasResult(3508, 4961)).toBeUndefined();
  });

  it('clears a size already given up, but not one larger in either side', () => {
    recordCanvasResult(3508, 4961, false);
    recordCanvasResult(3508, 4961, false);
    recordCanvasResult(6000, 6000, false);
    recordCanvasResult(6000, 6000, false);
    expect(knownCanvasResult(3508, 4961)).toBe(false);
    recordCanvasResult(5400, 7200, true);
    expect(knownCanvasResult(3508, 4961)).toBe(true);
    expect(knownCanvasResult(4000, 4000)).toBe(true);
    // 6000 × 6000 is wider than 5400 × 7200: still given up, and so are sizes beyond it.
    expect(knownCanvasResult(6000, 6000)).toBe(false);
    expect(knownCanvasResult(6000, 8000)).toBe(false);
  });

  it('is dropped by a later failure of a smaller size, which counts toward giving up', () => {
    recordCanvasResult(5400, 7200, true);
    recordCanvasResult(3508, 4961, false);
    expect(knownCanvasResult(5400, 7200)).toBeUndefined();
    expect(knownCanvasResult(3508, 4961)).toBeUndefined();
    recordCanvasResult(3508, 4961, false);
    expect(knownCanvasResult(3508, 4961)).toBe(false);
    expect(knownCanvasResult(5400, 7200)).toBe(false);
    // Smaller sizes that worked are kept.
    recordCanvasResult(1080, 1920, true);
    recordCanvasResult(3508, 4961, false);
    expect(knownCanvasResult(1080, 1350)).toBe(true);
  });
});

describe('canvasWorks', () => {
  it('allocates only when the answer is unknown, and frees the canvas', () => {
    const created: ReturnType<typeof fakeCanvas>[] = [];
    const create = vi.fn((w: number, h: number) => {
      const canvas = fakeCanvas(w, h);
      created.push(canvas);
      return canvas;
    });
    expect(canvasWorks(4096, 4096, create)).toBe(true);
    expect(created[0]?.width).toBe(0);
    expect(canvasWorks(4096, 4096, create)).toBe(true);
    expect(canvasWorks(1080, 1350, create)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('records a canvas that throws on creation as failing', () => {
    expect(
      canvasWorks(20000, 20000, () => {
        throw new RangeError('too big');
      }),
    ).toBe(false);
    expect(knownCanvasResult(20000, 20000)).toBeUndefined();
    expect(canvasDiagnostics().failing).toEqual(['20000x20000']);
  });
});
