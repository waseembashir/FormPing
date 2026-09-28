/**
 * FR-96 — an alert may not claim a fill or a submission that did not happen.
 *
 * A production alert for fautons.com carried both of these lines at once:
 *
 *     Multi-step form found
 *     Safe mode — the form was filled, then deliberately not submitted
 *
 * `MULTI_STEP_FORM_DETECTED` is emitted only inside `if (filledFields.length === 0)`,
 * so nothing was filled. The sentence was built from `record.mode` alone and
 * described what the mode is FOR, not what the run DID.
 *
 * The grid below is the point of this file: every mode against every outcome the
 * engine can produce, asserted against the one rule that matters — never claim
 * an action that did not occur. A new reason code cannot quietly inherit a false
 * sentence, because the "no false claims" test walks the whole matrix.
 */

import { describe, it, expect } from 'vitest';
import { formRunScope, runOutcome } from '@/lib/formWatch/alertFacts';
import type { FormRunRecord } from '@/lib/formWatch/types';

/** Every (reasonCode, submissionResult) pair `runSingleSite.ts` emits. */
const ENGINE_OUTCOMES: Array<{ reasonCode: string; submissionResult: string; filled: boolean }> = [
  // Submit attempted — a submit outcome proves the form was filled first.
  { reasonCode: 'THANK_YOU_REDIRECT', submissionResult: 'success', filled: true },
  { reasonCode: 'INLINE_SUCCESS_ONLY', submissionResult: 'success', filled: true },
  { reasonCode: 'NO_REDIRECT_NO_SUCCESS', submissionResult: 'success', filled: true },
  { reasonCode: 'VALIDATION_ERROR', submissionResult: 'validation_error', filled: true },
  { reasonCode: 'CAPTCHA_DETECTED', submissionResult: 'captcha_blocked', filled: true },
  { reasonCode: 'ANTI_BOT_DETECTED', submissionResult: 'anti_bot_blocked', filled: true },
  { reasonCode: 'SUBMIT_FAILED', submissionResult: 'submit_failed', filled: true },
  // Filled, then stopped before the submit could fire.
  { reasonCode: 'SAFE_MODE_NO_SUBMIT', submissionResult: 'not_attempted', filled: true },
  { reasonCode: 'SUBMIT_HELD_INCOMPLETE', submissionResult: 'not_attempted', filled: true },
  { reasonCode: 'CAPTCHA_DETECTED', submissionResult: 'not_attempted', filled: true },
  // Never filled anything.
  { reasonCode: 'MULTI_STEP_FORM_DETECTED', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'REQUIRED_FIELDS_UNSUPPORTED', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'NON_CONTACT_FORM_FOUND', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'THIRD_PARTY_EMBED_FORM', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'LOW_CONFIDENCE_FORM', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'FORM_NOT_FOUND', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'CONTACT_PAGE_NOT_FOUND', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'BLOCKED_BY_HOST', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'ANTI_BOT_DETECTED', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'DETECT_ONLY', submissionResult: 'not_attempted', filled: false },
  { reasonCode: 'ERROR', submissionResult: 'not_attempted', filled: false },
];

const MODES = ['detect-only', 'safe', 'live'] as const;

function run(over: Partial<FormRunRecord>): FormRunRecord {
  return {
    scheduleId: 's1',
    url: 'https://fautons.com',
    site: 'fautons.com',
    mode: 'safe',
    ranAt: '2026-09-25T22:52:00.000Z',
    status: 'warn',
    reasonCode: 'SAFE_MODE_NO_SUBMIT',
    submissionResult: 'not_attempted',
    durationMs: 1000,
    notes: [],
    errors: [],
    ...over,
    fingerprint: {
      contactPage: 'https://fautons.com',
      formFound: true,
      formConfidence: 0.8,
      formId: null,
      formAction: null,
      formMethod: null,
      captchaDetected: false,
    },
  } as unknown as FormRunRecord;
}

