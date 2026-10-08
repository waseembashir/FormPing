/**
 * Warming a tab before it is asked for.
 *
 * Hovering a sidebar link starts that tab's fetch so the click lands on data
 * already held. It is pure head start: nothing renders differently because a
 * prefetch is running, and one that loses its race did nothing at all.
 *
 * Which is exactly why it needs testing. A feature with no visible output has
 * no visible failure either — it can stop working, or start doing far too
 * much, and the only symptom is a page feeling slightly slower or a server
 * seeing several times the traffic. Neither gets traced back here.
 *
 * Three things are asserted, and all three are about restraint rather than
 * speed: it does not fetch what is already held, it does not fetch the same
 * thing twice at once, and it never caches a failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefetchTab, tabForHref } from '@/lib/tabPrefetch';
import { readTab, writeTab, forgetTab } from '@/lib/tabCache';
import type { TabSource, TabLoad } from '@/lib/tabLoaders';

/** A tab whose loader is a spy, answering however the test needs. */
function fakeTab(key: string, answer: TabLoad<string> | (() => Promise<TabLoad<string>>)) {
  const load = vi.fn(async () => (typeof answer === 'function' ? answer() : answer));
  return { tab: { key, load } as TabSource<string>, load };
}

beforeEach(() => forgetTab());
afterEach(() => {
  forgetTab();
  vi.restoreAllMocks();
});

