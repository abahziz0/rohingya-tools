import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, launch, openPopup, statusTitle, type Harness } from './harness';

let h: Harness;
test.beforeEach(async () => {
  h = await launch();
});
test.afterEach(async () => {
  await h.context.close();
});

const audit = async (popup: Page, label: string) => {
  const results = await new AxeBuilder({ page: popup }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
  expect(summary, `${label} axe violations`).toEqual([]);
};

test('popup has no WCAG 2.1 A/AA violations in its main states (light and dark)', async () => {
  const page = await h.context.newPage();
  await page.goto(`${FIXTURES}/tone-marks.html`);
  for (const scheme of ['light', 'dark'] as const) {
    const popup = await openPopup(h, page);
    await popup.emulateMedia({ colorScheme: scheme });
    await audit(popup, `${scheme} ready`);
    await popup.click('#convert');
    await expect(statusTitle(popup)).toHaveText('Rohingyalish is enabled on this page');
    await popup.locator('#notes-summary').click();
    await audit(popup, `${scheme} enabled + notes`);
    await popup.locator('#always').check();
    await expect(popup.locator('#site-detail')).toContainText('converts automatically');
    await audit(popup, `${scheme} always on`);
    await popup.locator('#always').uncheck();
    await popup.click('#original');
    await expect(statusTitle(popup)).toHaveText('Showing the original text');
    await audit(popup, `${scheme} paused`);
    await popup.close();
  }
});

test('popup is fully usable with the keyboard', async () => {
  const page = await h.context.newPage();
  await page.goto(`${FIXTURES}/mixed-script.html`);
  const popup = await openPopup(h, page);
  const focused = () => popup.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

  await popup.keyboard.press('Tab');
  expect(await focused()).toBe('convert');
  await popup.keyboard.press('Enter');
  await expect(statusTitle(popup)).toHaveText('Rohingyalish is enabled on this page');

  // Convert is now disabled; focus order continues with Show original.
  await popup.locator('#original').focus();
  await popup.keyboard.press('Enter');
  await expect(statusTitle(popup)).toHaveText('Showing the original text');

  await popup.keyboard.press('Tab');
  expect(await focused()).toBe('always');
  await popup.keyboard.press('Space');
  await expect(popup.locator('#always')).toBeChecked();
  await expect(popup.locator('#always')).toHaveAttribute('role', 'switch');
  await expect(popup.getByRole('switch', { name: /Always convert this website/ })).toBeVisible();

  // Visible focus indicator on the switch.
  const outline = await popup.locator('#always').evaluate(el => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');

  await popup.keyboard.press('Tab');
  expect(await focused()).toBe('converter-link');
  await expect(popup.getByRole('link', { name: /Open the online script converter/ })).toHaveAttribute('href', 'https://rohingyalanguage.org/tools/script-converter/');
  await expect(popup.getByRole('status')).toContainText('Rohingyalish is enabled on this page');
});
