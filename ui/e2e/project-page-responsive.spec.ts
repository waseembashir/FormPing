import { test, expect } from '@playwright/test';

/**
 * The project page fits a phone.
 *
 * This exists because it did not, and nobody noticed. The "Watched by" badge
 * was added to each URL card's action group, which was `shrink-0` — so the
 * group grew past a 375px viewport and took the whole page with it. 439px of
 * content in a 375px window, horizontal scroll on every project.
 *
 * It shipped because the phone test written alongside that badge covered the
 * per-URL DASHBOARD, not the project page the badge was later moved to. The
 * surface that was built first got the test; the surface it ended up on did
 * not.
 *
 * So this guards the page itself rather than any one feature on it: whatever
 * is added to a URL card next, it has to fit.
 */

const AT = new Date().toISOString();

const PROJECT = {
  project: {
    id: 'p1',
    name: 'Apexure',
    urls: ['https://www.apexure.com'],
    createdAt: AT,
    updatedAt: AT,
    createdBy: 'Tajamul Wani',
    updatedBy: 'Tajamul Wani',
    shareToken: null,
    health: [
      {
        url: 'https://www.apexure.com',
        form: {
          monitored: true, owner: 'Tajamul Wani', level: 'healthy', label: 'Form detected',
          mode: 'detect-only', intervalMs: 86_400_000, lastRunAt: AT,
        },
        site: {
          monitored: true, owner: 'Tajamul Wani', upState: 'up', statusCode: 200,
          intervalMs: 300_000, lastCheckedAt: AT, ssl: { valid: true, daysRemaining: 60 },
        },
        change: { tracked: false },
      },
    ],
  },
};

test('a URL card does not push the page sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.route('**/api/projects/p1', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROJECT) }),
  );
  await page.goto('/projects/p1');

  // The card has to be there, or this passes by rendering nothing.
  await expect(page.getByText('https://www.apexure.com')).toBeVisible();
  await expect(page.getByText(/Watched by/)).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
