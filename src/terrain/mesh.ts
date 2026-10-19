/**
 * The terrain mesh: one BufferGeometry built from a {@link TerrainGrid} and a ShaderMaterial that
 * draws the style A look (DECISIONS.md "Terrain look"): a flat `--surface` fill, lightly shaded so
 * slopes read, with 1px ink ridge lines along every Nth row of the grid. Rows nearer the camera
 * are darker and slightly thicker. The depth buffer hides the rows behind each ridge, which gives
 * the stacked-profile look of the canvas illustration.
 *
 * Local frame: x east, y up, z south; the origin is the grid's centre at its lowest elevation.
 * One unit is the longer horizontal side of the grid, so the model is 1 unit across, and the
 * horizontal aspect and the vertical scale are true metres (before exaggeration).
 *
 * Exaggeration is a uniform (`uExaggeration`): the slider changes it without rebuilding. Colours
 * come from a {@link TerrainPalette}, never from the shader source, so other poster styles can
 * reuse the module.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Camera,
} from 'three';
import { gridElevation, type TerrainGrid } from './grid';

/** Colours of the terrain figure, as CSS colour strings. */
export interface TerrainPalette {
  /** Fill of the surface and its side walls. */
  readonly surface: string;
  /** Ridge lines and edges. */
  readonly ink: string;
  /**
   * How far the side walls' fill is blended from `surface` towards `ink` (0–1), so the walls read
   * as planes below the surface. Default {@link DEFAULT_WALL_SHADE}.
   */
  readonly wallShade?: number;
}

/** Style A's wall shade: a touch darker than the surface. */
export const DEFAULT_WALL_SHADE = 0.09;

/** Style A ("Trail Sign"): the CSS tokens the palette is read from, and their spec values. */
export const STYLE_A_TOKENS = { surface: '--surface', ink: '--ink' } as const;
export const STYLE_A_PALETTE: TerrainPalette = {
  surface: '#E6EAEE',
  ink: '#1B2A3A',
  wallShade: DEFAULT_WALL_SHADE,
};

/**
 * Reads a palette from CSS custom properties (the view passes its container's computed style);
 * a token that is missing or empty falls back to `fallback`.
 */
export function readPalette(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
  tokens: { readonly surface: string; readonly ink: string } = STYLE_A_TOKENS,
  fallback: TerrainPalette = STYLE_A_PALETTE,
): TerrainPalette {
  const read = (name: string, otherwise: string) =>
    style.getPropertyValue(name).trim() || otherwise;
  return {
    surface: read(tokens.surface, fallback.surface),
    ink: read(tokens.ink, fallback.ink),
    wallShade: fallback.wallShade ?? DEFAULT_WALL_SHADE,
  };
}

/** Ridge lines across the model's longer side, by default (DECISIONS.md asks for ~40–60). */
export const DEFAULT_ROW_LINES = 48;

export interface TerrainMeshOptions {
  palette?: TerrainPalette;
  /** Initial vertical exaggeration (`uExaggeration`). */
  exaggeration?: number;
  /** About this many ridge lines across the model's longer side; sets the row step N. */
  rowLines?: number;
  /** Side walls down to a flat base, so the model reads as a block. Default true. */
  skirt?: boolean;
  /** How far the base sits below the lowest point of the visible edges, in model units. */
  baseDepth?: number;
  /** Ridge line width in CSS pixels at mid depth. */
  lineWidth?: number;
  /** Device pixel ratio the lines are drawn for (line widths are in device pixels in the shader). */
  pixelRatio?: number;
}

/** The local frame of a grid: extents and the metres → model units scale. */
export interface ModelBounds {
  /** Model units per metre (horizontal and vertical). */
  readonly scale: number;
  /** East–west extent, model units. */
  readonly width: number;
  /** North–south extent, model units. */
  readonly depth: number;
  /** Top of the highest point at this exaggeration, model units above the origin. */
  readonly height: number;
  /** Centre of the box enclosing the surface (not the skirt). */
  readonly center: Vector3;
  /** Radius of the sphere around that box. */
  readonly radius: number;
}

