import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page, Request, Route } from '@playwright/test';
import {
  countPixels,
  decodePng,
  greyCells,
  near,
  pdfSummary,
  pngInfo,
  type Pixels,
  type Rect,
} from './files';
import { serveSyntheticTiles } from './tiles';

/**
 * The real export (phase 3, task 6), driven by keyboard through Poster mode: the files' sizes,
 * resolution and contents (terrain and text both drawn), the PDF's page, a Latin Extended title
 * drawn with the right glyphs, Cancel, and the network log (CLAUDE.md "Privacy": only same-origin
 * assets and tile z/x/y). The posters are large, so this runs once, at 1440.
 */

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Exports run once, at 1440.');
test.setTimeout(180_000);
// One after another in one worker: each export keeps a renderer and the CPU busy.
test.describe.configure({ mode: 'default' });

/** What the app may ask its origin for. */
const ALLOWED_PATHS = [
  /^\/$/,
  // Hashed build files; the WebP images are the Upload page's example posters.
  /^\/assets\/[\w.-]+\.(js|css|svg|webp)$/,
  /^\/fonts\/[\w.-]+\.woff2$/,
  /^\/samples\/coosa-backcountry\.gpx$/,
  /^\/tiles\/\d{1,2}\/\d{1,5}\/\d{1,5}\.png$/,
  /^\/favicon\.svg$/,
];

/** 300 dpi in pixels per metre, as pHYs stores it. */
const DPI_300 = Math.round(300 / 0.0254);

const ROUTE = '#C2410C';
const INK_A = '#1B2A3A';

function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  return requests;
}

function expectPrivate(requests: readonly Request[], baseURL: string | undefined) {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  for (const request of requests) {
    const url = new URL(request.url());
    // The download itself is a blob: URL made in the page; nothing is sent anywhere.
    if (url.protocol === 'blob:' || url.protocol === 'data:') continue;
    expect(url.origin, `request to another origin: ${request.url()}`).toBe(origin);
    expect(url.search, `query string on ${request.url()}`).toBe('');
    expect(
      ALLOWED_PATHS.some((allowed) => allowed.test(url.pathname)),
      `unexpected request ${url.pathname}`,
    ).toBe(true);
    expect(request.method()).toBe('GET');
    expect(request.postData()).toBeNull();
  }
}

function isFocused(target: Locator) {
  return () =>
    target
      .evaluate((element) => element === element.ownerDocument.activeElement)
      .catch(() => false);
}

async function tabUntil(page: Page, target: Locator, max = 60, key = 'Tab') {
  const focused = isFocused(target);
  if (await focused()) return;
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(key);
    if (await focused()) return;
  }
  throw new Error(`${key} ×${String(max)} never reached the target`);
}

