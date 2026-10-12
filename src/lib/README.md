# lib

Shared, pure maths with no React, DOM or three.js: geodesy (haversine, local metres), Web Mercator tile
maths, Terrarium decoding, units (km/mi, m/ft), number and time formatting.

Longitudes are continuous (`geo.ts`): a run across 180° is unwrapped into its narrowest
representation (`unwrapLongitudes`, `lonInterval`), so its bounds may run past ±180 and world / tile
x past [0, 1) / [0, 2^z). `wrapTile` folds a tile back before it is fetched; `normalizeLon` folds a
longitude back for display.

Everything here has unit tests; it is the easiest code in the repo to get exactly right.