/** Default depth of the base below the lowest visible edge point, model units (1.2% of the width). */
export const DEFAULT_BASE_DEPTH = 0.012;

/**
 * Lowest elevation along each of the grid's four edges, in model units above the grid's minimum at
 * exaggeration 1.
 */
export interface EdgeLevels {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

export function edgeLevels(grid: TerrainGrid): EdgeLevels {
  const { width: w, height: h, elevations, min } = grid;
  const scale = frame(grid).scale;
  const lowest = (count: number, index: (k: number) => number) => {
    let low = Infinity;
    for (let k = 0; k < count; k++) low = Math.min(low, elevations[index(k)] ?? min);
    return (low - min) * scale;
  };
  return {
    north: lowest(w, (i) => i),
    south: lowest(w, (i) => (h - 1) * w + i),
    west: lowest(h, (j) => j * w),
    east: lowest(h, (j) => j * w + w - 1),
  };
}

/** Lowest point of the whole edge (model units, exaggeration 1). */
export function edgeLevel(grid: TerrainGrid): number {
  const { north, south, east, west } = edgeLevels(grid);
  return Math.min(north, south, east, west);
}

/**
 * The edge level the skirt's flat base hangs from for a camera at azimuth `theta` (0 = south of
 * the model, positive = east): the lowest point of the edges whose walls face the camera (within
 * about 55° of it). The base sits a small depth below it, so the walls in front show the edge's
 * relief over a thin base instead of dropping to a low point on a hidden or side edge (or inside
 * the model). Where a more oblique wall's edge dips below the base, that wall's bottom follows its
 * edge down, one base depth below it (see the vertex shader), so no wall ever turns inside out. A
 * wall turning towards the camera lowers the level smoothly over ~16° of rotation, so orbiting
 * never makes the base jump.
 */
export function visibleEdgeLevel(levels: EdgeLevels, theta: number): number {
  const x = Math.sin(theta);
  const z = Math.cos(theta);
  const walls: [number, number][] = [
    [levels.south, z],
    [levels.north, -z],
    [levels.east, x],
    [levels.west, -x],
  ];
  const highest = Math.max(levels.north, levels.south, levels.east, levels.west);
  let level = highest;
  for (const [low, facing] of walls) {
    const t = Math.min(1, Math.max(0, (facing - 0.35) / 0.25));
    const exposure = t * t * (3 - 2 * t);
    level = Math.min(level, highest + (low - highest) * exposure);
  }
  return level;
}

/** Height of the skirt's flat base in the local frame at `exaggeration`. */
export function baseLevel(edge: number, exaggeration: number, baseDepth: number): number {
  return edge * exaggeration - baseDepth;
}

/** A point on the grid's edge in the local frame, at exaggeration 1. */
export interface EdgePoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

/**
 * Grid nodes on a regular subgrid of about `perSide` × `perSide` (edges and the highest node
 * included), in the local frame at exaggeration 1: a light stand-in for the surface when centring
 * the model on screen.
 */
export function surfaceSamples(grid: TerrainGrid, perSide = 48): EdgePoint[] {
  const { width: w, height: h, elevations, min } = grid;
  const { spanX, spanZ, scale } = frame(grid);
  const point = (i: number, j: number): EdgePoint => ({
    x: (i / (w - 1) - 0.5) * spanX * scale,
    z: (j / (h - 1) - 0.5) * spanZ * scale,
    y: ((elevations[j * w + i] ?? min) - min) * scale,
  });
  const steps = (n: number) => {
    const stride = Math.max(1, Math.floor((n - 1) / perSide));
    const at: number[] = [];
    for (let k = 0; k < n - 1; k += stride) at.push(k);
    at.push(n - 1);
    return at;
  };
  const points: EdgePoint[] = [];
  const columns = steps(w);
  for (const j of steps(h)) for (const i of columns) points.push(point(i, j));
  let top = 0;
  elevations.forEach((e, k) => {
    if (e > (elevations[top] ?? -Infinity)) top = k;
  });
  points.push(point(top % w, Math.floor(top / w)));
  return points;
}

/**
 * An envelope of the surface on a coarse lattice of about `perSide` × `perSide` nodes (the grid's
 * corners and edges included), in the local frame at exaggeration 1: each lattice node is raised to
 * the highest grid node in the lattice cells around it, so the envelope is never below the surface
 * and no peak between lattice nodes is missed. For fitting the camera to the model as it is seen
 * from one azimuth.
 */
export function surfaceEnvelope(grid: TerrainGrid, perSide = 24): EdgePoint[] {
  const { width: w, height: h, elevations, min } = grid;
  const { spanX, spanZ, scale } = frame(grid);
  const lattice = (n: number) => {
    const stride = Math.max(1, Math.ceil((n - 1) / perSide));
    const at: number[] = [];
    for (let k = 0; k < n - 1; k += stride) at.push(k);
    at.push(n - 1);
    return at;
  };
  const columns = lattice(w);
  const rows = lattice(h);
  const cols = columns.length;
  // Highest node of each lattice cell (its corners included).
  const cellTop = new Float64Array(Math.max(0, (cols - 1) * (rows.length - 1))).fill(min);
  for (let b = 0; b < rows.length - 1; b++) {
    for (let a = 0; a < cols - 1; a++) {
      let top = min;
      for (let j = rows[b] ?? 0; j <= (rows[b + 1] ?? 0); j++) {
        for (let i = columns[a] ?? 0; i <= (columns[a + 1] ?? 0); i++) {
          top = Math.max(top, elevations[j * w + i] ?? min);
        }
      }
      cellTop[b * (cols - 1) + a] = top;
    }
  }
  const points: EdgePoint[] = [];
  rows.forEach((j, b) => {
    columns.forEach((i, a) => {
      let top = elevations[j * w + i] ?? min;
      for (const [cb, ca] of [
        [b - 1, a - 1],
        [b - 1, a],
        [b, a - 1],
        [b, a],
      ] as const) {
        if (cb >= 0 && ca >= 0 && cb < rows.length - 1 && ca < cols - 1) {
          top = Math.max(top, cellTop[cb * (cols - 1) + ca] ?? min);
        }
      }
      points.push({
        x: (i / (w - 1) - 0.5) * spanX * scale,
        z: (j / (h - 1) - 0.5) * spanZ * scale,
        y: (top - min) * scale,
      });
    });
  });
  return points;
}

/**
 * About `count` points along the grid's edge (every corner included), for fitting the camera to
 * the bottom of the walls: a wall-bottom point sits at `min(base, y · exaggeration − baseDepth)`.
 */
export function edgePoints(grid: TerrainGrid, count = 256): EdgePoint[] {
  const { width: w, height: h, elevations, min } = grid;
  const { spanX, spanZ, scale } = frame(grid);
  const step = Math.max(1, Math.floor((2 * (w + h)) / count));
  const points: EdgePoint[] = [];
  const add = (i: number, j: number) => {
    points.push({
      x: (i / (w - 1) - 0.5) * spanX * scale,
      z: (j / (h - 1) - 0.5) * spanZ * scale,
      y: ((elevations[j * w + i] ?? min) - min) * scale,
    });
  };
  const along = (n: number, at: (k: number) => [number, number]) => {
    for (let k = 0; k < n - 1; k += step) add(...at(k));
  };
  along(w, (i) => [i, 0]);
  along(h, (j) => [w - 1, j]);
  along(w, (i) => [w - 1 - i, h - 1]);
  along(h, (j) => [0, h - 1 - j]);
  return points;
}

/** A point of a rotation-invariant outline: distance from the vertical axis and height. */
export interface RadialPoint {
  readonly rho: number;
  readonly y: number;
}

/**
 * The surface's outline seen from every azimuth at once: the upper convex hull of (distance from
 * the vertical axis, height) over all grid nodes, at exaggeration 1. Revolved around the axis it
 * encloses the surface at every azimuth (it is the convex hull of the surface's solid of
 * revolution), so a camera fitted to it frames the model however it is turned. Nodes are binned
 * by distance (`bins` bins, each bin's highest node counted at both edges of the bin, so the hull
 * still encloses every node), which keeps this linear in the grid size.
 */
export function radialHull(grid: TerrainGrid, bins = 96): RadialPoint[] {
  const { width: w, height: h, elevations, min } = grid;
  const { spanX, spanZ, scale } = frame(grid);
  const halfX = (spanX * scale) / 2;
  const halfZ = (spanZ * scale) / 2;
  const outer = Math.hypot(halfX, halfZ);
  const top = new Float64Array(bins).fill(-Infinity);
  for (let j = 0; j < h; j++) {
    const z = (j / (h - 1)) * 2 * halfZ - halfZ;
    for (let i = 0; i < w; i++) {
      const x = (i / (w - 1)) * 2 * halfX - halfX;
      const bin = Math.min(bins - 1, Math.floor((Math.hypot(x, z) / outer) * bins));
      const y = ((elevations[j * w + i] ?? min) - min) * scale;
      if (y > (top[bin] ?? -Infinity)) top[bin] = y;
    }
  }
  const points: RadialPoint[] = [];
  // Each bin's highest node at both edges of the bin: the segment between them covers every node
  // in the bin, wherever it lies.
  top.forEach((y, bin) => {
    if (y === -Infinity) return;
    points.push({ rho: (bin / bins) * outer, y }, { rho: ((bin + 1) / bins) * outer, y });
  });
  // Monotone chain, upper hull (points are sorted by rho).
  const hull: RadialPoint[] = [];
  const cross = (o: RadialPoint, a: RadialPoint, b: RadialPoint) =>
    (a.rho - o.rho) * (b.y - o.y) - (a.y - o.y) * (b.rho - o.rho);
  for (const point of points) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      if (a && b && cross(a, b, point) >= 0) hull.pop();
      else break;
    }
    hull.push(point);
  }
  return hull;
}

