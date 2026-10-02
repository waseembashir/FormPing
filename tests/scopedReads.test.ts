/**
 * FR-74 — a scoped read must narrow BEFORE the database applies its limit.
 *
 * `loadReports` fetches a site's newest reports up to a limit. Once the read is
 * scoped to one person, where the filter happens stops being an implementation
 * detail and becomes the difference between a correct tab and an empty one:
 *
 *   - filter in the QUERY  → the newest N reports belonging to me
 *   - filter AFTERWARDS    → the newest N reports belonging to ANYONE, with
 *                            everyone else's then removed
 *
 * In the second case someone whose reports sit behind fifty of a colleague's
 * sees nothing at all, while having plenty of their own. The limit quietly
 * becomes a limit on other people's rows. There is no error and no empty-state
 * distinction — the tab simply looks like you have never run anything.
 *
 * So this pins the ORDER of the query, not just the result.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Records the query chain the store builds, in the order it is built. */
const calls = vi.hoisted(() => ({ chain: [] as string[] }));

vi.mock('@/lib/supabase', () => {
  const builder: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(ok);
        }
        return (...args: unknown[]) => {
          calls.chain.push(String(prop));
          if (prop === 'or') calls.chain.push(`or-arg:${String(args[0])}`);
          return builder;
        };
      },
    },
  );
  return { supabaseAdmin: () => builder, supabaseEnabled: () => true, supabaseSchema: () => 'dev' };
});

beforeEach(() => {
  calls.chain.length = 0;
});

describe('loadReports narrows by owner in the query', () => {
  it('applies the owner filter before the limit', async () => {
    const { loadReports } = await import('@/lib/reportStore');
    await loadReports('example.com', 50, 'owner@example.com');

    const or = calls.chain.indexOf('or');
    const limit = calls.chain.indexOf('limit');

    expect(or, 'a scoped read must narrow in the query').toBeGreaterThan(-1);
    expect(limit, 'the query should still be limited').toBeGreaterThan(-1);
    expect(or, 'the owner filter must come before the limit').toBeLessThan(limit);
  });

  it('keeps ownerless reports in that filter', async () => {
    // Legacy reports have no owner and stay visible to everyone, so the filter
    // has to be "mine OR nobody's" rather than "mine".
    const { loadReports } = await import('@/lib/reportStore');
    await loadReports('example.com', 50, 'owner@example.com');

    expect(calls.chain.some((c) => c.startsWith('or-arg:') && c.includes('owner.is.null'))).toBe(true);
  });

  it('does not narrow at all when no scope is given', async () => {
    // The shared Projects views call it this way and must keep seeing every
    // owner's reports — that is what tells the team a site is already covered.
    const { loadReports } = await import('@/lib/reportStore');
    await loadReports('example.com', 50);

    expect(calls.chain).not.toContain('or');
  });
});
