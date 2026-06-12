/**
 * Types for the Form Watch scheduler — a NEW, self-contained feature that
 * runs recurring live form tests and records their health over time.
 *
 * This module is additive: it does not import from or modify any existing
 * monitor/watch code. It only reuses the form-test CLI by spawning it.
 */

export type FormWatchMode = 'live' | 'safe' | 'detect-only';

/** A recurring schedule for one form URL. */
export interface FormSchedule {
  /** Stable unique id. */
  id: string;
  /** The exact URL the user entered. */
  url: string;
  /** Hostname-only label for grouping/history. */
  site: string;
  /** How often to run, in milliseconds (e.g. 3 days = 259_200_000). */
  intervalMs: number;
  /** Submit mode for the scheduled run. Defaults to 'live'. */
  mode: FormWatchMode;
  /** ISO timestamp when the schedule was created. */
  createdAt: string;
  /** ISO timestamp of the last completed run, or null if never run. */
  lastRunAt: string | null;
  /** ISO timestamp when the next run is due. */
  nextRunAt: string;
  /** Compact summary of the most recent run (for list views). */
  lastStatus?: FormRunStatus;
  lastReasonCode?: string;
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
}

/** One recorded run of a scheduled form test. */
export interface FormRunRecord {
  scheduleId: string;
  url: string;
  site: string;
  /** ISO timestamp of when the run finished. */
  ranAt: string;
  status: FormRunStatus;
  reasonCode: string;
  submissionResult: string;
  durationMs: number;
  fingerprint: FormFingerprint;
  /** Free-text notes/errors surfaced by the form tester. */
  notes: string[];
  errors: string[];
}
