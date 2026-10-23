import { expect, test } from '@playwright/test';

test('the app loads without requesting anything from another origin', async ({ page, baseURL }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    if (baseURL && !request.url().startsWith(baseURL)) foreign.push(request.url());
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your run, as terrain.' }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // Privacy and self-hosting: no CDN, no third-party fonts. Google Analytics loads on
  // vert.geekplux.com only (src/page/analytics.ts), never here.
  expect(foreign).toEqual([]);
});

test('the self-hosted fonts load', async ({ page }) => {
  await page.goto('/');
  const loaded = await page.evaluate(async () => {
    const faces = await Promise.all([
      document.fonts.load('800 condensed 72px "Archivo"', 'VERT'),
      document.fonts.load('400 12px "IBM Plex Mono"', 'KM'),
      document.fonts.load('500 12px "IBM Plex Mono"', 'KM'),
    ]);
    return faces.map((set) => set.map((face) => `${face.family} ${face.weight}`));
  });

  expect(loaded).toEqual([['Archivo 400 800'], ['IBM Plex Mono 400'], ['IBM Plex Mono 500']]);
});
