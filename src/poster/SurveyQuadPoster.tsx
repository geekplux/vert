import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { SURVEY_QUAD_LABEL_FACE, SURVEY_QUAD_TITLE_FACE, useFaceMeasure } from './faceMeasure';
import type { SurveyQuadFigureData, SurveyQuadMap } from './figures';
import { contourIntervalText, defaultContourInterval } from './contours';
import type { ScaleBar } from './contours';
import { posterLayout } from './layout';
import type { PosterLayoutKind } from './layout';
import type { PosterSize } from './sizes';
import { SURVEY_QUAD_PALETTE as PALETTE } from './styles';
import { fitTitle, hasWide } from './titleFit';
import type { TitleFitOptions } from './titleFit';
import type { FigureBoxSize } from './TrailSignPoster';
import { POSTER_URL, posterAriaLabel } from './types';
import type { PosterContent, PosterStatKey } from './types';
import { loadPosterFonts } from './fonts';
import { useFigureBox } from './useFigureBox';
import styles from './SurveyQuadPoster.module.css';

export interface SurveyQuadPosterProps {
  content: PosterContent;
  size: PosterSize;
  /** Shown inside the map frame while `figureData.map` is missing (placeholder or loading note). */
  figure?: ReactNode;
  /** Contours, route, markers and scale bar (built for the reported box), and the coordinates. */
  figureData?: SurveyQuadFigureData | null;
  /** Called with the map box's size in logical px (inside the frame's 6 px padding). */
  onFigureBox?: (size: FigureBoxSize) => void;
  className?: string;
}

/** Title fit: Libre Caslon Text 400, mixed case, ≤ 3 lines across the column. */
export const SURVEY_QUAD_TITLE: Readonly<Record<PosterLayoutKind, TitleFitOptions>> = {
  print: {
    width: 624,
    maxSize: 56,
    minSize: 32,
    maxLines: 3,
    letterSpacing: 0,
    step: 2,
    uppercase: false,
  },
  social: {
    width: 936,
    maxSize: 84,
    minSize: 48,
    maxLines: 3,
    letterSpacing: 0,
    step: 2,
    uppercase: false,
  },
};

/** The stats in the canvas's order and labels (the vert reads ASCENT here, unsigned). */
const QUAD_STATS: readonly (readonly [PosterStatKey, string])[] = [
  ['distance', 'DISTANCE'],
  ['vert', 'ASCENT'],
  ['time', 'TIME'],
  ['highPoint', 'HIGH POINT'],
];

function quadStats(content: PosterContent): [PosterStatKey, string, string][] {
  const list: [PosterStatKey, string, string][] = [];
  for (const [key, label] of QUAD_STATS) {
    const stat = content.stats[key];
    if (stat === undefined) continue;
    const text = typeof stat === 'string' ? stat : stat.text;
    list.push([key, label, key === 'vert' ? text.replace(/^\+/, '') : text]);
  }
  return list;
}

/** A length at the layout's scale `k`, rounded to 0.01 px (no float noise in the SVG). */
const sc = (value: number, k: number) => Math.round(value * k * 100) / 100;

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/**
 * Poster style E, Survey Quad (DESIGN-SPEC §4, canvas frame "Style E · Survey Quad"), adapted to
 * the portrait poster sizes at their logical size: the title on top, the contour map in its 2 px
 * frame below it with the coordinate rows, then the stats band and a row with the legend and the
 * scale bar. The canvas's place-name labels ([Summit name], [CREEK NAME]) are omitted: there is
 * no such data (DECISIONS: no invented data).
 *
 * One image: the root is `role="img"` with the poster summary as its name; the drawn text is
 * `aria-hidden`.
 */
