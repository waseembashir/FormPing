import type { Page } from '@playwright/test';
import type { FormSchedule } from '@/lib/formWatch/types';

/**
 * Put the app into a known state by answering its API calls with fixtures.
 *
 * A spec says what exists and what it wants to observe; it never has to know
 * which endpoints the page happens to call. Extends the `page.route` pattern
 * already used by tester-multiform.spec.ts. FR-88.
 */

/** Records the run-now calls a spec provoked, so it can assert on them. */
export interface RunNowSpy {
  /** Schedule ids the page asked to run, in order. */
  readonly calls: string[];
}

/**
 * Serve the Form Scheduler from fixtures.
 *
 * Returns a spy over `POST /api/form-watch/run-now` — the request that actually
 * runs a test — so a spec can assert that cancelling a confirmation ran nothing,
 * which is the whole point of the guard.
 */
export async function mockFormWatch(page: Page, schedules: FormSchedule[]): Promise<RunNowSpy> {
  const calls: string[] = [];

  // The list the page renders.
  await page.route('**/api/form-watch', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schedules }) }),
  );

  // Each card's history. Empty: these specs are about the controls, not results.
  await page.route('**/api/form-watch/results**', (route) => {
    const id = new URL(route.request().url()).searchParams.get('id') ?? '';
    const schedule = schedules.find((s) => s.id === id) ?? null;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schedule, runs: [], manualRunning: false }),
    });
  });

  // The run itself — recorded, never actually performed.
  await page.route('**/api/form-watch/run-now', async (route) => {
    let id = '';
    try {
      id = (route.request().postDataJSON() as { id?: string })?.id ?? '';
    } catch {
      /* a malformed body is itself worth failing on in the assertion */
    }
    calls.push(id);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ started: true, alreadyRunning: false, startedAt: new Date().toISOString() }),
    });
  });

  return { calls };
}
