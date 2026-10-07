/**
 * What deleting a URL, or a whole project, has to take with it.
 *
 * This is the one irreversible cascade in the app, and until now the only
 * thing exercising it was somebody deleting a real project and looking. It
 * lived inside route handlers, which drag in the whole request stack, so it
 * could not easily be tested — and the operations it performs are exactly the
 * kind you cannot see going missing. Nothing fails. A stopped monitor's result
 * simply reappears in Unassigned next week, or a watch resumes after a
 * redeploy and rebuilds what was deleted.
 *
 * These tests exist because the cascade was made CONCURRENT to fix a delete
 * that took ten to fifteen seconds. Speed work on a destructive path is the
 * worst kind to do blind: the failure mode is not a crash, it is something
 * quietly not deleted. So they assert the SET of operations and the one
 * ORDERING that matters, rather than the timing.
 */

import { describe, it, expect } from 'vitest';
import { teardownUrls, teardownHosts, purgeableHosts, type TeardownIO } from '@/lib/projects/teardown';

/** Records every destructive call, in the order it was actually made. */
function spyIO() {
  const calls: string[] = [];
  const io: TeardownIO = {
    removeFormSchedule: async (id) => void calls.push(`formSchedule:${id}`),
    removeSiteSchedule: async (id) => void calls.push(`siteSchedule:${id}`),
    removeRun: async (u) => void calls.push(`run:${u}`),
    removeFormResult: async (u) => void calls.push(`formResult:${u}`),
    removeSiteResult: async (u) => void calls.push(`siteResult:${u}`),
    removeDaily: async (u) => void calls.push(`daily:${u}`),
    stopWatch: (h) => {
      calls.push(`stopWatch:${h}`);
      return true;
    },
    removeActiveWatch: async (h) => void calls.push(`activeWatch:${h}`),
    removeReports: async (h) => void calls.push(`reports:${h}`),
    removeChangeEvents: async (h) => void calls.push(`changeEvents:${h}`),
    removeAlertsForSite: async (h) => void calls.push(`alerts:${h}`),
    removeSnapshotsForHost: async (h) => void calls.push(`snapshots:${h}`),
  };
  return { io, calls };
}

describe('tearing down a URL', () => {
  const URL_A = 'https://a.example.com/contact';

  it('removes every trace of it, and misses none', () => {
    // The real risk of this cascade is omission, so the assertion is the whole
    // set rather than a sample of it. A store added later and not wired in
    // here fails nothing at runtime — it just leaves rows behind.
    const { io, calls } = spyIO();
    return teardownUrls([URL_A], () => ({ formId: 'f1', siteId: 's1' }), io).then(() => {
      expect(new Set(calls)).toEqual(
        new Set([
          'formSchedule:f1',
          'siteSchedule:s1',
          `run:${URL_A}`,
          `formResult:${URL_A}`,
          `siteResult:${URL_A}`,
          `daily:${URL_A}`,
        ]),
      );
    });
  });

  it('still clears the results when there is no monitor to remove', async () => {
    // A URL that was tested once but never monitored still has a stored run
    // and a durable result. Skipping those is how a deleted URL comes back as
    // Unassigned.
    const { io, calls } = spyIO();
    await teardownUrls([URL_A], () => ({}), io);

    expect(calls).toContain(`run:${URL_A}`);
    expect(calls).toContain(`formResult:${URL_A}`);
    expect(calls.some((c) => c.startsWith('formSchedule'))).toBe(false);
  });

  it('counts the live monitors it removed, and only those', async () => {
    const { io } = spyIO();
    const both = await teardownUrls(['u1'], () => ({ formId: 'f', siteId: 's' }), io);
    const one = await teardownUrls(['u2'], () => ({ formId: 'f' }), io);
    const none = await teardownUrls(['u3'], () => ({}), io);

    expect([both, one, none]).toEqual([2, 1, 0]);
  });

  it('handles every URL of a project, not just the first', async () => {
    const { io, calls } = spyIO();
    const urls = ['https://a.test/x', 'https://b.test/y', 'https://c.test/z'];
    await teardownUrls(urls, (u) => ({ formId: `f-${u}` }), io);

    for (const u of urls) expect(calls).toContain(`run:${u}`);
    expect(calls.filter((c) => c.startsWith('formSchedule')).length).toBe(3);
  });
});

describe('tearing down a host', () => {
  it('stops the watch BEFORE deleting anything of its', async () => {
    /**
     * The one ordering in the whole cascade, and the one a concurrency rewrite
     * would silently drop. A watch left running writes new events and reports
     * into the gap and resurrects exactly what is being deleted — so the
     * delete appears to work and the data is back within the hour.
     */
    const { io, calls } = spyIO();
    await teardownHosts(['a.test'], io);

    const stopped = calls.indexOf('stopWatch:a.test');
    const unregistered = calls.indexOf('activeWatch:a.test');
    for (const after of ['reports:a.test', 'changeEvents:a.test', 'alerts:a.test', 'snapshots:a.test']) {
      expect(calls.indexOf(after)).toBeGreaterThan(stopped);
      expect(calls.indexOf(after)).toBeGreaterThan(unregistered);
    }
  });

  it('clears everything the host owns', async () => {
    const { io, calls } = spyIO();
    await teardownHosts(['a.test'], io);

    expect(new Set(calls)).toEqual(
      new Set([
        'stopWatch:a.test',
        'activeWatch:a.test',
        'reports:a.test',
        'changeEvents:a.test',
        'alerts:a.test',
        'snapshots:a.test',
      ]),
    );
  });

  it('counts the watches it actually killed', async () => {
    const { io } = spyIO();
    expect(await teardownHosts(['a.test', 'b.test'], io)).toBe(2);

    const quiet = spyIO();
    quiet.io.stopWatch = () => false; // nothing was running
    expect(await teardownHosts(['a.test'], quiet.io)).toBe(0);
  });

  it('keeps each host’s ordering when several are torn down at once', async () => {
    // Hosts run concurrently; the guarantee is per host, not global.
    const { io, calls } = spyIO();
    await teardownHosts(['a.test', 'b.test'], io);

    for (const h of ['a.test', 'b.test']) {
      expect(calls.indexOf(`reports:${h}`)).toBeGreaterThan(calls.indexOf(`stopWatch:${h}`));
    }
  });
});

describe('which hosts may be purged at all', () => {
  it('spares a host another project still tracks', () => {
    // Change tracking is per hostname. Wiping a shared host would take a
    // sibling project's history with it, and the sibling would never know why.
    expect(purgeableHosts(['a.test', 'b.test'], new Set(['b.test']))).toEqual(['a.test']);
  });

  it('never purges the unparseable "unknown" host', () => {
    // It is not a host. Purging it would delete the change history of every
    // URL that failed to parse, together.
    expect(purgeableHosts(['unknown', 'a.test'], new Set())).toEqual(['a.test']);
  });

  it('purges a host only once however many URLs share it', () => {
    expect(purgeableHosts(['a.test', 'a.test', 'a.test'], new Set())).toEqual(['a.test']);
  });

  it('returns nothing when every host is spoken for', () => {
    expect(purgeableHosts(['a.test'], new Set(['a.test']))).toEqual([]);
  });
});
