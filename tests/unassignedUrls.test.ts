/**
 * Which URLs land in the Unassigned bucket.
 *
 * The app's standing promise is that no URL with a monitor, a run or a stored
 * result can become invisible: anything tested or watched but not filed under
 * a project has to surface somewhere to be assigned or dismissed. Get this
 * wrong in the quiet direction and a client's monitored page simply vanishes
 * from the interface while still running on a timer.
 *
 * The rule used to be welded to the five store reads that fed it, so it could
 * only be exercised by running the whole Projects endpoint. It is pure now,
 * because the Projects page was changed to read each store once and derive
 * both of its answers — and a data path worth rewriting is a rule worth
 * pinning first.
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * `unassignedFrom` is pure, but it lives beside the store code that feeds it,
 * so importing it reaches the database client. The root suite runs with only
 * the engine's package installed — see tests/importBoundary — so the client is
 * stubbed rather than resolved. Nothing here touches it.
 */
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({}),
  supabaseEnabled: () => false,
  supabaseSchema: () => 'dev',
}));

import { unassignedFrom } from '@/lib/projects/health';

const sched = (url: string) => ({ url }) as never;
const result = (inputUrl: string) => ({ inputUrl }) as never;

const data = (over: Partial<Parameters<typeof unassignedFrom>[0]> = {}) => ({
  forms: new Map(),
  sites: new Map(),
  runs: new Map(),
  dismissed: new Set<string>(),
  formResults: new Map(),
  siteResults: new Map(),
  tracked: [],
  ...over,
}) as Parameters<typeof unassignedFrom>[0];

describe('a URL nobody has filed', () => {
  it('surfaces when it has a form monitor', () => {
    const d = data({ forms: new Map([['k', sched('https://a.test/contact')]]) });
    expect(unassignedFrom(d, [])).toEqual(['https://a.test/contact']);
  });

  it('surfaces when it was only ever tested by hand', () => {
    // A Form Tester run is as clear a signal of interest as a monitor. Without
    // this, testing a URL and walking away loses it entirely.
    const d = data({ runs: new Map([['k', result('https://a.test/x')]]) });
    expect(unassignedFrom(d, [])).toEqual(['https://a.test/x']);
  });

  it('surfaces when only a stored result remains', () => {
    // The monitor was stopped but its durable result is kept. The URL is still
    // something the team looked at, and still needs somewhere to live.
    const d = data({ formResults: new Map([['k', result('https://a.test/y')]]) });
    expect(unassignedFrom(d, [])).toEqual(['https://a.test/y']);
  });

  it('surfaces when it is only content-tracked', () => {
    const d = data({ tracked: ['https://a.test/z'] });
    expect(unassignedFrom(d, [])).toEqual(['https://a.test/z']);
  });
});

describe('a URL that is already accounted for', () => {
  it('stays out once a project claims it', () => {
    const d = data({ forms: new Map([['k', sched('https://a.test/contact')]]) });
    expect(unassignedFrom(d, [{ urls: ['https://a.test/contact'] }])).toEqual([]);
  });

  it('is matched the way the rest of the app matches URLs', () => {
    // `www.`, case and a trailing slash all fold together. Without that, a
    // project holding "https://www.A.test/contact/" would leave the identical
    // page sitting in Unassigned, inviting somebody to file it twice.
    const d = data({ forms: new Map([['k', sched('https://a.test/contact')]]) });
    expect(unassignedFrom(d, [{ urls: ['https://www.A.test/contact/'] }])).toEqual([]);
  });

  it('stays out once it has been dismissed', () => {
    const d = data({
      forms: new Map([['k', sched('https://a.test/contact')]]),
      dismissed: new Set(['https://a.test/contact']),
    });
    expect(unassignedFrom(d, [])).toEqual([]);
  });
});

describe('the same URL reached by several routes', () => {
  it('appears once, not once per signal', () => {
    const url = 'https://a.test/contact';
    const d = data({
      forms: new Map([['k', sched(url)]]),
      sites: new Map([['k', sched(url)]]),
      runs: new Map([['k', result(url)]]),
      tracked: [url],
    });
    expect(unassignedFrom(d, [])).toEqual([url]);
  });

  it('keeps the FORM schedule’s spelling when the two differ', () => {
    /**
     * Both schedules describe one page; only the casing or trailing slash
     * differs. Which spelling is shown is cosmetic, but it must be stable —
     * and it must not change silently. Reading the stores once nearly flipped
     * this from first-seen to last-seen, which would have quietly altered what
     * every Unassigned row displays.
     */
    const d = data({
      forms: new Map([['k', sched('https://a.test/Contact')]]),
      sites: new Map([['k', sched('https://www.a.test/contact/')]]),
    });
    expect(unassignedFrom(d, [])).toEqual(['https://a.test/Contact']);
  });
});
