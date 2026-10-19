import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { serveSyntheticTiles } from './tiles';

/**
 * Phase 2 task (g): walk all four states (Upload, View, Poster mode, Exporting) with the keyboard
 * only. After `page.goto('/')` nothing is clicked: Tab, Shift+Tab, Enter, Space, arrows, Escape
 * and typing. The DOM is read to assert focus, names and values (CLAUDE.md "Everything is keyboard
 * operable; focus is always visible"; DECISIONS "Focus on screen changes").
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/** The focused element, as a locator Playwright can assert names and attributes on. */
const focused = (page: Page) => page.locator(':focus');

/** True when `target` is the document's active element. */
function isFocused(target: Locator) {
  return () =>
    target
      .evaluate((element) => element === element.ownerDocument.activeElement)
      .catch(() => false);
}

/**
 * Presses `key` (Tab by default) until `predicate` holds, at most `max` times. Fails with the
 * focus path it took, so a broken Tab order says where it went.
 */
async function tabUntil(
  page: Page,
  predicate: () => Promise<boolean>,
  max = 60,
  key: 'Tab' | 'Shift+Tab' = 'Tab',
) {
  const path: string[] = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(key);
    if (await predicate()) return;
    path.push(await describeFocus(page));
  }
  throw new Error(`${key} ×${String(max)} never reached the target. Path: ${path.join(' → ')}`);
}

const shiftTabUntil = (page: Page, predicate: () => Promise<boolean>, max = 60) =>
  tabUntil(page, predicate, max, 'Shift+Tab');

function describeFocus(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return '<body>';
    const label =
      element.getAttribute('aria-label') ??
      (element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null)
        ?.textContent ??
      element.closest('label')?.textContent ??
      element.textContent;
    return `${element.tagName.toLowerCase()}[${label.trim().slice(0, 30)}]`;
  });
}

/** Where the focused element's ring is drawn, what it looks like and whether a clip cuts it. */
interface FocusRing {
  /** On the element itself, on a wrapper that `:has(:focus-visible)`, or on the next sibling. */
  readonly kind: 'self' | 'wrapper' | 'sibling';
  /** The ring-bearing element's border box, CSS px. */
  readonly rect: { x: number; y: number; width: number; height: number };
  /** How far the outline reaches outside that box (offset + width; negative: inside). */
  readonly reach: number;
  readonly width: number;
  /** The outline colour, [r, g, b]. */
  readonly rgb: [number, number, number];
  /** An ancestor whose `overflow: hidden | clip` cuts the outline, or null. */
  readonly clippedBy: string | null;
}

/**
 * The focused element draws a visible indicator: a non-"none" outline on itself, on a wrapper that
 * `:has(:focus-visible)` (Segmented, StylePicker, Slider, the terrain box), or on the card right
 * after a `:focus-visible` radio (SizePicker's `.input:focus-visible + .card`). The outline must
 * also survive clipping: no ancestor with `overflow: hidden | clip` may cut it (a computed outline
 * that is clipped away entirely is invisible). With `pixels`, the ring is also counted in a
 * screenshot: ring-coloured pixels on every side of the box that is on screen.
 */
