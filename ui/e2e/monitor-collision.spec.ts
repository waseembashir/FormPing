import { test, expect } from '@playwright/test';
import { mockFormWatch } from './helpers/mockApi';
import { SAFE_MONITOR } from './fixtures/schedules';

/**
 * Being refused a URL somebody else already monitors.
 *
 * One URL, one monitor, one person responsible — enforced across the whole
 * team, because two monitors on one form would post two real submissions into
 * a client's inbox every cycle. Per-user isolation then made that rule
 * unanswerable: the monitor in your way belongs to a colleague, so it is not in
 * your tab and was named on no screen. "A schedule already exists for this URL"
 * was true and left nowhere to go.
 *
 * This asserts the refusal now carries the one fact that makes it actionable.
 * The 409 is served from a fixture because provoking a real one needs a second
 * signed-in user holding a monitor on the same URL, which the hermetic
 * environment cannot arrange.
 */

const URL_IN_USE = 'https://client.test/contact';

test('a URL a colleague monitors is refused by name, not by a dead end', async ({ page }) => {
  await mockFormWatch(page, [SAFE_MONITOR], {}, {
    status: 409,
    body: {
      error:
        'Priya Sharma already has a form monitor on this URL. Each URL is watched by one person, so speak to them if it should be yours.',
    },
  });
  await page.goto('/form-watch');

  await page.getByPlaceholder('client-site.com/contact').fill(URL_IN_USE);
  await page.getByRole('button', { name: 'Add monitor' }).click();

  // The name is the point: it is who you have to speak to, and without it the
  // message sends the reader looking for a monitor they cannot see.
  await expect(page.getByText(/Priya Sharma/)).toBeVisible();
  // And the RULE, not just the obstacle — "already exists" reads like a
  // duplicate to dodge and sends people hunting for a way to add a second.
  await expect(page.getByText(/one person/i)).toBeVisible();
});

/*
 * There is deliberately no e2e for "the refusal does not disclose the blocking
 * monitor". In this environment the mock IS the server, so such a test would
 * assert that a fixture lacks something the fixture's author chose to leave
 * out — true by construction, and proof of nothing.
 *
 * That guarantee lives where it can actually be checked: the route builds its
 * 409 body from `collisionMessage` alone (unit tested), and both pages read
 * `data.schedule.id` strictly after their `!res.ok` return, so there is no
 * consumer left for the record that used to be sent.
 */
