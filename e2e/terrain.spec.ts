import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import { serveSyntheticTiles } from './tiles';

/**
 * The live terrain in the View (phase 3): the three.js chunk stays out of the Upload state, a run
 * reaches its first terrain frame within the 5 s budget (BRIEF), only same-origin assets and tile
 * z/x/y requests are made (CLAUDE.md "Privacy"), and below 600px the legend and buttons sit under
 * the terrain instead of over it (DECISIONS "Terrain overlays").
 */

const SAMPLE_GPX = fileURLToPath(
  new URL('../public/samples/coosa-backcountry.gpx', import.meta.url),
);

/** What the app may ask its origin for. Everything else (or any other origin) fails the test. */
const ALLOWED_PATHS = [
  /^\/$/,
  /^\/assets\/[\w.-]+\.(js|css|svg)$/,
  /^\/fonts\/[\w.-]+\.woff2$/,
  /^\/samples\/coosa-backcountry\.gpx$/,
  /^\/tiles\/\d{1,2}\/\d{1,5}\/\d{1,5}\.png$/,
  /^\/favicon\.svg$/,
];

function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  return requests;
}

function waitForFirstFrame(page: Page) {
  return page.waitForFunction(
    () => performance.getEntriesByName('vert:first-frame').length > 0,
    null,
    { timeout: 15_000 },
  );
}

/** ms from choosing the file to the first terrain frame (perfMarks.ts). */
function chooseToFrame(page: Page) {
  return page.evaluate(() => {
    const at = (name: string) => performance.getEntriesByName(name)[0]?.startTime ?? Number.NaN;
    return at('vert:first-frame') - at('vert:chosen');
  });
}

function expectPrivate(requests: Request[], baseURL: string | undefined) {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  for (const request of requests) {
    const url = new URL(request.url());
    expect(url.origin, `request to another origin: ${request.url()}`).toBe(origin);
    expect(url.search, `query string on ${request.url()}`).toBe('');
    expect(
      ALLOWED_PATHS.some((allowed) => allowed.test(url.pathname)),
      `unexpected request ${url.pathname}`,
    ).toBe(true);
    expect(request.method(), `${request.method()} ${url.pathname}`).toBe('GET');
    expect(request.postData(), `body on ${url.pathname}`).toBeNull();
  }
}

test.beforeEach(async ({ page }) => {
  await serveSyntheticTiles(page);
});

test('Upload does not load the terrain code; the sample reaches live terrain within 5 s', async ({
  page,
  baseURL,
}) => {
  const requests = recordRequests(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your run, as terrain.' }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');
  const terrainChunk = (request: Request) =>
    /\/assets\/TerrainView-[\w-]+\.js$/.test(request.url());
  expect(requests.filter(terrainChunk)).toEqual([]);

  await page.getByRole('button', { name: 'try a sample run' }).click();
  await waitForFirstFrame(page);
  expect(await chooseToFrame(page)).toBeLessThan(5_000);
  expect(requests.filter(terrainChunk)).toHaveLength(1);
  await expect(
    page.getByRole('img', { name: /^3D terrain of Coosa Backcountry Trail: 21\.\d km loop, / }),
  ).toBeVisible();
  await expect(page.getByText('Loading terrain…')).toHaveCount(0);
  expect(requests.some((request) => /\/tiles\/\d+\/\d+\/\d+\.png$/.test(request.url()))).toBe(true);
  expectPrivate(requests, baseURL);
});

test('a file the user drops never leaves the browser: only assets and tile z/x/y', async ({
  page,
  baseURL,
}) => {
  const requests = recordRequests(page);
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_GPX);
  await waitForFirstFrame(page);
  expect(await chooseToFrame(page)).toBeLessThan(5_000);
  expectPrivate(requests, baseURL);
  // The file itself was read locally, not fetched.
  expect(requests.some((request) => request.url().includes('/samples/'))).toBe(false);
});