async function expectVisibleFocus(page: Page, { pixels = false }: { pixels?: boolean } = {}) {
  const ring = await page.evaluate((): FocusRing | null => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const outlined = (node: Element) => {
      const style = getComputedStyle(node);
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    };
    if (!element.matches(':focus-visible')) return null;
    let bearer: Element | null = null;
    let kind: FocusRing['kind'] = 'self';
    if (outlined(element)) bearer = element;
    for (let node = element.parentElement; !bearer && node; node = node.parentElement) {
      if (node.matches(':has(:focus-visible)') && outlined(node)) {
        bearer = node;
        kind = 'wrapper';
      }
    }
    const next = element.nextElementSibling;
    if (!bearer && next && outlined(next)) {
      bearer = next;
      kind = 'sibling';
    }
    if (!bearer) return null;
    const style = getComputedStyle(bearer);
    const width = parseFloat(style.outlineWidth);
    const reach = parseFloat(style.outlineOffset) + width;
    const box = bearer.getBoundingClientRect();
    // An element's own overflow never clips its outline; an ancestor's does.
    const clips = (value: string) => value === 'hidden' || value === 'clip';
    let clippedBy: string | null = null;
    for (let node = bearer.parentElement; node && !clippedBy; node = node.parentElement) {
      const ancestor = getComputedStyle(node);
      const x = clips(ancestor.overflowX);
      const y = clips(ancestor.overflowY);
      if (!x && !y) continue;
      const outer = node.getBoundingClientRect();
      const left = outer.left + node.clientLeft;
      const top = outer.top + node.clientTop;
      const cut =
        (x &&
          (box.left - reach < left - 0.5 || box.right + reach > left + node.clientWidth + 0.5)) ||
        (y && (box.top - reach < top - 0.5 || box.bottom + reach > top + node.clientHeight + 0.5));
      if (cut) clippedBy = `${node.tagName.toLowerCase()}.${node.getAttribute('class') ?? ''}`;
    }
    const rgb = (style.outlineColor.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    return {
      kind,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      reach,
      width,
      rgb: [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0],
      clippedBy,
    };
  });
  const name = await describeFocus(page);
  expect(ring, `no visible focus indicator on ${name}`).not.toBeNull();
  if (!ring) return;
  expect(ring.clippedBy, `the focus ring on ${name} is clipped`).toBeNull();
  if (pixels) await expectRingPixels(page, ring, name);
}

/**
 * Counts ring-coloured pixels in the band the outline occupies on each side of `ring.rect`: every
 * side that is on screen must show the ring along at least a quarter of its length.
 */
async function expectRingPixels(page: Page, ring: FocusRing, name: string) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const { rect, reach } = ring;
  const pad = Math.max(0, reach) + 2;
  const x0 = Math.max(0, Math.floor(rect.x - pad));
  const y0 = Math.max(0, Math.floor(rect.y - pad));
  const x1 = Math.min(viewport.width, Math.ceil(rect.x + rect.width + pad));
  const y1 = Math.min(viewport.height, Math.ceil(rect.y + rect.height + pad));
  const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const png = await page.screenshot({ clip });
  const counts = await page.evaluate(
    async ({ b64, clip, ring }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2D context');
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const scale = bitmap.width / clip.width;
      const { rect, reach, width, rgb } = ring;
      // The outline's band: from (reach − width) to reach outside the box, ±1 px for antialiasing.
      const inner = reach - width - 1;
      const outer = reach + 1;
      const counts = { top: 0, right: 0, bottom: 0, left: 0 };
      for (let py = 0; py < bitmap.height; py++) {
        for (let px = 0; px < bitmap.width; px++) {
          const i = (py * bitmap.width + px) * 4;
          const near =
            Math.abs((data[i] ?? 0) - rgb[0]) <= 48 &&
            Math.abs((data[i + 1] ?? 0) - rgb[1]) <= 48 &&
            Math.abs((data[i + 2] ?? 0) - rgb[2]) <= 48;
          if (!near) continue;
          const x = clip.x + (px + 0.5) / scale;
          const y = clip.y + (py + 0.5) / scale;
          const inX = x >= rect.x && x <= rect.x + rect.width;
          const inY = y >= rect.y && y <= rect.y + rect.height;
          const above = rect.y - y;
          const below = y - (rect.y + rect.height);
          const before = rect.x - x;
          const after = x - (rect.x + rect.width);
          if (inX && above >= inner && above <= outer) counts.top += 1;
          else if (inX && below >= inner && below <= outer) counts.bottom += 1;
          else if (inY && before >= inner && before <= outer) counts.left += 1;
          else if (inY && after >= inner && after <= outer) counts.right += 1;
        }
      }
      return counts;
    },
    { b64: png.toString('base64'), clip, ring },
  );
  const sides = {
    top: rect.y - reach >= 0 ? rect.width : 0,
    bottom: rect.y + rect.height + reach <= viewport.height ? rect.width : 0,
    left: rect.x - reach >= 0 ? rect.height : 0,
    right: rect.x + rect.width + reach <= viewport.width ? rect.height : 0,
  };
  const visible = Object.entries(sides).filter(([, length]) => length > 0);
  expect(visible.length, `no side of the focus ring on ${name} is on screen`).toBeGreaterThan(0);
  for (const [side, length] of visible) {
    expect(
      counts[side as keyof typeof counts],
      `ring pixels on the ${side} of ${name}: ${JSON.stringify(counts)}`,
    ).toBeGreaterThanOrEqual(length / 4);
  }
}

