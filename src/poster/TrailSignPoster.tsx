import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { plotProfile, profilePaths } from '../components/ElevationProfile/profileGeometry';
import { SHARE_PROFILE_GAP, SHARE_PROFILE_HEIGHT, figureBoxRule, posterLayout } from './layout';
import type { FigureBoxRule } from './layout';
import type { PosterSize } from './sizes';
import { POSTER_STYLES } from './styles';
import { SHARE_STACKED_LINE_GAP_PX, SHARE_TITLE, fitTitleSetting } from './titleFit';
import type { TitleSetting } from './titleFit';
import { POSTER_URL, elevationNote, posterAriaLabel, posterStatList, shareDateLine } from './types';
import type { PosterContent } from './types';
import type { ProfilePoint } from '../page/types';
import { useTitleFonts } from './useTitleMeasure';
import type { TitleFonts } from './useTitleMeasure';
import styles from './TrailSignPoster.module.css';

/** Width / height of the canvas's terrain illustration (viewBox 0 0 1000 680). */
export const DEFAULT_FIGURE_ASPECT = 1000 / 680;

/** The figure box's size in logical px. */
export interface FigureBoxSize {
  width: number;
  height: number;
}

export interface TrailSignPosterProps {
  content: PosterContent;
  size: PosterSize;
  /**
   * The terrain figure: a `<canvas>` rendered at the figure box's aspect (see `onFigureBox`), or an
   * `<img>` placeholder. It covers the figure box (`object-fit: cover`, centred).
   */
  figure: ReactNode;
  /**
   * The figure's natural width / height: sets the 4:5 box's height and the print box's minimum
   * (`figureBoxRule`).
   */
  figureAspect?: number;
  /**
   * Called with the figure box's size in logical px when it is first laid out and whenever it
   * changes, so the terrain renderer can render at exactly that aspect.
   */
  onFigureBox?: (size: FigureBoxSize) => void;
  className?: string;
}

const STYLE_A = POSTER_STYLES.find((style) => style.id === 'A');
if (!STYLE_A?.share) throw new Error('Poster style A needs a share palette');
const PALETTE = { ...STYLE_A, share: STYLE_A.share };

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/**
 * Poster style A, Trail Sign (DESIGN-SPEC §4, canvas frames "Style A · Trail Sign 18×24" and
 * "Style A · share card 4:5"), laid out at its logical size (`posterLayout`): print sizes at 720 px
 * wide, social sizes at 1080 px wide in the share-card layout. The parent scales it.
 *
 * The poster is one image: the root is `role="img"` with a summary as its name, and the drawn text
 * is `aria-hidden` (it is artwork to be exported; the summary carries the same facts).
 */
export function TrailSignPoster({
  content,
  size,
  figure,
  figureAspect = DEFAULT_FIGURE_ASPECT,
  onFigureBox,
  className,
}: TrailSignPosterProps) {
  const layout = posterLayout(size);
  const rule = figureBoxRule(layout, figureAspect);
  const vars = {
    width: layout.width,
    height: layout.height,
    '--poster-paper': PALETTE.paper,
    '--poster-ink': PALETTE.ink,
    '--poster-accent': PALETTE.accent,
    '--share-bg': PALETTE.share.bg,
    '--share-text': PALETTE.share.text,
    '--share-accent': PALETTE.share.accent,
    '--share-muted': PALETTE.share.muted,
    '--share-profile-opacity': String(PALETTE.share.profileOpacity),
    '--share-figure': PALETTE.share.figure,
    '--figure-aspect': String(figureAspect),
  } as CSSProperties;
  const titleHeadline = layout.kind === 'social' && !content.stats.vert && !content.stats.distance;
  const classes = cx(
    styles.poster,
    styles[layout.kind],
    (rule.tall || titleHeadline) && styles.spread,
    className,
  );
  const figureSlot = (
    <FigureSlot rule={rule} kind={layout.kind} onFigureBox={onFigureBox}>
      {figure}
    </FigureSlot>
  );

  return (
    <div
      role="img"
      aria-label={posterAriaLabel(content)}
      className={classes}
      style={vars}
      data-layout={layout.kind}
    >
      <div className={styles.inner} aria-hidden="true">
        {layout.kind === 'print' ? (
          <PrintLayout content={content} figure={figureSlot} />
        ) : (
          <SocialLayout content={content} figure={figureSlot} rule={rule} />
        )}
      </div>
    </div>
  );
}

