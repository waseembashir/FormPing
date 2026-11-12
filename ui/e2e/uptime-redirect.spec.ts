import { test, expect, type Page } from '@playwright/test';

/**
 * A check that was redirected says where it landed.
 *
 * Housekeeping redirects (https, www, a subdomain of the same site) read as a
 * plain fact. A redirect that leaves the site's main domain is shown in amber,
 * because a site answering from someone else's domain is not healthy even when
 * its status code is.
 *
 * Hermetic: the monitor list, its history and the URL dashboard are served here.
 */

const AT = '2026-11-12T09:00:00.000Z';

const schedule = {
  id: 'sw-1',
  url: 'https://ex.test/',
  host: 'ex.test',
  intervalMs: 300_000,
  createdAt: AT,
  lastCheckedAt: AT,
  nextCheckAt: AT,
  consecutiveDown: 0,
  alertedDown: false,
  lastClassification: 'up',
  lastStatusCode: 200,
  lastResponseMs: 140,
};

function check(minutesAgo: number, finalUrl?: string) {
  return {
    scheduleId: schedule.id,
    url: schedule.url,
    host: schedule.host,
    checkedAt: new Date(Date.parse(AT) - minutesAgo * 60_000).toISOString(),
    uptime: { classification: 'up', statusCode: 200, responseMs: 140, ...(finalUrl ? { finalUrl } : {}) },
    ssl: null,
    trigger: 'scheduled',
  };
}

async function openHistory(page: Page, checks: unknown[]) {
  await page.route('**/api/site-watch', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schedules: [schedule], saveFailures: {} }),
    }),
  );
  await page.route('**/api/site-watch/results**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checks }) }),
  );
  await page.goto('/site-watch');
  await page.getByRole('button', { name: /view check history/i }).click();
  await expect(page.getByText('HTTP status').first()).toBeVisible();
}

function dashboardPayload(uptimeFinalUrl?: string) {
  return {
    name: 'Test project',
    generatedAt: AT,
    windowDays: 30,
    overall: 'operational',
    sharedUrl: 'https://ex.test/',
    shareToken: null,
    sites: [
      {
        host: 'ex.test',
        url: 'https://ex.test/',
        state: 'up',
        uptime: { d1: null, d7: null, d30: null },
        uptimeWindowPct: null,
        dailyUptime: [],
        incidents: 0,
        ssl: { daysRemaining: 240, valid: true },
        formWorking: null,
        lastCheckedAt: AT,
        tech: {
          url: 'https://ex.test/',
          statusCode: 200,
          lastResponseMs: 140,
          lastCheckedAt: AT,
          domainDaysRemaining: null,
          avgResponseMs: null,
          responseTrend: [],
          intervalMs: 300000,
          ...(uptimeFinalUrl ? { check: { uptimeFinalUrl } } : {}),
        },
      },
    ],
  };
}

async function openDashboard(page: Page, uptimeFinalUrl?: string) {
  await page.route('**/api/projects/**/url/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboardPayload(uptimeFinalUrl)) }),
  );
  await page.goto('/projects/test-project/url/ex-test');
  await expect(page.getByText('Technical details')).toBeVisible();
}

test.describe('a redirect on the check history', () => {
  test('reads as a plain fact when it stays on the same site', async ({ page }) => {
    await openHistory(page, [check(0, 'https://www.ex.test/en/')]);

    const value = page.getByText('Lands on www.ex.test/en/');
    await expect(value).toBeVisible();
    await expect(value).not.toHaveClass(/text-warn|text-danger/);
  });

  test('is flagged in amber when it leaves for another domain', async ({ page }) => {
    await openHistory(page, [check(0, 'https://www.other-site.example/lander')]);

    const value = page.getByText('Sends visitors to another domain — other-site.example');
    await expect(value).toBeVisible();
    await expect(value).toHaveClass(/text-warn/);
  });

  test('says nothing when the check was not redirected', async ({ page }) => {
    await openHistory(page, [check(0)]);
    await expect(page.getByText('Redirect', { exact: true })).toHaveCount(0);
  });

  test('reads on a phone without pushing the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openHistory(page, [check(0, 'https://www.other-site.example/a-very-long-landing-path/with/segments')]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('a redirect on the URL dashboard', () => {
  test('names another domain in amber', async ({ page }) => {
    await openDashboard(page, 'https://other-site.example/');

    const value = page.getByText('Another domain — other-site.example');
    await expect(value).toBeVisible();
    await expect(value).toHaveClass(/text-warn/);
  });

  test('shows a same-site landing plainly', async ({ page }) => {
    await openDashboard(page, 'https://www.ex.test/');
    await expect(page.getByText('www.ex.test/', { exact: true })).toBeVisible();
  });

  test('has no redirect row when there was none', async ({ page }) => {
    await openDashboard(page);
    await expect(page.getByText('Redirects to')).toHaveCount(0);
  });
});