/** axe with every rule (including `region`), then the 390 rule: no horizontal page scroll. */
async function expectAccessibleAndNoSideScroll(page: Page, state: string) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async () => {
    // Let colour transitions and the screen's fade-in finish first (text mid-fade reads as low
    // contrast). Endless animations (a busy progress line) are left running.
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

test('all four states can be walked by keyboard alone', async ({ page }) => {
  // The walk ends with a real 18 × 24 export, which competes with the other specs for the CPU.
  test.setTimeout(90_000);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  // Elevation tiles come from a local synthetic source, so the live terrain needs no network.
  await serveSyntheticTiles(page);
  await page.goto('/');
  const uploadHeading = page.getByRole('heading', { level: 1, name: 'Your run, as terrain.' });
  await expect(uploadHeading).toBeVisible();

  // 1. Upload ---------------------------------------------------------------------------------
  await test.step('Upload: Tab order, About dialog, sample run', async () => {
    await expectAccessibleAndNoSideScroll(page, 'Upload');

    // The card's copy depends on the pointer: the 390 project emulates a touch screen.
    const touch = await page.evaluate(
      () => window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    );
    const card = touch
      ? 'Choose a .gpx file. Tap to open your files'
      : 'Drop a .gpx file here. or click to choose one';
    const preview = 'TRY THE SAMPLE RUN · 21.5 km · +1,102 m';
    // The wordmark, a link home, is the first stop in every state.
    for (const name of ['Vert, home', 'About', 'GitHub', card, 'Try the sample run', preview]) {
      await page.keyboard.press('Tab');
      await expect(focused(page)).toHaveAccessibleName(name);
      await expectVisibleFocus(page);
    }
    // The card is described by the note line, so the limits are read with it.
    await expect(page.getByRole('button', { name: card, exact: true })).toHaveAccessibleDescription(
      'GPX only · up to 20 MB · from Strava, Garmin, Coros, Suunto',
    );

    // Back to About, open it: focus moves inside the modal; Escape closes it and returns focus.
    const about = page.getByRole('button', { name: 'About' });
    await shiftTabUntil(page, isFocused(about), 5);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'About Vert' });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    // The browser restores focus to About on Escape; AboutDialog's handler for the (queued) `close`
    // event only fills in when focus was left on <body> or in the dialog, so Tabbing straight on
    // is safe: no waiting for the event.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(about).toBeFocused();

    await tabUntil(
      page,
      isFocused(page.getByRole('button', { name: 'Try the sample run', exact: true })),
      3,
    );
    await page.keyboard.press('Enter');
  });

  // 2. View -----------------------------------------------------------------------------------
  const viewHeading = page.getByRole('heading', { level: 1 });
  await test.step('View: header, exaggeration, terrain buttons, profile', async () => {
    await expect(viewHeading).not.toHaveText(/Your run/);
    await expect(viewHeading).toBeFocused();
    await expectAccessibleAndNoSideScroll(page, 'View');

    // Units: the radiogroup's checked radio takes focus; arrows switch and select.
    const distanceValue = page.locator('div:has(> dt:text-is("Distance")) > dd');
    await expect(distanceValue).toContainText(/km$/);
    const km = page.getByRole('radio', { name: 'km' });
    await tabUntil(page, isFocused(km));
    await expectVisibleFocus(page);
    // The wordmark comes just before the header's controls.
    await page.keyboard.press('Shift+Tab');
    await expect(focused(page)).toHaveAccessibleName('Vert, home');
    await expectVisibleFocus(page);
    await page.keyboard.press('Tab');
    await expect(km).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'mi' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'mi' })).toBeFocused();
    await expect(distanceValue).toContainText(/mi$/);
    await expectVisibleFocus(page);
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: 'km' })).toBeChecked();
    await expect(distanceValue).toContainText(/km$/);

    for (const name of ['New file', 'Make a poster']) {
      await page.keyboard.press('Tab');
      await expect(focused(page)).toHaveAccessibleName(name);
      await expectVisibleFocus(page);
    }

    const exaggeration = page.getByRole('slider', { name: 'Vertical exaggeration' });
    await tabUntil(page, isFocused(exaggeration));
    await expectVisibleFocus(page);
    await expect(page.getByText('Vertical ×1.6')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(exaggeration).toHaveValue('1.7');
    await expect(page.getByText('Vertical ×1.7')).toBeVisible();

    // The live terrain: focusable once drawn (arrow keys orbit), then Rotate view, Flat map.
    await page.waitForFunction(() => performance.getEntriesByName('vert:first-frame').length > 0);
    const terrain = page.locator('div:has(> canvas[role="img"])');
    await tabUntil(page, isFocused(terrain));
    // The terrain box clips its rounded corners: count the ring in a screenshot, not just styles.
    await expectVisibleFocus(page, { pixels: true });
    await page.keyboard.press('ArrowRight');
    await expect(terrain).toBeFocused();

    const rotate = page.getByRole('button', { name: 'Rotate view' });
    await page.keyboard.press('Tab');
    await expect(rotate).toBeFocused();
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    await expect(rotate).toBeFocused();

    const flat = page.getByRole('button', { name: 'Flat map' });
    await page.keyboard.press('Tab');
    await expect(flat).toBeFocused();
    await expectVisibleFocus(page);
    await expect(flat).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Space');
    await expect(flat).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(flat).toHaveAttribute('aria-pressed', 'false');

    const profile = page.getByRole('slider', { name: 'Elevation profile' });
    await page.keyboard.press('Tab');
    await expect(profile).toBeFocused();
    await expectVisibleFocus(page);
    const before = await profile.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    await expect(profile).not.toHaveAttribute('aria-valuenow', before ?? '');
    await page.keyboard.press('Home');
    await expect(profile).toHaveAttribute('aria-valuenow', '0');
    await page.keyboard.press('End');
    const total = await profile.getAttribute('aria-valuemax');
    expect(Number(total)).toBeGreaterThan(0);
    await expect(profile).toHaveAttribute('aria-valuenow', total ?? '');
  });

  // 3. Poster mode ----------------------------------------------------------------------------
  const pngButton = page.getByRole('button', { name: /^Download PNG · / });
  await test.step('Poster: style, size, title, stats, hide ends', async () => {
    const makePoster = page.getByRole('button', { name: 'Make a poster' });
    await shiftTabUntil(page, isFocused(makePoster));
    await page.keyboard.press('Enter');
    const posterHeading = page.getByRole('heading', { level: 1, name: 'Make a poster' });
    await expect(posterHeading).toBeFocused();
    await expectAccessibleAndNoSideScroll(page, 'Poster mode');

    const styleA = page.getByRole('radio', { name: 'A Trail Sign' });
    const styleB = page.getByRole('radio', { name: 'B Night Ridge' });
    await tabUntil(page, isFocused(styleA));
    await expectVisibleFocus(page);
    await page.keyboard.press('ArrowRight');
    await expect(styleB).toBeChecked();
    await expect(styleB).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(styleA).toBeChecked();

    const size18x24 = page.getByRole('radio', { name: /^18 × 24 in/ });
    const sizeA3 = page.getByRole('radio', { name: /^A3/ });
    await page.keyboard.press('Tab');
    await expect(size18x24).toBeFocused();
    await expectVisibleFocus(page);
    await expect(pngButton).toHaveAccessibleName('Download PNG · 5400 × 7200');
    await page.keyboard.press('ArrowRight');
    await expect(sizeA3).toBeChecked();
    await expect(pngButton).toHaveAccessibleName('Download PNG · 3508 × 4961');
    await page.keyboard.press('ArrowLeft');
    await expect(size18x24).toBeChecked();
    await expect(pngButton).toHaveAccessibleName('Download PNG · 5400 × 7200');

    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await page.keyboard.press('Tab');
    await expect(title).toBeFocused();
    await expectVisibleFocus(page);
    // The title starts as the route name; select it and type over it.
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Keyboard Ridge');
    await expect(title).toHaveValue('Keyboard Ridge');
    await expect(page.getByRole('img', { name: /^Poster: / })).toHaveAccessibleName(
      /Keyboard Ridge/i,
    );

    const highPoint = page.getByRole('checkbox', { name: 'High point' });
    await tabUntil(page, isFocused(highPoint), 10);
    await expectVisibleFocus(page);
    const shown = await highPoint.isChecked();
    await page.keyboard.press('Space');
    await expect(highPoint).toBeChecked({ checked: !shown });

    const hideEnds = page.getByRole('slider', { name: 'Hide start and end' });
    await page.keyboard.press('Tab');
    await expect(hideEnds).toBeFocused();
    await expectVisibleFocus(page);
    await page.keyboard.press('ArrowRight');
    await expect(hideEnds).toHaveAttribute('aria-valuetext', '300 metres');
    await expect(page.getByText('300 m', { exact: true })).toBeVisible();
  });

  // 4. Exporting ------------------------------------------------------------------------------
  await test.step('Exporting: progress label, Cancel, then a full export', async () => {
    await tabUntil(page, isFocused(pngButton), 5);
    await expect(pngButton).toHaveAccessibleName('Download PNG · 5400 × 7200');
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');

    const progressLabel = page.locator('p', {
      hasText: /^(Preparing…|Rendering tile \d+ of \d+|Saving the file…)$/,
    });
    await expect(progressLabel).toBeFocused();
    await expect(page.getByRole('button', { name: 'Back to the run' })).toBeDisabled();

    await page.keyboard.press('Tab');
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeFocused();
    await expectVisibleFocus(page);

    // The wordmark stays a focusable link, but like Back to the run it does not leave the export.
    const home = page.getByRole('link', { name: 'Vert, home' });
    await shiftTabUntil(page, isFocused(home), 10);
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Make a poster' })).toBeVisible();
    await expect(cancel).toBeVisible();
    await tabUntil(page, isFocused(cancel), 10);
    await page.keyboard.press('Enter');
    await expect(cancel).toBeHidden();
    await expect(pngButton).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Export cancelled.' })).toBeAttached();

    await page.keyboard.press('Enter');
    await expect(progressLabel).toBeFocused();
    await expectAccessibleAndNoSideScroll(page, 'Exporting');
    await expect(page.getByText(/^Saved vert-.*\.png$/)).toBeVisible({ timeout: 60_000 });
    await expect(pngButton).toBeFocused();
    await expectVisibleFocus(page);
    await expectAccessibleAndNoSideScroll(page, 'Poster mode after export');
    // Cancelled: nothing saved; the full export: one file (e2e/export.spec.ts checks its pixels).
    expect(downloads).toEqual([expect.stringMatching(/^vert-.*-18x24\.png$/)]);
  });

  // 5. Back -----------------------------------------------------------------------------------
  await test.step('Back to the run, then New file', async () => {
    const back = page.getByRole('button', { name: 'Back to the run' });
    await shiftTabUntil(page, isFocused(back));
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    await expect(viewHeading).toBeFocused();
    await expect(viewHeading).not.toHaveText('Make a poster');

    const newFile = page.getByRole('button', { name: 'New file' });
    await tabUntil(page, isFocused(newFile));
    await page.keyboard.press('Enter');
    await expect(uploadHeading).toBeFocused();
    await expect(page.getByRole('group', { name: /GPX/i })).toBeVisible();
    await expectAccessibleAndNoSideScroll(page, 'Upload again');
  });

  // 6. Home -----------------------------------------------------------------------------------
  await test.step('The wordmark: home from Upload and from the View, without a reload', async () => {
    // A marker on the window: a real navigation to "/" would reload the page and lose it.
    await page.evaluate(() => {
      (window as unknown as { vertWalk: boolean }).vertWalk = true;
    });
    const stillLoaded = () =>
      page.evaluate(() => (window as unknown as { vertWalk?: boolean }).vertWalk === true);
    const home = page.getByRole('link', { name: 'Vert, home' });

    // On Upload: no change of state, focus back on the h1.
    await shiftTabUntil(page, isFocused(home), 5);
    await page.keyboard.press('Enter');
    await expect(uploadHeading).toBeFocused();
    expect(await stillLoaded()).toBe(true);

    // From the View: back to Upload, as New file.
    await tabUntil(
      page,
      isFocused(page.getByRole('button', { name: 'Try the sample run', exact: true })),
    );
    await page.keyboard.press('Enter');
    await expect(viewHeading).toBeFocused();
    await expect(viewHeading).not.toHaveText(/Your run/);
    await shiftTabUntil(page, isFocused(home));
    await page.keyboard.press('Enter');
    await expect(uploadHeading).toBeFocused();
    expect(await stillLoaded()).toBe(true);
  });
});