interface FigureSlotProps {
  rule: FigureBoxRule;
  kind: 'print' | 'social';
  onFigureBox: ((size: FigureBoxSize) => void) | undefined;
  children: ReactNode;
}

/** The figure box, sized by `figureBoxRule`, reporting its size to `onFigureBox`. */
function FigureSlot({ rule, kind, onFigureBox, children }: FigureSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onFigureBox);
  useLayoutEffect(() => {
    callback.current = onFigureBox;
  });
  const observe = onFigureBox !== undefined;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!observe || !element || typeof ResizeObserver === 'undefined') return;
    let last = '';
    // contentRect is the layout size, unaffected by the preview's transform: logical px.
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      const key = `${String(rect.width)}×${String(rect.height)}`;
      if (key === last) return;
      last = key;
      callback.current?.({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [observe]);

  const style: CSSProperties = {
    flexGrow: rule.grow ? 1 : 0,
    flexBasis: rule.grow ? 0 : 'auto',
    minHeight: rule.minHeight ?? 0,
    maxHeight: rule.maxHeight ?? undefined,
  };
  return (
    <div
      ref={ref}
      className={cx(styles.figure, kind === 'social' && styles.shareFigure)}
      style={style}
      data-slot="figure"
    >
      {children}
    </div>
  );
}

function useProfileArea(profile: readonly ProfilePoint[]): string {
  return useMemo(() => {
    const plot = plotProfile(profile);
    return profilePaths(plot.points, plot.scale).area;
  }, [profile]);
}

interface LayoutProps {
  content: PosterContent;
  figure: ReactNode;
}

function PrintLayout({ content, figure }: LayoutProps) {
  const stats = posterStatList(content.stats);
  const area = useProfileArea(content.profile);
  const { measure, ink } = useTitleFonts(content.title);
  const title = fitTitleSetting(content.title, undefined, measure, undefined, ink);
  return (
    <>
      <div className={styles.header} data-slot="header">
        <span>VERT</span>
        <span>{content.date}</span>
      </div>
      <div
        className={styles.title}
        style={titleStyle(title)}
        data-slot="title"
        data-lines={title.lines}
      >
        {content.title}
      </div>
      {figure}
      {stats.length > 0 && (
        <div
          className={styles.stats}
          style={{ '--stat-columns': stats.length } as CSSProperties}
          data-slot="stats"
        >
          {stats.map(([key, label, text]) => (
            <div key={key} data-stat={key}>
              <div className={styles.label}>{label}</div>
              <div className={cx(styles.value, key === 'vert' && styles.accent)}>{text}</div>
            </div>
          ))}
        </div>
      )}
      <svg
        className={styles.profile}
        viewBox="0 0 1000 120"
        preserveAspectRatio="none"
        data-slot="profile"
      >
        {area && <path d={area} fill="currentColor" />}
      </svg>
      <div className={styles.footer} data-slot="footer">
        <PrintFooterNote content={content} />
        <span className={styles.footerSign}>{content.signature || POSTER_URL}</span>
      </div>
    </>
  );
}

/**
 * "[SAMPLE DATA · ][<subtitle> · ][ELEVATION FROM TERRAIN DATA · ]ELEVATION ×1.6" on one line (the
 * text of `elevationNote`). Only the subtitle truncates, so the sample note, the terrain note and
 * the exaggeration always stay readable.
 */
function PrintFooterNote({ content }: { content: PosterContent }) {
  const { isSample, subtitle, exaggeration, elevationSource } = content;
  const elevation = elevationNote({ isSample: false, exaggeration, elevationSource });
  return (
    <span className={styles.footerLeft}>
      {isSample && <span className={styles.keep}>SAMPLE DATA · </span>}
      {subtitle && <span className={styles.footerNote}>{subtitle}</span>}
      <span className={styles.keep}>{subtitle ? ` · ${elevation}` : elevation}</span>
    </span>
  );
}

