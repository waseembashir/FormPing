/**
 * Who watches a URL, said in one line.
 *
 * A URL can carry two independent monitors — one on its contact form, one on
 * its uptime — and they can belong to different people. The data has modelled
 * that since per-user isolation: `formOwner` and `siteOwner` are separate
 * fields precisely because "a single owner for the URL would be a guess".
 *
 * Nothing ever displayed them. That is what turned a colleague's monitor into a
 * dead end: the app enforced one-person-per-URL while telling nobody who that
 * person was, so the only way to find out was to try and fail. Projects is
 * where it belongs — the tool tabs are each person's own workspace, Projects is
 * the shared record, and "who do I talk to about this URL" is exactly what a
 * shared record is for.
 *
 * The wrinkle is that two owners is the UNUSUAL case. Most URLs are watched
 * end-to-end by whoever set them up, and printing "Priya (form) · Priya
 * (uptime)" for that makes the reader do work to discover there is only one
 * person. So the line collapses when it can and splits only when the answer
 * genuinely differs.
 *
 * Pure: the caller has already resolved each email to a display label, so every
 * shape below is decided without a database.
 */

/** One monitor on a URL: whether it exists, and who it belongs to. */
export interface Watcher {
  /** Is this kind of monitor set up on the URL at all? */
  monitored: boolean;
  /** Display label for its owner — name where known, email otherwise. Null for
   *  a monitor created before ownership was recorded. */
  owner: string | null;
  /**
   * The owner's address: who this is, as opposed to what to call them.
   *
   * Comparisons use this and fall back to the label only when it is absent.
   * The distinction is not academic — a display name is not an identity. Two
   * colleagues can share one, and one missed lookup renders the same person as
   * a name here and an address there, at which point comparing labels decides
   * they are two different people and splits a heading that should have
   * collapsed. That happened.
   */
  id?: string | null;
}

/**
 * The sentence for a "watched by" line, or null when there is nothing to say.
 *
 * Takes a list rather than a fixed pair. It used to take exactly (form,
 * uptime) — written when a URL carried two monitors — and content tracking
 * then became a third that this simply could not express. A list cannot go
 * stale the same way.
 *
 * Null rather than a placeholder in two cases, because both mean the line would
 * be noise: no monitor on this URL at all, and monitors that predate ownership.
 * "Watched by — " teaches the reader nothing and costs a row; a URL with no
 * recorded owner is better served by the row simply not being there.
 *
 * A monitor that exists but has no owner is deliberately left out of the
 * sentence rather than described as unknown. Naming one person and marking the
 * other "not recorded" reads like a fault to investigate, when the real
 * situation is mundane — one monitor predates the feature.
 */
export interface NamedWatcher extends Watcher {
  /** What this monitor is called when two owners have to be told apart. */
  kind: string;
}

export function watchedBy(watchers: NamedWatcher[]): string | null {
  const owned = watchers.filter((w) => w.monitored && w.owner);
  if (owned.length === 0) return null;

  const identity = (w: Watcher) => w.id ?? w.owner;
  const first = owned[0]!;

  // The common case by far: one person watches all of it. Qualifying every
  // name would make the reader work that out for themselves.
  if (owned.every((w) => identity(w) === identity(first))) return first.owner;

  // Grouped, so a person who holds two of the three is named once with both
  // against them rather than appearing twice.
  const byPerson = new Map<string, { label: string; kinds: string[] }>();
  for (const w of owned) {
    const key = identity(w) as string;
    const entry = byPerson.get(key) ?? { label: w.owner as string, kinds: [] };
    entry.kinds.push(w.kind);
    byPerson.set(key, entry);
  }

  return [...byPerson.values()].map((p) => `${p.label} (${p.kinds.join(', ')})`).join(' · ');
}

/**
 * Whether the line needs explaining.
 *
 * One name answers "who do I speak to" on its own. Several only make sense
 * once the reader knows a URL can carry separate monitors — which is not
 * obvious, and is the kind of thing that otherwise reads as a bug.
 */
export function watchedByNeedsContext(watchers: NamedWatcher[]): boolean {
  const owned = watchers.filter((w) => w.monitored && w.owner);
  const identity = (w: Watcher) => w.id ?? w.owner;
  return new Set(owned.map(identity)).size > 1;
}

/**
 * Where the watcher's name should be shown on a URL.
 *
 * A URL can carry three monitors — its contact form, its uptime, its content —
 * and each is owned independently. Printing a name on every row would be the
 * same fact three times for the common case, where one person set all of them
 * up; printing one name at the top would be a lie for the case where they did
 * not.
 *
 * So the answer decides its own placement. One name for everything goes at the
 * top, where it reads as a property of the URL. Disagreement goes onto the
 * rows, where each name sits against the monitor it actually owns.
 *
 * A monitor that nobody owns is left out of the comparison rather than counted
 * as a third opinion — a legacy row with no owner must not be able to split a
 * heading that two real owners agree on.
 */
export type WatchPlacement =
  /** Nothing to show anywhere: no live monitor has a recorded owner. */
  | { at: 'nowhere' }
  /** One person watches all of it — show the name once, at the top. */
  | { at: 'header'; label: string }
  /** They differ — show each name against its own monitor. */
  | { at: 'rows' };

export function watchPlacement(watchers: Watcher[]): WatchPlacement {
  const owned = watchers.filter((w) => w.monitored && w.owner);
  if (owned.length === 0) return { at: 'nowhere' };

  // Compared by identity, shown by label. Falling back to the label keeps
  // callers that have no address working, and is right for them: without an
  // address the label is the only identity on offer.
  const identity = (w: Watcher) => w.id ?? w.owner;

  const first = owned[0]!;
  return owned.every((w) => identity(w) === identity(first))
    ? { at: 'header', label: first.owner as string }
    : { at: 'rows' };
}
