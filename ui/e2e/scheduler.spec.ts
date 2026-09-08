import { test, expect } from '@playwright/test';
import { expectModeButtons, expectVisibleText } from './helpers/commandBar';

/**
 * Form Scheduler command bar (FR-63/FR-64). Hermetic — the command bar renders
 * client-side, so no secrets/schedules are needed. Verifies the controls, the
 * per-mode note, the landing helper, and the Detect default.
 */
test('Form Scheduler command bar renders controls + explanatory copy', async ({ page }) => {
  await page.goto('/form-watch');
  await expect(page.getByRole('button', { name: 'Add monitor' })).toBeVisible();
  await expectModeButtons(page);
  // Default is Detect (never Live) → note; whole-site helper (landing OFF).
  await expectVisibleText(page, 'Detect mode —', 'Each check searches the whole site to find the contact form');
});
