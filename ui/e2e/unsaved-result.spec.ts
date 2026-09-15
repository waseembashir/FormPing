import { test, expect } from '@playwright/test';
import { mockFormWatch } from './helpers/mockApi';
import { SAFE_MONITOR } from './fixtures/schedules';

/**
 * FR-87 — a monitor whose result could not be saved must say so.
 *
 * On 2026-09-08 a rejected insert left a card reading "last run 1h ago" above an
 * empty history: the summary and the history are separate writes to separate
 * tables, and only the history one was failing. The monitor looked healthy while
 * it was quietly losing every run.
 *
 * The notice is the user-facing half of the fix. Served from fixtures, because
 * the hermetic environment has no database that could refuse a write — and the
 * absence test below matters just as much: a warning that shows up on healthy
 * monitors would be worse than none at all.
 */

const NOTICE = 'The last check could not be saved';

test.describe('a monitor whose result could not be saved', () => {
  test('says so, above the figures it casts doubt on', async ({ page }) => {
    await mockFormWatch(page, [SAFE_MONITOR], {
      [SAFE_MONITOR.id]: { at: new Date().toISOString() },
    });
    await page.goto('/form-watch');

    const notice = page.getByText(NOTICE);
    await expect(notice).toBeVisible();

    // Plain language, and honest about what the reader is looking at.
    await expect(page.getByText(/we could not store what it found/)).toBeVisible();
    await expect(page.getByText(/We will try again at the next one/)).toBeVisible();

    // The raw Postgres message never leaves the server: the API projects the
    // failure down to a timestamp (saveFailuresForClient), so there is nothing
    // for the page to leak. Asserted anyway, cheaply, so that re-adding the
    // reason to the payload and rendering it would fail here. (copy-tone;
    // FR-86 removes the same class of leak from the Certificates panel.)
    await expect(page.locator('body')).not.toContainText('trigger_source');
    await expect(page.locator('body')).not.toContainText('column');

    // Above the summary, not tucked underneath it: someone who reads the
    // status line first must have already passed the warning.
    const noticeBox = await notice.boundingBox();
    const statusBox = await page.getByText(/last run/).first().boundingBox();
    expect(noticeBox!.y).toBeLessThan(statusBox!.y);
  });

  test('reads correctly on a phone, without pushing the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockFormWatch(page, [SAFE_MONITOR], {
      [SAFE_MONITOR.id]: { at: new Date().toISOString() },
    });
    await page.goto('/form-watch');

    await expect(page.getByText(NOTICE)).toBeVisible();
    // The card must not overflow its viewport — a warning you have to scroll
    // sideways to read is not a warning. (Working agreement: responsive by default.)
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('stays away when every result saved cleanly', async ({ page }) => {
    await mockFormWatch(page, [SAFE_MONITOR]);
    await page.goto('/form-watch');

    await expect(page.getByText(/last run/).first()).toBeVisible();
    await expect(page.getByText(NOTICE)).toHaveCount(0);
  });
});
