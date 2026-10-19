import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

/**
 * Opening a baked scene from a link (DECISIONS "Page: open a scene by URL"): `/?scene=<URL>` with
 * the sample scene the site serves (public/samples/coosa-backcountry.scene, the library's fixture)
 * draws the terrain from the scene alone (no tile request), shows its stats, scrubs by keyboard
 * and passes axe; the fetch carries no cookie and no referrer; a link that cannot be opened says
 * why over the Dropzone.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

function sceneUrl(baseURL: string | undefined, path = '/samples/coosa-backcountry.scene'): string {
  return new URL(path, baseURL ?? 'http://localhost:4173').href;
}

function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  return requests;
}

/** axe with every rule (contrast and `region` included), and no horizontal page scroll. */
async function expectAccessible(page: Page, state: string) {
  await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async () => {
    // Let the screen's fade-in and colour transitions finish (text mid-fade reads as low contrast).
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation instanceof CSSTransition ||
            (animation instanceof CSSAnimation &&
              animation.effect?.getTiming().iterations !== Infinity),
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    const axe = (window as unknown as { axe: typeof import('axe-core') }).axe;
    const result = await axe.run(document, { rules: { region: { enabled: true } } });
    return result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
  });
  expect(violations, `axe violations in ${state}`).toEqual([]);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth, `horizontal scroll in ${state}`).toBeLessThanOrEqual(
    overflow.innerWidth,
  );
}

test('?scene= draws the scene: terrain, stats, keyboard scrub, axe', async ({
  page,
  context,
  baseURL,
}) => {
  // A cookie on the scene's origin, which the fetch must not send.
  await context.addCookies([{ name: 'session', value: 'secret', url: sceneUrl(baseURL) }]);
  const requests = recordRequests(page);
  await page.goto(`/?scene=${encodeURIComponent(sceneUrl(baseURL))}`);

  await expect(page.getByRole('heading', { level: 1, name: 'coosa-backcountry' })).toBeVisible();
  await expect(page.getByText('SCENE · LOCALHOST')).toBeVisible();
  await page.waitForFunction(
    () => performance.getEntriesByName('vert:first-frame').length > 0,
    null,
    { timeout: 15_000 },
  );
  await expect(
    page.getByRole('img', { name: /^3D terrain of coosa-backcountry: 21\.5 km loop/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rotate view' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );

  const aside = page.getByRole('complementary', { name: 'Run details' });
  await expect(aside).toContainText('21.5');
  await expect(aside).toContainText('+1,102');
  await expect(aside).toContainText('Drawn');
  await expect(aside).toContainText('The first 200 m and the last 200 m of the run are not drawn.');
  await expect(page.getByRole('button', { name: 'Make a poster' })).toHaveCount(0);

  // The scene came over fetch, once, with no cookie and no referrer; no elevation tile was asked.
  const fetched = requests.filter(
    (request) => request.resourceType() === 'fetch' && request.url().endsWith('.scene'),
  );
  expect(fetched).toHaveLength(1);
  const [sceneRequest] = fetched;
  if (!sceneRequest) throw new Error('the scene was not fetched');
  const headers = await sceneRequest.allHeaders();
  expect(headers.cookie).toBeUndefined();
  expect(headers.referer).toBeUndefined();
  expect(
    requests.filter((request) => new URL(request.url()).pathname.startsWith('/tiles/')),
  ).toEqual([]);

  // Keyboard scrub: Tab to the profile, then End moves the readout to the drawn route's end.
  const slider = page.getByRole('slider', { name: 'Elevation profile' });
  const readout = page
    .getByRole('heading', { level: 2, name: /Elevation/ })
    .locator('xpath=following-sibling::p');
  const before = await readout.textContent();
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    if (await slider.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(slider).toBeFocused();
  await page.keyboard.press('End');
  await expect(readout).not.toHaveText(before ?? '');
  await expect(readout).toHaveText(/^km 21\.3 · /);
  await page.keyboard.press('Home');
  await expect(readout).toHaveText(/^km 0\.2 · /);

  await expectAccessible(page, 'a scene from a link');

  // New file goes to Upload and forgets the link.
  await page.getByRole('banner').getByRole('button', { name: 'New file' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your run, as terrain.' }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});

test('?scene= with a link it will not open says why, over the Dropzone', async ({ page }) => {
  await page.goto(`/?scene=${encodeURIComponent('ftp://example.com/a.scene')}`);
  await expect(page.getByRole('alert')).toHaveText(
    'Could not open that scene: only https links can be opened.',
  );
  await expect(page.getByRole('button', { name: /\.gpx file/ })).toBeVisible();
  await expectAccessible(page, 'a refused scene link');
});

test('?scene= with a file that is not a scene says so', async ({ page, baseURL }) => {
  // The preview server answers an unknown path with the app's index.html (or a 404).
  await page.goto(`/?scene=${encodeURIComponent(sceneUrl(baseURL, '/samples/missing.scene'))}`);
  await expect(page.getByRole('alert')).toHaveText(
    /^Could not open that scene: (the file is not a Vert scene|the server answered 404)\.$/,
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your run, as terrain.' }),
  ).toBeVisible();
});
