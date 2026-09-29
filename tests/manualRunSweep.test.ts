/**
 * FR-93 — an expired re-run row leaves the database, not just the screen.
 *
 * The rule from FR-89 is "a manual run's row lives 24 hours, then disappears
 * from the database and from the log". Only the second half was true: the
 * per-schedule prune runs inside a successful append, so it deletes a row the
 * next time THAT monitor writes. A paused or stopped monitor never writes
 * again, and its re-run row stayed in Postgres indefinitely.
 *
 * That matters because a re-run in Live mode submitted a real message to a
 * client's form, and the row is the record of it.
 *
 * Two things have to hold at once, and the second is the dangerous one:
 *   - every expired MANUAL row goes, whatever its schedule is doing; and
 *   - no SCHEDULED row is ever touched by the sweep.
 *
 * A sweep that deletes too much would look like a working feature while
 * quietly destroying history, so the filters are asserted rather than the
 * outcome — a stand-in database cannot tell us what a real DELETE matched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Every call made on the query builder, in order, with its arguments. */
const calls = vi.hoisted(() => [] as { method: string; args: unknown[] }[]);
const db = vi.hoisted(() => ({ error: null as { message: string } | null, rows: [] as { id: string }[] }));

vi.mock('@/lib/supabase', () => {
  const builder: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
            Promise.resolve({ data: db.rows, error: db.error }).then(ok, fail);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return builder;
        };
      },
    },
  );
  return {
    supabaseAdmin: () => builder,
    supabaseEnabled: () => true,
    supabaseSchema: () => 'dev',
  };
});

const arg = (method: string, i = 0) => calls.find((c) => c.method === method)?.args[i];
const argsFor = (method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  db.error = null;
  db.rows = [{ id: 'a' }, { id: 'b' }];
});

describe.each([
  {
    name: 'Form Watch',
    table: 'form_watch_runs',
    stamp: 'ran_at',
    load: async () => (await import('@/lib/formWatch/historyStore')).sweepExpiredManualRuns,
  },
  {
    name: 'Site Watch',
    table: 'site_watch_runs',
    stamp: 'checked_at',
    load: async () => (await import('@/lib/siteWatch/historyStore')).sweepExpiredManualChecks,
  },
])('$name sweep', ({ table, stamp, load }) => {
  it('deletes from its own history table', async () => {
    await (await load())();
    expect(arg('from')).toBe(table);
    expect(calls.some((c) => c.method === 'delete')).toBe(true);
  });

  it('touches manual rows only — scheduled history is never swept', async () => {
    // The whole safety of this feature. Scheduled runs are the client's record
    // and are capped by count elsewhere; a time-based sweep must not see them.
    await (await load())();
    expect(argsFor('eq')).toContainEqual(['trigger_source', 'manual']);
  });

  it('is not scoped to one schedule — that scoping is the bug', async () => {
    // The per-schedule prune already existed. A sweep that also filtered by
    // schedule_id would reintroduce exactly the gap this fixes: a paused
    // monitor's row would still never be reached.
    await (await load())();
    expect(argsFor('eq').map(([col]) => col)).not.toContain('schedule_id');
  });

  it('cuts off at exactly 24 hours before the moment it ran', async () => {
    // Bracketed rather than given a tolerance. The sweep reads the clock inside
    // itself, at some instant between these two readings, so its cutoff must
    // land between them minus the TTL — an exact statement that holds however
    // long the call takes, on any machine.
    const TTL = 24 * 60 * 60 * 1000;
    const before = Date.now();
    await (await load())();
    const after = Date.now();

    const [column, cutoff] = (argsFor('lt')[0] ?? []) as [string, string];
    expect(column).toBe(stamp);
    expect(Date.parse(cutoff)).toBeGreaterThanOrEqual(before - TTL);
    expect(Date.parse(cutoff)).toBeLessThanOrEqual(after - TTL);
  });

  it('reports how many rows it removed', async () => {
    expect(await (await load())()).toBe(2);
  });

  it('survives a refused delete without throwing, and reports none removed', async () => {
    // Retention is best-effort: the read-side filter still hides the row, so a
    // failed sweep must not take the ticker down with it — the whole pass, and
    // every due monitor in it, would be lost over a cleanup.
    db.error = { message: 'permission denied' };
    await expect((await load())()).resolves.toBe(0);
  });
});
