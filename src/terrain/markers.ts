/**
 * Markers on the terrain: ○ start, ▲ summit and the ● scrub marker, as screen-space sprites that
 * keep their pixel size at any zoom (`sizeAttenuation: false`) and draw over the terrain and the
 * route (no depth test). Shapes match the 2D `Marker` component, so shape, not colour, tells them
 * apart (DESIGN-SPEC §5):
 *
 * - start: hollow circle, white fill, 3 px ink ring;
 * - finish (only when the route does not end within {@link LOOP_DISTANCE_M} of its start): the
 *   start circle with a solid ink dot in the middle (◉), so it never reads as a second start;
 *   a loop gets one ○ ("Start / finish" in the legend);
 * - summit: solid ink triangle with a 2.5 px white edge, its centroid on the highest point (only
 *   when that stands 10 m or more above the lowest, `hasSummit`);
 * - scrub: route-coloured dot with a 3 px white ring and a 1 px ink hairline outside it (the
 *   hairline keeps the white ring visible over the route's white halo).
 *
 * Sizes follow the canvas's terrain figure (frame 02 View: start r 9 with a 3 px stroke, summit
 * 28 × 24), which is a little larger than the 18 px `Marker` box used in the profile and legend:
 * on the terrain the markers sit on a 9 px halo and must stand clear of it.
 *
 * Each marker is a small canvas texture drawn at {@link TEXTURE_SCALE}× its CSS size, or more for
 * a figure drawn at a larger scale (`setTextureScale`, {@link markerTextureScale}: the 18 × 24
 * export draws them at 7.5×, so their textures are painted at 8×).
 *
 * Occlusion: a marker behind a ridge would otherwise float over the ridge with no route near it
 * (the route itself is depth-tested). Before each frame `updateOcclusion` marches a ray from each
 * marker to the eye over the height grid (CPU, a few hundred bilinear samples in all) and fades a
 * hidden marker to {@link OCCLUDED_OPACITY}: still there, plainly behind something.
 */
import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three';
import { haversine } from '../lib/geo';
import { hasSummit } from '../lib/summit';
import { sampleBilinear } from '../lib/terrarium';
import type { RunTrack } from '../page/types';
import { elevationAt, type Heightfield } from './heightfield';
import { heightfieldToLocal, modelBounds } from './mesh';
import {
  APP_ROUTE_PALETTE,
  DEFAULT_LIFT_M,
  pointAtDistance,
  type RoutePalette,
  type RouteTrack,
} from './route';

export type TerrainMarkerKind = 'start' | 'finish' | 'summit' | 'scrub';

/** A route that ends this close to its start is a loop: one ○ marks start and finish. */
export const LOOP_DISTANCE_M = 50;

/** Marker geometry, CSS px. */
export const START_DIAMETER_PX = 22;
export const START_RING_PX = 3;
export const FINISH_DOT_PX = 7;
export const SUMMIT_WIDTH_PX = 28;
export const SUMMIT_HEIGHT_PX = 24;
export const SUMMIT_EDGE_PX = 2.5;
/** Scrub: the profile's 14 px dot (3 px white ring), plus a 1 px ink hairline. */
export const SCRUB_DIAMETER_PX = 14;
export const SCRUB_RING_PX = 3;
export const SCRUB_HAIRLINE_PX = 1;
/** Texture pixels per CSS pixel (at least: see {@link markerTextureScale}). */
export const TEXTURE_SCALE = 4;
/** The largest texture scale a figure asks for (a summit texture of 40 × 16 = 640 px). */
export const MAX_TEXTURE_SCALE = 16;

/**
 * Texture px per CSS px for markers drawn at `pixelScale` output px per CSS px: never below
 * {@link TEXTURE_SCALE}, and at least the scale itself (whole steps), so a marker is never
 * magnified from a smaller texture.
 */
export function markerTextureScale(pixelScale: number): number {
  if (!(pixelScale > 0) || !Number.isFinite(pixelScale)) return TEXTURE_SCALE;
  return Math.min(MAX_TEXTURE_SCALE, Math.max(TEXTURE_SCALE, Math.ceil(pixelScale - 1e-6)));
}
/** Opacity of a marker the terrain hides from the camera. */
export const OCCLUDED_OPACITY = 0.35;

/** Draw order: after the terrain (0) and the route (1, 2). */
const RENDER_ORDER: Record<TerrainMarkerKind, number> = {
  start: 3,
  finish: 3,
  summit: 4,
  scrub: 5,
};

/** Indices of the route's markers in the track. */
export interface RouteMarkerIndices {
  readonly start: number;
  /** Null for a loop (the start marker stands for both). */
  readonly finish: number | null;
  /** Null when the high point is no summit (`hasSummit`: under 10 m above the lowest point). */
  readonly summit: number | null;
}

