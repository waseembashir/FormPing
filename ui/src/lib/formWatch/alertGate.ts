/**
 * Decides whether a finished Form Watch run is worth interrupting someone for.
 *
 * A monitor exists to report CHANGE. Form Watch fired on every run, so a
 * monitor whose verdict never changed sent the same alert every cycle — daily,
 * or hourly — and a permanent fact ("this site has no native contact form")
 * arrived forever. That is how a channel gets muted, and a muted channel
 * swallows the one alert that mattered.
 *
 * The dedupe key could not prevent it: `form:{scheduleId}:{ranAt}` is unique
 * per run by construction, so it only ever stopped a double-send of the SAME
 * run, never a repeat of the same verdict.
 *
 * So the decision is made here, on the facts of the run, and kept pure: no
 * database, no clock, no Slack. Everything it needs is passed in, which is what
 * makes every branch testable. FR-97.
 */

import type { VerdictLevel } from './verdict';

/**
 * What "the same result as last time" means.
 *
 * Level alone is too coarse: NON_CONTACT_FORM_FOUND and FORM_NOT_FOUND are both
 * bad, and a site sliding from one to the other is a real change that must not
 * be swallowed. So identity is level AND reason code.
 */
export function verdictIdentity(level: VerdictLevel, reasonCode: string): string {
  return `${level}:${reasonCode}`;
}

export interface GateInput {
  /** Identity of the run that just finished. */
  current: string;
  /** Identity of the previous run, or null when this schedule has never run. */
  previous: string | null;
  /** The level of the run that just finished — a failing monitor keeps a heartbeat. */
  level: VerdictLevel;
  /** How many fingerprint changes this run detected (field added, CAPTCHA appeared…). */
  changeCount: number;
  /**
   * True when enough time has passed since the last problem alert for this site
   * that a reminder is due. Computed by the caller from the alert log, because
   * that needs a query and this must stay pure.
   */
  renotifyDue: boolean;
}

export type GateReason =
  | 'first-run'
  | 'verdict-changed'
  | 'form-changed'
  | 'still-failing'
  | 'unchanged';

export interface GateDecision {
  send: boolean;
  reason: GateReason;
}

/**
 * Four reasons to speak, one reason to stay quiet.
 *
 * Order matters: the checks that represent NEW information come first, so a run
 * that is both a change and a repeat is always treated as a change. Nothing here
 * suppresses a change — suppression applies to repetition only.
 */
export function shouldNotify(input: GateInput): GateDecision {
  // Never seen this schedule before. The first observation is information, even
  // when it is good news: it is the only message that proves monitoring started.
  if (input.previous === null) return { send: true, reason: 'first-run' };

  // The verdict moved. Covers breakage, recovery, and any slide between two bad
  // states — all of which someone needs to know about.
  if (input.current !== input.previous) return { send: true, reason: 'verdict-changed' };

  // The verdict held, but the form itself changed underneath it: a field added,
  // a CAPTCHA appearing, an action URL rewritten. The verdict can stay "healthy"
  // through all of those, and they are exactly what a form monitor is for.
  if (input.changeCount > 0) return { send: true, reason: 'form-changed' };

  // Silence about a broken form is its own failure, so a failing monitor keeps
  // a spaced heartbeat. Deliberately limited to `failing`: a `limited` or
  // `attention` verdict that never changes is a standing fact, and the monitor
  // card is where a standing fact belongs.
  if (input.level === 'failing' && input.renotifyDue) return { send: true, reason: 'still-failing' };

  return { send: false, reason: 'unchanged' };
}