/** Extents of the model built from `grid` at `exaggeration`. */
export function modelBounds(grid: TerrainGrid, exaggeration = 1): ModelBounds {
  const { spanX, spanZ, scale } = frame(grid);
  const width = spanX * scale;
  const depth = spanZ * scale;
  const height = (grid.max - grid.min) * scale * exaggeration;
  return {
    scale,
    width,
    depth,
    height,
    center: new Vector3(0, height / 2, 0),
    radius: Math.hypot(width, depth, height) / 2,
  };
}

/** Ground spans of the grid in metres and the scale that makes the longer one 1 unit. */
function frame(grid: TerrainGrid) {
  const { width, height, metresPerSample } = grid;
  const spanX = Math.max((width - 1) * metresPerSample.x, Number.EPSILON);
  const spanZ = Math.max((height - 1) * metresPerSample.y, Number.EPSILON);
  return { spanX, spanZ, scale: 1 / Math.max(spanX, spanZ) };
}

/**
 * A grid position (fractional column and row) on the terrain in the mesh's local frame, at
 * `exaggeration`, raised `liftMetres` (true metres, also exaggerated) above the surface. Matches
 * the mesh exactly at grid nodes and bilinearly between them. Positions outside the grid
 * extrapolate horizontally and take the edge elevation.
 */
