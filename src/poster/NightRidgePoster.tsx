import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { plotProfile } from '../components/ElevationProfile/profileGeometry';
import { formatDistance, formatNumber } from '../lib/format';
import type { Units } from '../lib/format';
import type { ProfilePoint } from '../page/types';
import { NIGHT_RIDGE_TITLE_FACE, useFaceMeasure } from './faceMeasure';
import type { NightRidgeFigureData } from './figures';
import { posterLayout } from './layout';
import type { PosterLayoutKind } from './layout';
import { ridgeExaggeration } from './ridges';
import type { Rect, RidgeFigure } from './ridges';
import type { PosterSize } from './sizes';
import { NIGHT_RIDGE_PALETTE as PALETTE } from './styles';
import { fitTitle, hasWide } from './titleFit';
import type { TitleFitOptions } from './titleFit';
import type { FigureBoxSize } from './TrailSignPoster';
import { POSTER_URL, elevationNote, posterAriaLabel } from './types';
import type { PosterContent } from './types';
import styles from './NightRidgePoster.module.css';

export interface NightRidgePosterProps {
  content: PosterContent;
  size: PosterSize;
  /**
   * Shown in the figure box while `figureData.ridges` is missing (e.g. a placeholder `<img>` or a
   * loading note). It covers the box, centred.
   */
  figure?: ReactNode;
  /** The ridgeline figure (built for the reported box), sunrise and start time. */
  figureData?: NightRidgeFigureData | null;
  /**
   * Called with the figure box (the stage under the text column) in logical px, plus the text's
   * line boxes over it (`keepOut`), so the ridges can be laid out for it: pass it straight to
   * `nightRidgeFigureData` as the box.
   */
  onFigureBox?: (size: NightRidgeBox) => void;
  className?: string;
}

/** Title fit: Big Shoulders Display 800, uppercase, ≤ 3 lines across the text column. */
export const NIGHT_RIDGE_TITLE: Readonly<Record<PosterLayoutKind, TitleFitOptions>> = {
  print: { width: 624, maxSize: 104, minSize: 48, maxLines: 3, letterSpacing: 0, step: 2 },
  social: { width: 936, maxSize: 156, minSize: 72, maxLines: 3, letterSpacing: 0, step: 2 },
};

/** The elevation strip's height, logical px (canvas: 70 px at 1440 wide). */
const PROFILE_HEIGHT: Readonly<Record<PosterLayoutKind, number>> = { print: 56, social: 84 };

/** A length at the layout's scale `k`, rounded to 0.01 px (no float noise in the SVG). */
const sc = (value: number, k: number) => Math.round(value * k * 100) / 100;

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/** "KM 14.8" / "MI 9.2": the unit first, as the canvas's profile label. */
function distanceLabel(metres: number, units: Units): string {
  const { value, unit } = formatDistance(metres, units);
  return `${unit.toUpperCase()} ${value}`;
}

/**
 * The poster summary plus what only Night Ridge draws: the start time, the sunrise and the
 * exaggeration the ridges are drawn at, e.g. "… Sample data. Start 07:10. Sunrise 07:32 at km 2.7.
 * Elevation ×2.4."
 */
export function nightRidgeAriaLabel(
  content: PosterContent,
  figureData: Pick<NightRidgeFigureData, 'sunrise' | 'startClock'> | null,
): string {
  const parts = [posterAriaLabel(content)];
  if (figureData?.startClock) parts.push(`Start ${figureData.startClock}.`);
  if (figureData?.sunrise) {
    const at = distanceLabel(figureData.sunrise.distance, content.units).toLowerCase();
    parts.push(`Sunrise ${figureData.sunrise.clock} at ${at}.`);
  }
  parts.push(`Elevation ×${formatNumber(ridgeExaggeration(content.exaggeration), 1)}.`);
  return parts.join(' ');
}

