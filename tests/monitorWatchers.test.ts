/**
 * Who watches a URL, said in one line.
 *
 * A URL can carry two independent monitors — one on its contact form, one on
 * its uptime — owned by different people. The data has modelled that since
 * per-user isolation; nothing ever displayed it. That omission is what turned a
 * colleague's monitor into a dead end: the app enforced one-person-per-URL
 * while naming that person nowhere, so the only way to find out was to try to
 * create your own and be refused.
 *
 * The trap in fixing it is that two owners is the UNUSUAL case. Most URLs are
 * watched end to end by whoever set them up, and a line that always qualifies
 * both names makes a reader work to discover there is only one person. So these
 * pin when it collapses and when it must not.
 */

import { describe, it, expect } from 'vitest';
import { watchedBy, watchedByNeedsContext, watchPlacement } from '@/lib/monitorWatchers';

const JORDAN = { monitored: true, owner: 'Jordan Blake' };
const AVERY = { monitored: true, owner: 'Avery Stone' };
const UNOWNED = { monitored: true, owner: null };
const NONE = { monitored: false, owner: null };

/** `watchedBy` takes a list, so each entry says which monitor it speaks for. */
const form = (w: typeof JORDAN | typeof NONE) => ({ ...w, kind: 'form' });
const uptime = (w: typeof JORDAN | typeof NONE) => ({ ...w, kind: 'uptime' });
const content = (w: typeof JORDAN | typeof NONE) => ({ ...w, kind: 'content' });

describe('when one person watches the whole URL', () => {
  it('says their name once', () => {
    // The common case. "Jordan Blake (form) · Jordan Blake (uptime)" is the
    // same fact twice, and makes the reader deduce that it is one person.
    expect(watchedBy([form(JORDAN), uptime(JORDAN)])).toBe('Jordan Blake');
  });

  it('needs no explaining', () => {
    expect(watchedByNeedsContext([form(JORDAN), uptime(JORDAN)])).toBe(false);
  });
});

describe('when only one kind of monitor exists', () => {
  it('names its owner, unqualified', () => {
    // Nothing to disambiguate from, so "(form)" would be answering a question
    // nobody asked.
    expect(watchedBy([form(JORDAN), uptime(NONE)])).toBe('Jordan Blake');
    expect(watchedBy([form(NONE), uptime(AVERY)])).toBe('Avery Stone');
  });
});

describe('when two people watch the same URL', () => {
  it('names both, and says which is which', () => {
    const line = watchedBy([form(JORDAN), uptime(AVERY)]);
    expect(line).toContain('Jordan Blake');
    expect(line).toContain('Avery Stone');
    expect(line).toMatch(/form/);
    expect(line).toMatch(/uptime/);
  });

  it('is the case that needs explaining', () => {
    // Two names only make sense once the reader knows a URL can carry two
    // separate monitors. That is not obvious, and otherwise reads as a bug.
    expect(watchedByNeedsContext([form(JORDAN), uptime(AVERY)])).toBe(true);
  });
});

describe('when there is nothing worth saying', () => {
  it('says nothing when the URL has no monitors', () => {
    expect(watchedBy([form(NONE), uptime(NONE)])).toBeNull();
  });

  it('says nothing when the monitors predate ownership', () => {
    // "Watched by —" teaches the reader nothing and costs a row.
    expect(watchedBy([form(UNOWNED), uptime(UNOWNED)])).toBeNull();
  });

  it('ignores an owner on a monitor that does not exist', () => {
    // A stale owner on a signal that is no longer monitored must not produce a
    // line claiming somebody watches this URL.
    expect(watchedBy([form({ monitored: false, owner: 'Jordan Blake' }), uptime(NONE)])).toBeNull();
  });

  it('names the one owner it has, without flagging the other as missing', () => {
    // Naming one person and marking the other "not recorded" reads like a fault
    // to investigate. The real situation is mundane: one monitor predates the
    // feature, and the useful half of the answer is still useful.
    expect(watchedBy([form(JORDAN), uptime(UNOWNED)])).toBe('Jordan Blake');
    expect(watchedByNeedsContext([form(JORDAN), uptime(UNOWNED)])).toBe(false);
  });
});

describe('defaults', () => {
  it('treats absent monitors as nothing to report', () => {
    // The caller builds these from an optional payload; a missing block must
    // not throw or invent a watcher.
    expect(watchedBy([])).toBeNull();
    expect(watchedBy([form(JORDAN)])).toBe('Jordan Blake');
  });
});