export function gridToLocal(
  grid: TerrainGrid,
  col: number,
  row: number,
  exaggeration = 1,
  liftMetres = 0,
): Vector3 {
  const { spanX, spanZ, scale } = frame(grid);
  const elevation = gridElevation(grid, col, row);
  return new Vector3(
    (col / (grid.width - 1) - 0.5) * spanX * scale,
    (elevation - grid.min + liftMetres) * scale * exaggeration,
    (row / (grid.height - 1) - 0.5) * spanZ * scale,
  );
}

/**
 * Vertex kinds, in the `aWall` attribute. The shader draws ridge rows on the surface only; every
 * wall gets the same plain shade with its top and bottom edges outlined.
 */
const SURFACE = 0;
const SIDE_WALL = 1; // east and west walls
const END_WALL = 2; // north and south walls

const vertexShader = /* glsl */ `
uniform float uExaggeration;
uniform float uBaseDepth;
uniform float uEdgeLevel;
attribute float aRow;
attribute float aBase;
attribute float aWall;
varying vec3 vViewPosition;
varying float vRow;
varying float vBase;
varying float vWall;

void main() {
  vec3 p = position;
  // Surface and wall-top vertices scale with the exaggeration. Wall-bottom vertices (which carry
  // their edge's height too) sit on the flat base, a fixed depth below the lowest point of the
  // edges facing the camera, or one base depth below their own edge where it dips lower.
  float top = position.y * uExaggeration;
  p.y = mix(top, min(uEdgeLevel * uExaggeration - uBaseDepth, top - uBaseDepth), aBase);
  vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
  vViewPosition = viewPosition.xyz;
  vRow = aRow;
  vBase = aBase;
  vWall = aWall;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSurface;
uniform vec3 uInk;
uniform float uRowStep;
uniform float uFrontRow;
uniform float uLineWidth;
uniform float uPixelRatio;
uniform vec2 uDepthRange;
uniform vec3 uLightDirection;
uniform float uShade;
uniform float uWallShade;
uniform float uWallLine;
varying vec3 vViewPosition;
varying float vRow;
varying float vBase;
varying float vWall;

// Coverage of a line centred on every integer value of coord, widthPx device pixels wide, with
// a one-pixel anti-aliased edge. Lines that crowd closer than crowdPx device pixels fade out
// instead of merging into a dark smear.
float gridLine(float coord, float widthPx, float crowdPx) {
  float perPixel = max(fwidth(coord), 1e-6);
  float distancePx = abs(fract(coord + 0.5) - 0.5) / perPixel;
  float coverage = 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, distancePx);
  return coverage * smoothstep(crowdPx * 0.45, crowdPx, 1.0 / perPixel);
}

// Coverage of a line where value crosses edge (one side only), widthPx device pixels wide.
float edgeLine(float value, float edge, float widthPx) {
  float distancePx = abs(value - edge) / max(fwidth(value), 1e-6);
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, distancePx);
}

void main() {
  // Flat shading: the face normal from screen-space derivatives, lit from the upper left.
  vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  float light = max(dot(normal, normalize(uLightDirection)), 0.0);
  vec3 fill = uSurface * (1.0 - uShade * (1.0 - light));

  // 0 at the nearest point of the model, 1 at the farthest.
  float depth = clamp((-vViewPosition.z - uDepthRange.x) / max(uDepthRange.y - uDepthRange.x, 1e-6), 0.0, 1.0);
  // Row lines count from the front (south) edge, so the front edge always carries one.
  float rowCoord = (uFrontRow - vRow) / uRowStep;
  float line;
  float strength;
  vec3 ink = pow(uInk, vec3(1.0 / 2.2));
  vec3 base = pow(fill, vec3(1.0 / 2.2));
  if (vWall < 0.5) {
    // Top surface: lines darker and thicker towards the camera, fading where they crowd.
    float widthPx = uLineWidth * uPixelRatio * mix(1.15, 0.8, depth);
    strength = mix(0.95, 0.3, depth);
    line = gridLine(rowCoord, widthPx, 4.5 * uPixelRatio);
  } else {
    // Walls: a touch darker than the surface so they read as planes, outlined along their top
    // (the surface's edge) and bottom at one constant, light strength. The ridge rows stay on the
    // top surface: carried down a side wall, their ends hatch it with vertical lines.
    base = mix(base, ink, uWallShade);
    float widthPx = uLineWidth * uPixelRatio;
    strength = uWallLine;
    line = max(edgeLine(vBase, 0.0, widthPx), edgeLine(vBase, 1.0, widthPx));
  }
  // Blend the line in gamma space, as browsers blend SVG strokes: a linear blend makes partly
  // covered and faded lines look far lighter than the ink.
  vec3 encoded = mix(base, ink, line * strength);
  gl_FragColor = vec4(pow(encoded, vec3(2.2)), 1.0);
  // Colours are linear (three.js colour management); encode for the output colour space (sRGB).
  #include <colorspace_fragment>
}
`;

