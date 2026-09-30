/**
 * FR-94 — a wizard is recognised before anything is filled, and an unmeasured
 * form claims nothing.
 *
 * `isMultiStep` was derived from `stepsTraversed`, which only exists once
 * `fillForm` has walked the form. Detect-only never fills, so the flag came out
 * `false` rather than "unknown" — and because `false` is still a boolean, every
 * surface happily rendered **"Single-step"** for a genuine wizard.
 *
 * Detect is the default mode for both the Tester and the Scheduler. So the
 * default path asserted a fact about a form's shape that it had never measured,
 * and asserted it in the confident direction.
 *
 * Three values now, and the third is the point: true, false, or nothing said.
 */

import { describe, it, expect } from 'vitest';
import { nativeFormFacts } from '../src/runners/formFacts.js';

const form = { fields: [{ label: 'Email', type: 'email', name: 'email' }] } as never;

describe('what counts as proof of a wizard', () => {
  it('a Next control found before filling', () => {
    // The evidence Detect mode can gather without touching the form.
    expect(nativeFormFacts(form, { hiddenMultiStep: false, stepControlFound: true }).isMultiStep).toBe(true);
  });

  it('a walk that actually traversed more than one step', () => {
    expect(nativeFormFacts(form, { hiddenMultiStep: false, stepsTraversed: 3 }).isMultiStep).toBe(true);
  });

  it('a form hidden behind a wizard step (FR-62)', () => {
    expect(nativeFormFacts(form, { hiddenMultiStep: true }).isMultiStep).toBe(true);
  });

  it('any one signal is enough — they are not required together', () => {
    // A run can reach a wizard by any of three routes; requiring agreement
    // between them would reintroduce false negatives.
    expect(nativeFormFacts(form, { hiddenMultiStep: false, stepsTraversed: 1, stepControlFound: true }).isMultiStep).toBe(true);
  });
});

describe('saying "no" requires having looked', () => {
  it('reports false when the probe ran and found nothing', () => {
    expect(nativeFormFacts(form, { hiddenMultiStep: false, stepControlFound: false }).isMultiStep).toBe(false);
  });

  it('reports false when a walk completed in a single step', () => {
    expect(nativeFormFacts(form, { hiddenMultiStep: false, stepsTraversed: 1 }).isMultiStep).toBe(false);
  });

  it('says NOTHING when nothing measured it', () => {
    // The whole issue in one assertion. Previously this returned false, and
    // false renders as "Single-step" — a claim about a form nobody examined.
    expect(nativeFormFacts(form, { hiddenMultiStep: false }).isMultiStep).toBeUndefined();
  });

  it('distinguishes "not a wizard" from "not examined"', () => {
    const measured = nativeFormFacts(form, { hiddenMultiStep: false, stepControlFound: false }).isMultiStep;
    const unmeasured = nativeFormFacts(form, { hiddenMultiStep: false }).isMultiStep;
    expect(measured).toBe(false);
    expect(unmeasured).toBeUndefined();
    // Both are falsy. Only one of them is an answer — which is why every
    // surface must gate on `typeof x === 'boolean'`, not on truthiness.
    expect(measured).not.toBe(unmeasured);
  });
});
