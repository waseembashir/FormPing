/**
 * Which releases you have already read.
 *
 * Kept in the browser rather than against your account, deliberately. This is a
 * reading convenience, not a record: losing it costs you one re-read, which
 * does not justify a column, a migration, or a write on every visit to a page
 * people open occasionally. Signing in on another machine shows everything as
 * unread once — the same behaviour the Form Tester already has for its saved
 * run.
 *
 * Every accessor is guarded. localStorage throws in private browsing and when
 * site data is blocked, and a release-notes page must not be the thing that
 * breaks there — the honest fallback is "you have seen nothing", which shows
 * the page as it always looked.
 */

const KEY = 'formping:whats-new:last-seen';

/** Compare two semantic versions. Returns >0 when `a` is newer than `b`. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The newest version this browser has been shown, or null for never. */
export function lastSeenVersion(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Whether `version` is newer than what this browser has seen.
 *
 * A browser that has seen nothing treats everything as unread, which is right
 * for somebody opening the page for the first time: all of it is new to them.
 */
export function isUnread(version: string, lastSeen: string | null): boolean {
  if (!lastSeen) return true;
  return compareVersions(version, lastSeen) > 0;
}

/** Record that everything up to `version` has now been shown. */
export function markSeen(version: string): void {
  try {
    const current = lastSeenVersion();
    // Never move the marker backwards: an older release rendering last must not
    // make newer ones unread again.
    if (current && compareVersions(current, version) >= 0) return;
    window.localStorage.setItem(KEY, version);
  } catch {
    /* storage unavailable — the page still renders, it just cannot remember */
  }
}
