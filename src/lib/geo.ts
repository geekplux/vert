/**
 * Geodesy and Web Mercator tile maths.
 *
 * Coordinates are WGS 84 degrees. Distances use a spherical Earth: for a run-sized track the
 * difference from the ellipsoid (up to ~0.5%) is far below GPS noise, and every consumer in Vert
 * compares distances along the same track, so the bias cancels.
 *
 * Antimeridian: Vert assumes a single run never crosses ±180° longitude. Bounds are a plain
 * min/max over longitudes; a track that did cross would get a bbox spanning the whole globe.
 */

/** A WGS 84 position in degrees. */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** A lon/lat bounding box in degrees; `west <= east` (see the antimeridian note above). */
export interface Bounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** A 2D point; for tiles and world coordinates `y` grows southward, as in slippy maps. */
export interface XY {
  readonly x: number;
  readonly y: number;
}

/** A slippy-map tile address. */
export interface TileCoord {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** Mean Earth radius (IUGG R1), metres. Used for great-circle distances. */
export const EARTH_RADIUS_M = 6371008.8;

/** WGS 84 equatorial radius, metres: the sphere Web Mercator (EPSG:3857) is defined on. */
export const MERCATOR_RADIUS_M = 6378137;

/** Web Mercator's latitude limit, degrees: the latitude that makes the world square. */
export const MAX_MERCATOR_LAT = 85.0511287798066;

/** Highest zoom of the AWS Terrain Tiles (Terrarium) set. */
export const TERRARIUM_MAX_ZOOM = 15;

const DEG = Math.PI / 180;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Great-circle distance between two positions, in metres (haversine on a sphere of radius
 * {@link EARTH_RADIUS_M}).
 */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  // min() guards against h creeping past 1 through rounding for antipodal points.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Running distance along a track: element `i` is the distance in metres from the first point to
 * point `i`, so element 0 is 0 and the last element is the track length.
 */
export function cumulativeDistances(points: readonly LatLon[]): Float64Array {
  const out = new Float64Array(points.length);
  let total = 0;
  let previous: LatLon | undefined;
  points.forEach((point, i) => {
    if (previous) total += haversine(previous, point);
    out[i] = total;
    previous = point;
  });
  return out;
}

/**
 * Web Mercator world coordinates in [0, 1): x grows east from −180°, y grows south from the
 * northern Mercator limit. Latitudes beyond ±{@link MAX_MERCATOR_LAT} are clamped.
 */
export function lonLatToWorld(lon: number, lat: number): XY {
  const phi = clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT) * DEG;
  return {
    x: (lon + 180) / 360,
    y: (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2,
  };
}

/** Inverse of {@link lonLatToWorld}: world coordinates back to degrees. */
export function worldToLonLat(x: number, y: number): LatLon {
  return {
    lon: x * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / DEG,
  };
}

/**
 * Fractional tile coordinates at zoom `z`: the integer part is the tile address, the fraction is
 * the position inside that tile.
 */
export function lonLatToTile(lon: number, lat: number, z: number): XY {
  const n = 2 ** z;
  const world = lonLatToWorld(lon, lat);
  return { x: world.x * n, y: world.y * n };
}

/** The lon/lat box covered by tile `x`, `y` at zoom `z`. */
export function tileBounds(x: number, y: number, z: number): Bounds {
  const n = 2 ** z;
  const northWest = worldToLonLat(x / n, y / n);
  const southEast = worldToLonLat((x + 1) / n, (y + 1) / n);
  return { west: northWest.lon, south: southEast.lat, east: southEast.lon, north: northWest.lat };
}

/**
 * Ground distance covered by one pixel of a Web Mercator tile at latitude `lat` and zoom `z`, in
 * metres (156,543.03 m at the equator at z0 for 256 px tiles).
 */
export function metresPerPixel(lat: number, z: number, tileSize = 256): number {
  return (Math.cos(lat * DEG) * 2 * Math.PI * MERCATOR_RADIUS_M) / (tileSize * 2 ** z);
}

/**
 * Slack, in tile units, for deciding that a bbox edge sits on a tile boundary. A lon/lat → tile
 * round trip drifts by up to ~2.4e-11 tile at z15 (y = 6533.000000000001), which would otherwise
 * pull in a whole extra row or column of tiles; 1e-9 tile is under a micrometre on the ground.
 */
const TILE_EDGE_EPSILON = 1e-9;

/** Inclusive tile index ranges covering a bbox at zoom `z`, clamped to the valid tile range. */
function tileRange(bbox: Bounds, z: number) {
  const n = 2 ** z;
  const topLeft = lonLatToTile(bbox.west, bbox.north, z);
  const bottomRight = lonLatToTile(bbox.east, bbox.south, z);
  const index = (v: number) => clamp(Math.floor(v), 0, n - 1);
  // An edge that lies on a tile boundary (within float noise) does not pull in the next tile.
  const minX = index(topLeft.x + TILE_EDGE_EPSILON);
  const minY = index(topLeft.y + TILE_EDGE_EPSILON);
  const maxX = Math.max(minX, index(Math.ceil(bottomRight.x - TILE_EDGE_EPSILON) - 1));
  const maxY = Math.max(minY, index(Math.ceil(bottomRight.y - TILE_EDGE_EPSILON) - 1));
  return { minX, minY, maxX, maxY };
}

/** Number of tiles {@link tilesForBounds} would return, without building the list. */
export function tileCount(bbox: Bounds, z: number): number {
  const { minX, minY, maxX, maxY } = tileRange(bbox, z);
  return (maxX - minX + 1) * (maxY - minY + 1);
}

/**
 * Tiles covering a bbox at zoom `z`, row by row from the north-west corner. Always at least one
 * tile; indices are clamped to the valid range, so a box past the Mercator limits is safe.
 */
export function tilesForBounds(bbox: Bounds, z: number): TileCoord[] {
  const { minX, minY, maxX, maxY } = tileRange(bbox, z);
  const tiles: TileCoord[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) tiles.push({ z, x, y });
  }
  return tiles;
}

