import { test, expect } from '@playwright/test';
import { mockFormWatch } from './helpers/mockApi';
import { LIVE_MONITOR, SAFE_MONITOR } from './fixtures/schedules';

/**
 * FR-85 — Re-run must not submit a real message without asking.
 *
 * A Form Scheduler monitor set to Live SUBMITS the form on every run, so one
 * click of Re-run puts a real entry in the site owner's inbox. These tests are
 * the reason the guard can be trusted: they assert not only that the dialog
 * appears, but that cancelling it runs NOTHING — the assertion that actually
 * matters, and the one a screenshot can't make.
 *
 * Hermetic: the API is answered from fixtures (FR-88), so no schedule is created
 * and no browser run is ever fired at a real site. Testing the Live path for
 * real would mean submitting to whatever URL the fixture named.
 */

const RERUN = { name: /Re-run/ };

test.describe('Re-run on a Live monitor', () => {
  test('names the mode on the button, and asks before submitting', async ({ page }) => {
    const runNow = await mockFormWatch(page, [LIVE_MONITOR]);
    await page.goto('/form-watch');

    // The consequence is visible before the click, not only in the dialog.
    const button = page.getByRole('button', RERUN);
    await expect(button).toHaveText(/Re-run · Live/);

    await button.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Submit a real message to this form now?')).toBeVisible();
    // It names the URL, so you know which site you're about to message.
    await expect(page.getByRole('dialog')).toContainText(LIVE_MONITOR.url);

    // Nothing has run yet — the dialog is a gate, not a notification.
    expect(runNow.calls).toEqual([]);
  });

  test('cancelling runs nothing at all', async ({ page }) => {
    const runNow = await mockFormWatch(page, [LIVE_MONITOR]);
    await page.goto('/form-watch');

    await page.getByRole('button', RERUN).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(runNow.calls).toEqual([]);
  });

  test('confirming runs it', async ({ page }) => {
    const runNow = await mockFormWatch(page, [LIVE_MONITOR]);
    await page.goto('/form-watch');

    await page.getByRole('button', RERUN).click();
    await page.getByRole('button', { name: 'Yes, submit now', exact: true }).click();

    await expect.poll(() => runNow.calls).toEqual([LIVE_MONITOR.id]);
  });
});

test.describe('Re-run on a Safe monitor', () => {
  test('runs on one click, with no dialog', async ({ page }) => {
    const runNow = await mockFormWatch(page, [SAFE_MONITOR]);
    await page.goto('/form-watch');

    // No mode on the label: Safe fills but never submits, so there is nothing
    // to warn about, and a prompt on a harmless action teaches people to
    // dismiss prompts without reading.
    const button = page.getByRole('button', RERUN);
    await expect(button).toHaveText(/^\s*Re-run\s*$/);

    await button.click();
    await expect.poll(() => runNow.calls).toEqual([SAFE_MONITOR.id]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
