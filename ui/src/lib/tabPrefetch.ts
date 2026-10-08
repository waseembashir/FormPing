/**
 * Starting a tab's fetch while the pointer is still on its way to the link.
 *
 * `tabCache` already removed the blank page on a RETURN visit: the second time
 * you open Projects it renders what it last held and refreshes behind. The
 * first visit to each tab still waits for a full round trip, and that is the
 * one everybody has, every session.
 *
 * Next's `<Link>` prefetches the route's code, which does not help here: these
 * pages fetch their data in `useEffect`, so a warm route still lands on a cold
 * request. The useful thing to warm is the data, and the place to put it is
 * the cache the page already prefers over fetching. Hovering a sidebar link
 * buys a few hundred milliseconds of head start, which is most of the wait.
 *
 * Deliberately not a React hook, and deliberately fire-and-forget: there is no
 * component waiting on this, nothing renders differently because it is running,
 * and a prefetch that loses its race simply did nothing. The only way it can
 * be observed is by the page being ready sooner.
 */

import { readTab, writeTabIfCurrent, cacheEpoch } from './tabCache';
import { projectsTab, formWatchTab, siteWatchTab, teamTab, type TabSource } from './tabLoaders';

/**
 * Keys with a prefetch already running.
 *
 * Without this, dragging the pointer across the sidebar fires a request per
 * link per pass, and a wobble over one link fires several — turning a feature
 * that exists to reduce waiting into a way to flood the server. One in flight
 * per tab is all that can help; the rest would be discarded anyway.
 */
const inFlight = new Set<string>();

/**
 * Warm a tab's cache, if it is worth warming.
 *
 * Skipped when the tab is already remembered: the page would render that
 * copy immediately and refresh behind it regardless, so fetching now buys
 * nothing and competes with whatever the user is actually doing.
 *
 * A failed load writes NOTHING. That is the whole of the error handling, and
 * it is the right amount: the page's own load runs moments later and decides
 * what a failure means for what is on screen — keep the old list, say access
 * is gone, show an error. A prefetch caching a failure would make that
 * decision early, invisibly, and for a user who had not even clicked.
 *
 * Nor does a signed-out session get its answer remembered. The avatar menu
 * sits in the same sidebar as these links, so hovering a tab and then signing
 * out is an ordinary thing to do — and `forgetTab()` on sign-out cannot
 * un-start a request. The epoch captured here is what makes the clear win.
 */
export function prefetchTab<T>(tab: TabSource<T>): void {
  if (readTab(tab.key) !== null) return;
  if (inFlight.has(tab.key)) return;

  const started = cacheEpoch();
  inFlight.add(tab.key);
  void tab
    .load()
    .then((res) => {
      if (res.ok) writeTabIfCurrent(tab.key, res.data, started);
    })
    .finally(() => {
      inFlight.delete(tab.key);
    });
}

/**
 * Whether hovering means anything on this device.
 *
 * On a touchscreen a pointer-enter fires as part of the tap that is already
 * navigating, so the prefetch and the real load race each other to the same
 * endpoint and one of them is pure waste. `(hover: hover)` is false there and
 * true for a mouse or trackpad.
 *
 * Defaults to NOT prefetching where the answer cannot be had — during
 * server rendering, or in a browser without `matchMedia`. Doing nothing is
 * always safe here; the page still loads exactly as it did before.
 */
export function pointerCanHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: hover)').matches;
}

/**
 * The tab behind a sidebar link, if it is one that caches.
 *
 * Projects is keyed by its search, and the page opens with an empty one — so
 * that is the key worth warming. A search typed afterwards is its own key and
 * its own fetch, which is correct: nobody can hover their way to a result for
 * text they have not typed.
 *
 * Returns null for everything else. The Form Tester and Content Changes keep
 * their own run state rather than a tab payload, and Docs and What's new are
 * static — there is nothing to warm for any of them.
 */
export function tabForHref(href: string): TabSource<unknown> | null {
  switch (href) {
    case '/projects':
      return projectsTab('') as TabSource<unknown>;
    case '/form-watch':
      return formWatchTab() as TabSource<unknown>;
    case '/site-watch':
      return siteWatchTab() as TabSource<unknown>;
    case '/team':
      return teamTab() as TabSource<unknown>;
    default:
      return null;
  }
}

/** Hover handler for a sidebar link: warm its tab, or do nothing at all. */
export function prefetchHref(href: string): void {
  if (!pointerCanHover()) return;
  const tab = tabForHref(href);
  if (tab) prefetchTab(tab);
}