/** Focuses a radio group by Tab and arrows to `target`. */
async function chooseRadio(page: Page, group: Locator, target: Locator) {
  await tabUntil(page, group.locator('input:checked'));
  for (let i = 0; i < 6 && !(await target.isChecked()); i += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(target).toBeChecked();
}

const pngButton = (page: Page) => page.getByRole('button', { name: /^Download PNG · / });
const pdfButton = (page: Page) => page.getByRole('button', { name: 'Download PDF for print' });
const poster = (page: Page) => page.getByRole('img', { name: /^Poster: / });

/** The sample, by keyboard, then Make a poster. */
async function openPoster(page: Page) {
  await page.goto('/');
  await tabUntil(page, page.getByRole('button', { name: 'Try the sample run', exact: true }), 5);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => performance.getEntriesByName('vert:first-frame').length > 0,
    null,
    { timeout: 30_000 },
  );
  await tabUntil(page, page.getByRole('button', { name: 'Make a poster' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Make a poster' })).toBeFocused();
}

async function chooseStyle(page: Page, name: string) {
  const group = page.getByRole('radiogroup', { name: 'Style' });
  await chooseRadio(page, group, page.getByRole('radio', { name }));
}

async function chooseSize(page: Page, name: RegExp) {
  const group = page.getByRole('radiogroup', { name: 'Size' });
  await chooseRadio(page, group, page.getByRole('radio', { name }));
}

/** Waits until the preview has drawn its figure (A: the terrain canvas; B, E: their SVG). */
async function previewReady(page: Page, figure: 'terrain' | 'ridges' | 'contours') {
  await expect(poster(page).locator(`[data-figure="${figure}"]`)).toBeAttached({
    timeout: 30_000,
  });
}

/** Presses `button` by keyboard and returns the downloaded file and its suggested name. */
async function download(page: Page, button: Locator) {
  await tabUntil(page, button);
  const [file] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.keyboard.press('Enter'),
  ]);
  const path = await file.path();
  await expect(page.getByText(`Saved ${file.suggestedFilename()}`, { exact: true })).toBeVisible();
  return { name: file.suggestedFilename(), bytes: await readFile(path) };
}

/** A slot of the preview poster, in output px of an export `outputWidth` wide. */
async function slotInOutput(page: Page, slot: string, outputWidth: number): Promise<Rect> {
  const root = await poster(page).boundingBox();
  const box = await poster(page).locator(`[data-slot="${slot}"]`).first().boundingBox();
  if (!root || !box) throw new Error(`No ${slot} slot`);
  const k = outputWidth / root.width;
  return {
    x: (box.x - root.x) * k,
    y: (box.y - root.y) * k,
    width: box.width * k,
    height: box.height * k,
  };
}

function expectTerrainAndText(pixels: Pixels, figure: Rect, title: Rect) {
  const figureArea = figure.width * figure.height;
  // The route core (#C2410C) inside the figure box: the terrain layer was drawn.
  const route = countPixels(pixels, figure, near(ROUTE, 24));
  expect(route, 'route pixels in the figure box').toBeGreaterThan(figureArea * 0.005);
  // Ridge lines (dark ink) inside the figure box too.
  const ridges = countPixels(pixels, figure, (r, g, b) => r + g + b < 3 * 140);
  expect(ridges, 'ridge-line pixels in the figure box').toBeGreaterThan(figureArea * 0.005);
  // The title's heavy ink: the text layer was drawn.
  const ink = countPixels(pixels, title, near(INK_A, 24));
  expect(ink, 'title ink').toBeGreaterThan(title.width * title.height * 0.15);
}

test.beforeEach(async ({ page }) => {
  await serveSyntheticTiles(page);
});

test('style A: 18 × 24 PNG and PDF and the 4 : 5 PNG, with terrain and text; nothing but assets and tiles is requested', async ({
  page,
  baseURL,
}) => {
  const requests = recordRequests(page);
  await openPoster(page);
  await chooseSize(page, /^18 × 24 in/);
  await previewReady(page, 'terrain');

  await test.step('18 × 24 PNG', async () => {
    const { name, bytes } = await download(page, pngButton(page));
    expect(name).toBe('vert-coosa-backcountry-trail-trail-sign-18x24.png');
    const info = pngInfo(bytes);
    expect([info.width, info.height]).toEqual([5400, 7200]);
    expect(info.phys).toEqual({ x: DPI_300, y: DPI_300, unit: 1 });
    const pixels = decodePng(bytes);
    expectTerrainAndText(
      pixels,
      await slotInOutput(page, 'figure', 5400),
      await slotInOutput(page, 'title', 5400),
    );
    // Paper in the corner.
    expect(countPixels(pixels, { x: 0, y: 0, width: 40, height: 40 }, near('#E6EAEE', 3))).toBe(
      1600,
    );
    await expect(pngButton(page)).toBeFocused();
  });

  await test.step('18 × 24 PDF', async () => {
    const { name, bytes } = await download(page, pdfButton(page));
    expect(name).toBe('vert-coosa-backcountry-trail-trail-sign-18x24.pdf');
    const pdf = pdfSummary(bytes);
    expect(pdf.header).toBe('%PDF-');
    expect(pdf.pageCount).toBe(1);
    // 18 × 24 in at 72 pt per inch.
    expect(pdf.mediaBox).toEqual([0, 0, 1296, 1728]);
    expect(pdf.jpeg).toEqual({ width: 5400, height: 7200 });
    await expect(pdfButton(page)).toBeFocused();
  });

  await test.step('4 : 5 PNG', async () => {
    await chooseSize(page, /^4 : 5/);
    await previewReady(page, 'terrain');
    const { name, bytes } = await download(page, pngButton(page));
    expect(name).toBe('vert-coosa-backcountry-trail-trail-sign-4x5.png');
    const info = pngInfo(bytes);
    expect([info.width, info.height]).toEqual([1080, 1350]);
    expect(info.phys).toBeNull();
    const pixels = decodePng(bytes);
    const figure = await slotInOutput(page, 'figure', 1080);
    expect(countPixels(pixels, figure, near(ROUTE, 24))).toBeGreaterThan(
      figure.width * figure.height * 0.003,
    );
  });

  expectPrivate(requests, baseURL);
  expect(requests.some((request) => /\/assets\/export-[\w-]+\.js$/.test(request.url()))).toBe(true);
});

test('styles B and E: 18 × 24 PNGs with their figures drawn', async ({ page, baseURL }) => {
  const requests = recordRequests(page);
  await openPoster(page);
  await chooseSize(page, /^18 × 24 in/);

  await test.step('B · Night Ridge', async () => {
    await chooseStyle(page, 'B Night Ridge');
    await previewReady(page, 'ridges');
    const { name, bytes } = await download(page, pngButton(page));
    expect(name).toBe('vert-coosa-backcountry-trail-night-ridge-18x24.png');
    const info = pngInfo(bytes);
    expect([info.width, info.height]).toEqual([5400, 7200]);
    expect(info.phys).toEqual({ x: DPI_300, y: DPI_300, unit: 1 });
    const pixels = decodePng(bytes);
    const figure = await slotInOutput(page, 'figure', 5400);
    const title = await slotInOutput(page, 'title', 5400);
    // Night paper, light ridges (#8EC5DA strokes) and the route (#FFD9A0) in the stage.
    expect(countPixels(pixels, { x: 0, y: 0, width: 40, height: 40 }, near('#0F2233', 3))).toBe(
      1600,
    );
    const area = figure.width * figure.height;
    expect(countPixels(pixels, figure, near('#8EC5DA', 40))).toBeGreaterThan(area * 0.005);
    expect(countPixels(pixels, figure, near('#FFD9A0', 24))).toBeGreaterThan(area * 0.0005);
    expect(countPixels(pixels, title, near('#E8F1F5', 24))).toBeGreaterThan(
      title.width * title.height * 0.15,
    );
  });

  await test.step('E · Survey Quad', async () => {
    await chooseStyle(page, 'E Survey Quad');
    await previewReady(page, 'contours');
    const { name, bytes } = await download(page, pngButton(page));
    expect(name).toBe('vert-coosa-backcountry-trail-survey-quad-18x24.png');
    const info = pngInfo(bytes);
    expect([info.width, info.height]).toEqual([5400, 7200]);
    const pixels = decodePng(bytes);
    const figure = await slotInOutput(page, 'figure', 5400);
    const title = await slotInOutput(page, 'title', 5400);
    const area = figure.width * figure.height;
    // Contours (#9A5B2E) and the black dashed route on the map.
    expect(countPixels(pixels, figure, near('#9A5B2E', 40))).toBeGreaterThan(area * 0.005);
    expect(countPixels(pixels, figure, near('#1E1B18', 24))).toBeGreaterThan(area * 0.002);
    expect(countPixels(pixels, title, near('#1E1B18', 24))).toBeGreaterThan(
      title.width * title.height * 0.05,
    );
  });

  expectPrivate(requests, baseURL);
});

test('a Latin Extended title is drawn in the export with the glyphs the preview shows', async ({
  page,
}) => {
  const title = 'Żółta Góra — Ålesund';
  await openPoster(page);
  await chooseSize(page, /^18 × 24 in/);
  const field = page.getByRole('textbox', { name: 'Title', exact: true });
  await tabUntil(page, field);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(title);
  await expect(poster(page)).toHaveAccessibleName(new RegExp(`^Poster: ${title}`));
  await previewReady(page, 'terrain');
  // Let the title settle in its loaded faces before the screenshot.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const slot = poster(page).locator('[data-slot="title"]');
  const shot = decodePng(await slot.screenshot());

  const { name, bytes } = await download(page, pngButton(page));
  expect(name).toMatch(/^vert-.*-18x24\.png$/);
  const pixels = decodePng(bytes);
  const crop = await slotInOutput(page, 'title', 5400);
  // Both at a third of the preview's resolution, so sub-pixel placement does not count.
  const w = Math.floor(shot.width / 3);
  const h = Math.floor(shot.height / 3);
  const exported = greyCells(pixels, crop, w, h);
  const preview = greyCells(shot, { x: 0, y: 0, width: shot.width, height: shot.height }, w, h);
  const paperGrey = 0.299 * 0xe6 + 0.587 * 0xea + 0.114 * 0xee;
  /** Mean grey difference between the export (moved `dx` cells) and the preview. */
  const difference = (dx: number) => {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = Math.min(w - 1, Math.max(0, x + dx));
        sum += Math.abs((exported[y * w + from] ?? 0) - (preview[y * w + x] ?? 0));
      }
    }
    return sum / (w * h);
  };
  const ink = preview.reduce((sum, grey) => sum + Math.abs(paperGrey - grey), 0) / (w * h);
  expect(ink, 'the title has ink').toBeGreaterThan(20);
  // The same glyphs (accents and ring included) in the same places differ only by resampling:
  // far less than blank paper does, and far less than the same title moved by 6 preview px (a
  // fallback face's different advances would move every glyph after the first more than that).
  const same = difference(0);
  expect(same / ink, 'export vs preview, relative to blank paper').toBeLessThan(0.15);
  expect(same, 'export vs preview, relative to a 6 px shift').toBeLessThan(difference(2) * 0.4);

  // The diacritics sit above the first line's capitals: ink in the band above the cap height.
  const lineHeight = crop.height / 2;
  const top = countPixels(pixels, { ...crop, height: lineHeight * 0.18 }, near(INK_A, 30));
  expect(top, 'accent ink above the first line').toBeGreaterThan(500);
});

