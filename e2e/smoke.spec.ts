import { expect, test } from '@playwright/test';

test('the app loads without requesting anything from another origin', async ({ page, baseURL }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    if (baseURL && !request.url().startsWith(baseURL)) foreign.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Vert' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // Privacy and self-hosting: no CDN, no analytics, no third-party fonts.
  expect(foreign).toEqual([]);
});