describe('warming a tab', () => {
  it('caches what it loaded, so the page finds it already there', async () => {
    const { tab } = fakeTab('t:1', { ok: true, data: 'warm' });

    prefetchTab(tab);
    await vi.waitFor(() => expect(readTab<string>('t:1')).toBe('warm'));
  });

  it('does not fetch a tab that is already remembered', () => {
    // The page would render the remembered copy immediately and refresh behind
    // it anyway, so this request could only compete with whatever the user is
    // actually doing.
    writeTab('t:2', 'already here');
    const { tab, load } = fakeTab('t:2', { ok: true, data: 'fresh' });

    prefetchTab(tab);

    expect(load).not.toHaveBeenCalled();
    expect(readTab<string>('t:2')).toBe('already here');
  });

  it('fetches once however many times the pointer crosses the link', async () => {
    /**
     * Dragging the pointer across the sidebar fires pointer-enter on every
     * link it passes, and a wobble over one fires it repeatedly. Without
     * de-duping, a feature meant to reduce waiting becomes a way to flood the
     * server — and only one of those responses could ever be used.
     */
    let release: (v: TabLoad<string>) => void = () => {};
    const pending = new Promise<TabLoad<string>>((r) => {
      release = r;
    });
    const { tab, load } = fakeTab('t:3', () => pending);

    prefetchTab(tab);
    prefetchTab(tab);
    prefetchTab(tab);

    expect(load).toHaveBeenCalledTimes(1);

    release({ ok: true, data: 'done' });
    await vi.waitFor(() => expect(readTab<string>('t:3')).toBe('done'));
  });

  it('can be warmed again once the first attempt has finished and failed', async () => {
    // The in-flight guard must not become permanent: a tab whose prefetch
    // failed should be prefetchable on the next hover, or one blip would
    // disable warming that tab for the rest of the session.
    const { tab, load } = fakeTab('t:4', { ok: false, reason: 'error' });

    prefetchTab(tab);
    // Waiting for the call is not enough — the guard is released in a
    // `finally`, several microtasks after `load` is entered. A macrotask
    // drains all of them. Two real hovers are always at least this far apart.
    await new Promise((r) => setTimeout(r, 0));
    expect(load).toHaveBeenCalledTimes(1);

    prefetchTab(tab);
    await new Promise((r) => setTimeout(r, 0));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('what a prefetch refuses to remember', () => {
  it('caches nothing when the load failed', async () => {
    /**
     * The page's own load runs moments later and decides what a failure means
     * for what is on screen — keep the old list, say access is gone, show an
     * error. A prefetch caching the failure would make that decision early,
     * invisibly, and for somebody who has not clicked yet.
     */
    const { tab, load } = fakeTab('t:5', { ok: false, reason: 'error' });

    prefetchTab(tab);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());

    expect(readTab('t:5')).toBeNull();
  });

  it('caches nothing when access was refused', async () => {
    // Losing access must look like losing access. Writing anything here would
    // give the page something to render instead.
    const { tab, load } = fakeTab('t:6', { ok: false, reason: 'forbidden' });

    prefetchTab(tab);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());

    expect(readTab('t:6')).toBeNull();
  });

  it('leaves a remembered value alone when a later load fails', async () => {
    writeTab('t:7', 'good');
    const { tab } = fakeTab('t:7', { ok: false, reason: 'error' });

    prefetchTab(tab);
    await new Promise((r) => setTimeout(r, 0));

    expect(readTab<string>('t:7')).toBe('good');
  });
});

describe('a sign-out beats a load already in flight', () => {
  it('drops a prefetch that lands after everything was forgotten', async () => {
    /**
     * The hazard this whole guard exists for. The avatar menu sits in the same
     * sidebar as these links, so hovering a tab and then signing out is an
     * ordinary sequence — and sign-out navigates on the CLIENT, so this module
     * is never torn down and the request started a moment earlier still lands.
     *
     * Without the epoch check it would write the previous person's data into
     * the cache that signing out had just emptied, a few hundred milliseconds
     * too late to be noticed, on a browser somebody else is now signing into.
     */
    let release: (v: TabLoad<string>) => void = () => {};
    const pending = new Promise<TabLoad<string>>((r) => {
      release = r;
    });
    const { tab } = fakeTab('t:8', () => pending);

    prefetchTab(tab);           // hover
    forgetTab();                // sign out, while it is still in flight
    release({ ok: true, data: "previous person's projects" });
    await new Promise((r) => setTimeout(r, 0));

    expect(readTab('t:8')).toBeNull();
  });

  it('still remembers a prefetch that finishes with nobody signing out', async () => {
    // The guard must not be so eager that it discards ordinary work — that
    // would quietly turn prefetching off and nothing would ever say so.
    let release: (v: TabLoad<string>) => void = () => {};
    const pending = new Promise<TabLoad<string>>((r) => {
      release = r;
    });
    const { tab } = fakeTab('t:9', () => pending);

    prefetchTab(tab);
    release({ ok: true, data: 'kept' });
    await vi.waitFor(() => expect(readTab<string>('t:9')).toBe('kept'));
  });

  it('is not tripped by forgetting one unrelated tab', async () => {
    // Forgetting a single key is ordinary invalidation, not a session ending.
    // A fresh answer arriving after it is welcome.
    let release: (v: TabLoad<string>) => void = () => {};
    const pending = new Promise<TabLoad<string>>((r) => {
      release = r;
    });
    const { tab } = fakeTab('t:10', () => pending);

    prefetchTab(tab);
    forgetTab('something:else');
    release({ ok: true, data: 'kept' });
    await vi.waitFor(() => expect(readTab<string>('t:10')).toBe('kept'));
  });
});

describe('which links are worth warming', () => {
  it('knows the four tabs that cache', () => {
    for (const href of ['/projects', '/form-watch', '/site-watch', '/team']) {
      expect(tabForHref(href), href).not.toBeNull();
    }
  });

  it('warms Projects at the key the page actually opens with', () => {
    // Projects is keyed by its search and opens with an empty one. Warming any
    // other key would fill a slot the page never reads.
    expect(tabForHref('/projects')!.key).toBe('projects:');
  });

  it('leaves alone the pages that keep no tab payload', () => {
    // The Form Tester and Content Changes hold their own run state; Docs and
    // What's new are static. There is nothing to warm for any of them, and
    // inventing a key would cache data no page reads.
    for (const href of ['/', '/monitor', '/docs', '/whats-new', '/login']) {
      expect(tabForHref(href), href).toBeNull();
    }
  });

  it('gives each tab its own key', () => {
    const keys = ['/projects', '/form-watch', '/site-watch', '/team'].map((h) => tabForHref(h)!.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
