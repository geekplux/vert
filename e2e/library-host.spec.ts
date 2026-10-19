import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { build, type Rolldown } from 'vite';
import { decodePng } from './files';

/**
 * The built library in a foreign host (src/vert-lib/README.md): `vite.lib.config.ts` is built
 * afresh, then e2e/library-host (a dark page whose own `--ink` means something else, Vert's
 * tokens set on a wrapper around Vert) is bundled against those files, served under
 * /library-host/ and checked in a real browser: axe with contrast, the profile's CSS and the
 * terrain's colours following the wrapper, the view and the slider by keyboard.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const BASE = '/library-host/';

interface Served {
  readonly type: string;
  readonly body: string | Uint8Array;
}

const TYPES: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
};

let site: Map<string, Served>;

// One worker per width builds the library and the host once for the three tests.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Per worker: the two widths build side by side.
  const libDir = join(ROOT, 'test-results', `library-host-${String(test.info().workerIndex)}`);
  await build({
    configFile: join(ROOT, 'vite.lib.config.ts'),
    root: ROOT,
    logLevel: 'silent',
    build: { outDir: libDir, emptyOutDir: true },
  });
  const output = (await build({
    configFile: false,
    root: join(ROOT, 'e2e', 'library-host'),
    base: BASE,
    logLevel: 'silent',
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^vert-lib$/, replacement: join(libDir, 'index.js') },
        { find: /^vert-lib\//, replacement: `${libDir}/` },
      ],
    },
    build: { write: false, outDir: join(libDir, 'site'), emptyOutDir: false },
  })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];
  site = new Map();
  for (const item of (Array.isArray(output) ? output[0] : output)?.output ?? []) {
    const type = TYPES[item.fileName.split('.').pop() ?? ''] ?? 'application/octet-stream';
    site.set(item.fileName, { type, body: item.type === 'chunk' ? item.code : item.source });
  }
});

/** Serves the host page under /library-host/ (nothing else of the app is involved). */
async function openHost(page: Page) {
  await page.route(`**${BASE}**`, async (route) => {
    const name = new URL(route.request().url()).pathname.slice(BASE.length) || 'index.html';
    const file = site.get(name);
    if (!file) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({ status: 200, contentType: file.type, body: Buffer.from(file.body) });
  });
  await page.goto(BASE);
  await expect(page.locator('canvas[role="img"][data-visible]')).toBeAttached({ timeout: 30_000 });
  // The canvas fades in (and the intro moves the camera): let both finish.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.waitForTimeout(1300);
}

test('a dark host with Vert’s tokens on a wrapper: axe passes, contrast included', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHost(page);
  await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: typeof import('axe-core') }).axe;
    const result = await axe.run(document, { rules: { region: { enabled: true } } });
    return result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
  });
  expect(violations).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the profile and the terrain both follow the wrapper’s tokens, not the page’s', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHost(page);
  const slider = page.getByRole('slider', { name: 'Elevation profile' });
  const styles = await slider.evaluate((plot) => {
    const line = plot.querySelector('svg path:last-of-type');
    const tick = plot.parentElement?.querySelector('[aria-hidden="true"] span');
    return {
      line: line ? getComputedStyle(line).stroke : '',
      tick: tick ? getComputedStyle(tick).color : '',
    };
  });
  expect(styles).toEqual({ line: 'rgb(230, 237, 243)', tick: 'rgb(154, 168, 181)' });

  // The terrain: dark fill (--surface #1d2a36, shaded darker) with light ridge lines, where the
  // page's own --surface (#ffffff) would have drawn it white.
  const pixels = decodePng(await page.locator('canvas[role="img"]').screenshot());
  let sum = 0;
  let light = 0;
  const n = pixels.width * pixels.height;
  const channels = pixels.data.length / n;
  for (let i = 0; i < n; i++) {
    const r = pixels.data[i * channels] ?? 0;
    const g = pixels.data[i * channels + 1] ?? 0;
    const b = pixels.data[i * channels + 2] ?? 0;
    const value = (r + g + b) / (3 * 255);
    sum += value;
    if (value > 0.4) light++;
  }
  expect(sum / n).toBeLessThan(0.3);
  expect(light / n).toBeGreaterThan(0.005);
});

test('the view and the slider work by keyboard, with the focus ring in --route', async ({
  page,
}) => {
  await openHost(page);
  const canvas = page.getByRole('img', { name: '3D terrain of the Coosa Backcountry Trail' });
  const view = canvas.locator('xpath=..');
  await page.keyboard.press('Tab');
  await expect(view).toBeFocused();
  expect(await view.evaluate((element) => getComputedStyle(element).outlineColor)).toBe(
    'rgb(255, 138, 61)',
  );
  await page.keyboard.press('Tab');
  const slider = page.getByRole('slider', { name: 'Elevation profile' });
  await expect(slider).toBeFocused();
  await expect(slider).toHaveAttribute('aria-valuenow', '200');
  await page.keyboard.press('End');
  const end = Number(await slider.getAttribute('aria-valuenow'));
  expect(end).toBeGreaterThan(20_000);
  await expect(slider).toHaveAttribute('aria-valuetext', /^km 21\.\d, \d+ m$/);
});
