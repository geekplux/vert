/**
 * The terrain camera's angles and the pose the page hands from the View to Poster mode. Plain
 * numbers, no three.js: the page state imports this, and three.js stays in the lazy terrain chunk.
 *
 * Angles as the stage uses them (stage.ts): `polar` from straight down (0 = top-down map, π/2 =
 * horizon), `azimuth` around the vertical axis (0 = the camera south of the model looking north,
 * positive = the camera east of south).
 */

const DEG = Math.PI / 180;

/** OrbitControls polar limits for the oblique view (prompt: 20°–80°). */
export const MIN_POLAR = 20 * DEG;
export const MAX_POLAR = 80 * DEG;
/** The default oblique view. */
export const DEFAULT_POLAR = 62 * DEG;
/**
 * The default azimuth: the camera 18° east of south (DECISIONS.md's "−18°", a bearing measured the
 * other way round), so the east wall shows its stepped row ends on the right, as in the canvas.
 */
export const DEFAULT_AZIMUTH = 18 * DEG;
/** Top-down, a hair off 0 so `lookAt` keeps north up. */
export const FLAT_POLAR = 1e-4;

/**
 * Where the camera looks from, relative to the model's fit: what "Make a poster uses the current
 * camera" (BRIEF) carries from the View to the poster's terrain figure. The distance is not
 * stored: each box fits the model itself, and `zoom` scales that fit (1 = fitted, < 1 closer).
 */
export interface ViewCamera {
  /** Radians, see the module comment. */
  readonly azimuth: number;
  /** Radians from straight down. */
  readonly polar: number;
  /** Distance ÷ the fitted distance. */
  readonly zoom: number;
  /** `flat` = the top-down map, north up (the View's Flat map). */
  readonly view: 'oblique' | 'flat';
}

/** The View's default oblique camera, before the user turns or zooms it. */
export const DEFAULT_VIEW_CAMERA: ViewCamera = {
  azimuth: DEFAULT_AZIMUTH,
  polar: DEFAULT_POLAR,
  zoom: 1,
  view: 'oblique',
};

/** `angle` in (−π, π]. */
export function normalizeAzimuth(angle: number): number {
  if (!Number.isFinite(angle)) return DEFAULT_AZIMUTH;
  const turn = 2 * Math.PI;
  let a = angle % turn;
  if (a <= -Math.PI) a += turn;
  if (a > Math.PI) a -= turn;
  return a;
}
