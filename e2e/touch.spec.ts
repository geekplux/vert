import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { serveSyntheticTiles } from './tiles';

/**
 * Touch at 390 (DECISIONS.md "Library 7: host feedback"): a vertical swipe that starts on the
 * terrain or on the elevation profile scrolls the page, as anywhere else on it, and changes
 * nothing; a sideways drag orbits the terrain or scrubs the profile; two fingers zoom the
 * terrain; a tap on the profile sets the position. Real touch input through the Chrome DevTools
 * Protocol, so the browser's own `touch-action` handling and its `pointercancel` are exercised.
 */

test.skip(({ hasTouch }) => !hasTouch, 'the phone project (hasTouch)');

test.beforeEach(async ({ page }) => {
  await serveSyntheticTiles(page);
});

/** The sample run in the View, its terrain drawn and settled. */
async function openSample(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the sample run', exact: true }).click();
  await page.waitForFunction(
    () => performance.getEntriesByName('vert:first-frame').length > 0,
    null,
    { timeout: 15_000 },
  );
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await page.waitForTimeout(500);
}

interface Point {
  x: number;
  y: number;
}

function touchInput(cdp: CDPSession) {
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ ...p, id })),
    });
}

/** A point of `locator`'s box, at `share` of its width and half its height. */
async function at(locator: Locator, share = 0.5): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not laid out');
  return { x: Math.round(box.x + box.width * share), y: Math.round(box.y + box.height / 2) };
}

/** A 150 px upward touch swipe from `from`; resolves to how far the page scrolled. */
async function swipeUp(page: Page, cdp: CDPSession, from: Point): Promise<number> {
  const before = await page.evaluate(() => scrollY);
  await cdp.send('Input.synthesizeScrollGesture', {
    x: from.x,
    y: from.y,
    yDistance: -150,
    gestureSourceType: 'touch',
    speed: 800,
  });
  await page.waitForTimeout(400);
  return (await page.evaluate(() => scrollY)) - before;
}

test('terrain: a vertical swipe scrolls the page and leaves the view; a sideways drag orbits, two fingers zoom', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openSample(page);
  const canvas = page.getByRole('img', { name: /^3D terrain of / });
  expect(
    await canvas.evaluate((c) => [
      getComputedStyle(c).touchAction,
      getComputedStyle(c.parentElement ?? c).touchAction,
    ]),
  ).toEqual(['pan-y', 'pan-y']);
  const cdp = await page.context().newCDPSession(page);
  const touch = touchInput(cdp);

  // The swipe scrolls about 150 px, and the drawing is the same pixels: no tilt.
  const settled = await canvas.screenshot();
  const scrolled = await swipeUp(page, cdp, await at(canvas));
  expect(scrolled).toBeGreaterThanOrEqual(130);
  expect(scrolled).toBeLessThanOrEqual(160);
  await page.waitForTimeout(400);
  const still = await canvas.screenshot();
  expect(still.equals(settled)).toBe(true);

  // A sideways one-finger drag turns the terrain and leaves the page where it was.
  const centre = await at(canvas);
  const y = await page.evaluate(() => scrollY);
  await touch('touchStart', [{ x: centre.x - 80, y: centre.y }]);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [{ x: centre.x - 80 + i * 16, y: centre.y }]);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(800);
  const turned = await canvas.screenshot();
  expect(turned.equals(still)).toBe(false);
  expect(await page.evaluate(() => scrollY)).toBe(y);

  // Two fingers spreading zoom the view, not the page.
  await touch('touchStart', [
    { x: centre.x - 20, y: centre.y },
    { x: centre.x + 20, y: centre.y },
  ]);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [
      { x: centre.x - 20 - i * 8, y: centre.y },
      { x: centre.x + 20 + i * 8, y: centre.y },
    ]);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(800);
  expect((await canvas.screenshot()).equals(turned)).toBe(false);
  expect(await page.evaluate(() => visualViewport?.scale ?? 1)).toBe(1);
  expect(await page.evaluate(() => scrollY)).toBe(y);
});

test('profile: a vertical swipe scrolls the page and sets nothing; a tap sets; a sideways drag scrubs', async ({
  page,
}) => {
  await openSample(page);
  const slider = page.getByRole('slider', { name: 'Elevation profile' });
  expect(await slider.evaluate((element) => getComputedStyle(element).touchAction)).toBe('pan-y');
  await slider.scrollIntoViewIfNeeded();
  // Room above to scroll into: the swipe must be able to move the page.
  await page.evaluate(() => {
    window.scrollBy(0, -200);
  });
  const cdp = await page.context().newCDPSession(page);
  const touch = touchInput(cdp);
  const min = Number(await slider.getAttribute('aria-valuemin'));
  const max = Number(await slider.getAttribute('aria-valuemax'));
  const valueNow = async () => Number(await slider.getAttribute('aria-valuenow'));
  const expectNear = async (share: number) => {
    expect(Math.abs((await valueNow()) - (min + (max - min) * share))).toBeLessThanOrEqual(
      (max - min) * 0.01,
    );
  };
  const before = await valueNow();
  const text = await slider.getAttribute('aria-valuetext');

  const scrolled = await swipeUp(page, cdp, await at(slider));
  expect(scrolled).toBeGreaterThanOrEqual(130);
  expect(scrolled).toBeLessThanOrEqual(160);
  expect(await valueNow()).toBe(before);
  await expect(slider).toHaveAttribute('aria-valuetext', text ?? '');

  // A tap sets the position under the finger.
  await touch('touchStart', [await at(slider, 0.25)]);
  await touch('touchEnd', []);
  await expectNear(0.25);

  // A sideways drag follows the finger, and the page does not move.
  const y = await page.evaluate(() => scrollY);
  const from = await at(slider, 0.2);
  await touch('touchStart', [from]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: from.x + i * 16, y: from.y }]);
  await touch('touchEnd', []);
  const box = await slider.boundingBox();
  if (!box) throw new Error('no slider');
  await expectNear((from.x + 160 - box.x) / box.width);
  expect(await page.evaluate(() => scrollY)).toBe(y);
});
