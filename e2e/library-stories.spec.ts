import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The library's Ladle story "Library / Host sync" (src/vert-lib/Library.stories.tsx) in a real
 * browser: Ladle is built afresh, served from a stand-in origin, and the story is checked with axe
 * (contrast included) at both widths and driven by keyboard both ways: the stand-in heart-rate
 * chart's position moves Vert's scrub (`metresAtTime`), the profile moves the chart's time
 * (`onScrub` + `timeAtMetres`), and Escape clears both.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const LADLE_CLI = join(ROOT, 'node_modules', '@ladle', 'react', 'lib', 'cli', 'cli.js');
const ORIGIN = 'http://ladle.test';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

let outDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  test.setTimeout(120_000);
  // Per worker: the two widths build side by side.
  const relative = join('test-results', `ladle-${String(test.info().workerIndex)}`);
  outDir = join(ROOT, relative);
  // Ladle joins `--outDir` onto the working directory, so it takes a relative path.
  execFileSync(process.execPath, [LADLE_CLI, 'build', '--outDir', relative], {
    cwd: ROOT,
    stdio: 'pipe',
  });
});

/** Serves the Ladle build from ORIGIN and opens the Host sync story on its own. */
async function openStory(page: Page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = normalize(join(outDir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(outDir)) {
      await route.fulfill({ status: 404 });
      return;
    }
    try {
      const body = readFileSync(file);
      const contentType = TYPES[extname(file)] ?? 'application/octet-stream';
      await route.fulfill({ status: 200, contentType, body });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto(`${ORIGIN}/?story=library--host-sync&mode=preview`);
  await expect(page.locator('canvas[role="img"][data-visible]')).toBeAttached({ timeout: 30_000 });
  await page.waitForFunction(() => document.getAnimations().length === 0);
}

const term = (page: Page, name: string) =>
  page.locator('dt', { hasText: name }).locator('xpath=following-sibling::dd[1]');

test('Host sync: axe passes, contrast included, with and without a position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStory(page);
  await page.addScriptTag({ path: AXE_PATH });
  const audit = () =>
    page.evaluate(async () => {
      const axe = (window as unknown as { axe: typeof import('axe-core') }).axe;
      const result = await axe.run(document);
      const violations = result.violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
      );
      // Best-practice rules run too: the page has its one h1.
      if (!result.passes.some((rule) => rule.id === 'page-has-heading-one')) {
        violations.push('page-has-heading-one: not passed');
      }
      return violations;
    });
  await expect(page.getByRole('heading', { level: 1, name: 'Host sync' })).toBeVisible();
  expect(await audit()).toEqual([]);
  const profile = page.getByRole('slider', { name: 'Elevation profile' });
  await profile.focus();
  await page.keyboard.press('PageUp');
  await expect(profile).toHaveAttribute('aria-valuetext', /^km \d+\.\d, [\d,]+ m$/);
  expect(await audit()).toEqual([]);
  // Scrolled to the end, as a reader leaves it.
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  expect(await audit()).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Host sync: the chart drives the scrub, the profile drives the chart, Escape clears both', async ({
  page,
}) => {
  await openStory(page);
  const profile = page.getByRole('slider', { name: 'Elevation profile' });
  const chart = page.getByRole('slider', { name: 'Heart-rate chart position' });

  // Nothing selected yet.
  await expect(profile).toHaveAttribute('aria-valuetext', 'No position selected');
  await expect(profile).toHaveAttribute('aria-valuenow', '200');
  await expect(chart).toHaveAttribute('aria-valuetext', 'No time selected');

  // The chart's first seconds are in the trimmed start: a time, but no scrub.
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await expect(term(page, 'Time')).toHaveText('0:01 elapsed');
  await expect(chart).toHaveAttribute('aria-valuetext', /^0:01 elapsed, \d+ bpm$/);
  await expect(term(page, 'Scrub')).toHaveText(/^Not on the drawn route/);
  await expect(profile).toHaveAttribute('aria-valuetext', 'No position selected');

  // Half-way through the run: Vert's scrub follows, in metres from the real start.
  const max = Number(await chart.getAttribute('max'));
  await chart.fill(String(Math.round(max / 2)));
  await expect(term(page, 'Scrub')).toHaveText(/^km \d+\.\d\d from the start$/);
  const metres = Number(await profile.getAttribute('aria-valuenow'));
  expect(metres).toBeGreaterThan(5_000);
  expect(metres).toBeLessThan(16_000);
  await expect(profile).toHaveAttribute('aria-valuetext', /^km \d+\.\d, [\d,]+ m$/);

  // The profile drives the chart: Home is the drawn start, some minutes into the run.
  await profile.focus();
  await page.keyboard.press('Home');
  await expect(profile).toHaveAttribute('aria-valuenow', '200');
  await expect(term(page, 'Scrub')).toHaveText('km 0.20 from the start');
  await expect(term(page, 'Time')).toHaveText(/^\d+:\d\d elapsed$/);
  await expect(term(page, 'Time')).not.toHaveText('0:00 elapsed');
  await expect(chart).toHaveAttribute('aria-valuetext', /^\d+:\d\d elapsed, \d+ bpm$/);
  // The chart's value, its value text and the readout agree, to the second.
  const time = (await term(page, 'Time').textContent()) ?? '';
  expect(await chart.getAttribute('aria-valuetext')).toMatch(new RegExp(`^${time}, `));
  const [minutes = 0, seconds = 0] = time.replace(' elapsed', '').split(':').map(Number);
  await expect(chart).toHaveValue(String(minutes * 60 + seconds));

  // Escape on the profile clears the scrub, and the host clears its chart time with it.
  await page.keyboard.press('Escape');
  await expect(profile).toHaveAttribute('aria-valuetext', 'No position selected');
  await expect(term(page, 'Time')).toHaveText('No time selected');
  await expect(term(page, 'Scrub')).toHaveText('No position selected');
  await expect(chart).toHaveAttribute('aria-valuetext', 'No time selected');
});