export interface TerrainUniforms {
  [name: string]: { value: unknown };
  uExaggeration: { value: number };
  uBaseDepth: { value: number };
  uSurface: { value: Color };
  uInk: { value: Color };
  uRowStep: { value: number };
  uFrontRow: { value: number };
  uLineWidth: { value: number };
  uPixelRatio: { value: number };
  uDepthRange: { value: Vector2 };
  uLightDirection: { value: Vector3 };
  uShade: { value: number };
  uEdgeLevel: { value: number };
  uWallShade: { value: number };
  uWallLine: { value: number };
}

export type TerrainMaterial = ShaderMaterial & { uniforms: TerrainUniforms };
export type TerrainMesh = Mesh<BufferGeometry, TerrainMaterial>;

/** Row step N so that about `lines` ridge lines span the grid's longer side. */
export function rowStepFor(grid: TerrainGrid, lines = DEFAULT_ROW_LINES): number {
  const longest = Math.max(grid.width, grid.height) - 1;
  return Math.max(1, Math.round(longest / Math.max(1, lines)));
}

/** The style A material; exported for tests and for figures that share uniforms. */
export function createTerrainMaterial(
  grid: TerrainGrid,
  {
    palette = STYLE_A_PALETTE,
    exaggeration = 1,
    rowLines = DEFAULT_ROW_LINES,
    baseDepth = DEFAULT_BASE_DEPTH,
    lineWidth = 1,
    pixelRatio = 1,
  }: TerrainMeshOptions = {},
): TerrainMaterial {
  const uniforms: TerrainUniforms = {
    uExaggeration: { value: exaggeration },
    uBaseDepth: { value: baseDepth },
    uSurface: { value: new Color(palette.surface) },
    uInk: { value: new Color(palette.ink) },
    uRowStep: { value: rowStepFor(grid, rowLines) },
    uFrontRow: { value: grid.height - 1 },
    uLineWidth: { value: lineWidth },
    uPixelRatio: { value: pixelRatio },
    uDepthRange: { value: new Vector2(0, 1) },
    // View space: mostly from the viewer, a little from the upper left, so faces towards the
    // camera keep the flat --surface fill and only slopes turned away darken.
    uLightDirection: { value: new Vector3(-0.3, 0.35, 0.89).normalize() },
    uShade: { value: 0.14 },
    uEdgeLevel: { value: visibleEdgeLevel(edgeLevels(grid), 0) },
    uWallShade: { value: palette.wallShade ?? DEFAULT_WALL_SHADE },
    uWallLine: { value: 0.6 },
  };
  return new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  }) as TerrainMaterial;
}

