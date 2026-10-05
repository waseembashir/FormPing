/**
 * What to say when the URL you are trying to monitor is already somebody's.
 *
 * A URL has exactly one monitor and exactly one person responsible for it —
 * settled long before per-user isolation existed, because two monitors on one
 * form would mean two sets of real submissions landing in a client's inbox
 * every cycle, each invisible to the other.
 *
 * Isolation then made that rule unanswerable. The monitor blocking you belongs
 * to a colleague, so it is not in your tab, not in your list, and not named
 * anywhere. "A schedule already exists for this URL" is perfectly true and
 * leaves you with nowhere to go: the only way to the answer was knowing which
 * colleague to ask, and them being reachable.
 *
 * So the message names them. Under a model where one person is responsible for
 * a URL, who that person is cannot be the private part — it is the whole point.
 * What stays private is their monitor: its cadence, its mode, its health. The
 * route used to send the entire record and say nothing useful, which is exactly
 * backwards.
 *
 * Pure: it decides wording from facts a caller has already looked up, so every
 * case below can be tested without a database or a session.
 */

/** Which tab the collision happened on — they monitor different things. */
export type MonitorKind = 'form' | 'uptime';

export interface Collision {
  /** The owner's display name, or their email when no name is recorded. Null
   *  when the existing monitor predates ownership and has no owner at all. */
  ownerLabel: string | null;
  /** True when the monitor in the way is the caller's own. */
  mine: boolean;
}

const WHAT: Record<MonitorKind, string> = {
  form: 'form monitor',
  uptime: 'uptime monitor',
};

/**
 * The sentence shown when a monitor already exists for this URL.
 *
 * Three cases, because the useful thing to say is different in each:
 *
 *   • **yours** — no mystery and nobody to contact. Say so plainly rather than
 *     naming the reader back to themselves, which reads like a system that has
 *     not noticed who is using it.
 *   • **a colleague's** — name them. They are who you have to speak to, and
 *     without the name the message is a dead end.
 *   • **nobody's** — a monitor from before ownership was recorded. Inventing a
 *     name would be worse than admitting there is none, and "ask whoever set it
 *     up" is at least honest about what we know.
 *
 * The wording deliberately states the rule as well as the obstacle. "Already
 * exists" sounds like a duplicate to be avoided; one-monitor-per-URL is a
 * decision, and a reader who knows that stops looking for a way to add a second.
 */
export function collisionMessage(kind: MonitorKind, { ownerLabel, mine }: Collision): string {
  const what = WHAT[kind];

  if (mine) {
    return `You already have a ${what} on this URL. Open it below to change how often it runs, or stop it first if you want to set it up differently.`;
  }

  if (!ownerLabel) {
    return `This URL already has a ${what}, set up before FormPing recorded who owns a monitor. Each URL is watched by one person — ask the team who looks after this one.`;
  }

  return `${ownerLabel} already has a ${what} on this URL. Each URL is watched by one person, so speak to them if it should be yours.`;
}

/**
 * How to refer to the owner of a monitor: their name if we know it, otherwise
 * the email we stamped on the row.
 *
 * The email fallback is deliberate rather than a leak. Every member's address
 * is already on the Team page, and the point of naming an owner is that a
 * colleague can reach them — an unnamed obstacle helps nobody. What must not
 * travel is the monitor itself: its interval, its mode, its last verdict and
 * its schedule id are the private part, and none of them belong in a message
 * about whose it is.
 */
export function ownerLabel(name: string | null | undefined, email: string | null | undefined): string | null {
  const named = name?.trim();
  if (named) return named;
  const address = email?.trim();
  return address || null;
}