describe('the bug this issue was filed for', () => {
  it('a multi-step run that filled nothing no longer says the form was filled', () => {
    const scope = formRunScope(
      run({ mode: 'safe', reasonCode: 'MULTI_STEP_FORM_DETECTED', submissionResult: 'not_attempted' }),
    );
    expect(scope).not.toMatch(/the form was filled/i);
    expect(scope).toMatch(/could not be filled/i);
  });

  it('a Live run whose submit failed never says a message was submitted', () => {
    // The dangerous one: a reader takes "submitted" as proof a lead arrived.
    for (const reasonCode of ['SUBMIT_FAILED', 'VALIDATION_ERROR', 'CAPTCHA_DETECTED', 'ANTI_BOT_DETECTED']) {
      const submissionResult = ENGINE_OUTCOMES.find(
        (o) => o.reasonCode === reasonCode && o.submissionResult !== 'not_attempted',
      )!.submissionResult;
      const scope = formRunScope(run({ mode: 'live', reasonCode, submissionResult }));
      expect(scope, reasonCode).toMatch(/did NOT go through/);
      expect(scope, reasonCode).not.toMatch(/a real message was submitted and confirmed/i);
    }
  });

  it('a submitted-but-unconfirmed run is neither "confirmed" nor "failed"', () => {
    // NO_REDIRECT_NO_SUCCESS carries submissionResult 'success' because the
    // submit action completed — but nothing confirmed delivery.
    const scope = formRunScope(
      run({ mode: 'live', reasonCode: 'NO_REDIRECT_NO_SUCCESS', submissionResult: 'success' }),
    );
    expect(scope).toMatch(/no confirmation was seen/i);
    expect(scope).not.toMatch(/confirmed/i);
    expect(scope).not.toMatch(/did NOT go through/);
  });
});

describe('runOutcome reads the record instead of guessing', () => {
  it('agrees with the engine about what was filled, for every outcome it emits', () => {
    for (const o of ENGINE_OUTCOMES) {
      const got = runOutcome(run({ reasonCode: o.reasonCode, submissionResult: o.submissionResult }));
      expect(got.filled, `${o.reasonCode} / ${o.submissionResult}`).toBe(o.filled);
    }
  });

  it('tells the two CAPTCHA/anti-bot branches apart by their submit outcome', () => {
    // Both codes are emitted pre-fill AND post-submit, so the reason code alone
    // cannot say whether anything was filled — submissionResult decides.
    expect(runOutcome(run({ reasonCode: 'CAPTCHA_DETECTED', submissionResult: 'captcha_blocked' }))).toEqual({
      filled: true,
      submitted: 'failed',
    });
    expect(runOutcome(run({ reasonCode: 'ANTI_BOT_DETECTED', submissionResult: 'not_attempted' }))).toEqual({
      filled: false,
      submitted: 'none',
    });
  });
});

describe('no alert, in any mode, claims something that did not happen', () => {
  it('walks the whole mode × outcome grid', () => {
    for (const mode of MODES) {
      for (const o of ENGINE_OUTCOMES) {
        const scope = formRunScope(run({ mode, reasonCode: o.reasonCode, submissionResult: o.submissionResult }));
        const where = `${mode} / ${o.reasonCode} / ${o.submissionResult}`;
        const { filled, submitted } = runOutcome(run({ reasonCode: o.reasonCode, submissionResult: o.submissionResult }));

        // Never claim a fill that did not happen.
        if (!filled) {
          expect(scope, where).not.toMatch(/the form was filled/i);
        }
        // Never claim a delivered submission unless it was confirmed.
        if (submitted !== 'confirmed') {
          expect(scope, where).not.toMatch(/a real message was submitted and confirmed/i);
        }
        // Detect mode fills nothing, ever — that one IS a property of the mode.
        if (mode === 'detect-only') {
          expect(scope, where).toMatch(/nothing was filled or submitted/i);
        }
        // Always a complete sentence naming the mode.
        expect(scope, where).toMatch(/^(Detect|Safe|Live) mode — /);
        expect(scope.endsWith('.'), where).toBe(true);
      }
    }
  });
});
