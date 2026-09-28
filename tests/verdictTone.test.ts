/**
 * FR-97 — what each outcome is allowed to accuse the site of.
 *
 * Amber has to mean one thing: a person should look, because the form may be
 * broken. It had come to mean that AND "we could not finish", so a client's
 * healthy form — one with a CAPTCHA, or a multi-step wizard — was reported as
 * needing attention on every check. Those are different messages, and the
 * second one is about us.
 *
 * The level is the single place this is decided, so every surface (the monitor
 * card, the Form Tester, the project rows, Slack) follows from these tests.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runVerdict } from '@/lib/formWatch/verdict';

const level = (code: string, formFound = true) => runVerdict(code, formFound, undefined).level;

describe('our limits are never reported as the site’s fault', () => {
  it.each([
    ['CAPTCHA_DETECTED', 'the site is defending itself, exactly as intended'],
    ['ANTI_BOT_DETECTED', 'same — a human filling the form is unaffected'],
    ['MULTI_STEP_FORM_DETECTED', 'the form exists; we could not walk its steps'],
    ['NON_CONTACT_FORM_FOUND', 'a permanent fact about a site with no native contact form'],
    ['BLOCKED_BY_HOST', 'a firewall refused us; it says nothing about the form'],
  ])('%s is limited, not attention — %s', (code) => {
    expect(level(code)).toBe('limited');
  });
});

describe('amber keeps its narrow meaning', () => {
  it('stays for a submission whose outcome is genuinely unclear', () => {
    // Submitted, nothing confirmed it. The message may not have arrived — that
    // is a real doubt about the form, and the one thing amber is for.
    expect(level('NO_REDIRECT_NO_SUCCESS')).toBe('attention');
  });

  it('stays for a live submission held back mid-wizard', () => {
    expect(level('SUBMIT_HELD_INCOMPLETE')).toBe('attention');
  });
});

describe('real breakage is still failing', () => {
  it.each([
    'FORM_NOT_FOUND',
    'SUBMIT_FAILED',
    'SERVER_ERROR',
    'VALIDATION_ERROR',
    'SUBMISSION_BLOCKED_BY_ANTISPAM',
    'REQUIRED_FIELDS_UNSUPPORTED',
    'ERROR',
  ])('%s', (code) => {
    expect(level(code)).toBe('failing');
  });
});

describe('a clean run is still healthy', () => {
  it.each(['PASS', 'THANK_YOU_REDIRECT', 'INLINE_SUCCESS_ONLY', 'SAFE_MODE_NO_SUBMIT'])('%s', (code) => {
    expect(level(code)).toBe('healthy');
  });

  it('detect-only is healthy only when a form was actually found', () => {
    expect(level('DETECT_ONLY', true)).toBe('healthy');
    expect(level('DETECT_ONLY', false)).toBe('failing');
  });
});

/**
 * Currency: the verdict has to keep up with the engine.
 *
 * A reason code added to the engine and forgotten here falls through to the
 * default and is shown as raw SCREAMING_SNAKE — which is how PROXY_REJECTED_POST
 * reached users with no label at all. Comparing against the engine's own union
 * means the next one cannot slip through the same gap.
 */
describe('every outcome the engine can emit is spoken for', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/types.ts', import.meta.url)), 'utf8');
  const block = src.slice(src.indexOf('export type ReasonCode'));
  const codes = [
    ...new Set((block.slice(0, block.indexOf(';')).match(/'[A-Z][A-Z0-9_]*'/g) ?? []).map((c) => c.replace(/'/g, ''))),
  ];

  it('finds the engine reason codes to compare against', () => {
    expect(codes.length).toBeGreaterThan(20);
  });

  it('gives every code a plain-English label, never the raw identifier', () => {
    const unlabelled = codes.filter((c) => runVerdict(c, true, undefined).label === c);
    expect(unlabelled).toEqual([]);
  });

  it('assigns every code a level deliberately, with nothing left to the fallback', () => {
    // An unknown code falls through to `attention`, so amber is where a
    // forgotten code silently lands — and amber is the one tone that accuses
    // the site. Pinning the exact membership of that level means a new code
    // cannot quietly join it: this test fails, and someone decides on purpose.
    const amber = codes.filter((c) => level(c) === 'attention').sort();
    expect(amber).toEqual(['NO_REDIRECT_NO_SUCCESS', 'SUBMIT_HELD_INCOMPLETE']);
  });
});
