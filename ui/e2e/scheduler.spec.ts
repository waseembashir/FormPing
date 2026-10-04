import { test, expect } from '@playwright/test';
import { expectModeButtons, expectVisibleText } from './helpers/commandBar';

/**
 * Form Scheduler command bar (FR-63/FR-64). Hermetic — the command bar renders
 * client-side, so no secrets/schedules are needed. Verifies the controls, the
 * per-mode note, the scope helper, and the Detect default.
 */
test('Form Scheduler command bar renders controls + explanatory copy', async ({ page }) => {
  await page.goto('/form-watch');
  await expect(page.getByRole('button', { name: 'Add monitor' })).toBeVisible();
  await expectModeButtons(page);
  // Default is Detect (never Live) → note. The scope line has to say a monitor
  // covers ONE form on ONE page: people reasonably assumed a monitor watched
  // every form on a site, and nothing on this screen said otherwise. FR-79.
  await expectVisibleText(page, 'Detect mode —', 'A monitor watches one form on one page');
});
