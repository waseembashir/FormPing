/**
 * Before/after change detection between two form runs.
 *
 * Pure functions, no I/O. Compares the current run's fingerprint (and status)
 * against the previous run to surface meaningful changes — the "did the form
 * change?" signal the user asked for.
 */

import type { FormFingerprint, FormRunStatus } from './types';

/** Human-readable list of meaningful changes since the previous run. */
export function compareFingerprints(
  prev: FormFingerprint | null,
  curr: FormFingerprint,
): string[] {
  if (!prev) return []; // first run — nothing to compare against
  const changes: string[] = [];

  if (prev.formFound && !curr.formFound) changes.push('Form is no longer detected on the page');
  if (!prev.formFound && curr.formFound) changes.push('Form is detected again (was missing before)');

  if (!prev.captchaDetected && curr.captchaDetected) changes.push('CAPTCHA newly appeared on the form');
  if (prev.captchaDetected && !curr.captchaDetected) changes.push('CAPTCHA was removed from the form');

  if (prev.contactPage !== curr.contactPage) {
    changes.push(`Contact page changed: ${prev.contactPage ?? 'none'} → ${curr.contactPage ?? 'none'}`);
  }
  if (prev.formAction !== curr.formAction) {
    changes.push(`Form action (submit endpoint) changed: ${prev.formAction ?? 'none'} → ${curr.formAction ?? 'none'}`);
  }
  if (prev.formId !== curr.formId) {
    changes.push(`Form identifier changed: ${prev.formId ?? 'none'} → ${curr.formId ?? 'none'}`);
  }
  if (prev.formConfidence - curr.formConfidence >= 0.2) {
    changes.push(
      `Form detection confidence dropped (${prev.formConfidence.toFixed(2)} → ${curr.formConfidence.toFixed(2)})`,
    );
  }

  return changes;
}

/** True when the health status got worse than the previous run. */
export function isRegression(prev: FormRunStatus | null, curr: FormRunStatus): boolean {
  if (!prev) return false;
  const rank: Record<FormRunStatus, number> = { pass: 3, warn: 2, fail: 1, error: 0 };
  return rank[curr] < rank[prev];
}
