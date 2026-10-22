/**
 * What a poster shows, already formatted: every style reads the same `PosterContent` and only
 * lays it out differently (DESIGN-SPEC §4 shared slots: title, subtitle, date, stats row,
 * signature, terrain figure, elevation profile strip).
 */
import {
  formatDateLine,
  formatDistance,
  formatDuration,
  formatElevation,
  formatNumber,
} from '../lib/format';
import type { Formatted, Units } from '../lib/format';
import type { PosterPrefs, Prefs } from '../page/state';
import type { ElevationSource, ProfilePoint, Run } from '../page/types';

/** The poster's stats, only the ones switched on, in display order. */
export interface PosterStats {
  readonly distance?: Formatted;
  /** Signed: "+1,102 m". Absent when the run's elevation is unknown (no `<ele>`, no terrain yet). */
  readonly vert?: Formatted;
  /** Moving time, "3:04:58". Absent when the run has no time data. */
  readonly time?: string;
  /** Absent when the run's elevation is unknown. */
  readonly highPoint?: Formatted;
}

export type PosterStatKey = keyof PosterStats;

/** Display order and labels of the stats. */
export const POSTER_STAT_LABELS: readonly (readonly [PosterStatKey, string])[] = [
  ['distance', 'DISTANCE'],
  ['vert', 'VERT'],
  ['time', 'TIME'],
  ['highPoint', 'HIGH POINT'],
];

export interface PosterContent {
  readonly title: string;
  /**
   * Free text such as a place ("Vogel SP"); empty for none. Never replaces the date: print shows it
   * in the footer, the share card after the date.
   */
  readonly subtitle: string;
  /** The run's local date line, "SAT · 2026-10-03"; empty when the run has no valid start time. */
  readonly date: string;
  /** The author's handle; empty for none (the footer then shows the site URL). */
  readonly signature: string;
  readonly stats: PosterStats;
  /** The route's length, metres, whatever stats are shown (the profile axis, sunrise position). */
  readonly distance: number;
  readonly profile: readonly ProfilePoint[];
  /** Where the elevations come from (`Run.elevationSource`); `null` while unknown. */
  readonly elevationSource: ElevationSource | null;
  readonly units: Units;
  readonly isSample: boolean;
  /** Vertical exaggeration the terrain figure is drawn with. */
  readonly exaggeration: number;
}

/** Longest signature a poster shows, in characters (longer ones are cut). */
export const SIGNATURE_MAX = 40;

/** The site URL a poster shows when it has no signature (DECISIONS: no invented data). */
export const POSTER_URL = 'VERT.GEEKPLUX.COM';

/** The preferences a poster reads. */
export type PosterContentPrefs = Pick<Prefs, 'units' | 'exaggeration'> & {
  readonly poster: Pick<PosterPrefs, 'title' | 'subtitle' | 'signature' | 'stats'>;
};

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * The signature trimmed and, when longer than `SIGNATURE_MAX` characters (grapheme clusters), cut
 * to `SIGNATURE_MAX` including a closing "…".
 */
export function clampSignature(signature: string): string {
  const parts = Array.from(graphemes.segment(signature.trim()), (part) => part.segment);
  if (parts.length <= SIGNATURE_MAX) return parts.join('');
  return `${parts
    .slice(0, SIGNATURE_MAX - 1)
    .join('')
    .trimEnd()}…`;
}

function dateLine(run: Run): string {
  if (!Number.isFinite(run.startTime)) return '';
  return formatDateLine(new Date(run.startTime), run.lonForOffset);
}

/**
 * The poster content for a run and the current preferences: title defaults to the run name,
 * subtitle to none (a subtitle equal to the date line counts as none, since the date is always
 * shown); only the stats switched on are included, in the display units; a run
 * without time data has no time stat even when it is switched on, and one whose elevation is
 * unknown (no `<ele>` and no terrain yet) has no vert or high point, so no poster prints "–".
 */