/**
 * Poster style B, Night Ridge (DESIGN-SPEC §4, canvas frame "Style B · Night Ridge"), adapted to
 * the portrait poster sizes at their logical size (`posterLayout`: 720 wide for print, 1080 for
 * social). The text column sits over the ridgeline figure; the elevation strip runs along the
 * bottom with the sunrise marked when the run's timestamps put it during the run. The canvas's top
 * nav is omitted (DECISIONS).
 *
 * One image: the root is `role="img"` with the poster summary as its name; the drawn text is
 * `aria-hidden`.
 */
export function NightRidgePoster({
  content,
  size,
  figure,
  figureData,
  onFigureBox,
  className,
}: NightRidgePosterProps) {
  const layout = posterLayout(size);
  const kind = layout.kind;
  // Stroke widths and marker sizes are the spec's px at 720 wide; the share card is 1.5×.
  const k = layout.width / 720;
  const measure = useFaceMeasure(NIGHT_RIDGE_TITLE_FACE);
  const title = fitTitle(content.title, NIGHT_RIDGE_TITLE[kind], measure);
  const { stats, units } = content;
  const sunrise = figureData?.sunrise ?? null;
  const startClock = figureData?.startClock ?? null;
  const profileWidth = layout.width - 2 * (kind === 'print' ? 48 : 72);

  const eyebrow = [
    startClock ? `${startClock} START` : '',
    content.date,
    content.isSample ? 'SAMPLE DATA' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  // The hero is the vert; without it (switched off, or the elevation unknown) the distance, so the
  // hero is never "–". The distance then leaves the line under it.
  const hero = stats.vert?.text ?? stats.distance?.text ?? null;
  const heroIsDistance = !stats.vert && hero !== null;
  const line1 = [heroIsDistance ? undefined : stats.distance?.text, stats.time]
    .filter(Boolean)
    .join(' · ');
  const line2 = [
    stats.highPoint ? `high point ${stats.highPoint.text}` : '',
    sunrise ? `sunrise at ${distanceLabel(sunrise.distance, units).toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const footerNote = elevationNote({
    isSample: false,
    exaggeration: ridgeExaggeration(content.exaggeration),
    subtitle: content.subtitle,
    elevationSource: content.elevationSource,
  });

  const vars = {
    width: layout.width,
    height: layout.height,
    '--nr-paper': PALETTE.paper,
    '--nr-ink': PALETTE.ink,
    '--nr-route': PALETTE.route,
    '--nr-ridge': PALETTE.ridge,
    '--nr-body': PALETTE.body,
  } as CSSProperties;

  return (
    <div
      role="img"
      aria-label={nightRidgeAriaLabel(content, figureData ?? null)}
      className={cx(styles.poster, styles[kind], className)}
      style={vars}
      data-layout={kind}
      data-style="B"
    >
      <div className={styles.inner} aria-hidden="true">
        <div className={styles.header} data-slot="header">
          <span className={styles.wordmark}>VERT</span>
        </div>
        <Stage
          onFigureBox={onFigureBox}
          figure={figureData?.ridges ? <Ridges figure={figureData.ridges} k={k} /> : figure}
        >
          {eyebrow && (
            <div className={styles.eyebrow} data-slot="eyebrow" data-keep-out>
              {eyebrow}
            </div>
          )}
          <div
            className={styles.title}
            style={{ fontSize: title.size, lineHeight: hasWide(content.title) ? 1 : undefined }}
            data-slot="title"
            data-lines={title.lines}
            data-keep-out
          >
            {content.title}
          </div>
          {hero !== null && (
            <div
              className={styles.vert}
              data-slot="vert"
              data-hero={heroIsDistance ? 'distance' : 'vert'}
              data-keep-out
            >
              {hero}
            </div>
          )}
          {(line1 || line2) && (
            <div className={styles.lines} data-slot="stats">
              {line1 && <div data-keep-out>{line1}</div>}
              {line2 && <div data-keep-out>{line2}</div>}
            </div>
          )}
        </Stage>
        <div className={styles.profileBlock} data-slot="profile">
          <ProfileStrip
            profile={content.profile}
            total={content.distance}
            width={profileWidth}
            height={PROFILE_HEIGHT[kind]}
            sunrise={sunrise?.distance ?? null}
            k={k}
          />
          <div className={styles.profileLabels}>
            <span>0 {formatDistance(0, units).unit.toUpperCase()}</span>
            {sunrise && (
              <span className={styles.sunrise} data-slot="sunrise">
                SUNRISE {sunrise.clock} · {distanceLabel(sunrise.distance, units)}
              </span>
            )}
            <span>{totalLabel(content.distance, units)}</span>
          </div>
        </div>
        <div className={styles.footer} data-slot="footer">
          <span className={styles.footerNote}>{footerNote}</span>
          <span className={styles.footerSign}>{content.signature || POSTER_URL}</span>
        </div>
      </div>
    </div>
  );
}

/** "21.5 KM": the route's length at the right end of the strip (with or without a profile). */
function totalLabel(total: number, units: Units): string {
  const { value, unit } = formatDistance(total, units);
  return `${value} ${unit.toUpperCase()}`;
}

/** The figure box Night Ridge reports: the stage, and where its text sits over the figure. */
export interface NightRidgeBox extends FigureBoxSize {
  /** The text column's line boxes inside the stage, logical px (`ridgeFigure` keeps clear). */
  readonly keepOut: readonly Rect[];
}

/**
 * The stage between the header and the elevation strip: the ridgeline figure fills it and the
 * text column sits over its top-left, as in the canvas. Reports its size and the text's line
 * boxes (title lines one by one) to `onFigureBox`, so the ridges can rise beside short lines.
 */
function Stage({
  onFigureBox,
  figure,
  children,
}: {
  onFigureBox: ((size: NightRidgeBox) => void) | undefined;
  figure: ReactNode;
  children: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const callback = useRef(onFigureBox);
  useLayoutEffect(() => {
    callback.current = onFigureBox;
  });
  const observe = onFigureBox !== undefined;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const text = textRef.current;
    if (!observe || !stage || !text || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const report = () => {
      const width = stage.offsetWidth;
      const height = stage.offsetHeight;
      const rect = stage.getBoundingClientRect();
      // Client rects include the preview's transform; offset sizes are logical px.
      const ratio = rect.width > 0 ? width / rect.width : 1;
      const keepOut: Rect[] = [];
      for (const child of Array.from(text.querySelectorAll<HTMLElement>('[data-keep-out]'))) {
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const line of Array.from(range.getClientRects())) {
          if (line.width <= 0 || line.height <= 0) continue;
          keepOut.push({
            x: (line.left - rect.left) * ratio,
            y: (line.top - rect.top) * ratio,
            width: line.width * ratio,
            height: line.height * ratio,
          });
        }
      }
      const box: NightRidgeBox = { width, height, keepOut };
      const key = JSON.stringify(box, (_, v: unknown) =>
        typeof v === 'number' ? Math.round(v * 10) / 10 : v,
      );
      if (key === last) return;
      last = key;
      callback.current?.(box);
    };
    const observer = new ResizeObserver(report);
    observer.observe(stage);
    observer.observe(text);
    for (const child of Array.from(text.children)) observer.observe(child);
    const fonts = 'fonts' in document ? document.fonts : null;
    fonts?.addEventListener('loadingdone', report);
    return () => {
      observer.disconnect();
      fonts?.removeEventListener('loadingdone', report);
    };
  }, [observe]);

  return (
    <div ref={stageRef} className={styles.stage}>
      <div className={styles.figure} data-slot="figure">
        {figure}
      </div>
      <div ref={textRef} className={styles.text} data-slot="text">
        {children}
      </div>
    </div>
  );
}

/** Start and finish markers, px at 720 wide: ring radius and width, the paper band around it, the finish's dot. */
const MARKER_R = 7;
const MARKER_W = 3;
const MARKER_HALO = 3;
const MARKER_DOT_R = 2.5;

/** The ridgeline figure: rows back to front (paper fill, then the line), then the glowing route. */
function Ridges({ figure, k }: { figure: RidgeFigure; k: number }) {
  return (
    <svg
      viewBox={`0 0 ${String(figure.width)} ${String(figure.height)}`}
      preserveAspectRatio="xMidYMax meet"
      data-figure="ridges"
      data-depth-scale={figure.depthScale}
    >
      {figure.rows.map((row, index) => (
        <g key={index}>
          <path d={row.fill} fill={PALETTE.paper} />
          <path
            d={row.line}
            fill="none"
            stroke={PALETTE.ridge}
            strokeOpacity={row.opacity}
            strokeWidth={sc(1.1, k)}
            strokeLinejoin="round"
          />
        </g>
      ))}
      {figure.route && (
        <>
          <path
            d={figure.route}
            fill="none"
            stroke={PALETTE.glow}
            strokeOpacity={0.35}
            strokeWidth={sc(12, k)}
            strokeLinejoin="round"
            strokeLinecap="round"
            data-route="glow"
          />
          <path
            d={figure.route}
            fill="none"
            stroke={PALETTE.route}
            strokeWidth={sc(3, k)}
            strokeLinejoin="round"
            strokeLinecap="round"
            data-route="core"
          />
        </>
      )}
      {[figure.finish, figure.start].map(
        (point, index) =>
          point && (
            <g key={index} data-marker={index === 1 ? 'start' : 'finish'}>
              {/* A paper band around the ring: the ring is the route's colour and sits on the
                  route, so without it the ring would meet its own colour (1:1) at its edge. */}
              <circle
                cx={point.x}
                cy={point.y}
                r={sc(MARKER_R + MARKER_W / 2 + MARKER_HALO / 2, k)}
                fill="none"
                stroke={PALETTE.paper}
                strokeWidth={sc(MARKER_HALO, k)}
                data-part="halo"
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={sc(MARKER_R, k)}
                fill={PALETTE.paper}
                stroke={PALETTE.route}
                strokeWidth={sc(MARKER_W, k)}
                data-part="ring"
              />
              {/* The finish is ◉, the start ○: told apart by shape, never by colour. */}
              {index === 0 && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={sc(MARKER_DOT_R, k)}
                  fill={PALETTE.route}
                  data-part="dot"
                />
              )}
            </g>
          ),
      )}
    </svg>
  );
}

interface ProfileStripProps {
  profile: readonly ProfilePoint[];
  /** The route's length, metres: the strip's x axis, also without a profile (the sunrise). */
  total: number;
  width: number;
  height: number;
  /** Distance of the sunrise, metres, or null. */
  sunrise: number | null;
  k: number;
}

/**
 * The elevation strip as a line in `ridge` (canvas: 1.5 px, not filled), drawn at its real pixel
 * size so the stroke is exact, with the sunrise as a dashed vertical line in `route`.
 */
function ProfileStrip({ profile, total, width, height, sunrise, k }: ProfileStripProps) {
  const { line, sunriseX } = useMemo(() => {
    // The same minimum span and smoothing as every profile (`plotProfile`).
    const { scale, points } = plotProfile(profile);
    const pad = sc(3, k);
    const y = (ele: number) => pad + ((scale.y(ele) - 15) / 95) * (height - 2 * pad);
    const x = (d: number) => (total > 0 ? Math.min(width, Math.max(0, (d / total) * width)) : 0);
    let d = '';
    points.forEach((point, index) => {
      d += `${index === 0 ? 'M' : 'L'}${(Math.round(x(point.d) * 10) / 10).toString()},${(
        Math.round(y(point.ele) * 10) / 10
      ).toString()}`;
    });
    return { line: d, sunriseX: sunrise === null ? null : x(sunrise) };
  }, [profile, total, width, height, sunrise, k]);
  return (
    <svg
      className={styles.profile}
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
    >
      {line && (
        <path
          d={line}
          fill="none"
          stroke={PALETTE.ridge}
          strokeWidth={sc(1.5, k)}
          strokeLinejoin="round"
        />
      )}
      {sunriseX !== null && (
        <line
          x1={sunriseX}
          x2={sunriseX}
          y1={0}
          y2={height}
          stroke={PALETTE.route}
          strokeWidth={k}
          strokeDasharray={`${String(sc(3, k))} ${String(sc(3, k))}`}
          data-marker="sunrise"
        />
      )}
    </svg>
  );
}
