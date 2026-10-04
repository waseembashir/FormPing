/**
 * What a form monitor does on a database that is one migration behind.
 *
 * FR-79 added `pinned_page` to `form_watch_schedules`. That table also holds
 * `next_run_at`, which makes it the one place where a column the database does
 * not have yet is more than a lost field:
 *
 *   • PostgREST refuses the WHOLE upsert when the payload names an unknown
 *     column. That upsert is what advances `next_run_at`, so a refusal leaves
 *     every monitor permanently due — and the ticker, finding them due on every
 *     pass, re-runs each one every sixty seconds. A missing column turns into a
 *     loop that hammers a client's site.
 *   • It refuses a SELECT that names one too. Returning nothing there does not
 *     merely empty the Scheduler tab: the ticker reads the same function, so it
 *     would find no schedules at all and monitoring would stop silently.
 *
 * Both are the shape of the 2026-09-08 data loss — code deployed ahead of its
 * migration, every write refused, nothing but warnings in a log. So the store
 * gives up the pin rather than the cadence, and these pin which one it drops.
 *
 * The deploy order this protects is real either way round: Railway can finish
 * before the SQL is run by hand, and `dev` routinely lags `public`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const db = vi.hoisted(() => ({
  /** Whether the fake database has had migration 0018 applied. */
  migrated: false,
  /** Every `select` column list asked for, in order. */
  selects: [] as string[],
  /** Every row an upsert attempted, in order. */
  upserts: [] as Record<string, unknown>[],
}));

/**
 * A Supabase stand-in that refuses `pinned_page` the way PostgREST does —
 * rejecting the whole request rather than ignoring the field — so the retry is
 * exercised rather than described.
 */
vi.mock('@/lib/supabase', () => {
  const missing = (what: string) => ({
    data: null,
    error: { message: `column form_watch_schedules.${what} does not exist` },
  });

  const makeBuilder = () => {
    let op: 'select' | 'upsert' | 'other' = 'other';
    let columns = '';
    let row: Record<string, unknown> | null = null;

    const settle = () => {
      if (op === 'select') {
        if (!db.migrated && columns.includes('pinned_page')) return missing('pinned_page');
        return { data: [], error: null };
      }
      if (op === 'upsert') {
        if (!db.migrated && row && 'pinned_page' in row) return missing('pinned_page');
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop === 'symbol') return undefined;
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown) => Promise.resolve(settle()).then(ok);
          }
          return (...args: unknown[]) => {
            const name = String(prop);
            if (name === 'select') {
              op = 'select';
              columns = String(args[0] ?? '');
              db.selects.push(columns);
            } else if (name === 'upsert') {
              op = 'upsert';
              row = args[0] as Record<string, unknown>;
              db.upserts.push(row);
            }
            return builder;
          };
        },
      },
    );
    return builder;
  };

  return {
    supabaseAdmin: () => ({ from: () => makeBuilder() }),
    supabaseEnabled: () => true,
    supabaseSchema: () => 'dev',
  };
});

const schedule = {
  id: 'sched-1',
  url: 'https://example.com',
  site: 'example.com',
  intervalMs: 86_400_000,
  mode: 'safe' as const,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastRunAt: '2026-10-03T00:00:00.000Z',
  nextRunAt: '2026-10-04T00:00:00.000Z',
  pinnedPage: 'https://example.com/contact',
  pinnedAt: '2026-10-03T00:00:00.000Z',
};

beforeEach(() => {
  db.migrated = false;
  db.selects.length = 0;
  db.upserts.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('on a database that has had the migration', () => {
  it('stores the pinned page in one write', async () => {
    db.migrated = true;
    const { upsertSchedule } = await import('@/lib/formWatch/scheduleStore');
    await upsertSchedule(schedule);

    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0]).toMatchObject({
      pinned_page: 'https://example.com/contact',
      next_run_at: '2026-10-04T00:00:00.000Z',
    });
  });
});

describe('on a database that has not', () => {
  it('still advances the cadence, having dropped only the pin', async () => {
    // The whole point. The pin is worth losing; `next_run_at` is not, because
    // a monitor that never reschedules runs on every single tick.
    const { upsertSchedule } = await import('@/lib/formWatch/scheduleStore');
    await upsertSchedule(schedule);

    expect(db.upserts).toHaveLength(2); // the attempt, then the retry
    const retry = db.upserts[1]!;
    expect(retry).not.toHaveProperty('pinned_page');
    expect(retry).toMatchObject({
      id: 'sched-1',
      next_run_at: '2026-10-04T00:00:00.000Z',
      last_run_at: '2026-10-03T00:00:00.000Z',
    });
  });

  it('keeps listing monitors, so the ticker still has something to run', async () => {
    // A read that gave up here would stop monitoring altogether, which looks
    // nothing like its cause: no errors, no alerts, just nothing ever running.
    const { listSchedules } = await import('@/lib/formWatch/scheduleStore');
    const rows = await listSchedules();

    expect(rows).toEqual([]); // the fake holds no rows — what matters is HOW it asked
    expect(db.selects).toHaveLength(2);
    expect(db.selects[0]).toContain('pinned_page');
    expect(db.selects[1]).not.toContain('pinned_page');
    expect(db.selects[1]).toContain('next_run_at');
  });

  it('asks for the pin first every time, so one applied migration is enough', async () => {
    // The fallback must not latch. These run in one process for months; a store
    // that gave up on the column after its first refusal would keep ignoring it
    // long after the migration landed, and nothing would ever pin again.
    const { listSchedules } = await import('@/lib/formWatch/scheduleStore');
    await listSchedules();
    db.selects.length = 0;

    db.migrated = true;
    await listSchedules();

    expect(db.selects).toHaveLength(1);
    expect(db.selects[0]).toContain('pinned_page');
  });
});
