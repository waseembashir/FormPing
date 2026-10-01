/**
 * FR-74 — every row records whose work it is, and a scheduled run inherits.
 *
 * Isolation is only as good as the stamping underneath it. A row created
 * without an owner reads as legacy/shared, so once filtering is switched on it
 * stays visible to everyone — which looks like the feature silently not
 * working rather than like a bug, and would be found by a user rather than a
 * test.
 *
 * The dangerous case is not the obvious one. A monitor created through the app
 * has a signed-in session to take the owner from; a SCHEDULED RUN does not. It
 * is created by a ticker, on a timer, with no request and nobody to ask — so it
 * can only inherit from the schedule that triggered it. Get that wrong and
 * every scheduled result is ownerless while every manually created monitor
 * looks perfect.
 *
 * These test the mapping functions the stores and tickers use, which is where
 * the inheritance actually happens.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FormRunRecord } from '@/lib/formWatch/types';

/** Captures what the store hands to the database, without a database. */
const sent = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('@/lib/supabase', () => {
  const builder: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
        }
        return (...args: unknown[]) => {
          if ((prop === 'insert' || prop === 'upsert') && args[0] && typeof args[0] === 'object') {
            sent.rows.push(args[0] as Record<string, unknown>);
          }
          return builder;
        };
      },
    },
  );
  return { supabaseAdmin: () => builder, supabaseEnabled: () => true, supabaseSchema: () => 'dev' };
});

const run = (over: Partial<FormRunRecord> = {}): FormRunRecord =>
  ({
    scheduleId: 's1',
    url: 'https://example.com/contact',
    site: 'example.com',
    mode: 'detect-only',
    ranAt: new Date().toISOString(),
    status: 'pass',
    reasonCode: 'DETECT_ONLY',
    fingerprint: { formFound: true },
    notes: [],
    errors: [],
    ...over,
  }) as FormRunRecord;

beforeEach(() => {
  sent.rows.length = 0;
});

describe('a run carries its owner to the database', () => {
  it('writes the owner it was given', async () => {
    const { appendRun } = await import('@/lib/formWatch/historyStore');
    await appendRun(run({ owner: 'owner@example.com' }));
    expect(sent.rows[0]?.owner).toBe('owner@example.com');
  });

  it('writes NULL rather than throwing when there is no owner', async () => {
    // Legacy and unauthenticated paths must still record their result. Losing a
    // run because nobody could be attributed would trade a privacy feature for
    // data loss — the FR-87 failure, reintroduced.
    const { appendRun } = await import('@/lib/formWatch/historyStore');
    await appendRun(run());
    expect(sent.rows).toHaveLength(1);
    expect(sent.rows[0]?.owner).toBeNull();
  });

  it('sends the column on every write, not only when an owner exists', async () => {
    // If the key were omitted when undefined, a row would keep whatever the
    // database had before on an upsert, instead of being set explicitly.
    const { appendRun } = await import('@/lib/formWatch/historyStore');
    await appendRun(run());
    expect(Object.keys(sent.rows[0] ?? {})).toContain('owner');
  });
});

describe('derived rows inherit rather than invent', () => {
  it('a per-URL result takes the owner from the run that produced it', async () => {
    const { recordResult } = await import('@/lib/formWatch/resultStore');
    await recordResult(run({ owner: 'other@example.com' }));
    expect(sent.rows.some((r) => r.owner === 'other@example.com')).toBe(true);
  });

  it('and carries NULL through when the run had none', async () => {
    const { recordResult } = await import('@/lib/formWatch/resultStore');
    await recordResult(run());
    expect(sent.rows.every((r) => r.owner === null)).toBe(true);
  });
});
