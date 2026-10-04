import { test, expect } from '@playwright/test';
import { mockFormWatch } from './helpers/mockApi';
import { PINNED_MONITOR, SAFE_MONITOR } from './fixtures/schedules';

/**
 * FR-79 — a monitor says which page it watches.
 *
 * A monitor only ever watches ONE form on ONE page, and nothing on the screen
 * said so. That is why "why is it testing that form?" kept coming up: people
 * reasonably assumed a monitor covered the forms on their site, and the one it
 * had actually settled on was never named anywhere.
 *
 * Served from fixtures: a real pin is written by a real engine run against a
 * real website, which the hermetic environment has neither of. What is being
 * checked here is the card's side of the bargain — that the page is named, that
 * it is reachable, and that there is a way to re-point a monitor when a site
 * moves its contact page.
 */

test.describe('a monitor that has resolved its page', () => {
  test('names the page it watches, and links to it', async ({ page }) => {
    await mockFormWatch(page, [PINNED_MONITOR]);
    await page.goto('/form-watch');

    // `exact` because the setup copy above the list also says a monitor watches
    // one form on one page — the card's own line is the span, on its own.
    await expect(page.getByText('Watches one form on', { exact: true })).toBeVisible();

    // The link carries the whole URL even though it shows the path: the path is
    // what a reader scans for, the URL is what they click.
    const link = page.getByRole('link', { name: '/contact-us' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://pinned.example.com/contact-us');

    // How old the answer is, so somebody can judge whether to trust it.
    await expect(page.getByText(/found 2d ago/)).toBeVisible();
  });

  test('offers to find the form again, and asks the server to', async ({ page }) => {
    const spy = await mockFormWatch(page, [PINNED_MONITOR]);
    await page.goto('/form-watch');

    await page.getByRole('button', { name: 'Find the form again' }).click();

    await expect.poll(() => spy.findFormCalls).toEqual(['sched-pinned']);
    // Re-pointing a monitor must not be able to run a test on somebody's form
    // as a side effect — it clears the pin and lets a scheduled check resolve
    // it, which is a different request entirely.
    expect(spy.calls).toEqual([]);
  });

  test('reads correctly on a phone, without pushing the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockFormWatch(page, [PINNED_MONITOR]);
    await page.goto('/form-watch');

    await expect(page.getByText('Watches one form on', { exact: true })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('a monitor that has not resolved one yet', () => {
  test('claims no page and offers nothing to re-resolve', async ({ page }) => {
    // Monitors that predate the pin discover on every check until one of them
    // records a page. Naming a page for them, or offering to re-find a form
    // that was never pinned, would describe behaviour they do not have.
    await mockFormWatch(page, [SAFE_MONITOR]);
    await page.goto('/form-watch');

    await expect(page.getByText(/last run/).first()).toBeVisible();
    await expect(page.getByText('Watches one form on', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Find the form again' })).toHaveCount(0);
  });
});
