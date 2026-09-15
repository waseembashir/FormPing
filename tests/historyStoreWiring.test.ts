/**
 * FR-87 — the history stores report whether the row actually landed.
 *
 * This is the wiring the bug lived in, so it is the wiring under test: the real
 * `appendRun` / `appendCheck`, imported through the `@` alias, talking to a
 * stand-in Supabase client that can be told to refuse a write the way Postgres
 * refused the `trigger_source` column on 2026-09-08.
 *
 * Playwright cannot reach this: the e2e environment is hermetic with Supabase
 * blanked, so there is no database there to say no.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FormRunRecord } from '@/lib/formWatch/types';
import type { SiteCheckRecord } from '@/lib/siteWatch/types';

/**
 * What the fake database will answer with next. Hoisted so the `vi.mock`
 * factory below — which is lifted above the imports — can close over it.
 */
const db = vi.hoisted(() => ({ error: null as { message: string } | null }));

/**
 * A stand-in for the supabase-js query builder.
 *
 * Every method returns the builder again so any chain the store uses
 * (`.from().select().eq().order().range()`) keeps working without the test
 * having to know which one it picked, and awaiting anywhere in that chain
 * resolves to the configured answer.
 */
function builder(): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') {
          return (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: db.error }).then(onFulfilled, onRejected);
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({ from: () => builder() }),
  supabaseEnabled: () => true,
  supabaseSchema: () => 'test',
}));

const { appendRun } = await import('@/lib/formWatch/historyStore');
const { appendCheck } = await import('@/lib/siteWatch/historyStore');

const formRun: FormRunRecord = {
  scheduleId: 's1',
  url: 'https://example.com/contact',
  site: 'example.com',
  mode: 'safe',
  ranAt: '2026-09-08T08:00:00.000Z',
  status: 'pass',
  reasonCode: 'FORM_FILLED',
  submissionResult: 'not_attempted',
  durationMs: 1200,
  fingerprint: {
    contactPage: 'https://example.com/contact',
    formFound: true,
    formConfidence: 0.9,
    formId: 'contact',
    formAction: '/submit',
    formMethod: 'post',
    captchaDetected: false,
  },
  notes: [],
  errors: [],
  trigger: 'scheduled',
};

const siteCheck: SiteCheckRecord = {
  scheduleId: 's2',
  url: 'https://example.com',
  host: 'example.com',
  checkedAt: '2026-09-08T08:00:00.000Z',
  uptime: { classification: 'up', statusCode: 200, responseMs: 120 },
  ssl: null,
  domain: null,
  trigger: 'scheduled',
};

beforeEach(() => {
  db.error = null;
});
afterEach(() => vi.restoreAllMocks());

describe('appendRun', () => {
  it('reports success when the row lands', async () => {
    await expect(appendRun(formRun)).resolves.toEqual({ ok: true });
  });

  it('reports the database\'s own refusal instead of swallowing it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The exact shape of the 2026-09-08 failure.
    db.error = { message: `Could not find the 'trigger_source' column of 'form_watch_runs'` };

    const outcome = await appendRun(formRun);

    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ reason: expect.stringContaining('trigger_source') });
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0]![0]).toContain('ESSENTIAL WRITE FAILED');
  });

  it('never throws — a refused write must not also destroy a good result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.error = { message: 'connection reset' };
    await expect(appendRun(formRun)).resolves.toMatchObject({ ok: false });
  });
});

describe('appendCheck', () => {
  it('reports success when the row lands', async () => {
    await expect(appendCheck(siteCheck)).resolves.toEqual({ ok: true });
  });

  it('reports a refusal', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.error = { message: `Could not find the 'trigger_source' column of 'site_watch_runs'` };

    const outcome = await appendCheck(siteCheck);

    expect(outcome.ok).toBe(false);
    expect(err.mock.calls[0]![0]).toContain('ESSENTIAL WRITE FAILED');
  });
});