/** A ~13 km loop on Taveuni, Fiji, centred on 180°: longitudes as a GPX stores them, ±180. */
function antimeridianGpx(): Buffer {
  const points: string[] = [];
  for (let i = 0; i <= 600; i++) {
    const a = (i / 600) * 2 * Math.PI;
    const lat = -16.86 + 0.0165 * Math.sin(a);
    let lon = 180 + 0.0225 * Math.cos(a);
    if (lon >= 180) lon -= 360;
    points.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>300</ele></trkpt>`);
  }
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Taveuni Dateline</name><trkseg>${points.join('')}</trkseg></trk></gpx>`);
}

test('a run across the antimeridian gets its own few tiles, on both sides of 180°', async ({
  page,
  baseURL,
}) => {
  const requests = recordRequests(page);
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'taveuni.gpx',
    mimeType: 'application/gpx+xml',
    buffer: antimeridianGpx(),
  });
  await waitForFirstFrame(page);
  await expect(
    page.getByRole('img', { name: /^3D terrain of Taveuni Dateline: 13\.\d km loop, / }),
  ).toBeVisible();
  const tiles = requests
    .map((request) => /\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(new URL(request.url()).pathname))
    .filter((match) => match !== null)
    .map((match) => match.slice(1).map(Number) as [number, number, number]);
  // Not the whole world at z2 (the box used to span the globe): a run-sized area, x in range.
  expect(tiles.length).toBeGreaterThan(0);
  expect(tiles.length).toBeLessThanOrEqual(32);
  for (const [z, x] of tiles) {
    expect(z).toBeGreaterThanOrEqual(12);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(2 ** z);
  }
  const n = 2 ** (tiles[0]?.[0] ?? 0);
  expect(tiles.some(([, x]) => x === 0)).toBe(true);
  expect(tiles.some(([, x]) => x === n - 1)).toBe(true);
  expectPrivate(requests, baseURL);
});

test('legend and buttons overlay the terrain on wide screens and sit under it on phones', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample run' }).click();
  await waitForFirstFrame(page);
  const canvas = await page.getByRole('img', { name: /^3D terrain of / }).boundingBox();
  const rotate = await page.getByRole('button', { name: 'Rotate view' }).boundingBox();
  const flat = await page.getByRole('button', { name: 'Flat map' }).boundingBox();
  const chip = await page.getByText('Start / finish').boundingBox();
  if (!canvas || !rotate || !flat || !chip) throw new Error('terrain box not laid out');
  const bottom = canvas.y + canvas.height;
  const width = page.viewportSize()?.width ?? 0;

  if (width < 600) {
    for (const overlay of [rotate, flat, chip]) expect(overlay.y).toBeGreaterThanOrEqual(bottom);
    // Chip left, buttons right.
    expect(chip.x).toBeLessThan(rotate.x);
    expect(flat.x + flat.width).toBeLessThanOrEqual(canvas.x + canvas.width + 0.5);
  } else {
    for (const overlay of [rotate, flat, chip]) {
      expect(overlay.y).toBeGreaterThanOrEqual(canvas.y);
      expect(overlay.y + overlay.height).toBeLessThanOrEqual(bottom);
    }
  }
});

test('Try again keeps focus with the terrain: the loading text, then the drawn terrain', async ({
  page,
}) => {
  // No tile comes through: the terrain fails; then they come, slowly enough to see loading.
  let failing = true;
  await page.route(/\/tiles\/\d+\/\d+\/\d+\.png$/, async (route) => {
    if (failing) {
      await route.abort();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fallback();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample run' }).click();
  const retry = page.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  // Until the terrain is drawn, Rotate view and Flat map are inert and say why.
  for (const name of ['Rotate view', 'Flat map']) {
    const button = page.getByRole('button', { name });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAccessibleDescription(/couldn't load/);
  }

  failing = false;
  await retry.focus();
  await page.keyboard.press('Enter');
  const status = page.getByRole('status').filter({ hasText: 'Loading terrain…' });
  await expect(status).toBeFocused();
  const terrain = page.locator('div:has(> canvas[role="img"])');
  await waitForFirstFrame(page);
  await expect(terrain).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Terrain loaded.' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Flat map' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
