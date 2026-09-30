/**
 * What a tab remembers between visits.
 *
 * Every tool tab fetches in `useEffect` on mount with `loading` starting at
 * `true`. Nothing is kept between visits, so leaving Projects for the Scheduler
 * and coming back a few seconds later blanks the page and fetches it all again.
 * Navigation is instant; the content is not, and that gap is the whole of the
 * "not smooth" feeling.
 *
 * This is the smallest thing that fixes it: hold the last good payload per tab,
 * render it immediately on return, and refresh in the background. Stale for a
 * few hundred milliseconds beats empty for a full round trip.
 *
 * **In memory on purpose.** It lives for the life of the page, so it survives
 * client-side navigation — which is the case that hurts — and is dropped by a
 * hard reload. Nothing is written to storage, so there is no serialisation cost,
 * no schema to migrate, and no way for a stale payload to outlive the session
 * that produced it. It never crosses a request boundary and never reaches the
 * server.
 *
 * **It is a cache, not a source of truth.** Every read is followed by a fetch
 * that overwrites it, so a value being briefly out of date is expected and
 * self-correcting. Anything that must be current when shown — a confirmation, a
 * balance, a permission — should not be read from here. FR-105.
 */

const store = new Map<string, unknown>();

/**
 * The last payload seen for a tab, or null.
 *
 * Returns `null` rather than `undefined` for a miss so a caller can write
 * `readTab(key) ?? initial` without the two cases behaving differently.
 */
export function readTab<T>(key: string): T | null {
  return (store.get(key) as T | undefined) ?? null;
}

/** Remember this tab's payload for the rest of the page's life. */
export function writeTab<T>(key: string, value: T): void {
  store.set(key, value);
}

/**
 * Forget one tab, or everything.
 *
 * Needed where showing a remembered value would be wrong rather than merely
 * stale — after a sign-out, for instance, where the next person at the same
 * browser must not see the previous one's data for even one frame.
 */
export function forgetTab(key?: string): void {
  if (key === undefined) store.clear();
  else store.delete(key);
}

/** Keys are namespaced so a tab cannot read another's payload by accident. */
export const TAB_KEYS = {
  projects: (query: string) => `projects:${query}`,
  formWatch: 'form-watch',
  siteWatch: 'site-watch',
  team: 'team',
} as const;
