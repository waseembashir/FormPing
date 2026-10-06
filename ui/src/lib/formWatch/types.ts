/**
 * Types for the Form Watch scheduler — a NEW, self-contained feature that
 * runs recurring live form tests and records their health over time.
 *
 * This module is additive: it does not import from or modify any existing
 * monitor/watch code. It only reuses the form-test CLI by spawning it.
 */

import type { FormsOnPage, TrackingParams } from '@/types';

export type FormWatchMode = 'live' | 'safe' | 'detect-only';

/** Who started a run: the schedule's own timer, or a person hitting Re-run. FR-82. */
export type RunTrigger = 'scheduled' | 'manual';

/** A recurring schedule for one form URL. */
export interface FormSchedule {
  /** Stable unique id. */
  id: string;
  /**
   * Whose work this is — the signed-in user's email at the moment it was
   * created. Absent on rows that predate per-user isolation, which are legacy
   * and stay visible to everyone until re-run or claimed. FR-74.
   */
  owner?: string;

  /** The exact URL the user entered. */
  url: string;
  /** Hostname-only label for grouping/history. */
  site: string;
  /** How often to run, in milliseconds (e.g. 3 days = 259_200_000). */
  intervalMs: number;
  /** Submit mode for the scheduled run. Defaults to 'live'. */
  mode: FormWatchMode;
  /** "Landing page" mode: test the form on this exact URL, skipping contact-page
   *  discovery (no crawling). For standalone landing pages with an inline form.
   *  Defaults to false / undefined = normal discovery. */
  landingPage?: boolean;
  /**
   * The page this monitor watches, resolved once and then kept.
   *
   * A monitor watches one form on one page, so re-running discovery and
   * crawling the client's site on every check bought nothing and touched
   * somebody else's website on a timer. This is written from a check that
   * actually ran — never asserted — and it only moves when a person asks.
   *
   * Absent means "not pinned yet": the next check discovers as it always has
   * and pins itself from its own result, which is how monitors created before
   * this existed carry on watching the same form they watch today. Always
   * absent in landing-page mode, where the URL IS the page. FR-79.
   */
  pinnedPage?: string;
  /** When the pin was written — shown so a person can judge how old the answer
   *  is before trusting it. FR-79. */
  pinnedAt?: string;
  /**
   * When this monitor was last handed to somebody else, and by whom.
   *
   * Records the EVENT, not the ownership — `owner` already holds that, and
   * alert routing follows it. These exist so the new owner is told: a monitor
   * appearing quietly among a dozen others is not the same as knowing it is
   * now yours. Absent on every monitor that has never been handed over. FR-116.
   */
  assignedAt?: string;
  assignedBy?: string;
  /** ISO timestamp when the schedule was created. */
  createdAt: string;
  /** ISO timestamp of the last completed run, or null if never run. */
  lastRunAt: string | null;
  /** ISO timestamp when the next run is due. */
  nextRunAt: string;
  /** When true the ticker skips this schedule — paused, not stopped (keeps
   *  history, unlike Stop which removes it). */
  paused?: boolean;
  /** Compact summary of the most recent run (for list views). */
  lastStatus?: FormRunStatus;
  lastReasonCode?: string;
  /** Whether the most recent run found a form (drives the mode-aware verdict). */
  lastFormFound?: boolean;
}

/** Health verdict for a single run. */
export type FormRunStatus = 'pass' | 'fail' | 'warn' | 'error';

/** A "fingerprint" of the detected form, used for before/after change detection. */
export interface FormFingerprint {
  contactPage: string | null;
  formFound: boolean;
  formConfidence: number;
  formId: string | null;
  formAction: string | null;
  formMethod: string | null;
  captchaDetected: boolean;
  // Detected-form facts (FR-64) — for a result-oriented run log. All optional so
  // older stored records (without them) still parse.
  formType?: 'native' | 'third-party';
  embedProvider?: string | null;
  embedKind?: 'iframe' | 'script' | 'container' | null;
  fieldCount?: number;
  fields?: { label: string; type: string }[];
  isMultiStep?: boolean;
  landingPageMode?: boolean;
  /** True when this check loaded the page the monitor is pinned to instead of
   *  searching the site for it. Carried so nothing downstream claims a
   *  whole-site search that did not happen. FR-79. */
  pinnedPageMode?: boolean;
  /** "N forms on this page" summary (2+ forms only) — same data the Tester card
   *  shows, so a scheduled run reads identically. FR-68. */
  formsOnPage?: FormsOnPage;
  /** Hidden tracking/UTM params the form captures. FR-68. */
  tracking?: TrackingParams;
  /** How sure the engine was that this is really the contact form. Carried here
   *  so a SCHEDULED run hedges exactly like a manual one — the same engine ran
   *  it, so it must not read as more certain just because a timer started it.
   *  FR-73. */
  formConfidenceLevel?: 'high' | 'low';
  /** Plain reason the match was low-confidence. FR-73. */
  lowConfidenceReason?: string;
  /** Bot protection on the PAGE (as opposed to a CAPTCHA on this form). FR-73. */
  pageProtection?: boolean;
}

/** One recorded run of a scheduled form test. */
export interface FormRunRecord {
  scheduleId: string;
  /**
   * Whose work this is — the signed-in user's email at the moment it was
   * created. Absent on rows that predate per-user isolation, which are legacy
   * and stay visible to everyone until re-run or claimed. FR-74.
   */
  owner?: string;

  url: string;
  site: string;
  /** The mode this run used. */
  mode: FormWatchMode;
  /** ISO timestamp of when the run finished. */
  ranAt: string;
  status: FormRunStatus;
  reasonCode: string;
  submissionResult: string;
  durationMs: number;
  fingerprint: FormFingerprint;
  /**
   * What started this run. A re-run is a manual probe: it takes the identical
   * engine path but writes only this history row, so the log must be able to say
   * so rather than presenting it as something the schedule did. Optional —
   * records written before FR-82 have no value and are read as 'scheduled',
   * which is what they all were.
   */
  trigger?: RunTrigger;
  /** Free-text notes/errors surfaced by the form tester. */
  notes: string[];
  errors: string[];
}