export function SurveyQuadPoster({
  content,
  size,
  figure,
  figureData,
  onFigureBox,
  className,
}: SurveyQuadPosterProps) {
  const layout = posterLayout(size);
  const kind = layout.kind;
  const k = layout.width / 720;
  const measure = useFaceMeasure(SURVEY_QUAD_TITLE_FACE);
  const title = fitTitle(content.title, SURVEY_QUAD_TITLE[kind], measure);
  const stats = quadStats(content);
  const map = figureData?.map ?? null;
  const coordinates = figureData?.coordinates ?? null;
  const intervalText = contourIntervalText(
    map?.interval ?? defaultContourInterval(content.units),
    content.units,
  );
  const [keyRef, scaleRoom] = useScaleRoom(k);
  // The Caslon italic is only needed (and fetched) for a subtitle.
  const { subtitle } = content;
  useEffect(() => {
    if (subtitle) void loadPosterFonts('E', subtitle, { subtitle: true });
  }, [subtitle]);

  const vars = {
    width: layout.width,
    height: layout.height,
    '--sq-paper': PALETTE.paper,
    '--sq-ink': PALETTE.ink,
    '--sq-map': PALETTE.map,
  } as CSSProperties;

  return (
    <div
      role="img"
      aria-label={posterAriaLabel(content)}
      className={cx(styles.poster, styles[kind], className)}
      style={vars}
      data-layout={kind}
      data-style="E"
    >
      <div className={styles.inner} aria-hidden="true">
        <div className={styles.header} data-slot="header">
          <span className={styles.eyebrow}>VERT · TRAIL QUADRANGLE</span>
          <span className={styles.sign}>{content.signature || POSTER_URL}</span>
        </div>
        <div className={styles.titleBlock}>
          <div
            className={styles.title}
            style={{ fontSize: title.size, lineHeight: hasWide(content.title) ? 1.1 : undefined }}
            data-slot="title"
            data-lines={title.lines}
          >
            {content.title}
          </div>
          {content.subtitle && (
            <div className={styles.subtitle} data-slot="subtitle">
              {content.subtitle}
            </div>
          )}
        </div>
        <div className={styles.mapBlock}>
          <div className={styles.mapRow} data-slot="coordinates">
            <span>{coordinates?.lat ?? ''}</span>
            <span>{content.isSample ? 'SAMPLE DATA' : ''}</span>
            <span>{coordinates?.lon ?? ''}</span>
          </div>
          <div className={styles.frame}>
            <MapBox onFigureBox={onFigureBox}>
              {map ? <ContourMap map={map} k={k} /> : figure}
            </MapBox>
          </div>
          <div className={styles.mapRow} data-slot="credit">
            <span>MAPPED FROM GPX + PUBLIC ELEVATION DATA</span>
            <span>{content.date}</span>
          </div>
        </div>
        {stats.length > 0 && (
          <div
            className={styles.stats}
            style={{ '--stat-columns': stats.length } as CSSProperties}
            data-slot="stats"
          >
            {stats.map(([key, label, text]) => (
              <div key={key} data-stat={key}>
                <div className={styles.label}>{label}</div>
                <div className={styles.value}>{text}</div>
              </div>
            ))}
          </div>
        )}
        <div className={styles.key} ref={keyRef}>
          <Legend k={k} pointToPoint={map?.markers.some((m) => m.kind === 'finish') ?? false} />
          <div className={styles.scale} data-slot="scale">
            {map && (
              <ScaleBarGraphic
                bar={map.scaleBar}
                k={k}
                labelPx={SCALE_LABEL_PX[kind]}
                room={scaleRoom}
              />
            )}
            <div className={styles.label}>CONTOUR INTERVAL {intervalText}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapBox({
  onFigureBox,
  children,
}: {
  onFigureBox: ((size: FigureBoxSize) => void) | undefined;
  children: ReactNode;
}) {
  const ref = useFigureBox<HTMLDivElement>(onFigureBox);
  return (
    <div ref={ref} className={styles.map} data-slot="figure">
      {children}
    </div>
  );
}

/** Start and finish markers on the map, px at 720 wide: ring radius, and the finish's dot. */
const MARKER_R = 8;
const FINISH_DOT_R = 3;

/** Contours (intermediate under index), the route with its white halo, and the ○ / ◉ markers. */
function ContourMap({ map, k }: { map: SurveyQuadMap; k: number }) {
  return (
    <svg
      viewBox={`0 0 ${String(map.width)} ${String(map.height)}`}
      preserveAspectRatio="xMidYMid slice"
      data-figure="contours"
    >
      <g fill="none" stroke={PALETTE.contour} strokeLinecap="round" strokeLinejoin="round">
        <path d={map.contours.intermediate} strokeWidth={sc(0.7, k)} data-contour="intermediate" />
        <path d={map.contours.index} strokeWidth={sc(1.6, k)} data-contour="index" />
      </g>
      {map.route && (
        <g fill="none" strokeLinejoin="round">
          <path d={map.route} stroke={PALETTE.halo} strokeWidth={sc(9, k)} data-route="halo" />
          <path
            d={map.route}
            stroke={PALETTE.ink}
            strokeWidth={sc(3.5, k)}
            strokeDasharray={`${String(sc(10, k))} ${String(sc(6, k))}`}
            data-route="line"
          />
        </g>
      )}
      {/* Finish first, so a start drawn close by sits on top. ○ start, ◉ finish: shape, not colour. */}
      {[...map.markers].reverse().map((marker) => (
        <g key={marker.kind} data-marker={marker.kind}>
          <circle
            cx={marker.x}
            cy={marker.y}
            r={sc(MARKER_R, k)}
            fill={PALETTE.halo}
            stroke={PALETTE.ink}
            strokeWidth={sc(3, k)}
          />
          {marker.kind === 'finish' && (
            <circle cx={marker.x} cy={marker.y} r={sc(FINISH_DOT_R, k)} fill={PALETTE.ink} />
          )}
        </g>
      ))}
    </svg>
  );
}

/** The legend, as the canvas draws it: 48 px samples (scaled to the layout), labels in sentence case. */
function Legend({ k, pointToPoint }: { k: number; pointToPoint: boolean }) {
  const w = sc(40, k);
  const ring = (cx: number, finish: boolean) => (
    <>
      <circle
        cx={cx}
        cy={sc(9, k)}
        r={sc(6.5, k)}
        fill={PALETTE.halo}
        stroke={PALETTE.ink}
        strokeWidth={sc(2.5, k)}
      />
      {finish && <circle cx={cx} cy={sc(9, k)} r={sc(2.5, k)} fill={PALETTE.ink} />}
    </>
  );
  return (
    <div className={styles.legend} data-slot="legend">
      <div className={styles.legendItem}>
        <svg width={w} height={sc(10, k)}>
          <line
            x1={0}
            y1={sc(5, k)}
            x2={w}
            y2={sc(5, k)}
            stroke={PALETTE.ink}
            strokeWidth={sc(3.5, k)}
            strokeDasharray={`${String(sc(10, k))} ${String(sc(6, k))}`}
          />
        </svg>
        Route run
      </div>
      <div className={styles.legendItem}>
        <svg width={w} height={sc(10, k)}>
          <line
            x1={0}
            y1={sc(5, k)}
            x2={w}
            y2={sc(5, k)}
            stroke={PALETTE.contour}
            strokeWidth={sc(1.6, k)}
          />
        </svg>
        Index contour
      </div>
      <div className={styles.legendItem}>
        <svg width={w} height={sc(10, k)}>
          <line
            x1={0}
            y1={sc(5, k)}
            x2={w}
            y2={sc(5, k)}
            stroke={PALETTE.contour}
            strokeWidth={sc(0.7, k)}
          />
        </svg>
        Intermediate contour
      </div>
      {/* A loop has one ○ for start and finish; a point-to-point run ○ start and ◉ finish (as the
          View, Trail Sign and Night Ridge draw them), named in one row: "○ Start · ◉ Finish". */}
      <div className={styles.legendItem} data-legend="ends">
        <svg width={w} height={sc(18, k)}>
          {ring(w / 2, false)}
        </svg>
        {pointToPoint ? (
          <>
            Start ·
            <svg width={sc(16, k)} height={sc(18, k)}>
              {ring(sc(8, k), true)}
            </svg>
            Finish
          </>
        ) : (
          'Start / finish'
        )}
      </div>
    </div>
  );
}

/** Scale-bar tick labels, logical px (as in the CSS): social text is at least 18 px. */
const SCALE_LABEL_PX: Readonly<Record<PosterLayoutKind, number>> = { print: 10, social: 18 };

/** Least space between two shown scale labels, em. */
const SCALE_LABEL_GAP_EM = 0.5;

/** Least space kept between the legend and the scale block, logical px at 720 wide. */
const KEY_GAP_PX = 24;

export type ScaleLabelAlign = 'start' | 'centre' | 'end' | 'flush';

/**
 * How tick label `i` of `count` sits on its tick: the first starts at the bar's start; the last
 * ("4 km") has its number centred on the tick and the unit after it ('end'), or, with
 * `endFlush`, ends flush with the bar's end as in the canvas ('flush'); the rest are centred.
 */
export function scaleLabelAlign(i: number, count: number, endFlush = false): ScaleLabelAlign {
  if (i === 0) return 'start';
  if (i < count - 1) return 'centre';
  return endFlush ? 'flush' : 'end';
}

/** "4 km" → ["4", " km"]: the number, then the unit with its space ("" when there is none). */
export function splitScaleLabel(label: string): [string, string] {
  const space = label.indexOf(' ');
  return space < 0 ? [label, ''] : [label.slice(0, space), label.slice(space)];
}

/**
 * The [left, right] of tick label `i` of `labels` on its tick at `tickX` (bar px: the bar starts
 * at 0), with `measurePx` giving a text's width.
 */
export function scaleLabelExtent(
  labels: readonly string[],
  i: number,
  tickX: number,
  measurePx: (text: string) => number,
  endFlush = false,
): [number, number] {
  const label = labels[i] ?? '';
  const align = scaleLabelAlign(i, labels.length, endFlush);
  if (align === 'start') return [0, measurePx(label)];
  if (align === 'centre') return [tickX - measurePx(label) / 2, tickX + measurePx(label) / 2];
  if (align === 'flush') return [tickX - measurePx(label), tickX];
  const [number, unit] = splitScaleLabel(label);
  const left = tickX - measurePx(number) / 2;
  return [left, left + measurePx(number) + (unit ? measurePx(unit) : 0)];
}

/**
 * Which tick labels to show, each on its tick (`scaleLabelAlign`) at its real width: all of them
 * when no two come closer than `gap`, else every other one (always the first and the last, which
 * carries the unit), else only those two.
 */
export function scaleLabelsShown(
  labels: readonly string[],
  tickXs: readonly number[],
  measurePx: (text: string) => number,
  gap: number,
  endFlush = false,
): boolean[] {
  const last = labels.length - 1;
  const fits = (shown: readonly boolean[]) => {
    let right = -Infinity;
    for (let i = 0; i <= last; i++) {
      if (!shown[i]) continue;
      const [l, r] = scaleLabelExtent(labels, i, tickXs[i] ?? 0, measurePx, endFlush);
      if (l < right + gap) return false;
      right = r;
    }
    return true;
  };
  const all = labels.map(() => true);
  if (fits(all)) return all;
  const alternate = labels.map((_, i) => i % 2 === 0 || i === last);
  if (alternate[last - 1] && last - 1 > 0) alternate[last - 1] = false;
  if (fits(alternate)) return alternate;
  return labels.map((_, i) => i === 0 || i === last);
}

export interface ScaleLabelLayout {
  /** Each tick's x, bar px: the left edge of segment i (the last, the last segment's right edge). */
  readonly ticks: readonly number[];
  readonly shown: readonly boolean[];
  /** The last label ends flush with the bar instead of centring its number on the tick. */
  readonly endFlush: boolean;
  /**
   * Room kept after the bar's length, px: the bar's stroke and the unit hanging past the last
   * tick. The scale block is this much wider than the bar, so nothing in it crosses the column.
   */
  readonly reserve: number;
}

/**
 * Lays out the scale bar's labels: the last label centres its number on its tick with the unit
 * after it, and its overhang past the bar is reserved in the scale block, unless the bar plus that
 * overhang is wider than `room` (the space the key leaves for the scale), in which case the last
 * label ends flush with the bar's end.
 */
export function scaleLabelLayout(
  bar: Pick<ScaleBar, 'labels' | 'segmentPx' | 'lengthPx'>,
  k: number,
  measurePx: (text: string) => number,
  gap: number,
  room = Infinity,
): ScaleLabelLayout {
  const { labels } = bar;
  const ticks = labels.map((_, i) => sc(i * bar.segmentPx + k / 2, 1));
  const last = labels.length - 1;
  const centredRight = scaleLabelExtent(labels, last, ticks[last] ?? 0, measurePx)[1];
  const hanging = Math.max(k, Math.ceil(centredRight - bar.lengthPx));
  const endFlush = bar.lengthPx + hanging > room;
  return {
    ticks,
    shown: scaleLabelsShown(labels, ticks, measurePx, gap, endFlush),
    endFlush,
    reserve: endFlush ? k : hanging,
  };
}

/**
 * The width the key leaves for the scale block: the key's width less the legend's and a gap.
 * `undefined` until laid out (and in jsdom, which has no layout).
 */
function useScaleRoom(k: number): [RefObject<HTMLDivElement | null>, number | undefined] {
  const keyRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number>();
  useLayoutEffect(() => {
    const key = keyRef.current;
    const legend = key?.firstElementChild;
    if (!key || !(legend instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      setRoom(
        key.clientWidth > 0 ? key.clientWidth - legend.offsetWidth - KEY_GAP_PX * k : undefined,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(key);
    observer.observe(legend);
    return () => {
      observer.disconnect();
    };
  }, [k]);
  return [keyRef, room];
}

/**
 * Alternating ink / paper segments with tick labels under them ("0 1 2 3 4 km"), each label on
 * its tick (`scaleLabelLayout`): the labels share one grid cell and are moved there with a margin
 * and a transform, so they stay on their ticks whatever their real widths.
 */
function ScaleBarGraphic({
  bar,
  k,
  labelPx,
  room,
}: {
  bar: ScaleBar;
  k: number;
  labelPx: number;
  room: number | undefined;
}) {
  const measure = useFaceMeasure(SURVEY_QUAD_LABEL_FACE);
  const count = bar.labels.length;
  const { ticks, shown, endFlush, reserve } = scaleLabelLayout(
    bar,
    k,
    (text) => measure(text) * labelPx,
    SCALE_LABEL_GAP_EM * labelPx,
    room,
  );
  const height = sc(8, k);
  const width = bar.lengthPx;
  return (
    // Border-box: the padding (the reserve) comes on top of the bar's length.
    <div className={styles.scaleBar} style={{ width: width + reserve, paddingRight: reserve }}>
      <svg width={width + k} height={height + sc(2, k)} data-scale-bar={bar.text}>
        {Array.from({ length: bar.segments }, (_, i) => (
          <rect
            key={i}
            x={i * bar.segmentPx + k / 2}
            y={k}
            width={bar.segmentPx}
            height={height}
            fill={i % 2 === 0 ? PALETTE.ink : PALETTE.paper}
            stroke={PALETTE.ink}
            strokeWidth={k}
          />
        ))}
      </svg>
      <div className={styles.scaleLabels}>
        {bar.labels.map((label, i) => {
          const align = scaleLabelAlign(i, count, endFlush);
          if (!shown[i]) return <span key={i} />;
          if (align === 'start') return <span key={i}>{label}</span>;
          const [number, unit] = align === 'end' ? splitScaleLabel(label) : [label, ''];
          return (
            <span
              key={i}
              className={align === 'flush' ? styles.scaleFlush : styles.scaleTick}
              style={{ marginLeft: ticks[i] ?? 0 }}
              data-align={align}
            >
              {number}
              {unit && <span className={styles.scaleUnit}>{unit}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
