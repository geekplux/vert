import type { Story } from '@ladle/react';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SAMPLE_RUN } from '../../page/sample';
import { INITIAL_PREFS } from '../../page/state';
import sampleTerrain from '../../page/UploadState/sample-terrain.svg';
import { loadPosterFonts } from '../fonts';
import { posterLayout } from '../layout';
import { NightRidgePoster } from '../NightRidgePoster';
import { PosterPreview } from '../PosterPreview';
import { posterSizeById } from '../sizes';
import type { PosterSize } from '../sizes';
import type { PosterStyleId } from '../styles';
import { SurveyQuadPoster } from '../SurveyQuadPoster';
import { TrailSignPoster } from '../TrailSignPoster';
import { posterContentFromRun } from '../types';
import { defaultExportDeps, exportPoster } from './export';
import type { ExportDeps } from './export';
import { posterSvg } from './serialize';
import type { SerializedPoster } from './serialize';

// A verification harness, not app code. Titles in scripts no poster font covers (Cyrillic,
// Vietnamese, Greek) fall back to system fonts. The check exports each poster and compares the
// title's line breaks three ways: the live preview DOM, the exported SVG laid out on its own (only
// its embedded CSS, in an isolated frame), and the exported PNG's ink (each preview line's right
// edge must match the ink's right edge in that line's band). Results land on
// `window.__vertFallback` for the docs/verify scripts.
export default { title: 'Poster / Export fallback scripts' };

const TITLES = {
  ru: 'Эльбрус Северный Траверс Через Перевал',
  vi: 'Đường Mòn Núi Bà Đen Tây Ninh Hành Trình',
  el: 'Ορειβατικό Μονοπάτι Ολύμπου Προς Μύτικα',
} as const;
type Lang = keyof typeof TITLES;

/** Logical px between a preview line's right edge and the export's ink (side bearings, AA). */
const INK_TOLERANCE = 10;

const ALL_STATS = { distance: true, vert: true, time: true, highPoint: true };

interface FallbackResult {
  status: 'running' | 'pass' | 'fail' | 'error';
  title: string;
  /** Character offsets where each title line starts. */
  preview?: number[];
  svg?: number[];
  /** Per preview line: |ink right − preview right| in logical px. */
  inkDelta?: number[];
  error?: string;
}

declare global {
  interface Window {
    __vertFallback?: Record<string, FallbackResult>;
  }
}

function element(style: PosterStyleId, size: PosterSize, title: string): ReactElement {
  const prefs = {
    ...INITIAL_PREFS,
    poster: { ...INITIAL_PREFS.poster, stats: ALL_STATS, title },
  };
  const content = posterContentFromRun(SAMPLE_RUN, prefs);
  if (style === 'A') {
    return (
      <TrailSignPoster content={content} size={size} figure={<img src={sampleTerrain} alt="" />} />
    );
  }
  if (style === 'B') {
    return <NightRidgePoster content={content} size={size} figureData={null} figure={<span />} />;
  }
  return <SurveyQuadPoster content={content} size={size} figureData={null} figure={<span />} />;
}

/** Character offsets where each line of `el`'s text starts, and each line's box (screen px). */
function lines(el: Element): { starts: number[]; rects: DOMRect[] } {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const starts: number[] = [];
  const rects: DOMRect[] = [];
  let offset = 0;
  let top = -Infinity;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    for (let i = 0; i < text.length; i += 1) {
      if (/\s/.test(text[i] ?? '')) continue;
      const range = doc.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.top > top + rect.height / 2) {
        starts.push(offset + i);
        rects.push(new DOMRect(rect.x, rect.y, rect.width, rect.height));
        top = rect.top;
      } else {
        const last = rects[rects.length - 1];
        if (last) {
          const right = Math.max(last.right, rect.right);
          const bottom = Math.max(last.bottom, rect.bottom);
          last.width = right - last.x;
          last.height = bottom - last.y;
        }
      }
    }
    offset += text.length;
  }
  return { starts, rects };
}