/**
 * The highest zoom, at most {@link TERRARIUM_MAX_ZOOM}, whose covering of `bbox` needs no more
 * than `maxTiles` tiles. Falls back to 0 (a single tile covers the world) when even that is too
 * many, i.e. when `maxTiles < 1`.
 */
export function chooseZoom(bbox: Bounds, maxTiles: number): number {
  for (let z = TERRARIUM_MAX_ZOOM; z > 0; z--) {
    if (tileCount(bbox, z) <= maxTiles) return z;
  }
  return 0;
}

/**
 * The bbox of a set of positions, grown on each side by `paddingFraction` of its width and height
 * (0.1 adds 10% of the span to every edge). Latitudes are clamped to ±90 and longitudes to ±180
 * after padding. Assumes the points do not cross the antimeridian.
 *
 * @throws RangeError when `points` is empty.
 */
export function boundsOf(points: readonly LatLon[], paddingFraction = 0): Bounds {
  if (points.length === 0) throw new RangeError('boundsOf needs at least one point');
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { lat, lon } of points) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  const padX = (east - west) * paddingFraction;
  const padY = (north - south) * paddingFraction;
  return {
    west: clamp(west - padX, -180, 180),
    south: clamp(south - padY, -90, 90),
    east: clamp(east + padX, -180, 180),
    north: clamp(north + padY, -90, 90),
  };
}

/**
 * Position of `point` relative to `origin` in metres, x east and y north, by an equirectangular
 * projection with its standard parallel at the origin's latitude.
 *
 * North–south offsets are exact on the sphere. East–west offsets are scaled by cos(origin.lat)
 * instead of cos(point.lat), a relative error of about |tan(origin.lat) · Δlat| (Δlat in
 * radians): for a point 10 km north or south of the origin, under 0.16% at 45° and 0.27% at 60°,
 * i.e. tens of metres at the edge of a run-sized area and far smaller near the origin. Not for
 * areas hundreds of kilometres wide or near the poles.
 */
export function localMetres(origin: LatLon, point: LatLon): XY {
  return {
    x: (point.lon - origin.lon) * DEG * Math.cos(origin.lat * DEG) * EARTH_RADIUS_M,
    y: (point.lat - origin.lat) * DEG * EARTH_RADIUS_M,
  };
}
