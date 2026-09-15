/**
 * FR-87 — the rules that decide what a monitor may claim after a failed write.
 *
 * The 2026-09-08 data loss was not caused by a store failing. It was caused by
 * everything downstream carrying on as though the store had succeeded: the run
 * row was refused, and the schedule's summary — a different statement, a
 * different table — was written anyway, so a card reported a fresh healthy check
 * above a history that did not contain it.
 *
 * These pin the two decisions that prevent that, and they import the real
 * modules rather than restating them (see the `@` alias in vitest.config.ts):
 * a mirrored copy would have passed happily while the app lost data.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  WRITE_OK,
  bestEffortWriteFailed,
  clearSaveFailure,
  essentialWriteFailed,
  failureReason,
  getSaveFailure,
  keepCadenceOnly,
  noteSaveFailure,
  resetSaveFailures,
  saveFailures,
} from '@/lib/persistence';

beforeEach(() => resetSaveFailures());
afterEach(() => vi.restoreAllMocks());

describe('write outcomes', () => {
  it('an essential failure is loud, and says the result was not saved', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outcome = essentialWriteFailed('formWatch/historyStore', 'column "trigger_source" does not exist');

    expect(outcome).toEqual({ ok: false, reason: 'column "trigger_source" does not exist' });
    expect(err).toHaveBeenCalledOnce();
    // console.error, not warn — the old warning is how this went unnoticed.
    const line = err.mock.calls[0]![0] as string;
    expect(line).toContain('ESSENTIAL WRITE FAILED');
    expect(line).toContain('column "trigger_source" does not exist');
  });

  it('a best-effort failure stays a warning and returns nothing to check', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(bestEffortWriteFailed('formWatch/historyStore: prune scheduled', 'timeout')).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('ignored by design');
  });

  it('failureReason reports the first thing that actually went wrong', () => {
    expect(failureReason(WRITE_OK, { ok: false, reason: 'refused' })).toBe('refused');
    expect(failureReason({ ok: false, reason: 'first' }, { ok: false, reason: 'second' })).toBe('first');
    expect(failureReason(WRITE_OK, WRITE_OK)).toBe('unknown');
  });
});

describe('keepCadenceOnly — what a monitor may carry forward after a failed save', () => {
  /** A Form Watch schedule as it stood BEFORE the run that failed to save. */
  const previous = {
    id: 's1',
    url: 'https://example.com/contact',
    lastRunAt: '2026-09-01T08:00:00.000Z',
    nextRunAt: '2026-09-04T08:00:00.000Z',
    lastStatus: 'pass',
    lastReasonCode: 'FORM_SUBMITTED',
    lastFormFound: true,
  };
  /** What the ticker would have written had the run stored cleanly. */
  const advanced = {
    ...previous,
    lastRunAt: '2026-09-08T08:00:00.000Z',
    nextRunAt: '2026-09-11T08:00:00.000Z',
    lastStatus: 'error',
    lastReasonCode: 'ERROR',
    lastFormFound: false,
  };

  it('moves the retry forward', () => {
    expect(keepCadenceOnly(previous, advanced, 'nextRunAt').nextRunAt).toBe('2026-09-11T08:00:00.000Z');
  });

  it('keeps every claim at what the monitor last actually proved', () => {
    const kept = keepCadenceOnly(previous, advanced, 'nextRunAt');
    // This is the exact regression: lastRunAt must NOT say the run happened,
    // because the row recording it was refused.
    expect(kept.lastRunAt).toBe('2026-09-01T08:00:00.000Z');
    expect(kept.lastStatus).toBe('pass');
    expect(kept.lastReasonCode).toBe('FORM_SUBMITTED');
    expect(kept.lastFormFound).toBe(true);
  });

  it('does not mutate either input', () => {
    keepCadenceOnly(previous, advanced, 'nextRunAt');
    expect(previous.nextRunAt).toBe('2026-09-04T08:00:00.000Z');
    expect(advanced.lastRunAt).toBe('2026-09-08T08:00:00.000Z');
  });

  it('works the same for a Site Watch schedule, whose cadence field differs', () => {
    const before = { id: 's2', lastCheckedAt: '2026-09-01T00:00:00.000Z', nextCheckAt: '2026-09-01T00:05:00.000Z', lastStatusCode: 200 };
    const after = { id: 's2', lastCheckedAt: '2026-09-08T00:00:00.000Z', nextCheckAt: '2026-09-08T00:05:00.000Z', lastStatusCode: 500 };
    const kept = keepCadenceOnly(before, after, 'nextCheckAt');
    expect(kept.nextCheckAt).toBe('2026-09-08T00:05:00.000Z');
    expect(kept.lastCheckedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(kept.lastStatusCode).toBe(200);
  });
});

describe('remembering which monitors have an unsaved result', () => {
  it('records, reads back and clears a failure', () => {
    expect(getSaveFailure('form', 's1')).toBeNull();

    noteSaveFailure('form', 's1', 'refused');
    const failure = getSaveFailure('form', 's1');
    expect(failure?.reason).toBe('refused');
    expect(Date.parse(failure!.at)).not.toBeNaN();

    clearSaveFailure('form', 's1');
    expect(getSaveFailure('form', 's1')).toBeNull();
  });

  it('keeps the two schedulers apart, so one id cannot mask the other', () => {
    noteSaveFailure('form', 'shared-id', 'form refused');
    noteSaveFailure('site', 'shared-id', 'site refused');

    expect(getSaveFailure('form', 'shared-id')?.reason).toBe('form refused');
    expect(getSaveFailure('site', 'shared-id')?.reason).toBe('site refused');
    expect(saveFailures('form')).toEqual({ 'shared-id': expect.objectContaining({ reason: 'form refused' }) });

    clearSaveFailure('form', 'shared-id');
    expect(getSaveFailure('site', 'shared-id')?.reason).toBe('site refused');
  });

  it('lists only the monitors currently affected', () => {
    noteSaveFailure('site', 'a', 'refused');
    noteSaveFailure('site', 'b', 'refused');
    clearSaveFailure('site', 'a');
    expect(Object.keys(saveFailures('site'))).toEqual(['b']);
  });
});