/** The title: its slot, or on a share card whose big number is a stat, the line under it. */
const TITLE_SELECTOR = '[data-slot="title"], [data-slot="headline"] > :last-child';

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Lays the exported SVG out in an isolated frame (no page CSS) and reads the title's lines. */
async function svgLines(poster: SerializedPoster): Promise<number[]> {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:fixed;left:-20000px;top:0;border:0;width:${String(
    Math.ceil(poster.width),
  )}px;height:${String(Math.ceil(poster.height))}px`;
  iframe.srcdoc = `<!DOCTYPE html><html><head><style>html,body{margin:0}</style></head><body>${posterSvg(poster)}</body></html>`;
  document.body.appendChild(iframe);
  try {
    await new Promise((resolve) => {
      iframe.addEventListener('load', resolve, { once: true });
    });
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('no frame document');
    await doc.fonts.ready;
    await frame();
    const title = doc.querySelector(TITLE_SELECTOR);
    if (!title) throw new Error('no title in the SVG');
    return lines(title).starts;
  } finally {
    iframe.remove();
  }
}

/** Rightmost inked column in a horizontal band of the PNG, logical px; NaN when none. */
async function inkRight(blob: Blob, top: number, bottom: number, scale: number) {
  const bitmap = await createImageBitmap(blob);
  try {
    const y0 = Math.max(0, Math.round(top * scale));
    const h = Math.max(1, Math.round((bottom - top) * scale));
    const canvas = new OffscreenCanvas(bitmap.width, h);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return NaN;
    context.drawImage(bitmap, 0, -y0);
    const paper = Array.from(context.getImageData(4, 0, 1, 1).data);
    const data = context.getImageData(0, 0, bitmap.width, h).data;
    for (let x = bitmap.width - 1; x >= 0; x -= 1) {
      for (let y = 0; y < h; y += 1) {
        const i = (y * bitmap.width + x) * 4;
        let d = 0;
        for (let c = 0; c < 3; c += 1) d += Math.abs((data[i + c] ?? 0) - (paper[c] ?? 0));
        if (d > 120) return x / scale;
      }
    }
    return NaN;
  } finally {
    bitmap.close();
  }
}

/** Renders the poster in a PosterPreview (as Poster mode does) and reads the title's lines. */
async function previewLines(style: PosterStyleId, size: PosterSize, title: string) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:800px;opacity:0';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await loadPosterFonts(style, title, { subtitle: true });
    flushSync(() => {
      root.render(
        <PosterPreview size={size} maxWidth={600} maxHeight={800}>
          {element(style, size, title)}
        </PosterPreview>,
      );
    });
    await document.fonts.ready;
    for (let i = 0; i < 4; i += 1) await frame();
    const poster = host.querySelector('[role="img"]');
    const titleEl = host.querySelector(TITLE_SELECTOR);
    if (!poster || !titleEl) throw new Error('no poster title');
    const origin = poster.getBoundingClientRect();
    const k = origin.width / posterLayout(size).width;
    const { starts, rects } = lines(titleEl);
    // Logical px from the poster's corner.
    const boxes = rects.map(
      (r) => new DOMRect((r.x - origin.x) / k, (r.y - origin.y) / k, r.width / k, r.height / k),
    );
    return { starts, boxes };
  } finally {
    root.unmount();
    host.remove();
  }
}

async function runCase(
  style: PosterStyleId,
  sizeId: 'a3' | '4x5',
  lang: Lang,
): Promise<FallbackResult> {
  const title = TITLES[lang];
  const size = posterSizeById(sizeId);
  try {
    const preview = await previewLines(style, size, title);
    const captured: { poster?: SerializedPoster } = {};
    const deps: ExportDeps = {
      ...defaultExportDeps,
      serialize: async (root, options) =>
        (captured.poster = await defaultExportDeps.serialize(root, options)),
    };
    const blob = await exportPoster(
      { element: element(style, size, title), size, style, format: 'png', fileName: 'x.png' },
      deps,
    );
    if (!captured.poster) throw new Error('not serialized');
    const svg = await svgLines(captured.poster);
    const scale = posterLayout(size).scale;
    const inkDelta: number[] = [];
    for (const box of preview.boxes) {
      const right = await inkRight(
        blob,
        box.y + box.height * 0.2,
        box.bottom - box.height * 0.2,
        scale,
      );
      inkDelta.push(Math.round(Math.abs(right - box.right) * 10) / 10);
    }
    const same = JSON.stringify(svg) === JSON.stringify(preview.starts);
    const pass = same && inkDelta.every((d) => d <= INK_TOLERANCE);
    return { status: pass ? 'pass' : 'fail', title, preview: preview.starts, svg, inkDelta };
  } catch (error) {
    return { status: 'error', title, error: String(error) };
  }
}

const CASES = (['A', 'B', 'E'] as const).flatMap((style) =>
  (['a3', '4x5'] as const).flatMap((size) =>
    (Object.keys(TITLES) as Lang[]).map((lang) => [style, size, lang] as const),
  ),
);

export const Check: Story = () => {
  const [results, setResults] = useState<Record<string, FallbackResult>>({});
  const runAll = async () => {
    for (const [style, size, lang] of CASES) {
      const key = `${style}-${size}-${lang}`;
      const running: FallbackResult = { status: 'running', title: TITLES[lang] };
      window.__vertFallback = { ...window.__vertFallback, [key]: running };
      setResults((current) => ({ ...current, [key]: running }));
      const result = await runCase(style, size, lang);
      window.__vertFallback = { ...window.__vertFallback, [key]: result };
      setResults((current) => ({ ...current, [key]: result }));
    }
  };
  return (
    <section style={{ display: 'grid', gap: 8, padding: 16 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Fallback-script titles: preview vs export</h1>
      <div>
        <button type="button" data-run-all onClick={() => void runAll()}>
          Run all
        </button>
      </div>
      <table style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
        <tbody>
          {Object.entries(results).map(([key, r]) => (
            <tr key={key} data-fallback-result={key} data-status={r.status}>
              <td>{key}</td>
              <td>{r.status}</td>
              <td>{r.preview?.join(',')}</td>
              <td>{r.svg?.join(',')}</td>
              <td>{r.inkDelta?.join(',') ?? r.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
Check.storyName = 'Check';
