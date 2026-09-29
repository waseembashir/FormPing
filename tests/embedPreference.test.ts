/**
 * FR-95 — a footer newsletter must not hide an embedded contact form.
 *
 * A site whose contact form is a hosted embed was reported as having no contact
 * form, while the Form Tester listed that embed on screen for the same run.
 *
 * The cause was narrower than it first appeared. Discovery picks the contact
 * page correctly and the embed IS detected on it. But the site's footer
 * newsletter sign-up appears on every page, so on the contact page it becomes
 * the best *native* form — and the guard that says "the only form here is a
 * newsletter, so this is not a contact form" fires on that kind alone, without
 * consulting the embed beside it.
 *
 * Almost every agency site has a footer sign-up, which is what made this common
 * rather than exotic.
 */

import { describe, it, expect } from 'vitest';
import { embedBeatsNativeForm, embedOverUtilityNote } from '../src/runners/embedPreference.js';

describe('an embed wins over a form we already know is not a contact form', () => {
  it.each([
    ['newsletter', 'the footer sign-up on hutch.agency — the case this was raised for'],
    ['search', 'a search box is no more evidence of a contact form than a newsletter'],
    ['login', 'a sign-in form is never the contact form either'],
  ])('%s + an embed → report the embed (%s)', (kind) => {
    expect(embedBeatsNativeForm(kind, 1)).toBe(true);
  });
});

describe('it never overrides a real native contact form', () => {
  it('leaves a contact form alone even when an embed is also present', () => {
    // A native contact form can be filled and submitted; an embed cannot. When
    // the page genuinely offers both, the testable one must keep winning or this
    // fix would trade a false negative for a worse false positive.
    expect(embedBeatsNativeForm('contact', 1)).toBe(false);
  });

  it('leaves an unclassified form alone', () => {
    expect(embedBeatsNativeForm('other', 1)).toBe(false);
    expect(embedBeatsNativeForm(undefined, 1)).toBe(false);
  });
});

describe('with no embed there is nothing better to report', () => {
  it.each(['newsletter', 'search', 'login'])('%s alone stays "not a contact form"', (kind) => {
    // The honesty guard FR-68 added is still right in this case, and must keep
    // firing: a page whose only form is a newsletter genuinely has no contact
    // form, and saying so plainly is the point of that guard.
    expect(embedBeatsNativeForm(kind, 0)).toBe(false);
  });
});

describe('the note explains the choice rather than contradicting it', () => {
  it('names the native form it set aside, and the provider it chose', () => {
    // Without this the result reads as a contradiction: the run found a form,
    // and is reporting a different one.
    const note = embedOverUtilityNote('newsletter', 'HubSpot');
    expect(note).toContain('newsletter sign-up');
    expect(note).toContain('HubSpot');
  });

  it('describes each utility kind in plain words', () => {
    expect(embedOverUtilityNote('search', 'Typeform')).toContain('search box');
    expect(embedOverUtilityNote('login', 'Jotform')).toContain('login form');
  });

  it('carries no internal identifiers', () => {
    // A reason code or enum on a user-facing line is the leak FR-86 and FR-91
    // removed elsewhere.
    expect(embedOverUtilityNote('newsletter', 'HubSpot')).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/);
  });
});
