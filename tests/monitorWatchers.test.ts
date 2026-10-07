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

const PRIYA = { monitored: true, owner: 'Priya Sharma' };
const TAJAMUL = { monitored: true, owner: 'Tajamul Wani' };
const UNOWNED = { monitored: true, owner: null };
const NONE = { monitored: false, owner: null };

describe('when one person watches the whole URL', () => {
  it('says their name once', () => {
    // The common case. "Priya Sharma (form) · Priya Sharma (uptime)" is the
    // same fact twice, and makes the reader deduce that it is one person.
    expect(watchedBy(PRIYA, PRIYA)).toBe('Priya Sharma');
  });

  it('needs no explaining', () => {
    expect(watchedByNeedsContext(PRIYA, PRIYA)).toBe(false);
  });
});

describe('when only one kind of monitor exists', () => {
  it('names its owner, unqualified', () => {
    // Nothing to disambiguate from, so "(form)" would be answering a question
    // nobody asked.
    expect(watchedBy(PRIYA, NONE)).toBe('Priya Sharma');
    expect(watchedBy(NONE, TAJAMUL)).toBe('Tajamul Wani');
  });
});

describe('when two people watch the same URL', () => {
  it('names both, and says which is which', () => {
    const line = watchedBy(PRIYA, TAJAMUL);
    expect(line).toContain('Priya Sharma');
    expect(line).toContain('Tajamul Wani');
    expect(line).toMatch(/form/);
    expect(line).toMatch(/uptime/);
  });

  it('is the case that needs explaining', () => {
    // Two names only make sense once the reader knows a URL can carry two
    // separate monitors. That is not obvious, and otherwise reads as a bug.
    expect(watchedByNeedsContext(PRIYA, TAJAMUL)).toBe(true);
  });
});

describe('when there is nothing worth saying', () => {
  it('says nothing when the URL has no monitors', () => {
    expect(watchedBy(NONE, NONE)).toBeNull();
  });

  it('says nothing when the monitors predate ownership', () => {
    // "Watched by —" teaches the reader nothing and costs a row.
    expect(watchedBy(UNOWNED, UNOWNED)).toBeNull();
  });

  it('ignores an owner on a monitor that does not exist', () => {
    // A stale owner on a signal that is no longer monitored must not produce a
    // line claiming somebody watches this URL.
    expect(watchedBy({ monitored: false, owner: 'Priya Sharma' }, NONE)).toBeNull();
  });

  it('names the one owner it has, without flagging the other as missing', () => {
    // Naming one person and marking the other "not recorded" reads like a fault
    // to investigate. The real situation is mundane: one monitor predates the
    // feature, and the useful half of the answer is still useful.
    expect(watchedBy(PRIYA, UNOWNED)).toBe('Priya Sharma');
    expect(watchedByNeedsContext(PRIYA, UNOWNED)).toBe(false);
  });
});

describe('defaults', () => {
  it('treats absent monitors as nothing to report', () => {
    // The caller builds these from an optional payload; a missing block must
    // not throw or invent a watcher.
    expect(watchedBy()).toBeNull();
    expect(watchedBy(PRIYA)).toBe('Priya Sharma');
  });
});

describe('where the name belongs', () => {
  it('goes to the top when one person watches everything', () => {
    // The common case. Three rows each saying "Priya Sharma" is the same fact
    // three times, and makes the reader compare them to notice they match.
    expect(watchPlacement([PRIYA, PRIYA, PRIYA])).toEqual({ at: 'header', label: 'Priya Sharma' });
  });

  it('goes to the rows the moment two people disagree', () => {
    // One name at the top would be a plain lie about who to ask.
    expect(watchPlacement([PRIYA, TAJAMUL, PRIYA])).toEqual({ at: 'rows' });
  });

  it('goes to the top when only one monitor is set up', () => {
    expect(watchPlacement([PRIYA, NONE, NONE])).toEqual({ at: 'header', label: 'Priya Sharma' });
  });

  it('shows nothing when nothing is monitored, or nothing is owned', () => {
    expect(watchPlacement([NONE, NONE, NONE])).toEqual({ at: 'nowhere' });
    expect(watchPlacement([UNOWNED, UNOWNED])).toEqual({ at: 'nowhere' });
  });

  it('lets an unowned monitor stand aside rather than force a split', () => {
    // A legacy row with no owner is not a third opinion. Letting it push two
    // agreeing owners onto separate rows would scatter the answer over a row
    // that cannot name anybody anyway.
    expect(watchPlacement([PRIYA, UNOWNED, PRIYA])).toEqual({ at: 'header', label: 'Priya Sharma' });
  });

  it('ignores an owner on a monitor that is not running', () => {
    expect(watchPlacement([PRIYA, { monitored: false, owner: 'Tajamul Wani' }])).toEqual({
      at: 'header',
      label: 'Priya Sharma',
    });
  });
});

describe('identity, not the label', () => {
  // A display name is not an identity. These pin that the placement decision
  // asks WHO, because asking WHAT TO CALL THEM already went wrong once: a
  // missed name lookup rendered one person as "Samiya Nisar" against one
  // monitor and "samiya.nisar@…" against another, and the card concluded two
  // different people watched the URL and split a heading that should have
  // collapsed.
  const asName = { monitored: true, owner: 'Samiya Nisar', id: 'samiya@example.com' };
  const asEmail = { monitored: true, owner: 'samiya@example.com', id: 'samiya@example.com' };

  it('treats one person as one person however they are labelled', () => {
    expect(watchPlacement([asName, asEmail])).toEqual({ at: 'header', label: 'Samiya Nisar' });
  });

  it('still splits two people who happen to share a display name', () => {
    const alexA = { monitored: true, owner: 'Alex Smith', id: 'alex.smith@example.com' };
    const alexB = { monitored: true, owner: 'Alex Smith', id: 'a.smith@example.com' };
    expect(watchPlacement([alexA, alexB])).toEqual({ at: 'rows' });
  });

  it('falls back to the label when no address is given', () => {
    // Callers without an address are not broken by this — the label is then
    // the only identity on offer, and comparing it is the old behaviour.
    expect(watchPlacement([PRIYA, PRIYA])).toEqual({ at: 'header', label: 'Priya Sharma' });
    expect(watchPlacement([PRIYA, TAJAMUL])).toEqual({ at: 'rows' });
  });
});
