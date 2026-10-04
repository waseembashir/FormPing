/**
 * Which page a scheduled form check should load — and when a monitor earns the
 * right to stop looking for it.
 *
 * A Form Scheduler monitor can only ever watch ONE form: its verdict, its
 * fingerprint, its before/after diff and its alerts are all built around a
 * single form on a single page. Every check nevertheless re-ran contact-page
 * discovery and crawled up to twelve pages of the client's site, filling every
 * lead form it met, to report on one of them and discard the rest. The crawl
 * was not wasted effort so much as effort nothing could read.
 *
 * So: discover once, then pin. The pin is not a shortcut the user asserts — it
 * is written from a check that actually ran and is sitting in the history,
 * which is what makes "why is it watching THAT form?" a question with an
 * answer. Nothing here decides to pin a page nobody has loaded.
 *
 * Pure policy, no I/O and no imports beyond the schedule's own type: every rule
 * below is a decision about what SHOULD happen, and the ticker is where it
 * happens. That split is what lets these be tested without a browser, a
 * database or a client's website.
 */

import type { FormSchedule } from './types';

/** How the next check should find its form. */
export type CheckPlan =
  /** Crawl for the contact page as we always have — no pin to go on yet. */
  | { kind: 'discover'; url: string }
  /** Load this exact page. The user asserted it (landing-page mode). */
  | { kind: 'landing'; url: string }
  /** Load this exact page, because a previous check resolved it. */
  | { kind: 'pinned'; url: string };

/**
 * A pinned page must be somewhere we could actually navigate. The pin is read
 * back out of a database row and handed to a spawned process as an argument, so
 * "it was a URL when we wrote it" is not a reason to skip asking.
 */
function usableUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * What the next check for this schedule should load.
 *
 * Landing-page mode is checked FIRST and never consults the pin. Those monitors
 * are already pinned by construction — the user said "the form is on this exact
 * URL" — and that mode carries a deliberate leniency in form selection that
 * only their assertion justifies. Letting a pin take over would quietly move
 * them onto a different code path.
 *
 * Everything else falls back to discovery, which is exactly today's behaviour.
 * That fallback is the whole migration story for the monitors that already
 * exist: they keep crawling until a check of their own writes a pin, so none of
 * them changes which form it watches on the strength of this code shipping.
 */
export function planCheck(schedule: FormSchedule): CheckPlan {
  if (schedule.landingPage) return { kind: 'landing', url: schedule.url };

  const pinned = usableUrl(schedule.pinnedPage);
  if (pinned) return { kind: 'pinned', url: pinned };

  return { kind: 'discover', url: schedule.url };
}

/** What a just-finished check knows about the page it ended up on. */
export interface ResolvedRun {
  /** The page the engine settled on — `resolvedContactPage`. */
  resolvedPage: string | null | undefined;
  /** Whether that page actually turned out to have a form. */
  formFound: boolean;
}

/**
 * The page this schedule should be pinned to from now on, or null to leave it
 * alone.
 *
 * Three refusals, each of which would otherwise freeze a monitor onto the wrong
 * page for as long as it exists:
 *
 *   • **A check that found no form.** Discovery can resolve a page and find
 *     nothing fillable on it. Pinning that page would convert one bad check
 *     into a monitor that is permanently pointed at a dud and can no longer
 *     look anywhere else — and it would do so at the exact moment the monitor
 *     is already reporting a failure, which is the worst time to narrow what it
 *     can see.
 *   • **A page we cannot navigate to.** See `usableUrl`.
 *   • **A pin that is already there.** Re-pinning on every check would let the
 *     watched page drift run to run, which is the behaviour this whole thing
 *     exists to stop. A pin moves when a person asks it to, never on its own.
 *
 * Landing-page monitors are left alone: they have nothing to pin, because their
 * URL is their page.
 */
export function pinFor(schedule: FormSchedule, run: ResolvedRun): string | null {
  if (schedule.landingPage) return null;
  if (usableUrl(schedule.pinnedPage)) return null;
  if (!run.formFound) return null;

  return usableUrl(run.resolvedPage);
}

/**
 * Whether to spend one crawl working out where a form went.
 *
 * A pinned monitor that stops finding its form has two possible stories, and
 * they call for opposite responses: the form is broken or gone, or the site
 * moved its contact page and the form is alive somewhere else. The check itself
 * cannot tell them apart, because it only ever looked at one page.
 *
 * So on the transition — and only the transition — the check is followed by a
 * discovery pass whose single job is to say where a form can be found now. The
 * monitor does NOT re-point itself on the strength of that: a monitor that
 * silently redefines what it watches is the failure this feature was written to
 * prevent. It reports, and a person moves the pin.
 *
 * `lastFormFound === true` is what limits it to the transition. A monitor whose
 * form has been missing for a month alerted when it broke; crawling the site
 * again on every check for the rest of its life would reintroduce the cost this
 * work removes, on precisely the monitors that no longer justify it.
 *
 * A monitor that has never run counts as a transition too, and it is the one
 * case where nothing else could explain the failure. It can only be pinned
 * already if it took its page from a stored Form Tester run, and that run may
 * be months old — so its very first check can fail on a page whose form moved
 * long before the monitor existed. That is also the moment somebody is actually
 * watching the screen, having just pressed Add. It fires at most once: the
 * check then records `lastFormFound: false` and the rule above takes over.
 */
export function shouldLookForMovedForm(
  schedule: FormSchedule,
  run: { formFound: boolean },
): boolean {
  if (planCheck(schedule).kind !== 'pinned') return false;
  if (run.formFound) return false;
  return schedule.lastFormFound === true || schedule.lastRunAt === null;
}

/**
 * The note a diagnosis leaves behind, or null when it found nothing worth
 * saying.
 *
 * Deliberately phrased as an observation plus the action it implies, because
 * the monitor is about to keep reporting a failure for a form that may be
 * perfectly healthy twenty characters away. "No form found" on its own sends
 * somebody to check whether their contact form is broken; this sends them to
 * the button that fixes it.
 *
 * A diagnosis that lands back on the pinned page says nothing: the form is
 * missing from the page it is supposed to be on, which is what the run already
 * reports.
 */
export function movedFormNote(pinnedPage: string, found: ResolvedRun): string | null {
  if (!found.formFound) return null;
  const elsewhere = usableUrl(found.resolvedPage);
  if (!elsewhere) return null;
  if (samePage(elsewhere, pinnedPage)) return null;

  return `No form on the page this monitor watches (${pinnedPage}), but one was found on ${elsewhere} — the site may have moved its contact page. Use "Find the form again" to point this monitor at it.`;
}

/**
 * Whether two URLs name the same page, for the purpose of "did the form move?".
 *
 * Compares scheme, host and path and ignores the query and fragment: a site
 * that appends a tracking parameter has not moved its contact form, and an
 * alert saying it did is an alert people learn to ignore. `www.` and a trailing
 * slash fold together for the same reason — they are the same page to everyone
 * except a string comparison.
 */
export function samePage(a: string, b: string): boolean {
  const key = (value: string): string | null => {
    const url = usableUrl(value);
    if (!url) return null;
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./i, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase() || '/';
    return `${parsed.protocol}//${host}${path}`;
  };

  const left = key(a);
  const right = key(b);
  return left !== null && left === right;
}
