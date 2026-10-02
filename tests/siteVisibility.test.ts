/**
 * FR-74 — whether a site's snapshots may be seen, and cleared, by the caller.
 *
 * Snapshots are files on disk keyed by host. Nothing on disk records who took
 * one, so they cannot be filtered the way a database row can. The answer comes
 * from the change event each snapshot writes as it is taken -- those carry an
 * owner, and they exist for every snapshot, so they are an exact proxy rather
 * than a guess.
 *
 * Two consequences, and the second is the serious one:
 *
 *   - a count leaks that somebody is monitoring a site ("2 snapshots, 46 KB")
 *   - DELETE removes the files, so without the same check one person can
 *     destroy another's baselines without ever being able to see them
 *
 * A leak is embarrassing; silently deleting work somebody depends on is not
 * recoverable. Both use this one helper, which is why it is tested here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rows: [] as { owner: string | null }[],
  error: null as { message: string } | null,
}));

vi.mock('@/lib/supabase', () => {
  const builder: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: db.rows, error: db.error }).then(ok);
        }
        return () => builder;
      },
    },
  );
  return { supabaseAdmin: () => builder, supabaseEnabled: () => true, supabaseSchema: () => 'dev' };
});

const ME = 'owner@example.com';

beforeEach(() => {
  db.rows = [];
  db.error = null;
});

describe('whether a site is visible to the caller', () => {
  it('is visible to everyone when nothing is being scoped', async () => {
    // Flag off, or nobody signed in. Must not even query.
    const { siteVisibleTo } = await import('@/lib/changeEventStore');
    expect(await siteVisibleTo('example.com')).toBe(true);
  });

  it('is visible when the caller has an event for it', async () => {
    db.rows = [{ owner: ME }];
    const { siteVisibleTo } = await import('@/lib/changeEventStore');
    expect(await siteVisibleTo('example.com', ME)).toBe(true);
  });

  it('is visible when the events are legacy and ownerless', async () => {
    // Consistent with every other surface: pre-isolation work stays shared
    // until somebody re-runs it.
    db.rows = [{ owner: null }];
    const { siteVisibleTo } = await import('@/lib/changeEventStore');
    expect(await siteVisibleTo('example.com', ME)).toBe(true);
  });

  it('is hidden when every event belongs to someone else', async () => {
    db.rows = [{ owner: 'other@example.com' }];
    const { siteVisibleTo } = await import('@/lib/changeEventStore');
    expect(await siteVisibleTo('example.com', ME)).toBe(false);
  });

  it('is hidden when the site has no events at all', async () => {
    db.rows = [];
    const { siteVisibleTo } = await import('@/lib/changeEventStore');
    expect(await siteVisibleTo('example.com', ME)).toBe(false);
  });

  it('hides rather than reveals when the lookup fails', async () => {
    // Failing open would leak the count on any transient database error, and
    // would let DELETE through on one too. A missing count is visibly odd and
    // gets reported; a leak or a wrongful delete is silent.
    db.error = { message: 'connection reset' };
    db.rows = [{ owner: ME }];
    const { siteVisibleTo } = await import('@/lib/changeEventStore');
    expect(await siteVisibleTo('example.com', ME)).toBe(false);
  });

  it('treats an unknown host as not visible', async () => {
    db.rows = [{ owner: ME }];
    const { siteVisibleTo } = await import('@/lib/changeEventStore');
    expect(await siteVisibleTo('unknown', ME)).toBe(false);
    expect(await siteVisibleTo('', ME)).toBe(false);
  });
});
