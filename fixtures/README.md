# Fixtures

Real GPX files for checking the parser, stats and terrain against tracks you did not make up.
None of the GPX files in here are committed.

## `fixtures/gpx/`: your own tracks

Put your own GPX files here (aim for about 10: short and long, loops and point-to-point, different
watches and apps). The folder is git-ignored; never commit your own tracks, they hold where you live
and run. Create it if it is missing:

```sh
mkdir -p fixtures/gpx
```

## `fixtures/courses/`: official race courses

Three UTMB World Series course files (about 20 km, 50 km and 100 km with 6 000 m of climbing),
downloaded from the race pages:

```sh
pnpm fixtures
```

UTMB's terms forbid redistribution, so the `.gpx` files are git-ignored. `courses/SOURCES.md` lists
each file's race page, download URL, published distance and D+, and the terms.

Tests that read either folder must skip when the files are missing (a fresh clone or CI has none).
