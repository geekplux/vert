import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { SURVEY_QUAD_TITLE_FACE, useFaceMeasure } from './faceMeasure';
import type { SurveyQuadFigureData, SurveyQuadMap } from './figures';
import { CONTOUR_INTERVAL_M } from './contours';
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
  const interval = map?.interval ?? CONTOUR_INTERVAL_M;
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
        <div className={styles.key}>
          <Legend k={k} />
          <div className={styles.scale} data-slot="scale">
            {map && <ScaleBarGraphic bar={map.scaleBar} k={k} labelPx={SCALE_LABEL_PX[kind]} />}
            <div className={styles.label}>CONTOUR INTERVAL {interval} METRES</div>
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

/** Contours (intermediate under index), the route with its white halo, and the ○ markers. */
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
      {map.markers.map((marker) => (
        <circle
          key={marker.kind}
          cx={marker.x}
          cy={marker.y}
          r={sc(8, k)}
          fill={PALETTE.halo}
          stroke={PALETTE.ink}
          strokeWidth={sc(3, k)}
          data-marker={marker.kind}
        />
      ))}
    </svg>
  );
}

/** The legend, as the canvas draws it: 48 px samples (scaled to the layout), labels in sentence case. */
function Legend({ k }: { k: number }) {
  const w = sc(40, k);
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
      <div className={styles.legendItem}>
        <svg width={w} height={sc(18, k)}>
          <circle
            cx={w / 2}
            cy={sc(9, k)}
            r={sc(6.5, k)}
            fill={PALETTE.halo}
            stroke={PALETTE.ink}
            strokeWidth={sc(2.5, k)}
          />
        </svg>
        Start and finish
      </div>
    </div>
  );
}

/** Alternating ink / paper segments with tick labels under them ("0 1 2 3 4 km"). */
/** Scale-bar tick labels, logical px (as in the CSS): social text is at least 18 px. */
const SCALE_LABEL_PX: Readonly<Record<PosterLayoutKind, number>> = { print: 10, social: 18 };

/**
 * Which tick labels fit under a bar `lengthPx` long at `labelPx`: all of them when they fit, else
 * every other one (always the first and the last, which carries the unit), else only those two.
 * Widths are estimated at 0.55 em per character plus a 0.6 em gap (Archivo Narrow digits are
 * ~0.5 em).
 */
export function scaleLabelsShown(labels: readonly string[], lengthPx: number, labelPx: number) {
  const width = (shown: readonly string[]) =>
    shown.reduce((sum, label) => sum + (label.length * 0.55 + 0.6) * labelPx, 0);
  const all = labels.map(() => true);
  if (width(labels) <= lengthPx) return all;
  const last = labels.length - 1;
  const alternate = labels.map((_, i) => i % 2 === 0 || i === last);
  if (alternate[last - 1] && last - 1 > 0) alternate[last - 1] = false;
  if (width(labels.filter((_, i) => alternate[i])) <= lengthPx) return alternate;
  return labels.map((_, i) => i === 0 || i === last);
}

function ScaleBarGraphic({ bar, k, labelPx }: { bar: ScaleBar; k: number; labelPx: number }) {
  const shown = scaleLabelsShown(bar.labels, bar.lengthPx, labelPx);
  const height = sc(8, k);
  const width = bar.lengthPx;
  return (
    <div className={styles.scaleBar} style={{ width }}>
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
        {bar.labels.map((label, i) => (
          <span key={i}>{shown[i] ? label : ''}</span>
        ))}
      </div>
    </div>
  );
}
