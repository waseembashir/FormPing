/**
 * Deciding which releases are new to the reader.
 *
 * The page is called "What's new", so this is the rule that makes the title
 * true. Both ways of getting it wrong are quiet: too eager and everything is
 * forever marked new, which trains people to ignore the marker; too reluctant
 * and a release they never read is marked as read, which is worse — the one
 * thing they needed to know is the one thing hidden from them.
 *
 * Version comparison is the part that looks trivial and is not: "2.10.0" is
 * newer than "2.9.0" by number and older by string, and a sort that got that
 * wrong would start silently hiding releases at exactly the point the project
 * had shipped enough of them to need this page.
 */

import { describe, it, expect } from 'vitest';
import { isUnread } from '@/lib/releasesSeen';

describe('what counts as unread', () => {
  it('treats everything as unread for a first-time reader', () => {
    // Nothing stored yet. All of it is genuinely new to them.
    expect(isUnread('1.0.0', null)).toBe(true);
    expect(isUnread('2.1.0', null)).toBe(true);
  });

  it('marks a release newer than the last one seen', () => {
    expect(isUnread('2.2.0', '2.1.0')).toBe(true);
  });

  it('does not re-mark one already read', () => {
    expect(isUnread('2.1.0', '2.1.0')).toBe(false);
  });

  it('does not mark older releases the reader has scrolled past', () => {
    expect(isUnread('1.0.0', '2.1.0')).toBe(false);
  });
});

describe('versions compare as numbers, not as text', () => {
  it('knows 2.10.0 is newer than 2.9.0', () => {
    // The case that breaks a string comparison: "2.10.0" < "2.9.0" as text.
    // It only bites once there have been ten minor releases, which is to say
    // long after anybody would think to check it again.
    expect(isUnread('2.10.0', '2.9.0')).toBe(true);
    expect(isUnread('2.9.0', '2.10.0')).toBe(false);
  });

  it('compares each part in turn', () => {
    expect(isUnread('3.0.0', '2.99.99')).toBe(true);
    expect(isUnread('2.1.1', '2.1.0')).toBe(true);
    expect(isUnread('2.1.0', '2.1.1')).toBe(false);
  });

  it('treats a missing part as zero', () => {
    // A version written "2.1" must not read as newer than "2.1.0".
    expect(isUnread('2.1', '2.1.0')).toBe(false);
    expect(isUnread('2.1.0', '2.1')).toBe(false);
  });

  it('does not throw on a value it cannot parse', () => {
    // Whatever is in storage came from a browser and may be anything — an old
    // format, a half-written value, something a person typed. A release page
    // must not break on it.
    expect(() => isUnread('2.1.0', 'not-a-version')).not.toThrow();
    expect(() => isUnread('', '2.1.0')).not.toThrow();
  });
});
