#!/usr/bin/env node
/* global console, process, document, window, performance, URL, fetch */
// Captures Vert's showcase images from the real app, with the bundled sample run (public OSM
// data) at default settings:
//
//   src/page/UploadState/posters/{trail-sign,night-ridge,survey-quad}.webp
//                                 the Upload page's poster styles band, 600 × 800
//   docs/images/poster-{trail-sign,night-ridge,survey-quad}.png    README posters, 750 × 1000
//   docs/images/view.png          the View at 1440 × 900, 1800 wide
//   docs/images/view-phone.png    the View at 390 × 844 (touch), 1200 tall
//   docs/images/upload.png        the whole Upload page at 1440 wide, 1800 wide
//   public/og-image.png           the social card, 1280 × 640, drawn from scripts/og-image.html
//
// Each poster is Poster mode's live preview (18 × 24 in) at device pixel ratio 2. Run it against
// a production build:
//
//   pnpm build && pnpm preview --port 4173     # in one terminal
//   pnpm posters                               # in another (VERT_URL overrides the address)
//
// Needs Playwright's Chromium (`pnpm exec playwright install chromium`), and, only to regenerate
// these images, macOS `sips` and `cwebp` (Homebrew: `brew install webp`). The elevation tiles come
// through the preview server's /tiles proxy; nothing else leaves the machine.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.VERT_URL ?? 'http://localhost:4173';
const POSTERS_DIR = join(ROOT, 'src', 'page', 'UploadState', 'posters');
const IMAGES_DIR = join(ROOT, 'docs', 'images');
const CWEBP = process.env.CWEBP ?? '/opt/homebrew/bin/cwebp';

/** The three styles, as Poster mode's StylePicker names them, and the figure each one draws. */
const STYLES = [
  { radio: 'A Trail Sign', figure: 'terrain', slug: 'trail-sign' },
  { radio: 'B Night Ridge', figure: 'ridges', slug: 'night-ridge' },
  { radio: 'E Survey Quad', figure: 'contours', slug: 'survey-quad' },
];

/** Time for a figure to settle after it is attached (A redraws 150 ms after layout settles). */
const SETTLE_MS = 1500;

const tmp = mkdtempSync(join(tmpdir(), 'vert-capture-'));

function sips(input, maxSide, output) {
  execFileSync('sips', ['-Z', String(maxSide), input, '--out', output], { stdio: 'ignore' });
}

function report(path) {
  const kb = Math.round(statSync(path).size / 1024);
  console.log(`  wrote ${relative(ROOT, path)} (${String(kb)} KB)`);
}

/** Opens the sample run in the View and waits for the terrain's first frame. */
async function openSample(page) {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Try the sample run', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }).waitFor();
  await page.waitForFunction(
    () => performance.getEntriesByName('vert:first-frame').length > 0,
    null,
    { timeout: 60_000 },
  );
}

async function capturePosters(browser) {
  // Tall enough for the preview's full 600 × 800; reduced motion so the View's camera is at rest
  // when Make a poster copies it.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await openSample(page);
  await page.getByRole('button', { name: 'Make a poster' }).click();
  await page.getByRole('heading', { level: 1, name: 'Make a poster' }).waitFor();
  // The radios are visually hidden under their cards.
  await page.getByRole('radio', { name: /^18 × 24 in/ }).check({ force: true });
  const poster = page.getByRole('img', { name: /^Poster: / });

  for (const style of STYLES) {
    await page.getByRole('radio', { name: style.radio }).check({ force: true });
    await poster.locator(`[data-figure="${style.figure}"]`).waitFor({
      state: 'attached',
      timeout: 60_000,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(SETTLE_MS);
    const box = await poster.boundingBox();
    if (!box || Math.round(box.width) !== 600 || Math.round(box.height) !== 800) {
      throw new Error(`${style.radio}: the preview is ${JSON.stringify(box)}, not 600 × 800`);
    }
    const shot = join(tmp, `${style.slug}.png`);
    await poster.screenshot({ path: shot });

    mkdirSync(POSTERS_DIR, { recursive: true });
    const webp = join(POSTERS_DIR, `${style.slug}.webp`);
    execFileSync(CWEBP, ['-quiet', '-q', '82', '-resize', '600', '800', shot, '-o', webp]);
    report(webp);
    const png = join(IMAGES_DIR, `poster-${style.slug}.png`);
    sips(shot, 1000, png);
    report(png);
  }
  await context.close();
}

async function captureView(browser, { width, height, touch, maxSide, name }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: touch,
  });
  const page = await context.newPage();
  await openSample(page);
  await page.waitForTimeout(2500);
  // The page focuses the h1 on arrival; no focus ring in the picture.
  await page.evaluate(() => {
    if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur();
  });
  const shot = join(tmp, `${name}.png`);
  await page.screenshot({ path: shot });
  const out = join(IMAGES_DIR, `${name}.png`);
  sips(shot, maxSide, out);
  report(out);
  await context.close();
}

async function captureUpload(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByRole('heading', { level: 1, name: 'Your run, as terrain.' }).waitFor();
  // The band's images load lazily: bring them into view, wait for them, then go back up.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const shot = join(tmp, 'upload.png');
  await page.screenshot({ path: shot, fullPage: true });
  const out = join(IMAGES_DIR, 'upload.png');
  sips(shot, 1800, out);
  report(out);
  await context.close();
}

const CONTENT_TYPES = { '.html': 'text/html', '.woff2': 'font/woff2', '.webp': 'image/webp' };

/**
 * The social card: scripts/og-image.html with the repo's own fonts and the posters just written,
 * served from the working tree under a made-up origin (no server, no network).
 */
async function captureOgImage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 640 } });
  const page = await context.newPage();
  const origin = 'http://og.vert.invalid';
  await page.route(`${origin}/**`, (route) => {
    const path = join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!path.startsWith(ROOT)) return route.abort();
    try {
      const body = readFileSync(path);
      return route.fulfill({ body, contentType: CONTENT_TYPES[extname(path)] ?? 'text/plain' });
    } catch {
      return route.fulfill({ status: 404 });
    }
  });
  await page.goto(`${origin}/scripts/og-image.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
  );
  const out = join(ROOT, 'public', 'og-image.png');
  await page.screenshot({ path: out });
  report(out);
  await context.close();
}

const browser = await chromium.launch();
try {
  const reachable = await fetch(BASE).then(
    (response) => response.ok,
    () => false,
  );
  if (!reachable) {
    throw new Error(`Nothing answers at ${BASE}. Run \`pnpm build && pnpm preview --port 4173\`.`);
  }
  console.log(`Capturing from ${BASE}`);
  await capturePosters(browser);
  await captureView(browser, {
    width: 1440,
    height: 900,
    touch: false,
    maxSide: 1800,
    name: 'view',
  });
  await captureView(browser, {
    width: 390,
    height: 844,
    touch: true,
    maxSide: 1200,
    name: 'view-phone',
  });
  await captureUpload(browser);
  await captureOgImage(browser);
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