/**
 * Where the markers go: start at the first point, finish at the last unless the route is a loop,
 * summit at the highest point (the track's elevations as the stats use them, so it matches the
 * high point shown in the aside; the terrain's elevations when the file has none), and only when
 * it stands out (`hasSummit`, the same rule as the legend and the posters).
 */
export function routeMarkerIndices(
  track: Pick<RunTrack, 'lat' | 'lon' | 'ele'>,
  heightfield?: Heightfield,
): RouteMarkerIndices {
  const n = track.lat.length;
  if (n === 0) throw new RangeError('The track has no points');
  const last = n - 1;
  const gap = haversine(
    { lat: track.lat[0] ?? 0, lon: track.lon[0] ?? 0 },
    { lat: track.lat[last] ?? 0, lon: track.lon[last] ?? 0 },
  );
  const elevation = (i: number): number => {
    const recorded = track.ele?.[i];
    if (recorded !== undefined && Number.isFinite(recorded)) return recorded;
    return heightfield ? elevationAt(heightfield, track.lon[i] ?? 0, track.lat[i] ?? 0) : -Infinity;
  };
  let summit = 0;
  let highest = -Infinity;
  let lowest = Infinity;
  for (let i = 0; i < n; i++) {
    const e = elevation(i);
    if (e > highest) {
      highest = e;
      summit = i;
    }
    if (e < lowest) lowest = e;
  }
  return {
    start: 0,
    finish: n > 1 && gap > LOOP_DISTANCE_M ? last : null,
    summit: hasSummit(highest, lowest) ? summit : null,
  };
}

/**
 * True when the terrain hides `point` (local frame, at `exaggeration`) from `eye`: some sample on
 * the segment between them, past the first two grid cells, lies more than `toleranceMetres` below
 * the surface. Samples every half grid cell until the ray leaves the model or rises above its top.
 */
export function isOccluded(
  heightfield: Heightfield,
  point: Vector3,
  eye: Vector3,
  exaggeration: number,
  toleranceMetres = 3,
): boolean {
  const { width: w, height: h, elevations, min } = heightfield;
  const bounds = modelBounds(heightfield, exaggeration);
  const cell = Math.max(bounds.width / (w - 1), bounds.depth / (h - 1));
  const vertical = bounds.scale * exaggeration;
  const tolerance = toleranceMetres * vertical;
  const dx = eye.x - point.x;
  const dy = eye.y - point.y;
  const dz = eye.z - point.z;
  const length = Math.hypot(dx, dy, dz);
  const horizontal = Math.hypot(dx, dz);
  if (length === 0 || horizontal === 0) return false;
  // Parameter step: half a grid cell of horizontal travel.
  const step = (cell / 2 / horizontal) * length;
  for (let t = (2 * cell * length) / horizontal; t < length; t += step) {
    const k = t / length;
    const x = point.x + dx * k;
    const y = point.y + dy * k;
    const z = point.z + dz * k;
    if (y > bounds.height + tolerance) return false; // above the highest point: clear
    const i = (x / bounds.width + 0.5) * (w - 1);
    const j = (z / bounds.depth + 0.5) * (h - 1);
    if (i < 0 || j < 0 || i > w - 1 || j > h - 1) return false; // off the model
    const surface = (sampleBilinear(elevations, w, h, i, j) - min) * vertical;
    if (surface > y + tolerance) return true;
  }
  return false;
}

/** CSS-px size of a marker's texture box. */
export function markerBox(kind: TerrainMarkerKind): number {
  switch (kind) {
    case 'start':
    case 'finish':
      return START_DIAMETER_PX + 2;
    case 'summit': {
      // The triangle's centroid sits at the box centre; the apex is 2/3 of the height above it.
      const up = (SUMMIT_HEIGHT_PX * 2) / 3 + SUMMIT_EDGE_PX;
      const side = SUMMIT_WIDTH_PX / 2 + SUMMIT_EDGE_PX;
      return 2 * Math.ceil(Math.max(up, side)) + 2;
    }
    case 'scrub':
      return SCRUB_DIAMETER_PX + 2 * SCRUB_HAIRLINE_PX + 2;
  }
}

/** How far a marker's drawn shape reaches from its position on screen, CSS px. */
export interface MarkerExtent {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
}

/**
 * The drawn extent of `kind` around its anchor (what the framing keeps clear of the box's edges):
 * the start ring's outer edge, the summit triangle with its round-joined white edge (apex 2/3 of
 * the height above the centroid), the scrub dot with its hairline.
 */
