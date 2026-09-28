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

export type VerdictLevel = 'healthy' | 'detected' | 'limited' | 'attention' | 'failing';

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
// A recognised, expected outcome that isn't a problem AND isn't a clean submit:
// a third-party embed IS present and named, but it's a cross-origin form we can't
// auto-fill/submit. Its own "detected" level (sky/info) — never amber "attention"
// (nothing is wrong) and never green "healthy" (we didn't actually test a submit). FR-60.
// A single-input <form> was all we could match. Something IS there and we can
// show it, but calling it the contact form would be a guess — so it gets the
// same "detected, your call" treatment as an embed: never green, never red. FR-73.
const DETECTED = new Set(['THIRD_PARTY_EMBED_FORM', 'LOW_CONFIDENCE_FORM']);
// The form is broken / submission genuinely failed.
const FAILING = new Set([
  'FORM_NOT_FOUND',
  'CONTACT_PAGE_NOT_FOUND',
  'CONTACT_PAGE_AMBIGUOUS',
  'FORM_AMBIGUOUS',
  'SUBMIT_FAILED',
  'VALIDATION_ERROR',
  // The site's own backend returned 5xx — the form is genuinely broken. FR-73.
  'SERVER_ERROR',
  'SUBMISSION_BLOCKED_BY_ANTISPAM',
  'PROXY_REJECTED_POST',
  'REQUIRED_FIELDS_UNSUPPORTED',
  'ERROR',
]);
/**
 * The check could not be completed, and nothing is known to be wrong with the
 * site. These describe OUR limits or the site's own defences — not a fault the
 * owner should act on.
 *
 * FR-60 settled this for third-party embeds: a recognised embed is `detected`,
 * never amber, because nothing is broken. The same reasoning applies wherever
 * the engine simply could not finish. Amber has to keep one meaning — a person
 * should look because the form may be broken — or it stops carrying any. FR-97.
 */
const LIMITED = new Set([
  // The site is defending itself against automated entry. That is the site
  // working as intended, not a fault: a human filling the form is unaffected.
  'CAPTCHA_DETECTED',
  'ANTI_BOT_DETECTED',
  // A firewall refused our request. It says what the host does with our traffic,
  // not whether the form works — hosting providers routinely block cloud IPs.
  'BLOCKED_BY_HOST',
  // A form exists; it did not score as a contact form. On a site that genuinely
  // has no native contact form this is a permanent fact, not an incident.
  'NON_CONTACT_FORM_FOUND',
  // A multi-step form was found but its steps could not be walked this run. The
  // form exists and may be perfectly healthy.
  'MULTI_STEP_FORM_DETECTED',
]);
// Needs a look: the run DID act on the form, and what came back is unclear or
// incomplete. This is the narrow meaning of amber — something may be wrong.
const ATTENTION = new Set([
  // Submitted, but no confirmation was seen. The message may not have arrived.
  'NO_REDIRECT_NO_SUCCESS',
  // Multi-step form was filled but the live submission was held back (not a
  // clean entry) — worth a look, not a breakage. FR-63.
  'SUBMIT_HELD_INCOMPLETE',
]);

const LABELS: Record<string, string> = {
  THANK_YOU_REDIRECT: 'Submitted — thank-you page reached',
  INLINE_SUCCESS_ONLY: 'Submitted — success message shown',
  PASS: 'Submitted successfully',
  SAFE_MODE_NO_SUBMIT: 'Form healthy — filled, not submitted',
  DETECT_ONLY: 'Form detected',
  FORM_NOT_FOUND: 'No form found on the page',
  NON_CONTACT_FORM_FOUND: 'Found a form — not a contact form',
  LOW_CONFIDENCE_FORM: 'Only a single-field form — is this yours?',
  THIRD_PARTY_EMBED_FORM: 'Third-party form detected',
  MULTI_STEP_FORM_DETECTED: 'Multi-step form found',
  SUBMIT_HELD_INCOMPLETE: 'Multi-step filled — submission held',
  CONTACT_PAGE_NOT_FOUND: 'No contact page found',
  CONTACT_PAGE_AMBIGUOUS: 'Contact page ambiguous',
  FORM_AMBIGUOUS: 'Multiple forms — ambiguous',
  CAPTCHA_DETECTED: 'Blocked by CAPTCHA',
  ANTI_BOT_DETECTED: 'Blocked by anti-bot',
  BLOCKED_BY_HOST: 'Blocked by host',
  SUBMIT_FAILED: 'Submit failed',
  VALIDATION_ERROR: 'Validation error',
  SERVER_ERROR: 'The site’s server errored — message not delivered',
  SUBMISSION_BLOCKED_BY_ANTISPAM: 'Filtered by anti-spam',
  // Without a label here the raw code was shown to users — the same internal
  // identifier leak removed from the dashboards and alerts elsewhere. The
  // refusal happens before the request reaches the site, so the wording does
  // not blame the form. FR-97.
  PROXY_REJECTED_POST: 'Blocked before it reached the site',
  REQUIRED_FIELDS_UNSUPPORTED: 'Required fields could not be filled',
  NO_REDIRECT_NO_SUCCESS: 'Submitted — no confirmation seen',
  ERROR: 'Run error',
};

export function runVerdict(
  reasonCode: string,
  formFound: boolean,
  rawStatus?: FormRunStatus,
  /** How sure the engine is that it found the right form. A `low` match still
   *  gets filled — Landing-page mode asserts the form is on this page — but it
   *  must never read as a confident green pass, because the thing we filled may
   *  not be the form the user means. Downgrades a success to "detected". FR-73. */
  confidence?: 'high' | 'low',
): RunVerdict {
  const label = LABELS[reasonCode] ?? reasonCode;

  if (rawStatus === 'error') return { level: 'failing', label: LABELS[reasonCode] ?? 'Run error' };
  if (HEALTHY.has(reasonCode)) {
    return confidence === 'low'
      ? { level: 'detected', label: 'Filled — but we are not sure it is your contact form' }
      : { level: 'healthy', label };
  }
  if (DETECTED.has(reasonCode)) return { level: 'detected', label };
  if (reasonCode === DETECT_ONLY) {
    if (!formFound) return { level: 'failing', label: 'No contact form found' };
    return confidence === 'low'
      ? { level: 'detected', label: 'Form detected — but we are not sure it is the right one' }
      : { level: 'healthy', label };
  }
  if (FAILING.has(reasonCode)) return { level: 'failing', label };
  if (LIMITED.has(reasonCode)) return { level: 'limited', label };
  if (ATTENTION.has(reasonCode)) return { level: 'attention', label };
  return { level: 'attention', label };
}
