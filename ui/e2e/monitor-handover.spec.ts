import { test, expect } from '@playwright/test';

/**
 * Handing a URL's monitors to somebody else.
 *
 * A URL is watched by one person, and only they can see or manage it — right
 * until they go on leave, or leave. In a two-user test the only way to take a
 * URL over was to ask the colleague to stop their monitor, which works exactly
 * as long as they are reachable.
 *
 * The control lives on the "Watched by" badge rather than as a fourth button:
 * the badge states who is responsible, and pressing it is how that changes.
 *
 * Hermetic — the project payload and the team list are served from fixtures,
 * and the handover requests are recorded rather than performed.
 */

const AT = new Date(Date.now() - 3 * 3600_000).toISOString();

function payload(over: { formOwner?: string; siteOwner?: string; siteMonitored?: boolean } = {}) {
  return {
    project: {
      id: 'p1', name: 'Apexure', urls: ['https://www.apexure.com'],
      createdAt: AT, updatedAt: AT, createdBy: 'Tajamul Wani', updatedBy: 'Tajamul Wani',
      shareToken: null,
      health: [{
        url: 'https://www.apexure.com',
        form: {
          monitored: true, owner: over.formOwner ?? 'Tajamul Wani',
          ownerEmail: over.formOwner === 'Priya Sharma' ? 'priya@apexure.com' : 'tajamul@apexure.com',
          level: 'healthy',
          label: 'Form detected', mode: 'detect-only', intervalMs: 86_400_000, lastRunAt: AT,
        },
        site: over.siteMonitored === false
          ? { monitored: false }
          : {
              monitored: true, owner: over.siteOwner ?? 'Tajamul Wani',
              ownerEmail: over.siteOwner === 'Priya Sharma' ? 'priya@apexure.com' : 'tajamul@apexure.com',
              upState: 'up',
              statusCode: 200, intervalMs: 300_000, lastCheckedAt: AT,
              ssl: { valid: true, daysRemaining: 60 },
            },
        change: { tracked: false },
      }],
    },
  };
}

/** Records the handovers a spec provoked, so it can assert on them. */
async function mockProject(page: import('@playwright/test').Page, body: unknown) {
  const sent: { kind: string; to: string }[] = [];

  await page.route('**/api/projects/p1', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));

  await page.route('**/api/users/assignable', (r) =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ users: [
        // The current owner is deliberately present: the picker has to leave
        // them out itself, and a list that never contained them would prove
        // nothing.
        { email: 'tajamul@apexure.com', name: 'Tajamul Wani' },
        { email: 'priya@apexure.com', name: 'Priya Sharma' },
        { email: 'noname@apexure.com', name: null },
      ] }),
    }));

  await page.route('**/url/**/assign', async (r) => {
    sent.push(r.request().postDataJSON() as { kind: string; to: string });
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/projects/p1');
  return sent;
}

test('the badge is the control that hands a URL on', async ({ page }) => {
  const sent = await mockProject(page, payload());

  await page.getByRole('button', { name: /Watched by/ }).click();
  await expect(page.getByText('Priya Sharma')).toBeVisible();

  // Says plainly what changes, because handing over moves where alerts go.
  await expect(page.getByText(/alerts go to them/i)).toBeVisible();
  // …and what does not. Past checks keep naming whoever ran them.
  await expect(page.getByText(/stay recorded against whoever ran them/i)).toBeVisible();

  await page.getByRole('menuitem', { name: 'Priya Sharma' }).click();

  // One person owned both monitors, so both move — "give this URL to Priya"
  // means the URL, not one of its checks.
  await expect.poll(() => sent).toEqual([
    { kind: 'form', to: 'priya@apexure.com' },
    { kind: 'uptime', to: 'priya@apexure.com' },
  ]);
});

test('moves only the monitors that exist', async ({ page }) => {
  const sent = await mockProject(page, payload({ siteMonitored: false }));

  await page.getByRole('button', { name: /Watched by/ }).click();
  await page.getByRole('menuitem', { name: 'Priya Sharma' }).click();

  await expect.poll(() => sent).toEqual([{ kind: 'form', to: 'priya@apexure.com' }]);
});

test('hands over one monitor at a time when owners differ', async ({ page }) => {
  // Two owners put a badge on each row, and each speaks only for its own.
  const sent = await mockProject(page, payload({ formOwner: 'Priya Sharma', siteOwner: 'Tajamul Wani' }));

  await page.getByRole('button', { name: 'Watched by Priya Sharma' }).click();

  // Priya is not offered here — she already holds this one. Before the picker
  // learned that, this test picked her, and "passed" by asserting a request
  // the server would have refused.
  await expect(page.getByRole('menuitem', { name: 'Priya Sharma' })).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'Tajamul Wani' }).click();

  // Only the form monitor moves. The uptime monitor is somebody else's and has
  // its own badge.
  await expect.poll(() => sent).toEqual([{ kind: 'form', to: 'tajamul@apexure.com' }]);
});

test('falls back to the address for somebody with no name recorded', async ({ page }) => {
  await mockProject(page, payload());
  await page.getByRole('button', { name: /Watched by/ }).click();

  // Better than a blank row: the address is reachable, and a picker entry you
  // cannot identify is one nobody dares press.
  await expect(page.getByRole('menuitem', { name: 'noname@apexure.com' })).toBeVisible();
});

/*
 * The project page's own fit on a phone is guarded by
 * project-page-responsive.spec.ts — it is a property of the page, not of this
 * feature, and it broke once already from a change that had nothing to do with
 * handovers.
 */

test('the menu opens without pushing the page sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await mockProject(page, payload());

  await page.getByRole('button', { name: /Watched by/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Priya Sharma' })).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test('never offers the monitor to whoever already has it', async ({ page }) => {
  /**
   * The server refuses this — "that person already watches this URL" — so
   * offering it was presenting a choice that could only fail. Worse than
   * useless: seeing your own name under "hand this monitor to" reads as though
   * the app has not noticed the monitor is already yours, and invites the
   * reasonable question of whether you are supposed to assign your own work to
   * yourself.
   *
   * The rule was written down when this menu was built — a viewer is left out
   * because the server would refuse them — and simply never applied to the
   * owner.
   */
  await mockProject(page, payload());

  await page.getByRole('button', { name: /Watched by/ }).click();

  await expect(page.getByRole('menuitem', { name: 'Priya Sharma' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Tajamul Wani' })).toHaveCount(0);
});
