import { test, expect } from '@playwright/test';

/**
 * Who watches a URL, on the per-URL dashboard.
 *
 * A URL carries at most one form monitor and one uptime monitor, and the app
 * enforces that across the whole team — so a colleague's monitor refuses yours.
 * The owner of each has been recorded since per-user isolation and was
 * displayed nowhere, which is what made that refusal a dead end: the only way
 * to learn who to ask was to try to create a monitor and be told you could not.
 *
 * Projects is the shared record, so the answer belongs here. The trap is that
 * two owners is the UNUSUAL case — most URLs are watched end to end by whoever
 * set them up, and a line that qualifies both names every time makes a reader
 * work to discover there is only one person.
 *
 * Hermetic: the dashboard's API needs auth and a database, so the payload is
 * served directly. The owner fields arrive already resolved to display labels —
 * the route does that lookup — so that is what the fixture supplies.
 */

const AT = '2026-10-05T10:00:00.000Z';

function payload(over: {
  formOwner?: string;
  siteOwner?: string;
  changeOwner?: string;
  formIntervalMs?: number | null;
  state?: string;
}) {
  return {
    name: 'Test project',
    generatedAt: AT,
    windowDays: 30,
    overall: 'operational',
    sharedUrl: 'https://ex.test/contact/',
    shareToken: null,
    sites: [
      {
        host: 'ex.test',
        url: 'https://ex.test/contact/',
        state: over.state ?? 'up',
        uptime: { d1: null, d7: null, d30: null },
        uptimeWindowPct: null,
        dailyUptime: [],
        incidents: 0,
        ssl: null,
        formWorking: true,
        lastCheckedAt: AT,
        ...(over.formOwner ? { formOwner: over.formOwner } : {}),
        ...(over.siteOwner ? { siteOwner: over.siteOwner } : {}),
        ...(over.changeOwner ? { changeOwner: over.changeOwner, changeTracked: true } : {}),
        tech: {
          url: 'https://ex.test/contact/',
          statusCode: 200,
          lastResponseMs: 412,
          lastCheckedAt: AT,
          domainDaysRemaining: null,
          avgResponseMs: null,
          responseTrend: [],
          intervalMs: 300_000,
          form: {
            mode: 'safe',
            level: null,
            label: null,
            lastRunAt: AT,
            // A live monitor is the one with a cadence. Absent = stopped.
            intervalMs: over.formIntervalMs === undefined ? 259_200_000 : over.formIntervalMs,
          },
        },
      },
    ],
  };
}

async function open(page: import('@playwright/test').Page, body: unknown) {
  await page.route('**/api/projects/**/url/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
  await page.goto('/projects/test-project/url/ex-test-contact');
}

test.describe('who watches this URL', () => {
  test('names one person once when they watch all of it', async ({ page }) => {
    // The common case. Saying it twice, qualified, would make the reader deduce
    // that it is one person.
    await open(page, payload({ formOwner: 'Jordan Blake', siteOwner: 'Jordan Blake' }));

    await expect(page.getByText(/Watched by/)).toBeVisible();
    await expect(page.getByText('Jordan Blake', { exact: true })).toBeVisible();
    await expect(page.getByText(/\(form\)/)).toHaveCount(0);
  });

  test('names both, and says which is which, when they differ', async ({ page }) => {
    await open(page, payload({ formOwner: 'Jordan Blake', siteOwner: 'Avery Stone' }));

    const line = page.getByText(/Watched by/);
    await expect(line).toContainText('Jordan Blake');
    await expect(line).toContainText('Avery Stone');
    await expect(line).toContainText('(form)');
    await expect(line).toContainText('(uptime)');
  });

  test('says nothing when no monitor has a recorded owner', async ({ page }) => {
    // Monitors from before ownership existed. "Watched by —" teaches nothing
    // and costs a row, so the line is absent rather than empty.
    await open(page, payload({}));

    await expect(page.getByText(/Watched by/)).toHaveCount(0);
  });

  test('ignores the owner of a monitor that is no longer running', async ({ page }) => {
    // A stopped form monitor keeps its last result but nobody is watching it,
    // so its old owner must not be presented as responsible for the URL.
    await open(page, payload({ formOwner: 'Jordan Blake', formIntervalMs: null, state: 'unknown' }));

    await expect(page.getByText(/Watched by/)).toHaveCount(0);
  });

  test('states the form monitor’s cadence beside its mode', async ({ page }) => {
    await open(page, payload({ formOwner: 'Jordan Blake', siteOwner: 'Jordan Blake' }));

    await expect(page.getByText(/every 3d|every 3 days/)).toBeVisible();
  });

  test('reads on a phone without pushing the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page, payload({ formOwner: 'Jordan Blake', siteOwner: 'Avery Stone' }));

    await expect(page.getByText(/Watched by/)).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test('names the content watcher too, like the project page does', async ({ page }) => {
  /**
   * This screen named two of a URL's three watchers while the project page a
   * click away named all three — content tracking was simply absent from the
   * payload here. The same URL reporting different amounts of knowledge on two
   * screens is how people come to distrust both.
   *
   * It also pins the grouping: somebody holding two of the three is named once
   * with both against them, not twice, or three monitors would read as three
   * people.
   */
  await open(page, payload({ formOwner: 'Jordan Blake', siteOwner: 'Avery Stone', changeOwner: 'Jordan Blake' }));

  const line = page.getByText(/Watched by/);
  await expect(line).toContainText('Jordan Blake (form, content)');
  await expect(line).toContainText('Avery Stone (uptime)');
});
