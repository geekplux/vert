/**
 * The data the Night Ridge (B) and Survey Quad (E) posters draw their own SVG figures from, built
 * from the run, its heightfield and the figure box the poster reports (`onFigureBox`, logical px).
 * Pure: the page computes these and passes them as `figureData`.
 */
import type { Units } from '../lib/format';
import type { Bounds } from '../lib/geo';
import { formatClock, sunriseAlongRun } from '../lib/sun';
import type { Run, RunTrack } from '../page/types';
import type { Heightfield } from '../terrain/heightfield';
import {
  chooseContourInterval,
  contourPaths,
  extractContours,
  mapProjection,
  lineDetail,
  pathData,
  scaleBarFor,
  simplify,
  smoothHeightfield,
} from './contours';
import type { BoxSize, ContourPaths, ScaleBar } from './contours';
import type { PosterLayoutKind } from './layout';
import { ridgeFigure, RIDGE_ROWS } from './ridges';
import type { Point, Rect, RidgeFigure } from './ridges';

// ---------------------------------------------------------------------------------------------
// Framing (every style)
// ---------------------------------------------------------------------------------------------

/** The bounds of a track's points; null for an empty track. */
export function trackBounds(track: Pick<RunTrack, 'lat' | 'lon'>): Bounds | null {
  const n = Math.min(track.lat.length, track.lon.length);
  if (n === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let i = 0; i < n; i++) {
    const lat = track.lat[i] ?? 0;
    const lon = track.lon[i] ?? 0;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/**
 * The bounds every poster figure is framed on. With the ends hidden ("Hide start and end"), the
 * drawn route's: framed on the whole run, the empty margin around the drawn line would show where
 * the hidden start and finish were. Otherwise (or when nothing is left to draw) the run's.
 */
export function figureFrameBounds(
  runBounds: Bounds,
  drawnTrack: RunTrack | null,
  hideEnds: number,
): Bounds {
  if (!(hideEnds > 0) || !drawnTrack) return runBounds;
  return trackBounds(drawnTrack) ?? runBounds;
}

/** The View's heightfield padding: 15% of the width and height on every side. */
export const TRAIL_SIGN_PADDING = 0.15;

/** `bounds` with `padding` of its width and height added on every side. */
export function padBounds(bounds: Bounds, padding: number = TRAIL_SIGN_PADDING): Bounds {
  const padX = (bounds.east - bounds.west) * padding;
  const padY = (bounds.north - bounds.south) * padding;
  return {
    west: bounds.west - padX,
    east: bounds.east + padX,
    south: bounds.south - padY,
    north: bounds.north + padY,
  };
}

// ---------------------------------------------------------------------------------------------
// B · Night Ridge
// ---------------------------------------------------------------------------------------------

export interface NightRidgeSunrise {
  /** Local clock time, "07:31". */
  readonly clock: string;
  /** Distance from the start, metres. */
  readonly distance: number;
}

export interface NightRidgeFigureData {
  /** The ridgeline figure, laid out in the figure box; `null` until there is terrain. */
  readonly ridges: RidgeFigure | null;
  /** Sunrise during the run; `null` without timestamps or when the sun rose outside the run. */
  readonly sunrise: NightRidgeSunrise | null;
  /** Local clock time of the start, "05:42"; `null` without timestamps. */
  readonly startClock: string | null;
}

export interface NightRidgeOptions {
  /** Vertical exaggeration (the poster's setting). */
  exaggeration?: number;
  rows?: number;
  /** Output px per logical px (the export scale); 1 for the preview. See `lineDetail`. */
  detailScale?: number;
  /** IANA zone for the clock times; the browser's zone by default (see `formatClock`). */
  timeZone?: string;
  /**
   * The route to draw, with its start and finish where it begins and ends: the run's track with
   * the hidden ends cut off (`trimTrack`, "Hide start and end"), or null to draw no route.
   * Default `run.track`. Sunrise and the start time always come from the whole run.
   */
  drawnTrack?: RunTrack | null;
}

/** Ridge rows per layout: more rows on the wider share card. */
export const NIGHT_RIDGE_ROWS: Readonly<Record<PosterLayoutKind, number>> = {
  print: RIDGE_ROWS,
  social: 72,
};

/**
 * Figure data for Night Ridge. `heightfield` and `box` may be missing while they load; `box` is
 * what the poster's `onFigureBox` reports (the stage, and the text's line boxes to keep clear).
 */
export function nightRidgeFigureData(
  run: Pick<Run, 'track' | 'hasTime' | 'startTime'>,
  heightfield: Heightfield | null,
  box: (BoxSize & { readonly keepOut?: readonly Rect[] }) | null,
  { exaggeration, rows, timeZone, detailScale, drawnTrack }: NightRidgeOptions = {},
): NightRidgeFigureData {
  const route = drawnTrack === undefined ? run.track : drawnTrack;
  const ridges =
    heightfield && box && box.width > 0 && box.height > 0
      ? ridgeFigure(heightfield, box, route, {
          ...(exaggeration !== undefined ? { exaggeration } : {}),
          ...(rows !== undefined ? { rows } : {}),
          ...(box.keepOut ? { keepOut: box.keepOut } : {}),
          ...(detailScale !== undefined ? { detailScale } : {}),
        })
      : null;
  const timed = run.hasTime && run.track.time !== null;
  const found = timed ? sunriseAlongRun(run) : null;
  const start = run.track.time?.[0] ?? run.startTime;
  return {
    ridges,
    sunrise: found ? { clock: formatClock(found.time, timeZone), distance: found.distance } : null,
    startClock: timed && Number.isFinite(start) ? formatClock(start, timeZone) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// E · Survey Quad
// ---------------------------------------------------------------------------------------------

export interface QuadMarker extends Point {
  readonly kind: 'start' | 'finish';
}

export interface SurveyQuadMap {
  /** The map box, logical px (the SVG viewBox). */
  readonly width: number;
  readonly height: number;
  readonly contours: ContourPaths;
  /**
   * Contour interval actually drawn, metres: 20 m, or 50 ft (15.24 m) in imperial units, unless
   * the relief is too dense (see `chooseContourInterval`).
   */
  readonly interval: number;
  readonly route: string;
  /** Start ○, and a finish ○ when it is apart from the start. */
  readonly markers: readonly QuadMarker[];
  readonly scaleBar: ScaleBar;
  readonly pxPerMetre: number;
}

export interface SurveyQuadFigureData {
  /** `null` until there is terrain and a box. */
  readonly map: SurveyQuadMap | null;
  /** The run's centre, "34°46′ N" and "83°56′ W". */
  readonly coordinates: { readonly lat: string; readonly lon: string } | null;
}

/** Longest scale bar per layout, logical px. */
export const SCALE_BAR_MAX_PX: Readonly<Record<PosterLayoutKind, number>> = {
  print: 200,
  social: 300,
};

/** Degrees and minutes, "34°46′ N" / "83°56′ W" (rounded to the minute). */
export function formatLatLon(lat: number, lon: number): { lat: string; lon: string } {
  const dm = (value: number, positive: string, negative: string) => {
    const total = Math.round(Math.abs(value) * 60);
    const degrees = Math.floor(total / 60);
    const minutes = total - degrees * 60;
    return `${String(degrees)}°${String(minutes).padStart(2, '0')}′ ${value < 0 ? negative : positive}`;
  };
  return { lat: dm(lat, 'N', 'S'), lon: dm(lon, 'E', 'W') };
}

const METRES_PER_DEGREE_LAT = 111_320;

/**
 * Bounds to build Survey Quad's heightfield from (with `padding: 0`): the route's bounds plus
 * `margin` (a fraction of the larger side) on every side, widened on the shorter axis to the map
 * box's aspect (width / height), so the map covers its frame without cropping the route.
 */
export function quadBounds(route: Bounds, aspect: number, margin = 0.1): Bounds {
  const midLat = (route.north + route.south) / 2;
  const midLon = (route.east + route.west) / 2;
  const cos = Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  let w = Math.max(50, (route.east - route.west) * cos * METRES_PER_DEGREE_LAT);
  let h = Math.max(50, (route.north - route.south) * METRES_PER_DEGREE_LAT);
  const pad = Math.max(w, h) * margin;
  w += 2 * pad;
  h += 2 * pad;
  if (aspect > 0 && Number.isFinite(aspect)) {
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
  }
  const halfLon = w / 2 / (cos * METRES_PER_DEGREE_LAT);
  const halfLat = h / 2 / METRES_PER_DEGREE_LAT;
  return {
    west: midLon - halfLon,
    east: midLon + halfLon,
    south: midLat - halfLat,
    north: midLat + halfLat,
  };
}

/**
 * Bounds to build Night Ridge's heightfield from (with `padding: 0`): the route's bounds plus a
 * margin, widened so the figure fills the free part of the stage (below the text it keeps clear
 * of). The oblique view shows the ground's depth compressed to about 0.6 of its size, so the
 * ground's aspect is about 0.6 × the free area's, kept between 0.6:1 and 3:1.
 */
export function ridgeBounds(
  route: Bounds,
  box: BoxSize & { readonly keepOut?: readonly Rect[] },
): Bounds {
  const textBottom = Math.max(0, ...(box.keepOut ?? []).map((rect) => rect.y + rect.height));
  const free = Math.max(box.height * 0.2, box.height - textBottom);
  const aspect = free > 0 ? (box.width / free) * 0.6 : 1.6;
  return quadBounds(route, Math.min(3, Math.max(0.6, aspect)), 0.12);
}

/** Markers this close (logical px) are drawn as one: a loop's start and finish. */
const MARKER_MERGE_PX = 14;

export interface SurveyQuadOptions {
  units?: Units;
  layout?: PosterLayoutKind;
  /** Output px per logical px (the export scale); 1 for the preview. See `lineDetail`. */
  detailScale?: number;
  /**
   * The route to draw, its start and finish markers at its ends: the run's track with the hidden
   * ends cut off (`trimTrack`), or null to draw no route. Default `run.track`.
   */
  drawnTrack?: RunTrack | null;
  /**
   * What the map is centred on, and whose centre the coordinates give (`figureFrameBounds`: the
   * drawn route's when the ends are hidden). Default `run.bounds`.
   */
  frame?: Bounds;
}

/** Figure data for Survey Quad. `heightfield` and `box` may be missing while they load. */
export function surveyQuadFigureData(
  run: Pick<Run, 'track' | 'bounds'>,
  heightfield: Heightfield | null,
  box: BoxSize | null,
  {
    units = 'metric',
    layout = 'print',
    detailScale = 1,
    drawnTrack,
    frame,
  }: SurveyQuadOptions = {},
): SurveyQuadFigureData {
  const bounds = frame ?? run.bounds;
  const centred = [bounds.north, bounds.south, bounds.east, bounds.west].every(Number.isFinite);
  const coordinates = centred
    ? formatLatLon((bounds.north + bounds.south) / 2, (bounds.east + bounds.west) / 2)
    : null;
  if (!heightfield || !box || box.width <= 0 || box.height <= 0) return { map: null, coordinates };

  const projection = mapProjection(heightfield, box, centred ? bounds : undefined);
  // Smooth over ~2.5 px of map (at least a sample): tile noise would fray the 20 m lines.
  const pxPerSample = projection.pxPerMetre * heightfield.metresPerSample.x;
  const smoothed = smoothHeightfield(heightfield, Math.max(1, Math.round(2.5 / pxPerSample)));
  const interval = chooseContourInterval(smoothed, projection.pxPerMetre, { units });
  const contours = contourPaths(extractContours(smoothed, { interval }), projection, detailScale);
  const { tolerance, decimals } = lineDetail(detailScale);

  const route = drawnTrack === undefined ? run.track : drawnTrack;
  const lat = route?.lat ?? new Float64Array(0);
  const lon = route?.lon ?? new Float64Array(0);
  const n = Math.min(lat.length, lon.length);
  const flat: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = projection.lonLat(lon[i] ?? 0, lat[i] ?? 0);
    flat.push(x, y);
  }
  const markers: QuadMarker[] = [];
  if (n > 0) {
    const start = { x: flat[0] ?? 0, y: flat[1] ?? 0 };
    const end = { x: flat[flat.length - 2] ?? 0, y: flat[flat.length - 1] ?? 0 };
    markers.push({ ...start, kind: 'start' });
    if (Math.hypot(end.x - start.x, end.y - start.y) >= MARKER_MERGE_PX) {
      markers.push({ ...end, kind: 'finish' });
    }
  }
  return {
    map: {
      width: box.width,
      height: box.height,
      contours,
      interval,
      route: n > 1 ? pathData(simplify(flat, tolerance), false, decimals) : '',
      markers,
      scaleBar: scaleBarFor(projection.pxPerMetre, { maxPx: SCALE_BAR_MAX_PX[layout], units }),
      pxPerMetre: projection.pxPerMetre,
    },
    coordinates,
  };
}
