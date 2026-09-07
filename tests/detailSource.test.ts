/**
 * FR-67 — a URL can hold two accounts of its contact form: a manual Form Tester
 * run and a Form Scheduler monitor's last check.
 *
 * The bug this guards: the dashboard used to carry run detail ONLY when a URL
 * was NOT monitored, so adding a monitor stripped the page back to a single
 * line — it got poorer the more the URL was watched. Now both are carried and
 * the newer one is shown, which only works if this rule stays correct.
 *
 * Pure and import-free, so the engine's Vitest covers it.
 */

import { describe, it, expect } from 'vitest';
import { pickDetailSource } from '../ui/src/lib/status/detailSource';

const OLD = '2026-09-01T10:00:00.000Z';
const NEW = '2026-09-06T10:00:00.000Z';

describe('pickDetailSource', () => {
  it('shows nothing when neither source has detail', () => {
    expect(pickDetailSource({ hasMonitorDetail: false, hasRunDetail: false })).toBeNull();
  });

  it('uses the only source that has detail', () => {
    expect(pickDetailSource({ hasMonitorDetail: false, hasRunDetail: true, runAt: OLD })).toBe('tester');
    expect(pickDetailSource({ hasMonitorDetail: true, hasRunDetail: false, monitorAt: OLD })).toBe('monitor');
  });

  it('prefers whichever ran more recently', () => {
    expect(
      pickDetailSource({ hasMonitorDetail: true, hasRunDetail: true, monitorAt: NEW, runAt: OLD }),
    ).toBe('monitor');
    expect(
      pickDetailSource({ hasMonitorDetail: true, hasRunDetail: true, monitorAt: OLD, runAt: NEW }),
    ).toBe('tester');
  });

  it('keeps a monitored URL rich — the regression that started this', () => {
    // Before FR-67 this case returned nothing at all, because detail was only
    // attached when the URL had no monitor.
    expect(
      pickDetailSource({ hasMonitorDetail: true, hasRunDetail: false, monitorAt: NEW }),
    ).not.toBeNull();
  });

  it('falls back to the live monitor when a timestamp is unusable', () => {
    expect(
      pickDetailSource({ hasMonitorDetail: true, hasRunDetail: true, monitorAt: null, runAt: NEW }),
    ).toBe('monitor');
    expect(
      pickDetailSource({ hasMonitorDetail: true, hasRunDetail: true, monitorAt: 'not-a-date', runAt: NEW }),
    ).toBe('monitor');
  });
});