export function posterContentFromRun(run: Run, prefs: PosterContentPrefs): PosterContent {
  const { units, exaggeration, poster } = prefs;
  const shown = poster.stats;
  const date = dateLine(run);
  const stats: {
    distance?: Formatted;
    vert?: Formatted;
    time?: string;
    highPoint?: Formatted;
  } = {};
  if (shown.distance) stats.distance = formatDistance(run.distance, units);
  if (shown.vert && Number.isFinite(run.vert)) {
    stats.vert = formatElevation(run.vert, units, { signed: true });
  }
  if (shown.time && Number.isFinite(run.movingTime) && run.movingTime > 0) {
    stats.time = formatDuration(run.movingTime);
  }
  if (shown.highPoint && Number.isFinite(run.highPoint)) {
    stats.highPoint = formatElevation(run.highPoint, units);
  }
  return {
    title: poster.title.trim() || run.name,
    subtitle: poster.subtitle.trim() === date ? '' : poster.subtitle.trim(),
    date,
    signature: clampSignature(poster.signature),
    stats,
    distance: run.distance,
    profile: run.profile,
    elevationSource: run.elevationSource,
    units,
    isSample: run.isSample,
    exaggeration,
  };
}

/** The stats that are present, in display order, as [key, label, text]. */
export function posterStatList(stats: PosterStats): [PosterStatKey, string, string][] {
  const list: [PosterStatKey, string, string][] = [];
  for (const [key, label] of POSTER_STAT_LABELS) {
    const stat = stats[key];
    if (stat !== undefined) list.push([key, label, typeof stat === 'string' ? stat : stat.text]);
  }
  return list;
}

/** The small print a poster adds when its elevations were sampled from the terrain… */
export const TERRAIN_ELEVATION_NOTE = 'ELEVATION FROM TERRAIN DATA';
/** …or when the terrain filled gaps in the file's own. */
export const MIXED_ELEVATION_NOTE = 'ELEVATION PARTLY FROM TERRAIN DATA';
/** …or when the file's long gaps were interpolated (the terrain could not load). */
export const INTERPOLATED_ELEVATION_NOTE = 'ELEVATION GAPS INTERPOLATED';

/**
 * The print footer's left side: "[SAMPLE DATA · ][<subtitle> · ][ELEVATION FROM TERRAIN DATA · ]
 * [ELEVATION ×1.6]". The sample note only for the sample run, the subtitle only when set, the
 * terrain note only when the terrain supplied the elevations ("PARTLY" when it filled gaps), or
 * "ELEVATION GAPS INTERPOLATED" when the terrain could not fill them; the exaggeration only when
 * a relief is drawn (null: the terrain figure could not be drawn).
 */
export function elevationNote(
  content: Pick<PosterContent, 'isSample'> & {
    exaggeration: number | null;
    subtitle?: string;
    elevationSource?: ElevationSource | null;
  },
): string {
  return [
    content.isSample ? 'SAMPLE DATA' : '',
    content.subtitle ?? '',
    content.elevationSource === 'terrain'
      ? TERRAIN_ELEVATION_NOTE
      : content.elevationSource === 'mixed'
        ? MIXED_ELEVATION_NOTE
        : content.elevationSource === 'interpolated'
          ? INTERPOLATED_ELEVATION_NOTE
          : '',
    content.exaggeration === null ? '' : `ELEVATION ×${formatNumber(content.exaggeration, 1)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The share card's header date: "SAT · 2026-10-03 · VOGEL SP" (subtitle only when set). */
export function shareDateLine(content: Pick<PosterContent, 'date' | 'subtitle'>): string {
  return [content.date, content.subtitle].filter(Boolean).join(' · ');
}

/**
 * The poster's accessible name, e.g. "Poster: Coosa Backcountry Loop, SAT · 2026-10-03, Vogel SP.
 * Distance 21.5 km, vert +1,102 m, time 3:04:58. Sample data. By @geekplux."
 */
export function posterAriaLabel(content: PosterContent): string {
  const head = [content.title, content.date, content.subtitle].filter(Boolean).join(', ');
  const stats = posterStatList(content.stats)
    .map(([, label, text], index) => {
      const name = label.toLowerCase();
      return `${index === 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name} ${text}`;
    })
    .join(', ');
  const parts = [`Poster: ${head}.`];
  if (stats) parts.push(`${stats}.`);
  if (content.isSample) parts.push('Sample data.');
  if (content.elevationSource === 'terrain') parts.push('Elevation from terrain data.');
  if (content.elevationSource === 'mixed') parts.push('Elevation partly from terrain data.');
  if (content.elevationSource === 'interpolated') parts.push('Elevation gaps interpolated.');
  if (content.signature) parts.push(`By ${content.signature}.`);
  return parts.join(' ');
}