describe('where the name belongs', () => {
  it('goes to the top when one person watches everything', () => {
    // The common case. Three rows each saying "Jordan Blake" is the same fact
    // three times, and makes the reader compare them to notice they match.
    expect(watchPlacement([JORDAN, JORDAN, JORDAN])).toEqual({ at: 'header', label: 'Jordan Blake' });
  });

  it('goes to the rows the moment two people disagree', () => {
    // One name at the top would be a plain lie about who to ask.
    expect(watchPlacement([JORDAN, AVERY, JORDAN])).toEqual({ at: 'rows' });
  });

  it('goes to the top when only one monitor is set up', () => {
    expect(watchPlacement([JORDAN, NONE, NONE])).toEqual({ at: 'header', label: 'Jordan Blake' });
  });

  it('shows nothing when nothing is monitored, or nothing is owned', () => {
    expect(watchPlacement([NONE, NONE, NONE])).toEqual({ at: 'nowhere' });
    expect(watchPlacement([UNOWNED, UNOWNED])).toEqual({ at: 'nowhere' });
  });

  it('lets an unowned monitor stand aside rather than force a split', () => {
    // A legacy row with no owner is not a third opinion. Letting it push two
    // agreeing owners onto separate rows would scatter the answer over a row
    // that cannot name anybody anyway.
    expect(watchPlacement([JORDAN, UNOWNED, JORDAN])).toEqual({ at: 'header', label: 'Jordan Blake' });
  });

  it('ignores an owner on a monitor that is not running', () => {
    expect(watchPlacement([JORDAN, { monitored: false, owner: 'Avery Stone' }])).toEqual({
      at: 'header',
      label: 'Jordan Blake',
    });
  });
});

describe('identity, not the label', () => {
  // A display name is not an identity. These pin that the placement decision
  // asks WHO, because asking WHAT TO CALL THEM already went wrong once: a
  // missed name lookup rendered one person as "Robin Vale" against one
  // monitor and "samiya.nisar@…" against another, and the card concluded two
  // different people watched the URL and split a heading that should have
  // collapsed.
  const asName = { monitored: true, owner: 'Robin Vale', id: 'robin@example.com' };
  const asEmail = { monitored: true, owner: 'robin@example.com', id: 'robin@example.com' };

  it('treats one person as one person however they are labelled', () => {
    expect(watchPlacement([asName, asEmail])).toEqual({ at: 'header', label: 'Robin Vale' });
  });

  it('still splits two people who happen to share a display name', () => {
    const alexA = { monitored: true, owner: 'Robin Vale', id: 'r.vale@example.com' };
    const alexB = { monitored: true, owner: 'Robin Vale', id: 'rob.vale@example.com' };
    expect(watchPlacement([alexA, alexB])).toEqual({ at: 'rows' });
  });

  it('falls back to the label when no address is given', () => {
    // Callers without an address are not broken by this — the label is then
    // the only identity on offer, and comparing it is the old behaviour.
    expect(watchPlacement([JORDAN, JORDAN])).toEqual({ at: 'header', label: 'Jordan Blake' });
    expect(watchPlacement([JORDAN, AVERY])).toEqual({ at: 'rows' });
  });
});

describe('a URL with three monitors', () => {
  // `watchedBy` used to take exactly (form, uptime) — written when a URL
  // carried two. Content tracking became a third the signature could not
  // express, which is why the per-URL dashboard named two watchers while the
  // project page named three, for the same URL.
  const asForm = { kind: 'form', monitored: true, owner: 'Jordan Blake', id: 'priya@x.com' };
  const asUptime = { kind: 'uptime', monitored: true, owner: 'Avery Stone', id: 'avery@example.com' };
  const asContent = { kind: 'content', monitored: true, owner: 'Jordan Blake', id: 'priya@x.com' };

  it('names all three when one person holds them', () => {
    expect(watchedBy([asForm, { ...asUptime, owner: 'Jordan Blake', id: 'priya@x.com' }, asContent])).toBe(
      'Jordan Blake',
    );
  });

  it('names somebody once with both their monitors, not twice', () => {
    // One person holds the form and the content; another holds the uptime. Listing
    // her twice would make three monitors look like three people.
    const line = watchedBy([asForm, asUptime, asContent]);
    expect(line).toBe('Jordan Blake (form, content) · Avery Stone (uptime)');
  });

  it('counts people, not monitors, when deciding it needs explaining', () => {
    expect(watchedByNeedsContext([asForm, asContent])).toBe(false);
    expect(watchedByNeedsContext([asForm, asUptime])).toBe(true);
  });
});
