import type { Story } from '@ladle/react';
import { useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ExportFormat } from '../../page/PosterState/exporter';
import { SAMPLE_RUN } from '../../page/sample';
import { INITIAL_PREFS } from '../../page/state';
import type { PosterPrefs } from '../../page/state';
import type { Run } from '../../page/types';
import sampleTerrain from '../../page/UploadState/sample-terrain.svg';
import { NIGHT_RIDGE_ROWS, nightRidgeFigureData, quadBounds, ridgeBounds } from '../figures';
import { surveyQuadFigureData } from '../figures';
import { posterLayout } from '../layout';
import { NightRidgePoster } from '../NightRidgePoster';
import type { NightRidgeBox } from '../NightRidgePoster';
import { PosterPreview } from '../PosterPreview';
import { posterSizeById } from '../sizes';
import type { PosterSize, PosterSizeId } from '../sizes';
import { useHeightfield, useSampleRun } from '../storyData';
import type { PosterStyleId } from '../styles';
import { SurveyQuadPoster } from '../SurveyQuadPoster';
import { TrailSignPoster } from '../TrailSignPoster';
import type { FigureBoxSize } from '../TrailSignPoster';
import { posterContentFromRun } from '../types';
import { canvasDiagnostics } from './canvasLimits';
import type { CanvasDiagnostics } from './canvasLimits';
import {
  defaultExportDeps,
  downloadBlob,
  exportPoster,
  mountOffscreen,
  preparePoster,
} from './export';
import type { ExportDeps } from './export';
import { rasterize } from './rasterize';
import type { SettleResult } from './rasterize';

// A verification harness, not app code: export the poster stories' posters (same data) and show
// the files. Results are also left on `window.__vertExports[key]` for docs/verify scripts.
export default { title: 'Poster / Export harness' };

const ALL_STATS = { distance: true, vert: true, time: true, highPoint: true };

function prefsFor(poster: Partial<PosterPrefs>) {
  return { ...INITIAL_PREFS, poster: { ...INITIAL_PREFS.poster, stats: ALL_STATS, ...poster } };
}

interface ExportRecord {
  status: 'running' | 'done' | 'error';
  progress: string;
  ms?: number;
  blob?: Blob;
  url?: string;
  width?: number;
  height?: number;
  error?: string;
  heapMb?: number;
}

declare global {
  interface Window {
    __vertExports?: Record<string, ExportRecord>;
    __vertCanvas?: CanvasDiagnostics;
    __vertLatinExt?: Record<string, LatinExtResult>;
  }
}

interface PerformanceMemory {
  usedJSHeapSize: number;
}

function heapMb(): number | undefined {
  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1e6) : undefined;
}

interface Job {
  key: string;
  label: string;
  style: PosterStyleId;
  size: PosterSize;
  format: ExportFormat;
  element: () => ReactElement | null;
}