/** Positions (y at exaggeration 1), row index, base flag and wall kind for the grid and skirt. */
function buildGeometry(grid: TerrainGrid, skirt: boolean): BufferGeometry {
  const { width: w, height: h, elevations, min } = grid;
  const { spanX, spanZ, scale } = frame(grid);
  const xAt = (i: number) => (i / (w - 1) - 0.5) * spanX * scale;
  const zAt = (j: number) => (j / (h - 1) - 0.5) * spanZ * scale;
  const yAt = (i: number, j: number) => ((elevations[j * w + i] ?? min) - min) * scale;

  // Skirt: each edge vertex once at the top and once at the base, per wall (corners repeat so
  // each wall keeps its own kind).
  const edgeCount = skirt ? 2 * (w + h) : 0;
  const vertexCount = w * h + edgeCount * 2;
  const positions = new Float32Array(vertexCount * 3);
  const rows = new Float32Array(vertexCount);
  const bases = new Float32Array(vertexCount);
  const walls = new Float32Array(vertexCount);
  const triangleCount = (w - 1) * (h - 1) * 2 + (skirt ? 2 * ((w - 1) * 2 + (h - 1) * 2) : 0);
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(triangleCount * 3);

  let v = 0;
  const addVertex = (i: number, j: number, base: number, wall: number) => {
    positions[v * 3] = xAt(i);
    positions[v * 3 + 1] = yAt(i, j);
    positions[v * 3 + 2] = zAt(j);
    rows[v] = j;
    bases[v] = base;
    walls[v] = wall;
    return v++;
  };
  let t = 0;
  const addQuad = (a: number, b: number, c: number, d: number) => {
    // a b / d c, counter-clockwise seen from the side the quad faces.
    indices.set([a, d, b, b, d, c], t);
    t += 6;
  };

  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) addVertex(i, j, 0, SURFACE);
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      // Row j is north of row j + 1; seen from above (+y), north-west → north-east → south-east.
      addQuad(a, a + 1, a + 1 + w, a + w);
    }
  }

  if (skirt) {
    // Walls are drawn double-sided-free: winding faces outwards.
    const wall = (points: [number, number][], kind: number, outwardFlip: boolean) => {
      const start = v;
      for (const [i, j] of points) {
        addVertex(i, j, 0, kind);
        addVertex(i, j, 1, kind);
      }
      for (let k = 0; k < points.length - 1; k++) {
        const top0 = start + k * 2;
        const top1 = top0 + 2;
        if (outwardFlip) addQuad(top1, top0, top0 + 1, top1 + 1);
        else addQuad(top0, top1, top1 + 1, top0 + 1);
      }
    };
    const south = Array.from({ length: w }, (_, i): [number, number] => [i, h - 1]);
    const north = Array.from({ length: w }, (_, i): [number, number] => [i, 0]);
    const east = Array.from({ length: h }, (_, j): [number, number] => [w - 1, j]);
    const west = Array.from({ length: h }, (_, j): [number, number] => [0, j]);
    wall(south, END_WALL, false);
    wall(north, END_WALL, true);
    wall(east, SIDE_WALL, true);
    wall(west, SIDE_WALL, false);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aRow', new BufferAttribute(rows, 1));
  geometry.setAttribute('aBase', new BufferAttribute(bases, 1));
  geometry.setAttribute('aWall', new BufferAttribute(walls, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * The terrain mesh for `grid`: `width × height` surface vertices in the local frame (plus
 * the skirt), drawn with {@link createTerrainMaterial}. The vertex shader applies the exaggeration,
 * so the geometry's bounding volume is at exaggeration 1; the mesh opts out of frustum culling.
 */
export function createTerrainMesh(
  grid: TerrainGrid,
  options: TerrainMeshOptions = {},
): TerrainMesh {
  if (grid.width < 2 || grid.height < 2) {
    throw new RangeError('A terrain mesh needs at least 2 × 2 samples');
  }
  const geometry = buildGeometry(grid, options.skirt ?? true);
  const mesh = new Mesh(geometry, createTerrainMaterial(grid, options));
  mesh.frustumCulled = false;
  mesh.name = 'terrain';
  return mesh;
}

/** Sets the vertical exaggeration without rebuilding. */
export function setExaggeration(mesh: TerrainMesh, exaggeration: number): void {
  mesh.material.uniforms.uExaggeration.value = exaggeration;
}

/** Sets the edge level the skirt's base hangs from (see {@link visibleEdgeLevel}). */
export function setEdgeLevel(mesh: TerrainMesh, level: number): void {
  mesh.material.uniforms.uEdgeLevel.value = level;
}

/** Swaps the palette (another poster style, or tokens read after a theme change). */
export function setPalette(mesh: TerrainMesh, palette: TerrainPalette): void {
  mesh.material.uniforms.uSurface.value.set(palette.surface);
  mesh.material.uniforms.uInk.value.set(palette.ink);
  mesh.material.uniforms.uWallShade.value = palette.wallShade ?? DEFAULT_WALL_SHADE;
}

/**
 * Updates the depth range the line fade uses: the nearest and farthest distance of the model's
 * bounding sphere (`center`, `radius`) from `camera`. Call before each render.
 */
export function updateDepthRange(
  mesh: TerrainMesh,
  camera: Camera,
  center: Vector3,
  radius: number,
): void {
  const distance = camera.position.distanceTo(center);
  mesh.material.uniforms.uDepthRange.value.set(Math.max(0, distance - radius), distance + radius);
}

/** Frees the mesh's GPU resources. */
export function disposeTerrainMesh(mesh: TerrainMesh): void {
  mesh.geometry.dispose();
  mesh.material.dispose();
}
