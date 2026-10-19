# The Vert scene format, version 1

A `.scene` file holds what a page needs to draw one run in 3D: a height grid of the ground around
it, the drawn stretch of the route, its markers and climbs, and a few totals. It holds **no
georeference**: no latitude or longitude, no bounding box, no map-tile numbers, no timestamps, no
names. Positions are metres in the grid's own frame.

The file exists so a host site (first of all [Activities](https://activities.geekplux.org), which
publishes no coordinates anywhere) can show Vert's terrain view without its build or its pages ever
seeing a coordinate. Everything georeferenced happens offline in `pnpm bake`; the browser only
decodes the scene.

This document is the format's specification: a decoder can be written from it alone. The reference
implementation is `src/scene/`, with two entries: `src/scene/index.ts` for a host page
(`decodeScene`, the types, `SceneError`, the format's constants; no three.js, no terrain or tile
code) and `src/scene/bake.ts` for the offline bake (`buildScene`, `encodeScene`, `buildSidecar`,
the privacy and pitch checks).

Contents: [Conventions](#conventions) · [File layout](#file-layout) · [Streams](#streams) ·
[Sections](#sections) · [Rules a valid file follows](#rules-a-valid-file-follows) ·
[Decoding](#decoding) · [Versioning](#versioning-and-compatibility) · [Sidecar](#sidecar) ·
[Forbidden content](#forbidden-content) · [How the builder fills it](#how-the-builder-fills-it) ·
[Baking a scene](#baking-a-scene) · [Sizes](#sizes)

## Conventions

- **Byte order**: every multi-byte integer is little-endian. Types: `u8`, `u16`, `u32` unsigned,
  `i32` two's-complement signed.
- **Integers only.** Every value is stored as an integer count of its _step_ (a metre value of
  412.3 with a 0.1 m step is stored as 4123). The steps are fixed by the format, except the grid's
  elevation step and spacing, which the file carries.
- **Grid-local frame.** Metres from the grid's north-west corner (its first sample): x east, y
  south. Grid sample (i, j), column i and row j, sits at (i × spacingX, j × spacingY). The samples
  are evenly spaced; the spacing is the ground distance between neighbours at the grid's centre.
- **Distances** along the route are metres from the run's **real start**, before any trim: the
  drawn route of a run whose first and last 200 m are hidden starts at 200 m.
- **Times** are seconds since the run's first recorded point, never a clock time or date.
- **KB** in this document is 1,000 bytes.

## File layout

```
offset  size  field
0       4     magic: ASCII "VSCN" (56 53 43 4E)
4       2     u16 version: 1
6       2     u16 reserved: 0
8       4     u32 byteLength: length of the whole file, header included
12      ...   sections, back to back, until byteLength
```

Each section:

```
offset  size    field
0       4       tag: four printable ASCII bytes (0x21–0x7E each)
4       4       u32 length of the payload, bytes
8       length  payload
```

A reader rejects a tag with any other byte (reason `corrupt`).

Version 1 defines five sections: `GRID`, `ROUT`, `MARK`, `CLMB`, `SUMM`. Each must appear exactly
once. A writer emits them in that order; a reader accepts any order. Sections with other tags may
follow (see [Versioning](#versioning-and-compatibility)).

## Streams

Long integer arrays (the grid's samples and the route's coordinates) are stored as **streams**: a
sequence of signed integers ("residuals", see each section for what they are relative to), coded
as follows.

1. Each residual r is mapped to an unsigned u by **zigzag**: u = 2r for r ≥ 0, u = −2r − 1 for
   r < 0 (0, −1, 1, −2, 2 … become 0, 1, 2, 3, 4 …). A residual's magnitude is at most 2³⁰ − 1,
   so u ≤ 2³¹ − 2 (the zigzag of 2³⁰ − 1).
2. The values are cut into **blocks of 64** (the last block may be shorter). Each block starts
   with its **Rice parameter** k as 5 bits (valid range 0–24).
3. Each value of the block follows: q = ⌊u / 2^k⌋.
   - If q < 24: q one-bits, a zero-bit, then the low k bits of u (u mod 2^k), most significant
     first.
   - Otherwise (**escape**): 24 one-bits, then u as 32 bits, most significant first. No zero-bit
     follows the run.
4. Bits are packed **most significant bit first** within each byte. A stream starts on a byte
   boundary; after its last value it is padded with zero-bits to the next byte boundary.

A stream has no length field: the reader knows how many values it holds from the section's
fields, and it ends where the last value's padding ends. Several streams in one section follow each
other directly.

A reader rejects a k over 24 (reason `corrupt`), an escaped u over 2³¹ − 2 (reason `range`), and
padding that is not zero (`corrupt`). A unary run
never exceeds 24 bits, so a reader never loops on corrupt data.

The writer picks, per block, the k that makes the block shortest (the smallest such k on a tie),
and uses an escape only when q ≥ 24. Any k is valid for a reader; this rule only makes the output
deterministic.

## Sections

### `GRID`: the height grid

```
offset  size  field              unit / meaning                       valid range
0       2     u16 width          samples per row (west → east)        2–1024
2       2     u16 height         rows (north → south)                 2–1024
4       1     u8 zoom            tile zoom the grid was sampled from  0–24
5       1     u8 reserved        0
6       2     u16 elevationStep  millimetres                          10–65535
8       4     u32 spacingX       centimetres between columns          1–10,000,000
12      4     u32 spacingY       centimetres between rows             1–10,000,000
16      4     i32 offset         elevation of level 0, in steps       see below
20      ...   stream             width × height residuals
```

The grid holds width × height **levels**, row-major from the north-west corner (row 0 is the
north edge, column 0 the west edge). Sample (i, j)'s elevation in metres is

```
elevation(i, j) = (offset + level(i, j)) × elevationStep / 1000
```

Every level is in 0–65535, and every elevation lies within half a step of −12,000 … 9,000 m (what
rounding a value in that range to the step gives). In exact integer arithmetic, with the step in
millimetres: 2 × offset × step ≥ −24,000,000 − step and 2 × (offset + level) × step ≤ 18,000,000 +
step.

The stream holds, for each sample in row-major order, its level minus a **prediction** from the
samples already decoded (W = west neighbour, N = north neighbour, NW = north-west neighbour):

| sample                       | prediction |
| ---------------------------- | ---------- |
| (0, 0)                       | 0          |
| (i, 0), i > 0 (first row)    | W          |
| (0, j), j > 0 (first column) | N          |
| every other sample           | W + N − NW |

So level(i, j) = residual + prediction. A reader checks each level against 0–65535 as it rebuilds
it.

The stream must end exactly at the end of the section.

### `ROUT`: the drawn route

```
offset  size  field             unit / meaning                                  valid range
0       4     u32 count         points                                          2–100,000
4       1     u8 flags          bit 0: the route has times; other bits 0
5       3     reserved          0, 0, 0
8       4     u32 start         distance of the first point, centimetres        0–4,000,000,000
12      4     u32 end           distance of the last point, centimetres         start–4,000,000,000
16      ...   stream x          count residuals, ½ m units
        ...   stream y          count residuals, ½ m units
        ...   stream elevation  count residuals, decimetres
        ...   stream time       count residuals, tenths of a second (only when flags bit 0 is set)
```

Each stream holds first differences: value(k) = value(k − 1) + residual(k), with value(−1) = 0 (so
the first residual is the first value). Decoded, point k of the route has

```
x(k)         = xValue(k) / 2           metres east of the grid's west edge
y(k)         = yValue(k) / 2           metres south of the grid's north edge
elevation(k) = elevationValue(k) / 10  metres
time(k)      = timeValue(k) / 10       seconds since the run's first point
distance(k)  = (start + (end − start) × k / (count − 1)) / 100   metres from the run's real start
```

`distance(k)` is computed in IEEE-754 double precision in exactly this order, so every reader
gets the same bits: a = end − start (exact), b = a × k (exact, below 2⁵³), c = b / (count − 1)
(rounded), d = start + c (rounded), distance = d / 100 (rounded).

The points are **evenly spaced** along the route: distance is not stored per point. Times may be
of either sign and at most 100,000,000 s in magnitude (a writer only emits times ≥ 0 for a
well-ordered recording). Every position lies on the grid, give or take one sample:
−spacingX ≤ x ≤ width × spacingX, and the same for y (spacing in metres). Every elevation is in
−12,000 to 9,000 m.

The streams must end exactly at the end of the section.

### `MARK`: markers

```
offset  size  field
0       1     u8 count                                                         1–3
1       17×n  records:
              u8  kind        0 start ○, 1 finish ◉, 2 summit ▲
              u32 distance    centimetres from the run's real start           start–end of ROUT
              i32 x           ½ m units, grid-local                           on the grid (as ROUT)
              i32 y           ½ m units, grid-local                           on the grid (as ROUT)
              i32 elevation   decimetres                                      −12,000–9,000 m
```

The section is exactly 1 + 17 × count bytes. Records are in increasing kind order, each kind at
most once, and a start record is always present. The start's distance equals ROUT `start`; a
finish's equals ROUT `end`.

Which markers exist follows the Vert app's rules on the **drawn** route: start at its first point;
finish at its last point unless the drawn route ends within 50 m (straight line) of its start, in
which case the start marker stands for both (a loop); summit at its highest point, only when that
stands at least 10 m above its lowest.

### `CLMB`: climbs on the drawn route

```
offset  size  field
0       1     u8 count                                                         0–255
1       15×n  records:
              u32 start      centimetres from the run's real start            start–end of ROUT
              u32 end        centimetres                                      start + 1–end of ROUT
              u32 gain       decimetres gained                                0–10,000,000
              u16 avgGrade   gain / (end − start), units of 0.0001            0–65535
              u8  flags      bit 0: the steepest climb; other bits 0
```

The section is exactly 1 + 15 × count bytes. Records are in route order (start non-decreasing); at
most one has the steepest flag. Climbs lie wholly on the drawn route: a climb of the whole run that
the trim cut into is clipped to the drawn route.

### `SUMM`: totals

```
offset  size  field
0       4     u32 distance  whole run, centimetres          ≥ ROUT end, ≤ 4,000,000,000
4       4     u32 climb     whole run's ascent, decimetres  0–10,000,000, or FFFFFFFF = unknown
```

The section is exactly 8 bytes. These two describe the **whole** run (the host already publishes
them); everything else in the file covers only the drawn stretch.

## Rules a valid file follows

A decoder rejects a file (in the reference implementation, `SceneError` with a `reason`) when:

| reason      | when                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `magic`     | it does not start with `VSCN`                                                                                                    |
| `version`   | the version is not 1                                                                                                             |
| `truncated` | it is shorter than `byteLength`, or a section, field or stream runs past its end                                                 |
| `length`    | it is longer than `byteLength`; a known section is missing, repeated, or longer than its fields                                  |
| `range`     | any value is outside the range given above, an escaped stream value included                                                     |
| `corrupt`   | a reserved field, flag bit or padding bit is not zero; k > 24; a tag is not printable ASCII; markers or climbs break their rules |

Reading untrusted bytes safely needs nothing beyond these checks, applied before use: sizes are
capped (1024 × 1024 samples, 100,000 route points, 255 climbs) before anything is allocated, and a
stream must hold at least one bit per value it claims before it is read.

## Decoding

From the stored integers a reader derives:

- grid elevations (`GRID`), their minimum and maximum, the spacing in metres (centimetres / 100)
  and the elevation step in metres (millimetres / 1000);
- the route's points (`ROUT`), markers and climbs, as above;
- the **summary**: whole-run distance and climb (`SUMM`; climb `NaN` when unknown), the drawn
  length (end − start), the grid's extent (spacing × (samples − 1) on each axis) and the trim
  (start, and whole-run distance − end).

`decodeScene` returns these as a `Scene` (`src/scene/types.ts`): typed arrays for the grid
(`Float32Array`) and route (`Float32Array` for x, y, elevation; `Float64Array` for distance and
time).

**Decoded values are binary approximations.** Each is the stored integer times its step, computed
in float64 and kept as float32 or float64, not the decimal itself: a route elevation of 412.3 m is
the float32 412.29998779296875. They re-encode to the same bytes, and they are fine for drawing and
arithmetic. **A host must never write them into published text as they are**: printed in full,
such numbers match Activities' coordinate pattern `\d{2}\.\d{4,}`, which its guards apply to its
published data. Round to the step's decimals (or whole units) before printing.

A sketch of a decoder's main loop, for orientation (the reference code is `src/scene/decode.ts`):

```ts
const levels = new Int32Array(width * height);
const residuals = readStream(bits, width * height); // Rice, blocks of 64
for (let j = 0; j < height; j++)
  for (let i = 0; i < width; i++) {
    const w = i > 0 ? levels[j * width + i - 1] : 0;
    const n = j > 0 ? levels[(j - 1) * width + i] : 0;
    const nw = i > 0 && j > 0 ? levels[(j - 1) * width + i - 1] : 0;
    const p = j === 0 ? w : i === 0 ? n : w + n - nw;
    levels[j * width + i] = residuals[j * width + i] + p; // check 0–65535 here
  }
```

## Versioning and compatibility

- The **version** changes only for a change an existing reader would misread: a new layout of a
  known section, a new meaning of a field, a new required section. A version-1 reader refuses any
  other version (reason `version`) rather than guess.
- **Additions within version 1** go in new sections with new tags. A version-1 reader skips any
  section whose tag it does not know (using its length), wherever it appears, as long as its length
  stays within the file. So a writer may add, say, a heart-rate section without breaking hosts that
  do not use it.
- Known sections are **exact**: a version-1 reader rejects bytes left over in one. Reserved fields
  and flag bits must be zero, so they can gain a meaning in a later version.
- A file's `byteLength` must equal its length: trailing bytes outside any section are an error, not
  an extension point.

## Sidecar

Next to each `<id>.scene` the bake publishes `<id>.scene.json` (two-space JSON and a trailing
newline; shown here more compactly). The Coosa sample's,
`src/scene/fixtures/coosa-backcountry.scene.json`:

```json
{
  "format": "vert-scene",
  "version": 1,
  "bytes": 43115,
  "hash": "c787f362",
  "summary": {
    "distance": 21476,
    "climb": 1102,
    "drawnLength": 21076,
    "extent": { "x": 4361, "y": 6747 },
    "trim": { "start": 200, "end": 200 }
  }
}
```

| key       | meaning                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| `format`  | always `"vert-scene"`                                                                    |
| `version` | the scene file's format version                                                          |
| `bytes`   | the scene file's length                                                                  |
| `hash`    | FNV-1a 32-bit of the scene file's bytes, 8 lower-case hex digits; for cache-busting only |
| `summary` | the decoded summary in **whole metres** (`climb` is `null` when unknown)                 |

The sidecar's summary is read back from the scene bytes, so it always matches the file. Every
number in it is a whole number, so it never matches Activities' coordinate pattern
`\d{2}\.\d{4,}` (a coordinate-like decimal). Activities' privacy test and deploy guard apply that
pattern to its published data files (`data/activities.json`, `data/meta.json`), not to scenes or
sidecars; a host can extend its guard to sidecars and they pass (docs/INTEGRATION.md, "Scenes").

## Forbidden content

A scene carries none of the following, and the builder drops each:

| never stored                                                      | why                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| latitude, longitude, bounds                                       | they are the location                                                                             |
| tile x / y (or z/x/y)                                             | a tile number at a zoom is a location to within a tile                                            |
| `failedTiles`                                                     | a list of tile numbers                                                                            |
| timestamps, dates, time zones                                     | a clock time and date identify the run (and with sunrise, the place); they also break determinism |
| names (route, file, person)                                       | identity                                                                                          |
| a grid at native resolution, or with the tiles' pixel pitch in it | either, with `zoom`, gives cos(latitude) (see below)                                              |
| anything finer than useful                                        | each step is chosen so its rounding cannot be seen in the view or its readouts                    |
| the trimmed ends of the route, their elevations                   | a start at home would be drawn, and its elevation on the grid narrows home to one contour         |

**No latitude from the grid.** The tiles' native pixel size is 156,543 m × cos(latitude) / 2^zoom,
so anything that reads it off the grid gives the latitude with `zoom`. Three ways to read it are
known, and the builder closes each:

- **Spacing.** A grid sampled at the tiles' native resolution has their pixel size as its spacing.
  Every scene grid has a **fixed long side** (320 samples, `SCENE_LONG_SIDE`) whatever the area's
  size, so the ratio between its spacing and the pixel size is unknown.
- **Pixel pitch.** Bilinear interpolation of the tiles leaves a kink along every pixel line, so the
  second differences of any grid sampled from it peak once per pixel; the periodogram of the mean
  |second difference| per column then peaks at the pitch (folded into 0–0.5 cycles per sample),
  and an attacker who tries every latitude the zoom allows gets one candidate that matches. On the
  first version of this format that gave Coosa's latitude to 0.02° from a decoded scene. Scene
  grids are therefore sampled with `buildHeightfield`'s `sampling: 'smooth'`: each sample is a
  normalised Gaussian average of the tile pixels around it, tapered smoothly to zero at 4σ
  (`src/lib/smoothSample.ts`). The kernel has no knots, and with σ of at least 1.5 real pixels the
  variance of its output varies with the position inside a pixel by about e^(−π²σ²) ≈ 2·10⁻¹⁰, far
  below anything a spectrum of a few hundred samples can see.
- **Kernel width.** A smoothed grid's row and column spectra roll off as exp(−4π²σ²f²), so fitting
  them recovers σ in samples. With σ fixed in real pixels (as in the second version of this
  format) σ × spacing ÷ the equatorial pixel size is cos(latitude): a fit gave the latitude to
  0.2–2° on half of 14 real stretches. So σ comes from published values only: **σ = max(1.5 × the
  equatorial pixel size at the grid's zoom (2π · 6,378,137 m / (256 · 2^zoom)), 0.5 × the grid's
  spacing)**. That is still at least 1.5 real pixels at any latitude (cos(latitude) ≤ 1), at
  1 / cos(latitude) more smoothing than 1.5 real pixels (×1.22 at Coosa, ×1.45 at Lavaredo), and a
  fit of it finds what the zoom and the spacing already say.

`buildScene` refuses a grid that was not sampled this way (`heightfield.sampling !== 'smooth'`) or
not at the fixed long side, and never resamples (a second interpolation would bring a lattice
back). The app's own grids keep bilinear sampling, byte for byte.

What is tested (the attacks are in `src/scene/pitchAttack.ts`; the bake can run them on every
scene, since it knows the true latitude):

- **Pitch** (`src/scene/pitch.test.ts`). Tiles with independent noise at every pixel (the worst
  case), at 0.84, 1.4 and 2.3 grid samples per pixel: with bilinear sampling the predicted
  frequency carries 140–150× the spectrum's mean power and the candidate latitudes include the
  truth to 0.04°; with the scene's sampling it carries at most 2.5× and the nearest candidate is
  3.9° off or more. On real terrain (Coosa and Lavaredo, whole routes at z13 and 3–9 km stretches
  at z13 and z14), the predicted frequency is never the strongest in its neighbourhood (±0.05
  cycles per sample): at most 8.0×, in two stretches, at a low frequency where the relief's own
  spectrum reaches 19–24× (it rises with more smoothing, as all low-frequency relief does against
  the mean; a pitch would fall); the nearest candidate latitude is 1.8° off or more. A pitch counts as detected when its power is at least 6×
  the mean and the strongest in its neighbourhood.
- **Kernel width** (`src/scene/kernel.test.ts`, the roll-off fit `kernelWidth`). The fit measures
  the kernel's root-mean-square width, 0.834σ for this taper (`kernelWidthFactor`). Synthetic tiles
  at 0°, 35° and 46° (same zoom and spacing) give the same width, 1.12–1.17 samples against 1.17
  published (a kernel of 1.5 real pixels would have shrunk to 0.82 at 46°); at 60° (zoom 12) 1.88
  against 2.35 published and 1.17 for real pixels. On real terrain (20 fits over the four routes'
  whole courses and stretches, z11–z14) single fits spread by ±30% (real relief is no power law)
  and sit about 20% above the published width, but their median distance (in log) to the published
  width is 0.20 against 0.49 to the real-pixel width, and an attacker who reads them with the old
  rule is off by a median 34.8°, against 10.9° for simply taking the middle of the zoom band.

`zoom` stays (it says how detailed the source was); it narrows the latitude only to the band in
which that zoom gets chosen (a factor of two in cos(latitude)), and not at all for a route small
enough for zoom 14.

**Residual risks, accepted** (docs/DECISIONS.md, "Library for Activities"):

- **The terrain is a fingerprint.** A height grid could be matched against a global elevation
  model to find where it is. No encoding of real ground avoids that; publishing a scene publishes
  the shape of the ground. Scenes are baked per activity, by choice.
- **Mercator scale along the route.** The grid is evenly spaced in Web Mercator, so the grid-local
  length of a route step differs from its true length (stored distances are true ground distances)
  by cos(centre latitude) / cos(latitude): about 0.5% from the north edge to the south edge of a
  30 km grid at 45°. Regressing that over thousands of steps could estimate tan(latitude) roughly;
  it gives far less than the terrain itself already does.
- **The tiles' own smoothness.** Terrarium tiles are themselves resampled from source elevation
  models, with some smoothing of their own measured in real pixels; it adds to the kernel in
  quadrature (likely why real fits run about 20% above the published width). Within the fits'
  ±30% spread it gave no latitude on the 20 real grids measured.

`src/scene/privacy.ts` checks a built scene for every item of the first table, in three places:

- **Bytes.** At every offset: a float64 equal to a track coordinate (or its 4–6 decimal rounding);
  a float32 or float64 within 10⁻⁵° of a key value (bound edges, their arithmetic and Web Mercator
  centres, the track's ends); adjacent float32 or float64 (lat, lon) pairs, either order, inside the
  bounding box of all the secrets (so derived values, such as interpolated route points or a value
  nudged by 10⁻⁷, are caught too). Outside the Rice streams: int32 (lat, lon) pairs and int32 key
  values at 10⁵, 10⁶ and 10⁷ units per degree and in semicircles (2³¹/180), and tile (x, y) pairs at
  zooms 6–15 as u16 or u32 (columns past ±180° folded back; a pair with a zero in it, column 0 by the
  antimeridian, is the same bytes as one u32, such as a section's length, so it is looked for only
  where single tile numbers are). A box past ±180° also holds the longitudes a turn away. In sections the format does not define: any single float32, float64 or
  int32 (at those scales) inside the box; any u16 or u32 tile number; float32 or float64 (x, y)
  pairs inside the box in projected form (Web Mercator world units 0–1, EPSG:3857 metres,
  fractional tile coordinates at zooms 6–15); and decimals written as text (`34.76375`) inside the
  box. Patterns short enough to occur by chance in coded data are not looked for inside streams, nor
  single in-box integers in the format's own fixed fields (a climb at 75 km is 7,500,000 cm, which
  reads as 7.5° at 10⁶ per degree, and real scenes near 7° E have such climbs).
- **Decoded object.** Forbidden keys (`bounds`, `lat`, `lon`, `name`, `date` …); numbers within
  10⁻⁵° of a key value; (lat, lon) pairs among adjacent array elements or among one object's
  numbers; epoch-like timestamps; `x`/`y` scalars equal to a tile index. A lone number merely
  inside the box is not flagged: route times pass through 34.8 s, and a low grid through 46.6 m.
- **Sidecar.** Activities' pattern.

Tested on the Coosa track with a synthetic grid (trim 200 and 0, and moved to a low-lying place
where times and elevations share the coordinates' range), and on all four real scenes at trim 200
and 0: no finding on any clean scene, and each of 18 injected leaks (exact, interpolated and
nudged coordinates as float32/float64 singles and pairs, the Mercator centre, a bound, int32 at
10⁵/10⁷/semicircles, tile pairs and a lone tile number, Web Mercator, EPSG:3857 and fractional tile
pairs, and "lat,lon" as text) found in every one. The bake is to run it on every scene it writes.

## How the builder fills it

`buildScene(heightfield, track, run)` (`src/scene/build.ts`) is pure and has no network; it is the
only code in `src/scene` that reads latitude or longitude.

- **Grid**: as `buildHeightfield` sampled it with `SCENE_HEIGHTFIELD_OPTIONS` (`gridSize: 320`,
  `sampling: 'smooth'`); any other grid is refused. The shorter side follows the ground aspect
  ratio. Spacing is rounded to 1 cm. The elevation step is 1% of the larger spacing (quantising then tilts
  the ground between two samples by at most 0.6°), at least 0.1 m, and coarse enough for the
  grid's range to fit 65,535 levels (an Everest-scale 8,000 m range needs only 0.123 m); rounded
  up to 1 mm.
- **Frame**: a point at fractional grid column c, row r of the source grid (`gridPosition`) lands
  at x = c × spacingX, y = r × spacingY with the scene's rounded spacing, so route and grid line up.
- **Route**: the drawn stretch (`trimTrack`, default 200 m off each end), resampled evenly every
  10 m, or coarser to stay within 4,000 points (as the app draws it). Elevations are the run's own
  (as its stats use them), else the terrain's; times are offsets from the run's first point.
- **Markers**: the app's rules on the drawn stretch: `routeMarkerIndices` on its grid track
  (`gridTrackFromRun`), so the loop is decided by `isLoop` (`src/lib/loop.ts`), the one rule the
  legend uses too.
- **Climbs**: the run's climbs clipped to the drawn stretch. A climb the trim cut into takes its
  gain and grade from the drawn elevations, and is dropped if it then no longer counts as a climb
  (under 50 m gain or 4%); the steepest is marked again among those left.
- **Determinism**: the same inputs give the same bytes (no clock, no randomness, no iteration over
  unordered collections, and one rounding rule: `Math.round(value / step)`, halves rounded up).

## Baking a scene

```sh
pnpm bake <input> --out <dir> [--id <id>] [--trim <metres>] [--tiles <url-template>] [--cache <dir>]
```

`pnpm bake` (`node scripts/bake.ts`, code in `scripts/bake/`) turns one activity into
`<dir>/<id>.scene` and `<dir>/<id>.scene.json`, offline, on the machine that has the activity. It
needs Node 22.18 or later (`engines.node`, `.nvmrc`): it runs the TypeScript in `src/` directly,
with Node's type stripping and a small resolve hook for `src/`'s extensionless imports (an older
Node refuses the `.ts` entry before it can say so). No dependency, DOM or WebGL.
Integrating the files into a host page is `docs/INTEGRATION.md`'s subject.

| option    | default                                              | meaning                                                                                         |
| --------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `<input>` | (required)                                           | a `.gpx`, a `.json` points file (below), or `-`: a points file on stdin                         |
| `--out`   | (required)                                           | the directory to write to (created if needed)                                                   |
| `--id`    | the input's file name, lower-cased, other runs → `-` | the files' base name: `a-z`, `0-9`, `_`, `-`, at most 64, given ids as typed; required with `-` |
| `--trim`  | 200                                                  | metres hidden at each end of the route (the poster's default); `0` keeps them                   |
| `--tiles` | `https://vert.geekplux.org/tiles/{z}/{x}/{y}.png`    | elevation tile URL template (the tile Worker, or anything with its answers)                     |
| `--cache` | `scripts/.cache/terrarium` (git-ignored)             | the tile cache, `{z}/{x}/{y}.png`                                                               |

**What is checked in an id** (`scripts/bake/id.ts`). The id becomes a published file name, so:

- **No coordinate of the run.** The id's digit runs are the groups; any run of other characters,
  of any length, separates them. They are read as: one run of 5 or more digits with 1–7 decimals
  implied (`hike-34766`), and with its first 2 or 3 digits as degrees and the rest as their fraction
  (latitude and longitude run together: `347663839251`); degrees (1–3 digits, leading zeros
  allowed) and a fraction of 3 or more digits (`34-7663`, `34point7663`, `0034-7663`, the default
  id of `34.7663_-83.9251.gpx`); degrees and minutes below 60 (`34-45`); degrees, minutes and
  seconds below 60 (`34d45m58s`, the default id of `track 34°45'58"N 85°36'16"W.gpx`); degrees,
  minutes and a fraction of minutes (`n34-45-966`, or run together: `34d45966`). If any reading
  falls within the run's latitude or longitude range (as a magnitude: a minus cannot survive in an
  id), widened by 0.01°, the id is refused. A date in an id can collide with a run's box by chance
  (`lap-10-03` reads as 10° 3′); the message then asks for another id.
  - **Hashes are skipped**: a run of 16 or more hex characters, or a UUID, with a letter in it
    (Activities' file ids are `f:<sha1>`, `f-<sha1>` once sanitised). Over 5,000 random ids each
    against the Coosa, CCC and a Hong Kong box, none of `f-<sha1>` or UUIDs is refused.
  - **An explicit `--id` of 10 or more digits and nothing else is not read at all**: it is an
    opaque public identifier, such as a Strava activity id. Strava's ids are 11 digits that rise
    with time, so the prefix readings refused whole bands of them, not a scattering, wherever a
    run's latitude or longitude is 10–19° or 100–199° (every id from 11,413,000,000 to
    11,426,000,000 on a Hong Kong run; 1.2116e10–1.2203e10 on Lavaredo). A sweep of every
    millionth id from 1.0e9 to 2.0e10 is refused nowhere on the test boxes. The residual risk,
    accepted: someone typing concatenated coordinates as a bare-digit `--id`. A default id (from
    the file name) keeps every reading, digit-only or not, and so does any explicit id with
    anything besides digits (`a-11413500000`).
  - A long run's first digit alone is not read as degrees: by a 1-digit degree (the CCC, near
    7° E) that refused about 5% of uniformly random 10-digit ids. Runs of 6–8 digits still get that
    reading from the implied decimals, so uniformly random 8-digit ids are refused about 5% of the
    time there.
- **Default ids only: no timestamp.** An id made from the file name is refused when a digit run reads
  as epoch microseconds, milliseconds, seconds or minutes from 2000 to 2100 (15–16, 12–13, 9–10 or 8
  digits) or as a date YYYYMMDD (1990–2100): some apps name exports by the time of the run
  (`1607437156744.gpx`), which the file name would then publish (exit 2, "pass --id"). An explicit
  `--id` is never refused for being numeric or date-like: a host passes its own activity ids (a
  10-digit Strava id reads as epoch seconds), and it publishes those already. A date written with
  separators (`morning-run-2026-10-03`) is not looked for.

Local bakes of your own tracks belong in `fixtures/scenes/` (git-ignored).

**Points file.** For a host whose activities are FIT or similar:
`{ "points": [{ "lat": 46.1, "lon": 7.2, "ele": 1250.5, "t": "2026-10-03T11:10:00Z" }, …] }`.
`lat` (−90…90) and `lon` (−180…180) are required finite numbers; `ele` (metres) is optional;
`t` is optional and is either an ISO 8601 date-time **with a zone** or **epoch milliseconds**
(1990–2100; seconds are refused). At least 2 points, at most 500,000; present times must not go
backwards; no other keys (a typo such as `lng` would otherwise drop data). Errors name the point and
field, never the value. With `-` as the input the points file is read from standard input (same
limit, 128 MB), so a host can pipe the coordinates in and never write them to disk:
`spawnSync(process.execPath, ['../vert/scripts/bake.ts', '-', '--id', id, '--out', dir], { input: json })`.

**What it does.** The run is built exactly as the app builds it: a GPX goes through the parse
worker's own handler, a points file through the same `buildRun`; a file with no usable elevations
(or long gaps) gets them from the terrain with the app's `withTerrainElevation`, sampled from the
app's own grid of the whole run (`buildHeightfield(run.bounds)`, bilinear), so the summary matches
Vert's View for the same file. The drawn stretch is `trimTrack(track, trim)`; the scene grid is
`buildHeightfield` on its bounds with `SCENE_HEIGHTFIELD_OPTIONS`; then `buildScene`,
`encodeScene` and the sidecar. Before anything is written, the privacy scanners run on the bytes,
the decoded scene and the sidecar text, and the pixel-pitch attack runs with the true latitude; any
finding refuses the scene. Both files are written to temporary names and renamed into place
together; if any step fails, both are left as they were (absent, or the previous pair), never one
new and one old. A bake killed mid-write (SIGKILL, power loss) leaves files beside the targets:
temporary `<name>.tmp-*`, the previous file moved aside as `<name>.old-*`, an empty
`<name>.none-*` for a target that did not exist, and, once the swap is committed, `<name>.done-*`.
Before it starts, the next bake of the same id settles the pair: after a commit the new pair stays
(and every `.old-*` and `.none-*` of the pair is deleted before any `.done-*`, so a second crash
during that cleanup still reads as committed); before one, if either target has an `.old-*` or
`.none-*`, the pair reverts as a whole (each `.old-*` put back, each target marked `.none-*`
removed); then every leftover is deleted. So the pair is the old one (or none) or the new one, never
one of each. The same input and tiles give byte-identical files. A route across the
antimeridian works as in the app (its longitudes stay unwrapped, and the grid is framed in them).

**Loops and laps.** The trim hides the first and last metres along the route, but a loop or a lap
session passes its start again: when the real start or finish lies within 100 m of the drawn route,
the bake says so on stderr (exit 0): how near, in tens of metres ("within 100 m" rather than a
figure that rounds to it); where the drawn route passes closest, `about km X of Y` (one decimal,
distances along the route only, never a coordinate); and the smallest `--trim` (tens of metres,
printed to paste: `--trim 1700`) whose drawn route stays 100 m clear of it, or that no `--trim`
does (the route passes it again too far from both ends, as laps do; the place named is then that
pass). A larger trim draws a sub-stretch of a
smaller one's, so the bake finds that trim by binary search on the warning's own test. It still
writes the scene: the start is then one point among many of the route, but you decide whether
that is enough.

**Tiles.** At most 4 requests in flight, `User-Agent: vert-bake/<version> (offline scene bake)`,
20 s per request, only z/x/y in the path (as from the app). Answers, as the Worker gives them
(`worker/README.md`):

| answer                                     | the bake                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| 200 PNG                                    | decoded and checked (256 × 256), then cached atomically                         |
| 404 (no tile upstream: open sea)           | a missing tile, filled from its neighbours as in the app; not retried or cached |
| 400                                        | stops: a bug in the request or a wrong `--tiles`                                |
| 5xx, 429, network error, timeout           | retried once, then stops                                                        |
| 200 text/HTML/JSON/XML, or not a valid PNG | stops: the URL serves no tiles                                                  |
| any other status                           | stops                                                                           |

The app fills a tile from its neighbours after a 5xx or a timeout too, and says so on screen; a
published scene has no such note, so the bake stops instead of publishing invented terrain (and a
re-run would bake differently). Only a confirmed 404 is ever filled: anything else that goes wrong
loading a tile (a decoder fault, an unexpected file system error) stops the bake. Only verified PNGs
are cached; a second bake of the same activity makes no request. A tile that cannot be written to
the cache (read-only or full) is used all the same, and the bake warns: the elevations are verified
and in memory, and the cache only saves a later download.

**Output.** The summary gives the id, the whole run's length and climb and where its elevations
came from, the drawn length, the grid's samples, extent in metres and zoom, the bytes and hash, the
tiles fetched, read from the cache and missing upstream (across both grids, and how many of those
lie under the scene), and the privacy result; warnings go to stderr. When every elevation is the
file's own, an `offset` line gives the file's elevations minus the terrain's (sampled from the
scene grid) along the drawn route: the mean, weighted by distance, and the range, whole metres.

Distances (the route's, the sidecar's `distance` and `drawnLength`) are the 2D haversine sum over
the input's raw points (`src/gpx/stats.ts`: no smoothing, no elevation), so they can differ from a
device's recorded distance by a percent or two. Nothing printed, errors
included, holds a coordinate, a bound, a tile x/y or a tile URL. Exit codes: 0 written, 1 the bake
failed (nothing written), 2 a usage error.

`src/scene/fixtures/coosa-backcountry.scene` (and its sidecar) is the sample baked with the
defaults; `scripts/bake/fixture.test.ts` re-bakes it byte for byte when the tiles are cached.

## Sizes

Budget: **at most 80 KB before compression** for a ~20 km route, grid and route together.

Measured on real terrain (AWS Terrain Tiles, Terrarium encoding) for the Coosa sample
(`public/samples/coosa-backcountry.gpx`) and three UTMB courses, each trimmed by 200 m, the grid
framed on the drawn route with 15% padding and sampled as the bake samples it (`sampling:
'smooth'`). Totals in KB for four grid elevation steps; the default (1% of spacing) in the last
column. Route size depends only on the route: Coosa 7.0 KB (2,109 points, with times), Lavaredo
6.6 KB (1,912, with times), Eiger 9.7 KB and CCC 11.2 KB (4,000 points each, no times).

| route (length, zoom, relief)         | long side | grid    | spacing | 0.1 m | 0.25 m | 0.5% spacing | **1% spacing (default)** |
| ------------------------------------ | --------- | ------- | ------- | ----- | ------ | ------------ | ------------------------ |
| Coosa (21.5 km, z13, 752 m)          | 256       | 166×256 | 26.4 m  | 39.2  | 32.3   | 37.1 (0.133) | 31.9 (0.265)             |
|                                      | 288       | 187×288 | 23.4 m  | 45.6  | 36.8   | 44.0 (0.118) | 37.4 (0.235)             |
|                                      | **320**   | 207×320 | 21.2 m  | 52.0  | 41.2   | 51.2 (0.106) | **43.1 (0.212)**         |
|                                      | 384       | 249×384 | 17.6 m  | 65.5  | 50.5   | 65.5 (0.1)   | 56.0 (0.177)             |
| Lavaredo 20K (19.5 km, z13, 1,927 m) | 256       | 256×184 | 26.1 m  | 35.5  | 28.1   | 33.2 (0.131) | 27.7 (0.261)             |
|                                      | 288       | 288×207 | 23.2 m  | 40.5  | 31.4   | 39.0 (0.116) | 32.1 (0.232)             |
|                                      | **320**   | 320×230 | 20.8 m  | 45.6  | 34.7   | 45.0 (0.105) | **36.7 (0.209)**         |
|                                      | 384       | 384×276 | 17.4 m  | 56.0  | 41.6   | 56.0 (0.1)   | 46.8 (0.174)             |
| Eiger E51 (52.1 km, z12, 3,056 m)    | 256       | 256×106 | 75.3 m  | 37.1  | 32.6   | 30.7 (0.377) | 27.3 (0.753)             |
|                                      | 288       | 288×119 | 66.9 m  | 42.8  | 37.2   | 35.4 (0.335) | 31.2 (0.670)             |
|                                      | **320**   | 320×132 | 60.2 m  | 48.9  | 42.0   | 40.5 (0.302) | **35.3 (0.604)**         |
|                                      | 384       | 384×159 | 50.1 m  | 62.2  | 52.1   | 52.1 (0.251) | 44.6 (0.502)             |
| CCC (99.4 km, z11, 4,275 m)          | 256       | 171×256 | 153.1 m | 64.2  | 56.9   | 48.1 (0.768) | 42.7 (1.535)             |
|                                      | 288       | 192×288 | 136.3 m | 75.8  | 66.7   | 56.7 (0.682) | 49.8 (1.364)             |
|                                      | **320**   | 213×320 | 122.8 m | 88.3  | 77.1   | 66.0 (0.614) | **57.5 (1.228)**         |
|                                      | 384       | 256×384 | 102.1 m | 115.8 | 99.6   | 86.9 (0.511) | 74.7 (1.022)             |

Decoding the default files takes 2.5–3.5 ms (Coosa 3.1, Lavaredo 2.9, Eiger 2.5, CCC 3.5; mean of
5 decodes in Node 22 on an Apple M4). At the format's caps (1024 × 1024 grid, 100,000 route points,
1.16 MB) a decode takes about 90 ms.

**Worst case for a ~20 km route.** A near-square area costs more than the elongated ones above.
Coosa's and Lavaredo's terrain on a square grid:

| square grid | Coosa, 0.5% spacing | Coosa, 1% spacing | Lavaredo, 0.5% spacing | Lavaredo, 1% spacing |
| ----------- | ------------------- | ----------------- | ---------------------- | -------------------- |
| 288 × 288   | 63.3                | 53.2              | 53.1                   | 43.4                 |
| 304 × 304   | 68.8                | 57.6              | 57.4                   | 46.7                 |
| 320 × 320   | 74.6                | **62.1**          | 61.8                   | 50.1                 |

**Choice: long side 320, elevation step 1% of spacing.** Of the long sides measured, 320 is the
largest for which every route above and a square grid of the roughest ~20 km terrain measured stay
within 80 KB with room to spare; at 384 a square Coosa-like area would take about 89 KB. Halving
the step (0.5%) costs 15–23% more bytes for a difference below what shading shows.

**Fidelity cost of the smooth sampler** (at the default long side, against the same grid sampled
bilinearly; "route fit" is the mean absolute deviation of the run's own elevations from the grid
under the route, after removing their mean offset; lower is closer):

| grid                  | zoom | spacing | σ (m) | change max / mean | route fit, smooth / bilinear |
| --------------------- | ---- | ------- | ----- | ----------------- | ---------------------------- |
| Coosa, whole route    | 13   | 21.2 m  | 28.7  | 8.7 / 1.69 m      | 2.24 / 0.88 m                |
| Coosa, 3.0–4.5 km     | 14   | 4.1 m   | 14.3  | 4.0 / 0.75 m      | 0.90 / 0.85 m                |
| Coosa, 3.0–6.0 km     | 14   | 5.7 m   | 14.3  | 4.7 / 0.69 m      | 0.77 / 0.80 m                |
| Coosa, 3.0–7.5 km     | 14   | 7.4 m   | 14.3  | 4.7 / 0.71 m      | 0.87 / 0.95 m                |
| Coosa, 3.0–9.0 km     | 14   | 10.0 m  | 14.3  | 4.7 / 0.74 m      | 0.98 / 0.90 m                |
| Lavaredo, whole route | 13   | 20.8 m  | 28.7  | 31.4 / 0.75 m     | 16.67 / 16.60 m              |
| Lavaredo, 3.0–4.5 km  | 14   | 2.6 m   | 14.3  | 1.1 / 0.13 m      | 17.64 / 17.64 m              |
| Lavaredo, 3.0–6.0 km  | 14   | 5.6 m   | 14.3  | 12.1 / 0.21 m     | 23.96 / 23.94 m              |
| Lavaredo, 3.0–7.5 km  | 14   | 8.2 m   | 14.3  | 13.9 / 0.29 m     | 21.23 / 21.21 m              |
| Lavaredo, 3.0–9.0 km  | 13   | 12.0 m  | 28.7  | 35.1 / 0.89 m     | 18.47 / 18.42 m              |
| Eiger E51             | 12   | 60.2 m  | 57.3  | 63.4 / 2.97 m     | 12.81 / 11.44 m              |
| CCC                   | 11   | 122.8 m | 114.7 | 92.6 / 9.23 m     | 12.78 / 9.03 m               |

The sampler rounds off sharp ridges, summits and gullies: under a metre on average at zoom 14
(14 m at most), 0.75–3 m on average at zooms 12–13 (9–63 m at most; Lavaredo's whole course 31.4 m
at most, 0.75 m on average) and 9.2 m on average, 93 m at most, on the CCC's 123 m grid at zoom 11,
whose kernel (σ 115 m) is the widest. At zoom 14 the route sits on its terrain about as well as
before; at zooms 11–13 less well (route fit 2.24 against 0.88 m on Coosa, 12.81 against 11.44 m on
the Eiger, 12.78 against 9.03 m on the CCC; the Lavaredo course's own elevations differ from the
DEM by 16–24 m whatever the sampling). Files get 7–14% smaller than bilinear grids of the same
areas.

**How the grid gets small.** A 207 × 320 grid of 16-bit samples is 132 KB; Rice-coded residuals of
the W + N − NW predictor take 4.3 bits per sample on Coosa (3.3 on Lavaredo, 5.4 on the CCC). The
alternatives, measured on the same areas' bilinear grids (long side 320, steps 0.1–1 m): byte-aligned
zigzag varints never go below 8 bits per sample and cost 23–290% more than Rice; with Rice coding,
the median edge predictor (LOCO-I) costs 6–31% more than W + N − NW; with varints, plain row deltas
(the west neighbour) cost up to 42% more than W + N − NW. One Rice parameter per block of 64 values
is within 2.5% of one per row, and usually smaller.

The size tests (`src/scene/size.test.ts`) run offline on synthetic grids with the roughness
measured here (Gaussian noise of the same predictor-residual RMS, which costs at least as many bits
as the real terrain), and on the real scenes when their tiles are in the local cache
(`scripts/.cache/terrarium`, `src/scene/testTiles.ts`).
