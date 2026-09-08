import { test, expect } from '@playwright/test';
import { expectModeButtons, expectVisibleText } from './helpers/commandBar';

/**
 * Form Tester command bar (FR-63/FR-64). Hermetic — no secrets, no run needed;
 * it exercises the client-rendered controls and the per-mode / landing-page
 * helper copy so a regression in that UI is caught end-to-end.
 */
test.describe('Form Tester command bar', () => {
  test('mode + landing controls and their explanatory copy render', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Run test' })).toBeVisible();
    await expectModeButtons(page);
    // Default is Detect → its note; landing OFF → whole-site helper.
    await expectVisibleText(page, 'Detect mode —', 'We search the whole site to find the contact form');
  });

  test('mode note switches when a different mode is picked', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Safe', exact: true }).click();
    await expectVisibleText(page, 'Safe mode —');
  });

  test('landing-page toggle swaps the helper copy', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('switch').first().click();
    await expectVisibleText(page, 'Landing page is on');
  });
});