interface Headline {
  /** The big slot: the vert or distance number, or the title when both are off. */
  big: string;
  bigIsTitle: boolean;
  line: string;
  /** The footer repeats time and high point only when the line does not already show them. */
  footerStats: boolean;
}

/** The share card's big slot and the line under it, from the stats that are switched on. */
function headline(content: PosterContent): Headline {
  const { stats, title } = content;
  if (stats.vert) {
    const where = stats.distance ? ` in ${stats.distance.text}` : '';
    return {
      big: stats.vert.text,
      bigIsTitle: false,
      line: `of climbing${where} on ${title}`,
      footerStats: true,
    };
  }
  if (stats.distance) {
    return { big: stats.distance.text, bigIsTitle: false, line: `on ${title}`, footerStats: true };
  }
  const rest = [stats.time, stats.highPoint ? `High point ${stats.highPoint.text}` : '']
    .filter(Boolean)
    .join(' · ');
  return { big: title, bigIsTitle: true, line: rest || content.date, footerStats: false };
}

/**
 * A fitted title's inline style: its size, and for diacritics a looser line-height inside the box
 * height the plain fit takes (`fitTitleSetting`), so nothing around it moves.
 */
function titleStyle(setting: TitleSetting): CSSProperties {
  return {
    fontSize: setting.size,
    lineHeight: setting.lineHeight,
    height: setting.boxHeight,
  };
}

/** The title in the big slot: uppercase display type fitted to ≤ 3 lines from 160 px. */
function bigTitleStyle(title: string, { measure, ink }: TitleFonts): CSSProperties {
  return titleStyle(fitTitleSetting(title, SHARE_TITLE, measure, SHARE_STACKED_LINE_GAP_PX, ink));
}

function SocialLayout({ content, figure, rule }: LayoutProps & { rule: FigureBoxRule }) {
  const { big, bigIsTitle, line, footerStats } = headline(content);
  const { time, highPoint } = content.stats;
  const area = useProfileArea(content.profile);
  const fonts = useTitleFonts(content.title);
  const footer = [
    content.isSample ? 'SAMPLE DATA' : '',
    footerStats ? (time ?? '') : '',
    footerStats && highPoint ? `HIGH POINT ${highPoint.text}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const bodyStyle: CSSProperties | undefined =
    rule.tall && rule.maxHeight !== null
      ? {
          flexGrow: 1,
          maxHeight: rule.maxHeight + SHARE_PROFILE_GAP + SHARE_PROFILE_HEIGHT,
          gap: SHARE_PROFILE_GAP,
        }
      : undefined;
  return (
    <>
      <div className={styles.shareHeader} data-slot="header">
        <span className={styles.wordmark}>VERT</span>
        <span className={styles.shareDate}>{shareDateLine(content)}</span>
      </div>
      <div className={styles.headline} data-slot="headline">
        {bigIsTitle ? (
          <div
            className={cx(styles.big, styles.bigTitle)}
            style={bigTitleStyle(big, fonts)}
            data-slot="title"
          >
            {big}
          </div>
        ) : (
          <div className={styles.big}>{big}</div>
        )}
        <div className={styles.line}>{line}</div>
      </div>
      <div className={styles.shareBody} style={bodyStyle} data-slot="body">
        {figure}
        {rule.profile && (
          <svg
            className={styles.shareProfile}
            style={{ height: SHARE_PROFILE_HEIGHT }}
            viewBox="0 0 1000 120"
            preserveAspectRatio="none"
            data-slot="profile"
          >
            {area && <path d={area} fill="currentColor" />}
          </svg>
        )}
      </div>
      <div className={styles.shareFooter} data-slot="footer">
        {footer && <span className={styles.shareStats}>{footer}</span>}
        <span className={styles.shareSign}>{content.signature || POSTER_URL}</span>
      </div>
    </>
  );
}
