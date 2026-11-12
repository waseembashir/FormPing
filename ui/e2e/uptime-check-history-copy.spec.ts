import { test, expect } from '@playwright/test';

/**
 * The Uptime card's check history reads in plain language.
 *
 * A failed check carries the raw network message on `uptime.error` for the
 * server log. The card phrases the failure kind instead — the same sentence the
 * URL dashboard and the Slack alert use — so "getaddrinfo ENOTFOUND" never
 * reaches a person.
 *
 * Hermetic: the monitor list and its history are served here, which also lets
 * the spec produce failures that are awkward to provoke on demand.
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
  consecutiveDown: 1,
  alertedDown: false,
  lastClassification: 'down',
  lastStatusCode: null,
  lastResponseMs: 15_000,
};

function check(minutesAgo: number, uptime: Record<string, unknown>) {
  return {
    scheduleId: schedule.id,
    url: schedule.url,
    host: schedule.host,
    checkedAt: new Date(Date.parse(AT) - minutesAgo * 60_000).toISOString(),
    uptime,
    ssl: null,
    trigger: 'scheduled',
  };
}

const checks = [
  // Unreachable, with the failure kind recorded.
  check(0, {
    classification: 'down',
    statusCode: null,
    responseMs: 15_000,
    error: 'getaddrinfo ENOTFOUND ex.test',
    failure: 'unreachable',
  }),
  // Stored before failure kinds existed: raw text and no kind.
  check(5, { classification: 'down', statusCode: null, responseMs: 900, error: 'fetch failed' }),
  // A status code that arrived alongside a raw error.
  check(10, { classification: 'down', statusCode: 503, responseMs: 300, error: 'socket hang up' }),
  // Healthy.
  check(15, { classification: 'up', statusCode: 200, responseMs: 120 }),
];

async function openHistory(page: import('@playwright/test').Page) {
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
  await expect(page.getByText(/could not reach this site/i)).toBeVisible();
}

test.describe('the Uptime check history', () => {
  test('never prints a raw network error', async ({ page }) => {
    await openHistory(page);

    const body = page.locator('body');
    for (const raw of ['ENOTFOUND', 'getaddrinfo', 'fetch failed', 'socket hang up']) {
      await expect(body).not.toContainText(raw);
    }
  });

  test('phrases each failure for a person, and keeps a healthy check factual', async ({ page }) => {
    await openHistory(page);

    // Unreachable, with a kind: the same sentence the dashboard and Slack use.
    await expect(page.getByText('We could not reach this site — no response from the server.')).toBeVisible();
    // A row stored before kinds existed: the truthful generic line.
    await expect(page.getByText('This check did not complete last time.')).toBeVisible();
    // A status code keeps its number and meaning, without the raw text beside it.
    await expect(page.getByText(/^503 · /)).toBeVisible();
    // A healthy check is unchanged.
    await expect(page.getByText(/^200 · /)).toBeVisible();
    await expect(page.getByText('120 ms', { exact: false })).toBeVisible();
  });

  test('reads on a phone without pushing the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openHistory(page);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
