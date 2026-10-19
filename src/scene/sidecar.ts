/**
 * The JSON sidecar published next to a scene (`<id>.scene.json`, docs/SCENE.md, "Sidecar"): what
 * a host needs before fetching the scene (its size, a hash to bust caches, the totals to show), and
 * nothing more. Every number is a whole number, so no published text matches the host's
 * coordinate check (`\d{2}\.\d{4,}`).
 */
import { decodeScene } from './decode';
import { SCENE_VERSION } from './format';

/** The sidecar's `format` value. */
export const SIDECAR_FORMAT = 'vert-scene';

export interface SceneSidecar {
  readonly format: typeof SIDECAR_FORMAT;
  /** Format version of the scene file. */
  readonly version: number;
  /** Byte length of the scene file. */
  readonly bytes: number;
  /** FNV-1a (32-bit) of the scene file, 8 lower-case hex digits: changes whenever the file does. */
  readonly hash: string;
  /** The scene's summary, whole metres (`climb` is null when unknown). */
  readonly summary: {
    readonly distance: number;
    readonly climb: number | null;
    readonly drawnLength: number;
    readonly extent: { readonly x: number; readonly y: number };
    readonly trim: { readonly start: number; readonly end: number };
  };
}

/** FNV-1a, 32 bits, as 8 lower-case hex digits. */
export function fnv1a32(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The sidecar of a scene file. The summary is read back from the bytes, so it always describes
 * the file it sits next to.
 *
 * @throws SceneError when `bytes` is not a valid scene.
 */
export function buildSidecar(bytes: Uint8Array): SceneSidecar {
  const { summary } = decodeScene(bytes);
  const whole = Math.round;
  return {
    format: SIDECAR_FORMAT,
    version: SCENE_VERSION,
    bytes: bytes.length,
    hash: fnv1a32(bytes),
    summary: {
      distance: whole(summary.distance),
      climb: Number.isFinite(summary.climb) ? whole(summary.climb) : null,
      drawnLength: whole(summary.drawnLength),
      extent: { x: whole(summary.extent.x), y: whole(summary.extent.y) },
      trim: { start: whole(summary.trim.start), end: whole(summary.trim.end) },
    },
  };
}

/** The sidecar as published: two-space JSON with a trailing newline. */
export function sidecarJson(sidecar: SceneSidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}
