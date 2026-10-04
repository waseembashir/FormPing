import type { FormSchedule } from '@/lib/formWatch/types';

/**
 * Monitor fixtures for e2e specs.
 *
 * Built as objects rather than fetched from a database so a spec can put the app
 * into a state that is otherwise awkward to produce on demand — a Live monitor,
 * a paused one, a site that is down — and get the same state every run.
 *
 * Crucially it also keeps the tests harmless: creating a real Live monitor to
 * test the Live path would mean a real browser run submitting a real message to
 * whatever URL the fixture named. FR-88.
 */

const HOUR = 60 * 60 * 1000;

function schedule(over: Partial<FormSchedule> & Pick<FormSchedule, 'id' | 'url' | 'mode'>): FormSchedule {
  return {
    site: new URL(over.url).hostname,
    intervalMs: 24 * HOUR,
    createdAt: new Date(Date.now() - 72 * HOUR).toISOString(),
    lastRunAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    nextRunAt: new Date(Date.now() + 21 * HOUR).toISOString(),
    lastStatus: 'pass',
    lastReasonCode: 'SAFE_MODE_NO_SUBMIT',
    lastFormFound: true,
    ...over,
  };
}

/** A monitor that SUBMITS on every run — the one the confirmation guards. */
export const LIVE_MONITOR = schedule({
  id: 'sched-live',
  url: 'https://live.example.com/contact',
  mode: 'live',
  lastReasonCode: 'SUBMITTED',
});

/** Fills but never submits. Should re-run on one click, with no dialog. */
export const SAFE_MONITOR = schedule({
  id: 'sched-safe',
  url: 'https://safe.example.com/contact',
  mode: 'safe',
});

/**
 * A monitor that has resolved the page it watches, so the card can say which
 * page and offer to re-resolve it. Its pin is older than its last run, which is
 * the normal case: the page was found once and the checks went to it. FR-79.
 */
export const PINNED_MONITOR = schedule({
  id: 'sched-pinned',
  url: 'https://pinned.example.com',
  mode: 'safe',
  pinnedPage: 'https://pinned.example.com/contact-us',
  pinnedAt: new Date(Date.now() - 48 * HOUR).toISOString(),
});

/** Only confirms a form exists. Also one click. */
export const DETECT_MONITOR = schedule({
  id: 'sched-detect',
  url: 'https://detect.example.com/contact',
  mode: 'detect-only',
  lastReasonCode: 'DETECT_ONLY',
});
