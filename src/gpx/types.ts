/**
 * The shapes the GPX parser produces. Plain data only, so a parsed track can cross a
 * `postMessage` boundary between the parsing worker and the page unchanged.
 */

/** One recorded position. */
export interface TrackPoint {
  /** Latitude in decimal degrees, WGS 84, within [-90, 90]. */
  lat: number;
  /** Longitude in decimal degrees, WGS 84, within [-180, 180]. */
  lon: number;
  /** Elevation in metres from `<ele>`, or `null` when the point has none. */
  ele: number | null;
  /** Timestamp from `<time>` in milliseconds since the Unix epoch, or `null`. */
  time: number | null;
}

/** A GPX file reduced to the one track Vert draws. */
export interface ParsedGpx {
  /** Name of the chosen track (or route), else the file's metadata name; `null` if neither. */
  name: string | null;
  /** Activity type from the track's `<type>` (e.g. `"trail_running"`, `"running"`, `"9"`). */
  type: string | null;
  /** The `creator` attribute of `<gpx>`: the app or device that wrote the file. */
  creator: string | null;
  /** The file's own timestamp from `<metadata><time>` (ms since epoch), not the first point's. */
  time: number | null;
  /**
   * Valid points in recording order: every `<trkseg>` of the first track with a valid point,
   * concatenated (or the first such route's points).
   */
  points: TrackPoint[];
  /** Number of track segments that contributed at least one point (1 for a route). */
  segments: number;
  /** Where the points came from: a recorded track, or a planned route when there is no track. */
  source: 'trk' | 'rte';
}

/** Why a file could not be turned into a track. */
export type GpxErrorCode = 'not-gpx' | 'no-points' | 'malformed' | 'too-large';

/** Default UI copy for each error code. Short, plain, and says what to do next. */
export const GPX_ERROR_MESSAGES: Readonly<Record<GpxErrorCode, string>> = {
  'not-gpx':
    "This doesn't look like a GPX file. Vert reads .gpx files exported from a watch, a phone app or Strava.",
  'no-points': 'This file has no track points. Vert needs a GPX track recorded by a watch or app.',
  malformed:
    "This GPX file looks damaged or cut off, so Vert can't read it. Try exporting it again.",
  'too-large':
    'This track has more points than Vert can draw. Try a shorter activity, or export it with fewer points.',
};

/**
 * A file Vert cannot use. `message` is written for people and safe to show in the UI as is;
 * `code` is for branching (and survives structured cloning where the class does not).
 */
export class GpxError extends Error {
  readonly code: GpxErrorCode;

  constructor(code: GpxErrorCode, options?: { message?: string; cause?: unknown }) {
    super(options?.message ?? GPX_ERROR_MESSAGES[code], { cause: options?.cause });
    this.name = 'GpxError';
    this.code = code;
  }
}