function useExports() {
  const [records, setRecords] = useState<Record<string, ExportRecord>>({});
  const controller = useRef<AbortController | null>(null);
  const update = (key: string, record: ExportRecord) => {
    window.__vertExports = { ...window.__vertExports, [key]: record };
    setRecords((current) => ({ ...current, [key]: record }));
  };
  const run = async (job: Job) => {
    const element = job.element();
    if (!element) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const started = performance.now();
    let peak = heapMb();
    update(job.key, { status: 'running', progress: 'Preparing…' });
    try {
      const blob = await exportPoster({
        element,
        size: job.size,
        style: job.style,
        format: job.format,
        fileName: `vert-harness-${job.key}.${job.format}`,
        signal: abort.signal,
        onProgress: ({ done, total }) => {
          peak = Math.max(peak ?? 0, heapMb() ?? 0);
          update(job.key, {
            status: 'running',
            progress: `Tile ${String(done)} of ${String(total)}`,
          });
        },
      });
      const ms = Math.round(performance.now() - started);
      let width: number | undefined;
      let height: number | undefined;
      if (blob.type === 'image/png') {
        const bitmap = await createImageBitmap(blob);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      }
      update(job.key, {
        status: 'done',
        progress: 'Done',
        ms,
        blob,
        url: URL.createObjectURL(blob),
        width,
        height,
        heapMb: peak,
      });
    } catch (error) {
      update(job.key, {
        status: 'error',
        progress: 'Failed',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  };
  const cancel = () => {
    controller.current?.abort();
  };
  return { records, run, cancel };
}

function Result({ record }: { record: ExportRecord | undefined }) {
  if (!record) return null;
  const facts = [
    record.progress,
    record.width ? `${String(record.width)} × ${String(record.height)} px` : '',
    record.ms !== undefined ? `${String(record.ms)} ms` : '',
    record.blob ? `${(record.blob.size / 1e6).toFixed(2)} MB ${record.blob.type}` : '',
    record.heapMb !== undefined ? `JS heap ≤ ${String(record.heapMb)} MB` : '',
    record.error ?? '',
  ].filter(Boolean);
  return (
    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
      <p data-status={record.status}>{facts.join(' · ')}</p>
      {record.url && record.blob?.type === 'image/png' && (
        <img
          src={record.url}
          alt="Exported poster"
          style={{ width: 240, display: 'block', boxShadow: '0 2px 12px rgb(0 0 0 / 0.2)' }}
        />
      )}
      {record.url && record.blob?.type === 'application/pdf' && (
        <a href={record.url} target="_blank" rel="noreferrer">
          Open the PDF
        </a>
      )}
    </div>
  );
}

function JobRow({
  job,
  record,
  onRun,
}: {
  job: Job;
  record: ExportRecord | undefined;
  onRun: (job: Job) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          data-job={job.key}
          onClick={() => {
            onRun(job);
          }}
        >
          {job.label}
        </button>
        {record?.blob && (
          <button
            type="button"
            onClick={() => {
              if (record.blob) downloadBlob(record.blob, `vert-harness-${job.key}.${job.format}`);
            }}
          >
            Save
          </button>
        )}
      </div>
      <Result record={record} />
    </div>
  );
}

/** Night Ridge with its ridges built for the laid-out stage (as in its stories, export detail). */
function useNightRidge(run: Run | null, size: PosterSize) {
  const [box, setBox] = useState<NightRidgeBox | null>(null);
  const round = (v: number) => Math.round(v / 10) * 10;
  const stageW = box ? round(box.width) : 0;
  const stageH = box ? round(box.height) : 0;
  const textBottom = box ? round(Math.max(0, ...box.keepOut.map((r) => r.y + r.height))) : 0;
  const bounds = useMemo(
    () =>
      run && stageW > 0
        ? ridgeBounds(run.bounds, {
            width: stageW,
            height: stageH,
            keepOut: [{ x: 0, y: 0, width: 1, height: textBottom }],
          })
        : null,
    [run, stageW, stageH, textBottom],
  );
  const heightfield = useHeightfield(bounds, { padding: 0 });
  const layout = posterLayout(size);
  const data = useMemo(
    () =>
      run && heightfield
        ? nightRidgeFigureData(run, heightfield, box, {
            exaggeration: INITIAL_PREFS.exaggeration,
            rows: NIGHT_RIDGE_ROWS[layout.kind],
            detailScale: layout.scale,
          })
        : null,
    [run, heightfield, box, layout.kind, layout.scale],
  );
  return { data, setBox };
}

function useSurveyQuad(run: Run | null, size: PosterSize) {
  const [box, setBox] = useState<FigureBoxSize | null>(null);
  const aspect = box ? Math.round((box.width / box.height) * 100) / 100 : null;
  const bounds = useMemo(
    () => (run && aspect ? quadBounds(run.bounds, aspect) : null),
    [run, aspect],
  );
  const heightfield = useHeightfield(bounds, { padding: 0 });
  const layout = posterLayout(size);
  const data = useMemo(
    () =>
      run && heightfield
        ? surveyQuadFigureData(run, heightfield, box, {
            layout: layout.kind,
            detailScale: layout.scale,
          })
        : null,
    [run, heightfield, box, layout.kind, layout.scale],
  );
  return { data, setBox };
}

/**
 * Latin Extended regression: titles that need Archivo's second unicode-range subset. A cold export
 * once drew no Archivo text at all (Chrome drew the still-loading face as nothing). Each case
 * exports the poster, then measures the ink in the title (or share-card headline line) and stats
 * bands against the paper; every band must be clearly inked.
 */
const LATIN_EXT_TITLES = {
  pl: 'Łódź Żółta Ścieżka',
  cs: 'Krkonoše Sněžka Okruh',
  sk: 'Štrbské Pleso Kriváň',
  tr: 'Kaçkar Dağları Yürüyüşü',
  ro: 'Vârful Moldoveanu Făgăraș',
  hu: 'Kéktúra Őrség Szőlőhegy',
} as const;

type LatinExtLang = keyof typeof LATIN_EXT_TITLES;

/** Minimum share of inked pixels in a text band, percent (a band with its text has 12–40%; without its Archivo text, under 4%). */
const MIN_INK_PCT = 6;

interface LatinExtResult {
  status: 'running' | 'pass' | 'fail' | 'error';
  title: string;
  withoutFix: boolean;
  ink?: Record<string, number>;
  settle?: SettleResult;
  ms?: number;
  error?: string;
}

/** The deps with the font fix switched off (no preload, no settle): reproduces the old bug. */
const WITHOUT_FONT_FIX: ExportDeps = {
  ...defaultExportDeps,
  preloadFonts: () => Promise.resolve(() => undefined),
  rasterize: (options) => rasterize({ ...options, settle: false }),
};

/** Percentage of pixels in `box` (logical px) that differ clearly from the paper colour. */
async function inkPercent(blob: Blob, box: DOMRect, scale: number): Promise<number> {
  const bitmap = await createImageBitmap(blob);
  try {
    const sx = Math.round(box.x * scale);
    const sy = Math.round(box.y * scale);
    const sw = Math.max(1, Math.round(box.width * scale));
    const sh = Math.max(1, Math.round(box.height * scale));
    const k = Math.min(1, 1200 / sw);
    const w = Math.max(1, Math.round(sw * k));
    const h = Math.max(1, Math.round(sh * k));
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return 0;
    context.drawImage(bitmap, 8, 8, 1, 1, 0, 0, 1, 1);
    const paper = Array.from(context.getImageData(0, 0, 1, 1).data);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    const data = context.getImageData(0, 0, w, h).data;
    let inked = 0;
    for (let i = 0; i < data.length; i += 4) {
      let d = 0;
      for (let c = 0; c < 3; c += 1) d += Math.abs((data[i + c] ?? 0) - (paper[c] ?? 0));
      if (d > 90) inked += 1;
    }
    return Math.round((1000 * inked) / (w * h)) / 10;
  } finally {
    bitmap.close();
  }
}

/** The text bands of the poster (title or share-card line, stats), logical px from its corner. */
async function textBands(element: ReactElement, size: PosterSize) {
  const layout = posterLayout(size);
  const mounted = await mountOffscreen(element, layout.width, layout.height);
  try {
    await preparePoster(mounted.root, 'A');
    const origin = mounted.root.getBoundingClientRect();
    const band = (selector: string) => {
      const rect = mounted.root.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? new DOMRect(rect.x - origin.x, rect.y - origin.y, rect.width, rect.height)
        : null;
    };
    const bands: Record<string, DOMRect> = {};
    // Print: the title slot. Share card: the line under the big number carries the title.
    const title = band('[data-slot="title"]') ?? band('[data-slot="headline"] > :last-child');
    if (title) bands.title = title;
    const stats = band('[data-slot="stats"]') ?? band('[data-slot="headline"] > :first-child');
    if (stats) bands.stats = stats;
    return bands;
  } finally {
    mounted.unmount();
  }
}

/** Leaves a result on `window.__vertLatinExt` for the verify scripts. */
function publishLatinExt(key: string, result: LatinExtResult) {
  window.__vertLatinExt = { ...window.__vertLatinExt, [key]: result };
}

/** Exports one Latin Extended case and measures its text bands. */
async function runLatinExtCase(
  lang: LatinExtLang,
  id: '18x24' | '4x5',
  withoutFix: boolean,
  update: (key: string, result: LatinExtResult) => void,
) {
  const key = `${lang}-${id}`;
  const title = LATIN_EXT_TITLES[lang];
  const size = posterSizeById(id);
  const element = (
    <TrailSignPoster
      content={posterContentFromRun(SAMPLE_RUN, prefsFor({ title }))}
      size={size}
      figure={<img src={sampleTerrain} alt="" />}
    />
  );
  update(key, { status: 'running', title, withoutFix });
  const started = performance.now();
  let settle: SettleResult | undefined;
  try {
    const blob = await exportPoster(
      {
        element,
        size,
        style: 'A',
        format: 'png',
        fileName: `${key}.png`,
        onSettled: (result) => {
          settle = result;
        },
      },
      withoutFix ? WITHOUT_FONT_FIX : defaultExportDeps,
    );
    const ms = Math.round(performance.now() - started);
    const bands = await textBands(element, size);
    const ink: Record<string, number> = {};
    for (const [slot, box] of Object.entries(bands)) {
      ink[slot] = await inkPercent(blob, box, posterLayout(size).scale);
    }
    const pass =
      Object.keys(ink).length === 2 && Object.values(ink).every((pct) => pct >= MIN_INK_PCT);
    update(key, { status: pass ? 'pass' : 'fail', title, withoutFix, ink, settle, ms });
  } catch (error) {
    update(key, { status: 'error', title, withoutFix, error: String(error) });
  }
}

function LatinExtCheck() {
  const [results, setResults] = useState<Record<string, LatinExtResult>>({});
  const [withoutFix, setWithoutFix] = useState(false);
  const update = (key: string, result: LatinExtResult) => {
    publishLatinExt(key, result);
    setResults((current) => ({ ...current, [key]: result }));
  };
  const runCase = (lang: LatinExtLang, id: '18x24' | '4x5') =>
    runLatinExtCase(lang, id, withoutFix, update);
  const cases = (Object.keys(LATIN_EXT_TITLES) as LatinExtLang[]).flatMap((lang) =>
    (['18x24', '4x5'] as const).map((id) => [lang, id] as const),
  );
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Latin Extended titles (regression)</h2>
      <label style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={withoutFix}
          onChange={(event) => {
            setWithoutFix(event.target.checked);
          }}
        />{' '}
        Without the font fix (no preload, no settle): reproduces the old failure
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {cases.map(([lang, id]) => (
          <button
            key={`${lang}-${id}`}
            type="button"
            data-latin={`${lang}-${id}`}
            onClick={() => void runCase(lang, id)}
          >
            {lang} {id}
          </button>
        ))}
      </div>
      <table style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
        <tbody>
          {Object.entries(results).map(([key, result]) => (
            <tr key={key} data-latin-result={key} data-status={result.status}>
              <td>{key}</td>
              <td>{result.title}</td>
              <td>{result.status}</td>
              <td>
                {result.ink
                  ? Object.entries(result.ink)
                      .map(([slot, pct]) => `${slot} ${String(pct)}%`)
                      .join(' · ')
                  : (result.error ?? '')}
              </td>
              <td>
                {result.settle
                  ? `settled in ${String(result.settle.attempts)}${result.settle.stable ? '' : ' (unstable)'}`
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const section = { display: 'grid', gap: 16, padding: 16 } as const;
const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: 24,
} as const;

export const Harness: Story = () => {
  const { records, run, cancel } = useExports();
  const [canvas, setCanvas] = useState<CanvasDiagnostics | null>(null);
  const sampleRun = useSampleRun();
  const print = posterSizeById('18x24');
  const nightRidge = useNightRidge(sampleRun, print);
  const surveyQuad = useSurveyQuad(sampleRun, print);
  const figure = <img src={sampleTerrain} alt="" />;

  const trailSign =
    (id: PosterSizeId, signature = '') =>
    () => (
      <TrailSignPoster
        content={posterContentFromRun(SAMPLE_RUN, prefsFor(signature ? { signature } : {}))}
        size={posterSizeById(id)}
        figure={figure}
      />
    );
  const nightRidgeElement = () =>
    sampleRun && nightRidge.data ? (
      <NightRidgePoster
        content={posterContentFromRun(sampleRun, prefsFor({}))}
        size={print}
        figureData={nightRidge.data}
        figure={<span />}
      />
    ) : null;
  const surveyQuadElement = () =>
    sampleRun && surveyQuad.data ? (
      <SurveyQuadPoster
        content={posterContentFromRun(sampleRun, prefsFor({}))}
        size={print}
        figureData={surveyQuad.data}
        figure={<span />}
      />
    ) : null;

  const jobs: Job[] = [
    ['a-18x24', 'Trail Sign 18 × 24 PNG', 'A', '18x24', 'png', trailSign('18x24')],
    ['a-18x24-pdf', 'Trail Sign 18 × 24 PDF', 'A', '18x24', 'pdf', trailSign('18x24')],
    ['a-a3', 'Trail Sign A3 PNG', 'A', 'a3', 'png', trailSign('a3')],
    ['a-a3-pdf', 'Trail Sign A3 PDF', 'A', 'a3', 'pdf', trailSign('a3')],
    ['a-4x5', 'Trail Sign 4 : 5 PNG', 'A', '4x5', 'png', trailSign('4x5', '@geekplux')],
    ['a-9x16', 'Trail Sign 9 : 16 PNG', 'A', '9x16', 'png', trailSign('9x16', '@geekplux')],
    ['b-18x24', 'Night Ridge 18 × 24 PNG', 'B', '18x24', 'png', nightRidgeElement],
    ['e-18x24', 'Survey Quad 18 × 24 PNG', 'E', '18x24', 'png', surveyQuadElement],
  ].map(([key, label, style, size, format, element]) => ({
    key: key as string,
    label: label as string,
    style: style as PosterStyleId,
    size: posterSizeById(size as PosterSizeId),
    format: format as ExportFormat,
    element: element as () => ReactElement | null,
  }));

  return (
    <div style={section}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Poster export harness</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => {
            const seen = canvasDiagnostics();
            window.__vertCanvas = seen;
            setCanvas(seen);
          }}
        >
          Show canvas sizes verified
        </button>
        <button type="button" onClick={cancel}>
          Cancel the running export
        </button>
        <span data-testid="limits" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {canvas
            ? `works: ${canvas.working.join(', ') || '—'} · failed: ${canvas.failing.join(', ') || '—'}`
            : 'Canvases are verified lazily, at export'}
        </span>
        <span data-testid="figures-ready" style={{ fontSize: 12 }}>
          {nightRidge.data?.ridges && surveyQuad.data?.map
            ? 'B and E figures ready'
            : 'Building the B and E figures…'}
        </span>
      </div>
      <div style={grid}>
        {jobs.map((job) => (
          <JobRow key={job.key} job={job} record={records[job.key]} onRun={(j) => void run(j)} />
        ))}
      </div>
      <LatinExtCheck />
      <h2 style={{ margin: 0, fontSize: 16 }}>Figure sources (B and E at 18 × 24)</h2>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <PosterPreview size={print} maxWidth={240} maxHeight={320}>
          <NightRidgePoster
            content={posterContentFromRun(sampleRun ?? SAMPLE_RUN, prefsFor({}))}
            size={print}
            figureData={nightRidge.data}
            onFigureBox={nightRidge.setBox}
            figure={<span />}
          />
        </PosterPreview>
        <PosterPreview size={print} maxWidth={240} maxHeight={320}>
          <SurveyQuadPoster
            content={posterContentFromRun(sampleRun ?? SAMPLE_RUN, prefsFor({}))}
            size={print}
            figureData={surveyQuad.data}
            onFigureBox={surveyQuad.setBox}
            figure={<span />}
          />
        </PosterPreview>
      </div>
    </div>
  );
};
Harness.storyName = 'Export harness';