export function markerExtent(kind: TerrainMarkerKind): MarkerExtent {
  switch (kind) {
    case 'start':
    case 'finish': {
      const r = START_DIAMETER_PX / 2;
      return { left: r, right: r, up: r, down: r };
    }
    case 'summit': {
      const side = SUMMIT_WIDTH_PX / 2 + SUMMIT_EDGE_PX;
      return {
        left: side,
        right: side,
        up: (SUMMIT_HEIGHT_PX * 2) / 3 + SUMMIT_EDGE_PX,
        down: SUMMIT_HEIGHT_PX / 3 + SUMMIT_EDGE_PX,
      };
    }
    case 'scrub': {
      const r = SCRUB_DIAMETER_PX / 2 + SCRUB_HAIRLINE_PX;
      return { left: r, right: r, up: r, down: r };
    }
  }
}

/** Draws one marker centred in a `box × box` CSS-px square (the context is scaled to CSS px). */
export function drawMarker(
  ctx: Pick<
    CanvasRenderingContext2D,
    | 'beginPath'
    | 'arc'
    | 'moveTo'
    | 'lineTo'
    | 'closePath'
    | 'fill'
    | 'stroke'
    | 'fillStyle'
    | 'strokeStyle'
    | 'lineWidth'
    | 'lineJoin'
  >,
  kind: TerrainMarkerKind,
  palette: RoutePalette,
  box: number,
): void {
  const c = box / 2;
  const disc = (radius: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  switch (kind) {
    case 'start':
    case 'finish': {
      // Ring centred on r − ring/2, so the outer edge is the diameter.
      const radius = (START_DIAMETER_PX - START_RING_PX) / 2;
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, 2 * Math.PI);
      ctx.fillStyle = palette.halo;
      ctx.fill();
      ctx.lineWidth = START_RING_PX;
      ctx.strokeStyle = palette.ink;
      ctx.stroke();
      if (kind === 'finish') disc(FINISH_DOT_PX / 2, palette.ink);
      break;
    }
    case 'summit': {
      const w = SUMMIT_WIDTH_PX / 2;
      const up = (SUMMIT_HEIGHT_PX * 2) / 3;
      const down = SUMMIT_HEIGHT_PX / 3;
      ctx.beginPath();
      ctx.moveTo(c, c - up);
      ctx.lineTo(c + w, c + down);
      ctx.lineTo(c - w, c + down);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = SUMMIT_EDGE_PX * 2; // half of it lies under the fill
      ctx.strokeStyle = palette.halo;
      ctx.stroke();
      ctx.fillStyle = palette.ink;
      ctx.fill();
      break;
    }
    case 'scrub': {
      const outer = SCRUB_DIAMETER_PX / 2;
      disc(outer + SCRUB_HAIRLINE_PX, palette.ink);
      disc(outer, palette.halo);
      disc(outer - SCRUB_RING_PX, palette.route);
      break;
    }
  }
}

/** Paints `kind` into `canvas` at `scale`×. Without a 2D context it stays blank. */
function paintMarker(
  canvas: HTMLCanvasElement,
  kind: TerrainMarkerKind,
  palette: RoutePalette,
  scale: number = TEXTURE_SCALE,
) {
  const box = markerBox(kind);
  canvas.width = Math.ceil(box * scale);
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, box, box);
  drawMarker(ctx, kind, palette, box);
}

interface MarkerSprite {
  readonly kind: TerrainMarkerKind;
  readonly sprite: Sprite;
  readonly material: SpriteMaterial;
  readonly texture: CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  /** Position at exaggeration 1. */
  readonly base: Vector3;
}