test('Cancel mid-export returns to Poster mode and saves nothing', async ({ page }) => {
  const downloads: string[] = [];
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  // Hold the export code back a moment, so Cancel lands while the export is preparing.
  await page.route(/\/assets\/export-[\w-]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fallback();
  });
  await openPoster(page);
  await chooseSize(page, /^18 × 24 in/);
  await previewReady(page, 'terrain');

  await tabUntil(page, pngButton(page));
  await page.keyboard.press('Enter');
  const label = page.locator('p', {
    hasText: /^(Preparing…|Rendering tile \d+ of \d+|Saving the file…)$/,
  });
  await expect(label).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeHidden();
  await expect(pngButton(page)).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Export cancelled.' })).toBeAttached();

  // Long enough for the held-back code to arrive and the export to have finished.
  await page.waitForTimeout(4_000);
  expect(downloads).toEqual([]);
  await expect(page.locator('[data-vert-export]')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Make a poster' })).toBeVisible();

  // Cancel while tiles render: wait for a tile report, then Cancel.
  await page.unroute(/\/assets\/export-[\w-]+\.js$/);
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 8 });
  await page.keyboard.press('Enter');
  await expect(label).toBeFocused();
  await expect(label).toHaveText(/^Rendering tile \d+ of 8$/, { timeout: 60_000 });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(pngButton(page)).toBeFocused();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForTimeout(4_000);
  expect(downloads).toEqual([]);
  await expect(page.locator('[data-vert-export]')).toHaveCount(0);
});

