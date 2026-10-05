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
  /** Schedule ids the page asked to re-resolve, in order. FR-79. */
  readonly findFormCalls: string[];
}

/**
 * Serve the Form Scheduler from fixtures.
 *
 * Returns a spy over `POST /api/form-watch/run-now` — the request that actually
 * runs a test — so a spec can assert that cancelling a confirmation ran nothing,
 * which is the whole point of the guard.
 */
export async function mockFormWatch(
  page: Page,
  schedules: FormSchedule[],
  /**
   * Monitors whose last run could not be stored, keyed by schedule id — the
   * shape `GET /api/form-watch` returns. Lets a spec reproduce a database
   * refusing writes, which the hermetic environment has no way to cause for
   * real. FR-87.
   */
  saveFailures: Record<string, { at: string }> = {},
  /**
   * How the server should answer an attempt to ADD a monitor. Lets a spec
   * reproduce the duplicate-URL refusal, which otherwise needs a second signed
   * in user holding a monitor on the same URL — something the hermetic
   * environment has no way to arrange. FR-116.
   */
  addResponse?: { status: number; body: unknown },
): Promise<RunNowSpy> {
  const calls: string[] = [];
  const findFormCalls: string[] = [];

  // The list the page renders — and, on POST, the answer to adding one.
  await page.route('**/api/form-watch', (route) => {
    if (route.request().method() === 'POST' && addResponse) {
      return route.fulfill({
        status: addResponse.status,
        contentType: 'application/json',
        body: JSON.stringify(addResponse.body),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schedules, saveFailures }),
    });
  });

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

  // "Find the form again" — recorded, never actually performed. Answered with
  // the monitor minus its pin, which is what the route really returns. FR-79.
  await page.route('**/api/form-watch/find-form', async (route) => {
    let id = '';
    try {
      id = (route.request().postDataJSON() as { id?: string })?.id ?? '';
    } catch {
      /* a malformed body is itself worth failing on in the assertion */
    }
    findFormCalls.push(id);
    const found = schedules.find((s) => s.id === id);
    const cleared = found ? { ...found, pinnedPage: undefined, pinnedAt: undefined } : null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schedule: cleared }),
    });
  });

  return { calls, findFormCalls };
}