function createMarkerSprite(kind: TerrainMarkerKind, palette: RoutePalette): MarkerSprite {
  const canvas = document.createElement('canvas');
  paintMarker(canvas, kind, palette);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({
    map: texture,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new Sprite(material);
  sprite.name = `marker-${kind}`;
  sprite.renderOrder = RENDER_ORDER[kind];
  sprite.frustumCulled = false;
  return { kind, sprite, material, texture, canvas, base: new Vector3() };
}

export interface MarkerLayerOptions {
  palette?: RoutePalette;
  exaggeration?: number;
  /** Metres above the surface, as the route. */
  lift?: number;
}

export interface MarkerLayer {
  readonly group: Group;
  readonly indices: RouteMarkerIndices;
  /** The sprite for `kind`, or null when this route has none (finish on a loop). */
  sprite(kind: TerrainMarkerKind): Sprite | null;
  /**
   * The markers that stay put (start, finish, summit): kind and position at exaggeration 1, local
   * frame. The scrub marker moves along the route, so the framing pads the route instead.
   */
  fixedMarkers(): { kind: TerrainMarkerKind; position: Vector3 }[];
  setExaggeration(exaggeration: number): void;
  setPalette(palette: RoutePalette): void;
  /**
   * Texture px per CSS px (default {@link TEXTURE_SCALE}); repaints the textures when it changes.
   * Only the textures' resolution changes: the sprites keep their size.
   */
  setTextureScale(scale: number): void;
  /** Viewport height in CSS px and the camera's vertical field of view: sets the sprites' size. */
  setViewport(heightPx: number, fovDeg: number): void;
  /** Moves the scrub marker `d` metres along the route; null hides it. No rebuild. */
  setScrub(d: number | null): void;
  /**
   * Fades the markers the terrain hides from `eye` (the camera position, local frame); true when
   * any opacity changed.
   */
  updateOcclusion(eye: Vector3): boolean;
  dispose(): void;
}

/** Start (and finish), summit and scrub markers for `track` on `heightfield`. */
export function createMarkerLayer(
  heightfield: Heightfield,
  track: RouteTrack & Pick<RunTrack, 'ele'>,
  { palette = APP_ROUTE_PALETTE, exaggeration = 1, lift = DEFAULT_LIFT_M }: MarkerLayerOptions = {},
): MarkerLayer {
  const indices = routeMarkerIndices(track, heightfield);
  const group = new Group();
  group.name = 'marker-layer';
  const markers = new Map<TerrainMarkerKind, MarkerSprite>();
  let currentExaggeration = exaggeration;
  let currentPalette = palette;
  let textureScale = TEXTURE_SCALE;
  const repaint = () => {
    for (const marker of markers.values()) {
      paintMarker(marker.canvas, marker.kind, currentPalette, textureScale);
      // A new size needs a new GPU texture: dispose, and the next draw uploads it afresh.
      marker.texture.dispose();
      marker.texture.needsUpdate = true;
    }
  };

  const place = (marker: MarkerSprite, lon: number, lat: number) => {
    marker.base.copy(heightfieldToLocal(heightfield, lon, lat, 1, lift));
    marker.sprite.position.set(marker.base.x, marker.base.y * currentExaggeration, marker.base.z);
  };
  const add = (kind: TerrainMarkerKind, index: number | null) => {
    const marker = createMarkerSprite(kind, palette);
    markers.set(kind, marker);
    group.add(marker.sprite);
    if (index !== null) place(marker, track.lon[index] ?? 0, track.lat[index] ?? 0);
    return marker;
  };
  add('start', indices.start);
  if (indices.finish !== null) add('finish', indices.finish);
  if (indices.summit !== null) add('summit', indices.summit);
  const scrub = add('scrub', null);
  scrub.sprite.visible = false;

  return {
    group,
    indices,
    sprite: (kind) => markers.get(kind)?.sprite ?? null,
    fixedMarkers: () =>
      [...markers.values()]
        .filter((marker) => marker.kind !== 'scrub')
        .map((marker) => ({ kind: marker.kind, position: marker.base.clone() })),
    setExaggeration(value) {
      currentExaggeration = value;
      for (const marker of markers.values()) marker.sprite.position.y = marker.base.y * value;
    },
    setPalette(next) {
      currentPalette = next;
      for (const marker of markers.values()) {
        paintMarker(marker.canvas, marker.kind, next, textureScale);
        marker.texture.needsUpdate = true;
      }
    },
    setTextureScale(scale) {
      const next = scale > 0 && Number.isFinite(scale) ? scale : TEXTURE_SCALE;
      if (next === textureScale) return;
      textureScale = next;
      repaint();
    },
    setViewport(heightPx, fovDeg) {
      // With sizeAttenuation off a sprite of scale s spans s · P11 in NDC, P11 = 1 / tan(fov / 2):
      // S pixels need s = 2 · S · tan(fov / 2) / height.
      const perPixel = (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
      for (const marker of markers.values()) {
        const size = markerBox(marker.kind) * perPixel;
        marker.sprite.scale.set(size, size, 1);
      }
    },
    setScrub(d) {
      if (d === null || !Number.isFinite(d) || track.cumulative.length === 0) {
        scrub.sprite.visible = false;
        return;
      }
      const point = pointAtDistance(track, d);
      place(scrub, point.lon, point.lat);
      scrub.sprite.visible = true;
    },
    updateOcclusion(eye) {
      let changed = false;
      for (const marker of markers.values()) {
        if (!marker.sprite.visible) continue;
        const hidden = isOccluded(heightfield, marker.sprite.position, eye, currentExaggeration);
        const opacity = hidden ? OCCLUDED_OPACITY : 1;
        if (marker.material.opacity !== opacity) {
          marker.material.opacity = opacity;
          changed = true;
        }
      }
      return changed;
    },
    dispose() {
      group.removeFromParent();
      for (const marker of markers.values()) {
        marker.material.dispose();
        marker.texture.dispose();
      }
      markers.clear();
    },
  };
}
