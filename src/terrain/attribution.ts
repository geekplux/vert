/**
 * Credit for the elevation data every terrain is drawn from (AWS Terrain Tiles, built by Mapzen
 * from many sources). The About dialog shows it; the library exports it so a host page that shows
 * a scene can credit the same source in the same words.
 */

/** The credit as plain text, exactly as the About dialog shows it. */
export const TERRAIN_ATTRIBUTION = 'AWS Terrain Tiles / Mapzen (various sources)';

/**
 * The credit with a link, for a host that links its credits: Mapzen's list of the sources behind
 * the tiles (the "various sources"), which the tiles' terms ask users to credit.
 */
export const TERRAIN_ATTRIBUTION_LINK = {
  text: TERRAIN_ATTRIBUTION,
  href: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
} as const;
