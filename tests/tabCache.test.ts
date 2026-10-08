/**
 * FR-105 — what a tab is allowed to remember between visits.
 *
 * Every tool tab fetched on mount with `loading` starting true and nothing kept
 * between visits, so returning to a tab blanked it and fetched everything
 * again. Navigation was instant; the content was not.
 *
 * The cache is small enough that its behaviour is obvious. What is not obvious,
 * and what these tests exist for, is the boundary: a cache that remembers too
 * much or forgets too late shows one person another person's data. That is a
 * worse bug than the slowness it was added to fix, so the forgetting is tested
 * at least as carefully as the remembering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readTab, writeTab, writeTabIfCurrent, cacheEpoch, forgetTab, TAB_KEYS } from '@/lib/tabCache';

beforeEach(() => forgetTab());

describe('remembering', () => {
  it('hands back exactly what was stored', () => {
    writeTab('x', { schedules: [1, 2, 3] });
    expect(readTab<{ schedules: number[] }>('x')).toEqual({ schedules: [1, 2, 3] });
  });

  it('reports a miss as null, so a caller can fall back in one expression', () => {
    expect(readTab('never-written')).toBeNull();
  });

  it('overwrites rather than merging — the newest payload is the whole truth', () => {
    // A merge would let a deleted monitor survive in the list forever.
    writeTab('x', { schedules: [1, 2, 3] });
    writeTab('x', { schedules: [] });
    expect(readTab<{ schedules: number[] }>('x')).toEqual({ schedules: [] });
  });

  it('can remember an empty result, which is not the same as no result', () => {
    // "You have no monitors" is an answer worth showing instantly on return;
    // treating it as a miss would blank the tab for someone with none.
    writeTab('x', { schedules: [] });
    expect(readTab('x')).not.toBeNull();
  });
});

describe('forgetting', () => {
  it('drops everything when told to — the sign-out case', () => {
    // The cache outlives a sign-out, because the page does. Without a full
    // clear the next person at this browser sees the previous one's data for
    // the frame before the refresh lands.
    writeTab(TAB_KEYS.formWatch, { schedules: ['mine'] });
    writeTab(TAB_KEYS.team, { users: ['mine'] });
    forgetTab();
    expect(readTab(TAB_KEYS.formWatch)).toBeNull();
    expect(readTab(TAB_KEYS.team)).toBeNull();
  });

  it('drops one tab without disturbing the others', () => {
    writeTab(TAB_KEYS.formWatch, { schedules: ['a'] });
    writeTab(TAB_KEYS.siteWatch, { schedules: ['b'] });
    forgetTab(TAB_KEYS.formWatch);
    expect(readTab(TAB_KEYS.formWatch)).toBeNull();
    expect(readTab(TAB_KEYS.siteWatch)).not.toBeNull();
  });
});

describe('keys keep tabs apart', () => {
  it('gives each tab its own namespace', () => {
    const keys = [TAB_KEYS.formWatch, TAB_KEYS.siteWatch, TAB_KEYS.team, TAB_KEYS.projects('')];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('treats a different search as a different result, not the same one', () => {
    // Projects is filtered server-side by the query, so two searches are two
    // different answers. Sharing a key would show the results of one search
    // under the other's heading.
    writeTab(TAB_KEYS.projects('acme'), { projects: ['acme'] });
    expect(readTab(TAB_KEYS.projects('other'))).toBeNull();
    expect(readTab(TAB_KEYS.projects('acme'))).not.toBeNull();
  });

  it('separates an empty search from a populated one', () => {
    writeTab(TAB_KEYS.projects(''), { projects: ['all'] });
    expect(readTab(TAB_KEYS.projects('a'))).toBeNull();
  });
});

describe('a cleared cache stays cleared', () => {
  /**
   * Clearing is not enough on its own. A load already in flight finishes
   * afterwards and writes into the cache that was just emptied.
   *
   * Signing out is exactly that: `forgetTab()` runs, then the app navigates to
   * /login on the CLIENT, so this module is never torn down and a request
   * started a moment earlier still lands. The previous person's data would end
   * up in the cache of a browser somebody else is now signing into — the thing
   * clearing it exists to prevent, a few hundred milliseconds late.
   */

  it('drops a write whose load began before everything was forgotten', () => {
    const started = cacheEpoch();
    writeTab('a', 'original');

    forgetTab(); // the sign-out

    writeTabIfCurrent('a', 'late answer from the old session', started);
    expect(readTab('a')).toBeNull();
  });

  it('keeps a write when nothing was forgotten meanwhile', () => {
    // The guard must not be so eager it discards ordinary work — that would
    // silently disable remembering, and nothing would report it.
    const started = cacheEpoch();
    writeTabIfCurrent('b', 'kept', started);
    expect(readTab<string>('b')).toBe('kept');
  });

  it('is not tripped by forgetting a single key', () => {
    // One key is ordinary invalidation, not a session ending. A fresh answer
    // landing after it is welcome.
    const started = cacheEpoch();
    forgetTab('something:else');
    writeTabIfCurrent('c', 'kept', started);
    expect(readTab<string>('c')).toBe('kept');
  });

  it('moves on with each clear, so a stale write never becomes current again', () => {
    // A counter that wrapped or reset could let an old answer match a later
    // generation and be accepted long after its session ended.
    const first = cacheEpoch();
    forgetTab();
    forgetTab();
    expect(cacheEpoch()).not.toBe(first);

    writeTabIfCurrent('d', 'from two sessions ago', first);
    expect(readTab('d')).toBeNull();
  });

  it('accepts writes again from loads begun after the clear', () => {
    forgetTab();
    const started = cacheEpoch(); // a load started by the new session
    writeTabIfCurrent('e', 'new session data', started);
    expect(readTab<string>('e')).toBe('new session data');
  });
});
