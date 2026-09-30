import { describe, it, expect } from 'vitest';
import {
  meaningfulFields,
  nativeFormFacts,
  embedFormFacts,
  embedKindLabel,
  shouldHoldMultiStepSubmit,
} from '../src/runners/formFacts.js';
import type { DetectedFormField } from '../src/types.js';
import type { EmbedDetection } from '../src/forms/detectEmbeds.js';

/**
 * FR-64 — the result card describes what was found. These pure helpers turn raw
 * detection output into the human-facing facts (form type, field count + names,
 * multi-step, embed provider/kind) shown on every Tester + Scheduler card.
 */

const fields = (specs: Array<[string, string]>): DetectedFormField[] =>
  specs.map(([label, type]) => ({ label, type }));

describe('meaningfulFields (FR-64)', () => {
  it('drops hidden / submit / button fields, keeps user-fillable ones', () => {
    const f = fields([
      ['Name', 'text'],
      ['Email', 'email'],
      ['Message', 'textarea'],
      ['', 'hidden'],
      ['Send', 'submit'],
      ['', 'button'],
    ]);
    const kept = meaningfulFields(f);
    expect(kept.map((x) => x.label)).toEqual(['Name', 'Email', 'Message']);
  });

  it('is case-insensitive on the type', () => {
    expect(meaningfulFields(fields([['tok', 'HIDDEN'], ['Email', 'Email']]))).toHaveLength(1);
  });
});

describe('nativeFormFacts (FR-64)', () => {
  it('counts only meaningful fields and marks native', () => {
    const facts = nativeFormFacts({ fields: fields([['Name', 'text'], ['Email', 'email'], ['', 'hidden']]) }, { hiddenMultiStep: false });
    expect(facts.formType).toBe('native');
    expect(facts.fieldCount).toBe(2);
    expect(facts.fields.map((f) => f.label)).toEqual(['Name', 'Email']);
    // Nothing here measured step-ness, so nothing is claimed about it. This
    // asserted `false` until FR-94, and `false` renders as "Single-step" —
    // a statement about a form that was never examined for steps.
    expect(facts.isMultiStep).toBeUndefined();
  });

  it('is multi-step when the form was hidden (multi-step widget)', () => {
    const facts = nativeFormFacts({ fields: fields([['Email', 'email']]) }, { hiddenMultiStep: true });
    expect(facts.isMultiStep).toBe(true);
  });

  it('is multi-step when the fill walked more than one step', () => {
    const facts = nativeFormFacts({ fields: fields([['Email', 'email']]) }, { hiddenMultiStep: false, stepsTraversed: 3 });
    expect(facts.isMultiStep).toBe(true);
  });
});

describe('embedFormFacts (FR-64)', () => {
  it('reports the first provider + how it is mounted', () => {
    const embeds: EmbedDetection[] = [{ provider: 'Typeform', kind: 'iframe', detail: 'typeform.com/x' }];
    const facts = embedFormFacts(embeds);
    expect(facts).toEqual({ formType: 'third-party', embedProvider: 'Typeform', embedKind: 'iframe' });
  });

  it('returns null when there are no embeds', () => {
    expect(embedFormFacts([])).toBeNull();
  });
});

describe('embedKindLabel (FR-64)', () => {
  it('gives a plain-English phrase for each mount kind', () => {
    expect(embedKindLabel('iframe')).toMatch(/iframe/i);
    expect(embedKindLabel('script')).toMatch(/script/i);
    expect(embedKindLabel('container')).toMatch(/container/i);
  });
});

describe('shouldHoldMultiStepSubmit (FR-63)', () => {
  it('never holds a non-wizard form', () => {
    expect(shouldHoldMultiStepSubmit({ isWizard: false, reachedSubmit: false, filledEmail: false })).toBe(false);
  });
  it('submits a wizard only when it reached submit AND filled an email', () => {
    expect(shouldHoldMultiStepSubmit({ isWizard: true, reachedSubmit: true, filledEmail: true })).toBe(false);
  });
  it('holds when the wizard walk never reached the final step', () => {
    expect(shouldHoldMultiStepSubmit({ isWizard: true, reachedSubmit: false, filledEmail: true })).toBe(true);
  });
  it('holds when no email was filled (not a valid lead)', () => {
    expect(shouldHoldMultiStepSubmit({ isWizard: true, reachedSubmit: true, filledEmail: false })).toBe(true);
  });
});
