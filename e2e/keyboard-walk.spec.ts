import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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

/**
 * The focused element draws a visible indicator: a non-"none" outline on itself, on a wrapper that
 * `:has(:focus-visible)` (Segmented, StylePicker, Slider), or on the card right after a
 * `:focus-visible` radio (SizePicker's `.input:focus-visible + .card`).
 */
async function expectVisibleFocus(page: Page) {
  const ring = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const outlined = (node: Element) => {
      const style = getComputedStyle(node);
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    };
    if (!element.matches(':focus-visible')) return null;
    if (outlined(element)) return 'self';
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (node.matches(':has(:focus-visible)') && outlined(node)) return 'wrapper';
    }
    const next = element.nextElementSibling;
    if (next && outlined(next)) return 'sibling';
    return null;
  });
  expect(ring, `no visible focus indicator on ${await describeFocus(page)}`).not.toBeNull();
}

/** axe with every rule (including `region`), then the 390 rule: no horizontal page scroll. */
async function expectAccessibleAndNoSideScroll(page: Page, state: string) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async () => {
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
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  await page.goto('/');
  const uploadHeading = page.getByRole('heading', { level: 1, name: 'Your run, as terrain.' });
  await expect(uploadHeading).toBeVisible();

  // 1. Upload ---------------------------------------------------------------------------------
  await test.step('Upload: Tab order, About dialog, sample run', async () => {
    await expectAccessibleAndNoSideScroll(page, 'Upload');

    for (const name of ['About', 'GitHub', 'choose a file', 'try a sample run']) {
      await page.keyboard.press('Tab');
      await expect(focused(page)).toHaveAccessibleName(name);
      await expectVisibleFocus(page);
    }

    // Back to About, open it: focus moves inside the modal; Escape closes it and returns focus.
    const about = page.getByRole('button', { name: 'About' });
    await shiftTabUntil(page, isFocused(about), 4);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'About Vert' });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    // The dialog's `close` event is a queued task, and AboutDialog returns focus to About in it.
    // Wait for it as a person would (a test can Tab three times before it fires).
    await dialog.evaluate((node) => {
      node.addEventListener(
        'close',
        () => {
          (window as unknown as { aboutClosed?: boolean }).aboutClosed = true;
        },
        { once: true },
      );
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as unknown as { aboutClosed?: boolean }).aboutClosed);
    await expect(dialog).toBeHidden();
    await expect(about).toBeFocused();

    await tabUntil(page, isFocused(page.getByRole('button', { name: 'try a sample run' })), 3);
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
    await tabUntil(page, isFocused(page.getByRole('radio', { name: 'km' })));
    await expectVisibleFocus(page);
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

    const rotate = page.getByRole('button', { name: 'Rotate view' });
    await tabUntil(page, isFocused(rotate));
    await expectVisibleFocus(page);

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
  await test.step('Exporting: progress label, Cancel, then a full (simulated) export', async () => {
    await tabUntil(page, isFocused(pngButton), 5);
    await expect(pngButton).toHaveAccessibleName('Download PNG · 5400 × 7200');
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');

    const progressLabel = page.locator('p', { hasText: /^(Preparing…|Rendering tile \d+ of 12)$/ });
    await expect(progressLabel).toBeFocused();
    await expect(page.getByRole('button', { name: 'Back to the run' })).toBeDisabled();

    await page.keyboard.press('Tab');
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeFocused();
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    await expect(cancel).toBeHidden();
    await expect(pngButton).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Export cancelled.' })).toBeAttached();

    await page.keyboard.press('Enter');
    await expect(progressLabel).toBeFocused();
    await expectAccessibleAndNoSideScroll(page, 'Exporting');
    await expect(page.getByText(/^Saved vert-.*\.png$/)).toBeVisible({ timeout: 10_000 });
    await expect(pngButton).toBeFocused();
    await expectVisibleFocus(page);
    await expectAccessibleAndNoSideScroll(page, 'Poster mode after export');
    // Phase 2's exporter is simulated: nothing is downloaded.
    expect(downloads).toEqual([]);
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
});