test('a one-time canvas failure can be retried, and every progress label is painted', async ({
  page,
}) => {
  // The 18 × 24 output canvas throws once, as a transient allocation failure would.
  await page.addInitScript(() => {
    const Real = OffscreenCanvas;
    let failed = false;
    window.OffscreenCanvas = class extends Real {
      constructor(width: number, height: number) {
        if (!failed && width === 5400 && height === 7200) {
          failed = true;
          throw new RangeError('Simulated allocation failure');
        }
        super(width, height);
      }
    };
  });
  // The progress label as each frame is about to be painted.
  await page.addInitScript(() => {
    const painted: string[] = [];
    Object.assign(window, { vertPainted: painted });
    const label = /^(Preparing…|Rendering tile \d+ of \d+|Saving the file…)$/;
    const frame = () => {
      const text = [...document.querySelectorAll('p')]
        .map((p) => p.textContent)
        .find((t) => label.test(t));
      if (text && painted.at(-1) !== text) painted.push(text);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await openPoster(page);
  await chooseSize(page, /^18 × 24 in/);
  await previewReady(page, 'terrain');

  await tabUntil(page, pngButton(page));
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('This poster is too large for this browser. Try a smaller size.').first(),
  ).toBeVisible({ timeout: 60_000 });

  // The next Download tries the size again, and it works now.
  await page.evaluate(() => {
    (window as unknown as { vertPainted: string[] }).vertPainted.length = 0;
  });
  const { name } = await download(page, pngButton(page));
  expect(name).toBe('vert-coosa-backcountry-trail-trail-sign-18x24.png');
  const painted = await page.evaluate(
    () => (window as unknown as { vertPainted: string[] }).vertPainted,
  );
  expect(painted).toEqual([
    'Preparing…',
    ...Array.from({ length: 8 }, (_, i) => `Rendering tile ${String(i + 1)} of 8`),
    'Saving the file…',
  ]);
});

test('with the tiles refused, Night Ridge exports without its terrain and Trail Sign says why it cannot', async ({
  page,
}) => {
  // Registered after the synthetic tiles, so it wins: every tile request fails.
  await page.route('**/tiles/**', (route) => route.abort());
  await page.goto('/');
  await tabUntil(page, page.getByRole('button', { name: 'Try the sample run', exact: true }), 5);
  await page.keyboard.press('Enter');
  await tabUntil(page, page.getByRole('button', { name: 'Make a poster' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Make a poster' })).toBeFocused();
  const note = poster(page).locator('[data-figure="placeholder"]');

  await chooseStyle(page, 'Night Ridge');
  await expect(note).toHaveText('The terrain couldn’t be drawn.', { timeout: 30_000 });
  // No relief, so no exaggeration either.
  await expect(poster(page).locator('[data-slot="footer"]')).not.toContainText('ELEVATION ×');
  const started = Date.now();
  const file = await download(page, pngButton(page));
  expect(Date.now() - started).toBeLessThan(30_000);
  expect(file.name).toBe('vert-coosa-backcountry-trail-night-ridge-18x24.png');
  expect(pngInfo(file.bytes)).toMatchObject({ width: 5400, height: 7200 });

  await chooseStyle(page, 'Trail Sign');
  await expect(note).toHaveText('The terrain couldn’t be drawn.', { timeout: 30_000 });
  await tabUntil(page, pngButton(page));
  await page.keyboard.press('Enter');
  // Shown under the button (and also read out by the live region).
  await expect(
    page
      .getByText(
        'The terrain for this poster couldn’t be loaded. Check your connection and try again.',
        { exact: true },
      )
      .first(),
  ).toBeVisible({ timeout: 30_000 });
});

/**
 * Poster mode on the sample in `style`, with every tile refused until the returned `allow()`
 * (the refusal is registered after the synthetic tiles, so it wins until it is removed). One style
 * per page: the tiles one figure loads are cached for the next.
 */
async function posterWithTilesRefused(page: Page, style: string) {
  const refuse = (route: Route) => route.abort();
  await page.route('**/tiles/**', refuse);
  await page.goto('/');
  await tabUntil(page, page.getByRole('button', { name: 'Try the sample run', exact: true }), 5);
  await page.keyboard.press('Enter');
  await tabUntil(page, page.getByRole('button', { name: 'Make a poster' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Make a poster' })).toBeFocused();
  await chooseStyle(page, style);
  await expect(poster(page).locator('[data-figure="placeholder"]')).toHaveText(
    'The terrain couldn’t be drawn.',
    { timeout: 30_000 },
  );
  return { allow: () => page.unroute('**/tiles/**', refuse) };
}

test('once the tiles are back, Download draws Night Ridge’s terrain and the preview follows', async ({
  page,
}) => {
  const { allow } = await posterWithTilesRefused(page, 'Night Ridge');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await allow();
  const file = await download(page, pngButton(page));
  expect(file.name).toBe('vert-coosa-backcountry-trail-night-ridge-18x24.png');
  // The preview shows what the file shows: the ridges and the exaggeration, no note.
  await previewReady(page, 'ridges');
  await expect(poster(page).locator('[data-figure="placeholder"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();
  await expect(poster(page).locator('[data-slot="footer"]')).toContainText('ELEVATION ×2.4');
});

test('Survey Quad without terrain draws its route flat and drops its contour key; Try again draws the contours', async ({
  page,
}) => {
  const { allow } = await posterWithTilesRefused(page, 'Survey Quad');
  const legend = poster(page).locator('[data-slot="legend"]');
  await expect(legend).toContainText('Route run');
  await expect(legend).not.toContainText('contour');
  await expect(poster(page).locator('[data-slot="credit"]')).not.toContainText('ELEVATION');
  // A top-down map needs no terrain for the route, its ○ marker and the scale bar.
  await expect(poster(page).locator('[data-route="line"]')).toHaveAttribute('d', /^M/);
  await expect(poster(page).locator('[data-marker="start"]')).toBeAttached();
  await expect(poster(page).locator('[data-scale-bar]')).toBeAttached();
  await expect(poster(page).locator('[data-contour="index"]')).toHaveAttribute('d', '');

  // By keyboard, once the tiles are back: the map is drawn and focus moves to Download PNG.
  await allow();
  const tryAgain = page.getByRole('button', { name: 'Try again' });
  await tabUntil(page, tryAgain);
  await page.keyboard.press('Enter');
  await expect(poster(page).locator('[data-contour="index"]')).toHaveAttribute('d', /^M/, {
    timeout: 30_000,
  });
  await expect(tryAgain).toBeHidden();
  await expect(legend).toContainText('Index contour');
  await expect(pngButton(page)).toBeFocused();
});
