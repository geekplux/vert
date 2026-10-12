#!/usr/bin/env node
/* global console, process, fetch, Buffer */
// Downloads the official course GPX files listed in fixtures/courses/SOURCES.md into
// fixtures/courses/. The files belong to SAS UTMB Group and the race organisers; their terms
// forbid reproduction without permission, so the GPX files are git-ignored and fetched on demand.
//
//   pnpm fixtures            download the missing files
//   pnpm fixtures --force    download all files again
//
// Node 22+, no dependencies.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'fixtures', 'courses');
const USER_AGENT =
  'vert-fixtures/0.1 (course test fixtures for a GPX visualizer; github.com/geekplux)';

/** Keep in sync with fixtures/courses/SOURCES.md. */
const COURSES = [
  {
    file: 'lavaredo-20k.gpx',
    race: 'Lavaredo 20K (Lavaredo Ultra Trail by UTMB)',
    url: 'https://pdf.utmb.world/raw/upload/v1719163172/lavaredo/files/2024/LUT_20k_variante_2024_de2a531f04.gpx',
  },
  {
    file: 'eiger-e51.gpx',
    race: 'E51 (Eiger Ultra Trail by UTMB)',
    url: 'https://pdf.utmb.world/raw/upload/v1783658437/eiger/Races/GPX%202026/E51_2026_5eba191d79.gpx',
  },
  {
    file: 'montblanc-ccc.gpx',
    race: 'CCC (HOKA UTMB Mont-Blanc)',
    url: 'https://pdf.utmb.world/raw/upload/v1785143154/montblanc/Races/GPX/2026/CCC_2026_cd3cb129a5.gpx',
  },
];

/** Throws unless the text looks like a GPX document; returns its track/route point count. */
function checkGpx(text, label) {
  const head = text.trimStart().slice(0, 512);
  if (!head.startsWith('<?xml') && !head.startsWith('<gpx')) {
    throw new Error(`${label}: does not start with <?xml or <gpx`);
  }
  if (!/<gpx[\s>]/.test(text)) throw new Error(`${label}: no <gpx> element`);
  const points = (text.match(/<(?:trkpt|rtept)[\s>]/g) ?? []).length;
  if (points === 0) throw new Error(`${label}: no <trkpt> or <rtept> elements`);
  return points;
}

async function download(course) {
  const res = await fetch(course.url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${course.file}: HTTP ${String(res.status)} from ${course.url}`);
  return res.text();
}

async function main() {
  const force = process.argv.includes('--force');
  mkdirSync(OUT_DIR, { recursive: true });
  let failures = 0;
  for (const course of COURSES) {
    const path = join(OUT_DIR, course.file);
    try {
      let text;
      let action;
      if (!force && existsSync(path)) {
        text = readFileSync(path, 'utf8');
        action = 'kept';
      } else {
        text = await download(course);
        action = 'downloaded';
      }
      const points = checkGpx(text, course.file);
      if (action === 'downloaded') writeFileSync(path, text);
      const kb = (Buffer.byteLength(text) / 1024).toFixed(0);
      console.log(
        `${action.padEnd(10)} ${course.file.padEnd(20)} ${String(points).padStart(6)} points  ${kb} KB  ${course.race}`,
      );
    } catch (err) {
      failures += 1;
      console.error(
        `failed     ${course.file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (failures > 0) process.exit(1);
}

await main();
