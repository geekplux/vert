/** Test fakes for the export engine (imported by tests only). */
import type { ProbeCanvas } from './canvasLimits';

/** A structurally valid JPEG header: SOI, an APP0 segment, SOF0 with the size, then EOI. */
export function fakeJpeg(width: number, height: number, components = 3): Uint8Array<ArrayBuffer> {
  // prettier-ignore
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, // APP0, length 4
    0xff, 0xc0, 0x00, 0x0b, 0x08, // SOF0, length 11, 8 bits
    height >> 8, height & 0xff, width >> 8, width & 0xff, components,
    0x01, 0x11, 0x00,
    0xff, 0xd9, // EOI
  ]);
}

/** One `drawImage(image, x, y, width, height)` call. */
export interface DrawCall {
  readonly image: unknown;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type FakeCanvas = ProbeCanvas & { readonly draws: DrawCall[] };

export interface FakeCanvasOptions {
  /** Whether `getContext` returns a context (default true). */
  readonly context?: boolean;
  /** Whether the far-corner probe pixel reads back (default true): false = a canvas too large. */
  readonly works?: boolean;
}

/**
 * A canvas whose 2D context records `drawImage` calls (jsdom has no canvas). `getImageData`
 * returns the probe pixel (red when the canvas "works") or, for larger reads, bytes derived from
 * the last image drawn, so a pixel hash changes when the drawn image does.
 */
export function fakeCanvas(
  width: number,
  height: number,
  { context = true, works = true }: FakeCanvasOptions = {},
): FakeCanvas {
  const draws: DrawCall[] = [];
  const ctx = {
    fillStyle: '',
    fillRect: () => undefined,
    clearRect: () => undefined,
    drawImage: (image: unknown, x: number, y: number, w: number, h: number) => {
      draws.push({ image, x, y, width: w, height: h });
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      if (w === 1 && h === 1) {
        return { data: new Uint8ClampedArray(works ? [255, 0, 0, 255] : [0, 0, 0, 0]) };
      }
      const last = (draws[draws.length - 1]?.image as string | undefined) ?? '';
      return { data: new Uint8ClampedArray(Array.from(last, (c) => c.charCodeAt(0) & 0xff)) };
    },
  };
  return {
    width,
    height,
    draws,
    getContext: () => (context ? ctx : null),
  } as unknown as FakeCanvas;
}

/** A CSSFontFaceRule-like object (jsdom's CSSOM drops `src` and `unicode-range`). */
export function fontRule(descriptors: Record<string, string>): CSSRule {
  const names = Object.keys(descriptors);
  return {
    cssText: `@font-face { ${names.map((n) => `${n}: ${descriptors[n] ?? ''}`).join('; ')} }`,
    style: {
      length: names.length,
      item: (i: number) => names[i] ?? '',
      getPropertyValue: (name: string) => descriptors[name] ?? '',
    },
  } as unknown as CSSRule;
}
