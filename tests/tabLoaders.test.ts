/**
 * What each tool tab does with the answer it gets.
 *
 * These loaders exist because prefetching gave every tab a second caller. A
 * page and a prefetcher that shape the same response even slightly differently
 * would write cache entries the other then renders, and the symptom would
 * appear only on tabs somebody hovered — which is not a thing anyone would
 * think to reproduce. One loader per tab removes the possibility.
 *
 * The case worth the most attention here is the FAILED response, because it
 * used to be indistinguishable from an empty one. Three of these tabs read
 * `res.json()` without checking `res.ok`, so a 500 answering with a JSON error
 * body has no `schedules` key, the shaping turned that into `[]`, and the page
 * both displayed and CACHED "you have no monitors".
 *
 * Nothing failed. Nobody saw an error. The person was simply told that the
 * work they pay us to watch is not being watched, and the lie persisted in the
 * cache until the next good refresh.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { projectsTab, formWatchTab, siteWatchTab, teamTab } from '@/lib/tabLoaders';

/** Stand in for one fetch: a status and a body. */
function respond(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

/** A fetch that never answers — a dropped connection, an offline browser. */
function failToReach() {
  globalThis.fetch = vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('a response that failed is not an empty list', () => {
  it('reports a 500 as an error rather than shaping it into no monitors', async () => {
    // The bug this guards. The body is what a failing route actually sends:
    // valid JSON, no `schedules` key. Shaped blindly it becomes [].
    respond(500, { error: 'Internal Server Error' });

    const res = await formWatchTab().load();

    expect(res.ok).toBe(false);
    expect(res).toEqual({ ok: false, reason: 'error' });
  });

  it('does the same on Uptime and on Projects', async () => {
    respond(503, { error: 'upstream unavailable' });
    expect(await siteWatchTab().load()).toEqual({ ok: false, reason: 'error' });

    respond(500, { error: 'boom' });
    expect(await projectsTab('').load()).toEqual({ ok: false, reason: 'error' });
  });

  it('reports an unreachable server as an error too', async () => {
    failToReach();
    expect(await formWatchTab().load()).toEqual({ ok: false, reason: 'error' });
  });

  it('reports a body that is not JSON as an error, not as empty data', async () => {
    // An HTML error page answered with status 200 — a proxy or a crashed
    // route. `json()` throws, and that must not read as "no monitors".
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    })) as unknown as typeof fetch;

    expect(await siteWatchTab().load()).toEqual({ ok: false, reason: 'error' });
  });
});

describe('a refusal is kept apart from a failure', () => {
  it('reports 401 and 403 as forbidden', async () => {
    // Team shows a refusal as a refusal and never falls back to the cached
    // roster. It can only do that if the reason survives the loader.
    respond(401, {});
    expect(await teamTab().load()).toEqual({ ok: false, reason: 'forbidden' });

    respond(403, {});
    expect(await teamTab().load()).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('keeps that distinction on every tab, not just Team', async () => {
    // So a prefetch of any tab can tell "you may not see this" from "that did
    // not work", whatever is added later.
    respond(403, {});
    expect(await projectsTab('').load()).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('shaping a good response', () => {
  it('reads the Form Scheduler payload', async () => {
    const schedules = [{ id: 'f1' }, { id: 'f2' }];
    const saveFailures = { f1: { at: '2026-10-08T00:00:00.000Z' } };
    respond(200, { schedules, saveFailures });

    const res = await formWatchTab().load();

    expect(res).toEqual({ ok: true, data: { schedules, saveFailures } });
  });

  it('defaults missing keys rather than failing on them', async () => {
    // A successful response that simply has nothing in it — a new account.
    respond(200, {});

    const res = await siteWatchTab().load();

    expect(res).toEqual({ ok: true, data: { schedules: [], saveFailures: {} } });
  });

  it('ignores a schedules value that is not an array', async () => {
    respond(200, { schedules: 'nope', saveFailures: 7 });

    const res = await formWatchTab().load();

    expect(res).toEqual({ ok: true, data: { schedules: [], saveFailures: {} } });
  });

  it('keeps the unassigned bucket only when it really has URLs', async () => {
    const unassigned = { urls: ['https://a.example.com/x'], rollup: { severity: 0 } };
    respond(200, { projects: [], unassigned });

    const res = await projectsTab('').load();

    expect(res.ok && res.data.unassigned).toEqual(unassigned);
  });

  it('drops a malformed unassigned bucket to null', async () => {
    // Null, not an empty bucket: the page renders a bucket with no URLs
    // differently from no bucket at all.
    respond(200, { projects: [], unassigned: { rollup: {} } });

    const res = await projectsTab('').load();

    expect(res.ok && res.data.unassigned).toBeNull();
  });

  it('reads the team roster, defaulting me to null', async () => {
    const users = [{ email: 'avery@example.com', role: 'member', name: 'Avery Stone', picture: null }];
    respond(200, { users });

    const res = await teamTab().load();

    expect(res).toEqual({ ok: true, data: { users, me: null } });
  });
});

describe('where each tab is remembered', () => {
  it('gives two different searches two different keys', async () => {
    // Sharing one slot would show the results of whatever was typed last.
    expect(projectsTab('acme').key).not.toBe(projectsTab('zenith').key);
  });

  it('gives the same search the same key', () => {
    expect(projectsTab('acme').key).toBe(projectsTab('acme').key);
  });

  it('keeps the tabs from reading each other', () => {
    const keys = [projectsTab('').key, formWatchTab().key, siteWatchTab().key, teamTab().key];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('asks the right endpoint for each tab', async () => {
    // Cheap, and it catches a copy-paste between two tabs whose payloads have
    // the same shape — the Form Scheduler and Uptime are identical structurally
    // and would otherwise swap silently.
    for (const [tab, url] of [
      [formWatchTab(), '/api/form-watch'],
      [siteWatchTab(), '/api/site-watch'],
      [teamTab(), '/api/users'],
    ] as const) {
      respond(200, {});
      await tab.load();
      expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe(url);
    }

    respond(200, {});
    await projectsTab('acme co').load();
    expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/projects?q=acme%20co');
  });
});
