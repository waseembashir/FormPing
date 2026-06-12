/**
 * Mode-aware health verdict for a Form Watch run.
 *
 * The form-test engine returns a raw status that is mode-agnostic — e.g. SAFE
 * mode always comes back as `warn` (SAFE_MODE_NO_SUBMIT) because nothing was
 * submitted. But for monitoring, "filled the form, didn't submit (by design)"
 * is a HEALTHY outcome for safe mode. This maps (reasonCode + formFound) to a
 * human verdict + friendly label so the UI and Slack show green for "the form
 * is working as expected for the mode you chose".
 *
 * Pure function, no I/O — safe to import in both client and server code.
 */

import type { FormRunStatus } from './types';

export type VerdictLevel = 'healthy' | 'attention' | 'failing';

export interface RunVerdict {
  level: VerdictLevel;
  /** Short, human-readable result label. */
  label: string;
}

// Clear successes (the form did what the selected mode intended).
// SAFE_MODE_NO_SUBMIT is healthy on its own: the engine only emits it after it
// successfully found AND filled the form (a missing form yields FORM_NOT_FOUND).
const HEALTHY = new Set(['THANK_YOU_REDIRECT', 'INLINE_SUCCESS_ONLY', 'PASS', 'SAFE_MODE_NO_SUBMIT']);
// Detect-only is healthy only if a form was actually detected.
const DETECT_ONLY = 'DETECT_ONLY';
// The form is broken / submission genuinely failed.
const FAILING = new Set([
  'FORM_NOT_FOUND',
  'CONTACT_PAGE_NOT_FOUND',
  'CONTACT_PAGE_AMBIGUOUS',
  'FORM_AMBIGUOUS',
  'SUBMIT_FAILED',
  'VALIDATION_ERROR',
  'SUBMISSION_BLOCKED_BY_ANTISPAM',
  'PROXY_REJECTED_POST',
  'REQUIRED_FIELDS_UNSUPPORTED',
  'ERROR',
]);
// Needs a look, but not necessarily a broken form (external blocker / unclear).
const ATTENTION = new Set([
  'CAPTCHA_DETECTED',
  'ANTI_BOT_DETECTED',
  'BLOCKED_BY_HOST',
  'NO_REDIRECT_NO_SUCCESS',
]);

const LABELS: Record<string, string> = {
  THANK_YOU_REDIRECT: 'Submitted — thank-you page reached',
  INLINE_SUCCESS_ONLY: 'Submitted — success message shown',
  PASS: 'Submitted successfully',
  SAFE_MODE_NO_SUBMIT: 'Form healthy — filled, not submitted',
  DETECT_ONLY: 'Form detected',
  FORM_NOT_FOUND: 'No contact form found',
  CONTACT_PAGE_NOT_FOUND: 'No contact page found',
  CONTACT_PAGE_AMBIGUOUS: 'Contact page ambiguous',
  FORM_AMBIGUOUS: 'Multiple forms — ambiguous',
  CAPTCHA_DETECTED: 'Blocked by CAPTCHA',
  ANTI_BOT_DETECTED: 'Blocked by anti-bot',
  BLOCKED_BY_HOST: 'Blocked by host',
  SUBMIT_FAILED: 'Submit failed',
  VALIDATION_ERROR: 'Validation error',
  SUBMISSION_BLOCKED_BY_ANTISPAM: 'Filtered by anti-spam',
  REQUIRED_FIELDS_UNSUPPORTED: 'Required fields could not be filled',
  NO_REDIRECT_NO_SUCCESS: 'Submitted — no confirmation seen',
  ERROR: 'Run error',
};

export function runVerdict(
  reasonCode: string,
  formFound: boolean,
  rawStatus?: FormRunStatus,
): RunVerdict {
  const label = LABELS[reasonCode] ?? reasonCode;

  if (rawStatus === 'error') return { level: 'failing', label: LABELS[reasonCode] ?? 'Run error' };
  if (HEALTHY.has(reasonCode)) return { level: 'healthy', label };
  if (reasonCode === DETECT_ONLY) {
    return formFound
      ? { level: 'healthy', label }
      : { level: 'failing', label: 'No contact form found' };
  }
  if (FAILING.has(reasonCode)) return { level: 'failing', label };
  if (ATTENTION.has(reasonCode)) return { level: 'attention', label };
  return { level: 'attention', label };
}
