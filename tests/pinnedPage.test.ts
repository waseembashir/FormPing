/**
 * Which page a scheduled form check loads.
 *
 * A monitor watches one form on one page — but every check re-discovered that
 * page from scratch, crawling up to twelve pages of the client's site and
 * typing test data into every lead form on them, to report on one and throw the
 * rest away. On a timer, indefinitely, aimed at somebody else's website.
 *
 * The fix is to pin the page once. What makes it delicate is the guarantee
 * attached to it: no monitor may change which form it watches because this
 * shipped. Every rule below is one of the ways that could happen anyway — a pin
 * written from a failed check, a pin that drifts run to run, a monitor that
 * quietly follows a form to another page without saying so.
 *
 * Pure decisions, so they are tested as decisions: no browser, no database, no
 * site touched.
 */

import { describe, it, expect } from 'vitest';
import {
  planCheck,
  pinFor,
  pinnedFormFor,
  watchedFormLabel,
  shouldLookForMovedForm,
  movedFormNote,
  samePage,
} from '@/lib/formWatch/pinnedPage';
import type { FormSchedule } from '@/lib/formWatch/types';

const schedule = (over: Partial<FormSchedule> = {}): FormSchedule => ({
  id: 'sched-1',
  url: 'https://example.com',
  site: 'example.com',
  intervalMs: 86_400_000,
  mode: 'safe',
  createdAt: '2026-10-01T00:00:00.000Z',
  lastRunAt: null,
  nextRunAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

describe('a monitor that has never been pinned', () => {
  it('discovers, exactly as it does today', () => {
    // The migration story for every monitor that already exists. They keep
    // crawling until a check of their own writes a pin, so nothing changes
    // which form it watches on the strength of this code being deployed.
    expect(planCheck(schedule())).toEqual({ kind: 'discover', url: 'https://example.com' });
  });

  it('pins itself from a check that found a form', () => {
    expect(pinFor(schedule(), { resolvedPage: 'https://example.com/contact', formFound: true })).toBe(
      'https://example.com/contact',
    );
  });
});

describe('a pinned monitor', () => {
  const pinned = schedule({ pinnedPage: 'https://example.com/contact' });

  it('loads that page and nothing else', () => {
    expect(planCheck(pinned)).toEqual({ kind: 'pinned', url: 'https://example.com/contact' });
  });

  it('does not re-pin on later checks', () => {
    // A pin that rewrote itself every check would let the watched page drift
    // run to run — which is the behaviour the pin exists to stop. It moves when
    // a person asks, never on its own.
    expect(pinFor(pinned, { resolvedPage: 'https://example.com/contact-us', formFound: true })).toBeNull();
  });

  it('goes back to discovery once the pin is cleared', () => {
    // "Find the form again" clears the pin rather than guessing a new one, so
    // re-resolving is the same code path as resolving the first time.
    expect(planCheck(schedule({ pinnedPage: undefined })).kind).toBe('discover');
  });
});

describe('a check that pins nothing', () => {
  it('refuses a page where no form was found', () => {
    // Discovery can resolve a page and find nothing fillable on it. Pinning
    // that would convert one bad check into a monitor permanently pointed at a
    // dud — and it would narrow what the monitor can see at the exact moment it
    // is already reporting a failure.
    expect(pinFor(schedule(), { resolvedPage: 'https://example.com/about', formFound: false })).toBeNull();
  });

  it('refuses a page it has no page for', () => {
    expect(pinFor(schedule(), { resolvedPage: null, formFound: true })).toBeNull();
    expect(pinFor(schedule(), { resolvedPage: undefined, formFound: true })).toBeNull();
    expect(pinFor(schedule(), { resolvedPage: '   ', formFound: true })).toBeNull();
  });

  it('refuses anything that is not somewhere we could navigate', () => {
    // The pin is read back out of a database row and handed to a spawned
    // process as an argument. "It was a URL when we wrote it" is not a reason
    // to skip asking.
    expect(pinFor(schedule(), { resolvedPage: 'not a url', formFound: true })).toBeNull();
    expect(pinFor(schedule(), { resolvedPage: 'javascript:alert(1)', formFound: true })).toBeNull();
    expect(pinFor(schedule(), { resolvedPage: 'file:///etc/passwd', formFound: true })).toBeNull();
  });

  it('ignores a stored pin that is no longer usable, rather than loading it', () => {
    // A junk pin must fall back to discovery — the monitor keeps working and
    // re-pins itself — not be passed to the engine because it is non-empty.
    expect(planCheck(schedule({ pinnedPage: 'not a url' })).kind).toBe('discover');
  });
});

describe('landing-page monitors are already pinned', () => {
  const landing = schedule({ landingPage: true, url: 'https://example.com/promo' });

  it('keep their own mode', () => {
    // Their URL IS their page, and that mode carries a deliberate leniency in
    // form selection that only the user's assertion justifies. A pin taking
    // over would quietly move them onto a different code path and could change
    // which form they watch.
    expect(planCheck(landing)).toEqual({ kind: 'landing', url: 'https://example.com/promo' });
  });

  it('have nothing to pin', () => {
    expect(pinFor(landing, { resolvedPage: 'https://example.com/promo', formFound: true })).toBeNull();
  });

  it('keep their mode even if a pin somehow got written', () => {
    const odd = schedule({ landingPage: true, pinnedPage: 'https://example.com/contact' });
    expect(planCheck(odd).kind).toBe('landing');
  });
});

describe('working out whether a form moved', () => {
  const pinned = schedule({ pinnedPage: 'https://example.com/contact', lastFormFound: true });

  it('looks, but only when a working form has just gone missing', () => {
    expect(shouldLookForMovedForm(pinned, { formFound: false })).toBe(true);
  });

  it('does not look while the form is still there', () => {
    expect(shouldLookForMovedForm(pinned, { formFound: true })).toBe(false);
  });

  it('does not keep looking once it is a known failure', () => {
    // A monitor whose form has been missing for a month alerted when it broke.
    // Crawling the site again on every check for the rest of its life would
    // reintroduce the exact cost this work removes, on precisely the monitors
    // that no longer justify it.
    const stillBroken = schedule({
      pinnedPage: 'https://example.com/contact',
      // A monitor reporting a missing form has, by definition, run.
      lastRunAt: '2026-10-03T00:00:00.000Z',
      lastFormFound: false,
    });
    expect(shouldLookForMovedForm(stillBroken, { formFound: false })).toBe(false);
  });

  it('looks on a first check, where nothing else could explain the failure', () => {
    // A monitor can only be pinned before its first run if it took its page
    // from a stored Form Tester run — which may be months old, so the form may
    // have moved long before this monitor existed. It is also the moment
    // somebody is watching, having just pressed Add.
    const fresh = schedule({ pinnedPage: 'https://example.com/contact', lastRunAt: null });
    expect(shouldLookForMovedForm(fresh, { formFound: false })).toBe(true);
  });

  it('stops looking after that first check has failed once', () => {
    const afterFirst = schedule({
      pinnedPage: 'https://example.com/contact',
      lastRunAt: '2026-10-03T00:00:00.000Z',
      lastFormFound: false,
    });
    expect(shouldLookForMovedForm(afterFirst, { formFound: false })).toBe(false);
  });

  it('does not look on a monitor that is still crawling anyway', () => {
    // An unpinned check already searched the whole site. Searching it twice to
    // find out where the form is would answer a question it just answered.
    expect(shouldLookForMovedForm(schedule({ lastFormFound: true }), { formFound: false })).toBe(false);
  });

  it('does not look on a landing-page monitor', () => {
    // There is nowhere else to look: the user named the page.
    const landing = schedule({ landingPage: true, lastFormFound: true });
    expect(shouldLookForMovedForm(landing, { formFound: false })).toBe(false);
  });
});

describe('what a diagnosis tells the user', () => {
  const PIN = 'https://example.com/contact';

  it('names the page the form seems to have moved to, and the way to follow it', () => {
    // "No form found" sends somebody to check whether their contact form is
    // broken. This sends them to the button that fixes it — which matters
    // because the form may be perfectly healthy twenty characters away.
    const note = movedFormNote(PIN, { resolvedPage: 'https://example.com/contact-us', formFound: true });

    expect(note).toContain('https://example.com/contact-us');
    expect(note).toContain(PIN);
    expect(note).toContain('Find the form again');
  });

  it('says nothing when the crawl found no form either', () => {
    // Then the form is genuinely missing, and the run already reports that.
    expect(movedFormNote(PIN, { resolvedPage: 'https://example.com/about', formFound: false })).toBeNull();
  });

  it('says nothing when discovery lands back on the pinned page', () => {
    // The form is missing from the page it is supposed to be on. Reporting
    // that it "moved" to where it already was would be nonsense.
    expect(movedFormNote(PIN, { resolvedPage: PIN, formFound: true })).toBeNull();
  });
});

describe('deciding whether two URLs are the same page', () => {
  it('ignores a query string and a fragment', () => {
    // A site that appends a tracking parameter has not moved its contact form,
    // and an alert saying it did is an alert people learn to ignore.
    expect(samePage('https://example.com/contact?utm_source=x', 'https://example.com/contact')).toBe(true);
    expect(samePage('https://example.com/contact#form', 'https://example.com/contact')).toBe(true);
  });

  it('folds www and a trailing slash away', () => {
    expect(samePage('https://www.example.com/contact/', 'https://example.com/contact')).toBe(true);
  });

  it('still tells different pages apart', () => {
    expect(samePage('https://example.com/contact-us', 'https://example.com/contact')).toBe(false);
    expect(samePage('https://other.com/contact', 'https://example.com/contact')).toBe(false);
  });

  it('is false when either side is not a URL', () => {
    expect(samePage('not a url', 'https://example.com/contact')).toBe(false);
    expect(samePage('https://example.com/contact', '')).toBe(false);
  });
});

describe('naming the form a monitor watches', () => {
  /**
   * "Watches one form on /contact" answers the question only where the page
   * holds one form. On a page with three it states the rule and withholds the
   * answer — and "which form is it actually testing?" is the question that
   * opened FR-79.
   */

  it('stores the name the check gave the form it pinned', () => {
    expect(
      pinnedFormFor(schedule(), {
        resolvedPage: 'https://example.com/contact',
        formFound: true,
        formAbout: 'Get in touch',
      }),
    ).toBe('Get in touch');
  });

  it('stores no name when there is no pin to hang it on', () => {
    /**
     * The property that matters, and the reason this derives from `pinFor`
     * rather than re-deciding. `pinFor` refuses for four separate reasons, and
     * a name surviving any of them would caption a form the monitor is not
     * watching — with no symptom except a card that reads wrong.
     */
    const run = { resolvedPage: 'https://example.com/contact', formAbout: 'Get in touch' };

    // found nothing fillable
    expect(pinnedFormFor(schedule(), { ...run, formFound: false })).toBeUndefined();
    // already pinned — a pin moves only when a person asks
    expect(
      pinnedFormFor(schedule({ pinnedPage: 'https://example.com/contact-us' }), { ...run, formFound: true }),
    ).toBeUndefined();
    // landing-page mode has nothing to pin
    expect(
      pinnedFormFor(schedule({ landingPage: true }), { ...run, formFound: true }),
    ).toBeUndefined();
    // a page we could not navigate to
    expect(
      pinnedFormFor(schedule(), { resolvedPage: 'javascript:alert(1)', formFound: true, formAbout: 'X' }),
    ).toBeUndefined();
  });

  it('stores no name when the page offered none', () => {
    // FR-114 made "no trustworthy name" a real state rather than a bad guess:
    // a name has to be words, not a required-field asterisk. The engine sends
    // an empty string, and an empty string is not a name.
    const run = { resolvedPage: 'https://example.com/contact', formFound: true };
    expect(pinnedFormFor(schedule(), { ...run, formAbout: '' })).toBeUndefined();
    expect(pinnedFormFor(schedule(), { ...run, formAbout: '   ' })).toBeUndefined();
    expect(pinnedFormFor(schedule(), run)).toBeUndefined();
  });

  it('trims what the page gave us', () => {
    expect(
      pinnedFormFor(schedule(), {
        resolvedPage: 'https://example.com/contact',
        formFound: true,
        formAbout: '  Contact us  ',
      }),
    ).toBe('Contact us');
  });
});

describe('how the card says it', () => {
  it('quotes the name, because they are the page’s words and not ours', () => {
    // Without the quotes, "Watches Get in touch on /contact" reads as a broken
    // sentence rather than a name.
    expect(watchedFormLabel('Get in touch')).toBe('Watches “Get in touch” on');
  });

  it('falls back to what it said before when there is no name', () => {
    // Quieter, not wrong. Inventing "the Contact form" because the URL reads
    // /contact would be the app guessing out loud.
    for (const none of [undefined, null, '', '   ']) {
      expect(watchedFormLabel(none)).toBe('Watches one form on');
    }
  });
});
