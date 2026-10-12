# Course fixtures: sources

Three official course GPX files from UTMB World Series race pages, picked to cover a short, a
medium and a long course with big vert. Fetch them with:

```sh
pnpm fixtures            # downloads the missing files into fixtures/courses/
pnpm fixtures --force    # downloads all of them again
```

The URLs live in `scripts/fetch-courses.mjs`; keep that file and this table in sync. All three were
fetched and checked on 2026-10-12.

| File                | Race                                       | Edition on page | Race page                                     | GPX                                                                                                    | Published distance / D+ | Page profile distance / D+ | Measured distance / D+ | Committed |
| ------------------- | ------------------------------------------ | --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------- | -------------------------- | ---------------------- | --------- |
| `lavaredo-20k.gpx`  | Lavaredo 20K, Lavaredo Ultra Trail by UTMB | 2027            | https://lavaredo.utmb.world/races/lavaredo20k | https://pdf.utmb.world/raw/upload/v1719163172/lavaredo/files/2024/LUT_20k_variante_2024_de2a531f04.gpx | 20 km / 1000 m          | 19.89 km / 1063 m          | 19.51 km / 1061 m      | no        |
| `eiger-e51.gpx`     | E51, Eiger Ultra Trail by UTMB             | 2027            | https://eiger.utmb.world/races/E51            | https://pdf.utmb.world/raw/upload/v1783658437/eiger/Races/GPX%202026/E51_2026_5eba191d79.gpx           | 51 km / 3100 m          | 52.81 km / 2861 m          | 52.08 km / 2831 m      | no        |
| `montblanc-ccc.gpx` | CCC, HOKA UTMB Mont-Blanc                  | 2026            | https://montblanc.utmb.world/races/CCC        | https://pdf.utmb.world/raw/upload/v1785143154/montblanc/Races/GPX/2026/CCC_2026_cd3cb129a5.gpx         | 108 km / 6200 m         | 101.41 km / 6015 m         | 99.36 km / 6015 m      | no        |

- **Published**: the headline figures on the race page (its `bannerStats`).
- **Page profile**: the totals of the elevation profile the race page draws (its `track` data),
  which UTMB computes from the course; these are the numbers to compare a parser against.
- **Measured**: a naive check (regex point extraction, haversine on a 6 371 008.8 m sphere, ascent
  with a 3 m hysteresis, no smoothing or resampling). It runs about 1–2 % short on distance against
  the page profile and lands within about 1 % of its D+ on all three.

## Files

- **`lavaredo-20k.gpx`**: 2 703 track points, one segment, every point has `<ele>`. Garmin-style
  GPX 1.1 named "LUT 20k nuova variante 2024": the race page still links the 2024 course variant
  for the 2027 edition. Elevation 1 164–2 042 m around Cortina d'Ampezzo (Dolomites).
- **`eiger-e51.gpx`**: 5 151 track points, one segment, every point has `<ele>`. Exported from
  MySchweizMobil; the whole file is on one line. Elevation 894–2 679 m around Grindelwald. Its D+
  is 8–9 % under the published 3 100 m, also in UTMB's own profile (2 861 m).
- **`montblanc-ccc.gpx`**: 9 064 track points, one segment, every point has `<ele>`. Exported by
  LiveTrail (`<copyright author="LiveTrail®">`). Elevation 1 035–2 556 m, Courmayeur to Chamonix.
  The published 108 km is the race's headline; the course file and UTMB's profile both measure
  about 101 km. Its `<metadata><bounds>` has `minlon` and `maxlon` swapped (`maxlon` is 6.86912,
  `minlon` is 7.12835): a parser must not trust `<bounds>`.

## Licence and terms

The utmb.world sites (event subdomains link to the same page) are owned by SAS UTMB Group,
Chamonix. Their terms, https://utmb.world/terms-and-conditions (also
https://montblanc.utmb.world/terms-and-conditions), say under "Intellectual property" that all
components of the website "including texts, layouts, designs, photos, films, videos, graphics and
elements of any kind" are the intellectual property of SAS UTMB Group or its partners, and that "it
is strictly forbidden to reproduce, represent, use or modify ... either partially or entirely ...
by any means ... into any form whatsoever" without prior and express authorisation. No open licence
is offered for the course files, and the CCC file also carries a LiveTrail® copyright.

So the GPX files are **not committed**: `fixtures/courses/*.gpx` is in `.gitignore`. Only this file
and the download script are in the repo. Use the files locally as test fixtures; do not copy them
into `public/`, test snapshots or anything else that ships or gets committed. The committed sample
track stays synthetic (`public/samples/`).
