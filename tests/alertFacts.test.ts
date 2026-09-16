/**
 * FR-91 — a notification says what the run actually found.
 *
 * A third-party form on a client's site produced the Slack message "Third-party
 * form detected" and nothing else: no provider, no page, no field count. It read
 * as "we found something, we don't know what", and was reported as exactly that.
 *
 * The engine had known all of it since the v2.1.0 rebuild — `embedProvider`,
 * `fieldCount`, `formsOnPage`, `contactPage`, `formConfidenceLevel`. None of it
 * was passed to the alert layer. These pin that it now is, and that the line
 * stays short enough for a channel that throttles.
 */

import { describe, it, expect } from 'vitest';
import { formRunFacts, formRunFactsLine, formRunScope, manualActionFor } from '@/lib/formWatch/alertFacts';
import type { FormRunRecord, FormFingerprint } from '@/lib/formWatch/types';

function run(fingerprint: Partial<FormFingerprint>): FormRunRecord {
  return {
    scheduleId: 's1',
    url: 'https://hutch.example/contact',
    site: 'hutch.example',
    mode: 'detect-only',
    ranAt: '2026-09-09T10:00:00.000Z',
    status: 'warn',
    reasonCode: 'THIRD_PARTY_EMBED_FORM',
    submissionResult: 'not_attempted',
    durationMs: 4200,
    notes: [],
    errors: [],
    fingerprint: {
      contactPage: 'https://hutch.example/contact',
      formFound: true,
      formConfidence: 0.9,
      formId: null,
      formAction: null,
      formMethod: null,
      captchaDetected: false,
      ...fingerprint,
    },
  };
}

describe('a third-party form is named, not merely "detected"', () => {
  it('names the provider — the exact complaint that opened this issue', () => {
    const facts = formRunFacts(run({ formType: 'third-party', embedProvider: 'Typeform', fieldCount: 6 }));
    expect(facts[0]).toBe('Typeform form (embedded)');
    expect(formRunFactsLine(run({ formType: 'third-party', embedProvider: 'Typeform', fieldCount: 6 })))
      .toContain('Typeform');
  });

  it('says plainly that it is an embed when the provider is unknown', () => {
    const facts = formRunFacts(run({ formType: 'third-party', embedProvider: null }));
    // Never silence, and never anything that reads as "we found nothing".
    expect(facts[0]).toBe('Embedded third-party form');
  });
});

describe('the facts carry what the rebuilt engine learned', () => {
  it('reports field count, the page it was found on, and competing forms', () => {
    const line = formRunFactsLine(
      run({
        formFound: true,
        fieldCount: 6,
        contactPage: 'https://hutch.example/contact-us/',
        formsOnPage: { total: 3, native: 2, embeds: 1, tested: null, others: [], multipleContacts: false },
      }),
    )!;
    expect(line).toContain('6 fields');
    expect(line).toContain('found on /contact-us');
    // "on the page we tested" rather than "on this page": formsOnPage counts the
    // tested page only, and the looser wording read as a contradiction beside a
    // fact about a form on a different page.
    expect(line).toContain('3 forms on the page we tested');
  });

  it('calls a multi-step form what it is', () => {
    expect(formRunFacts(run({ isMultiStep: true, formFound: true }))[0]).toBe('Multi-step form');
  });

  it('flags a CAPTCHA, which explains why a submit may never succeed', () => {
    expect(formRunFacts(run({ formFound: true, captchaDetected: true }))).toContain('CAPTCHA present');
  });

  it('does not repeat the page when landing-page mode tested this exact URL', () => {
    const facts = formRunFacts(run({ formFound: true, landingPageMode: true, contactPage: 'https://hutch.example/contact' }));
    expect(facts.join(' ')).not.toContain('found on');
  });

  it('says nothing rather than guessing when the engine found no form', () => {
    expect(formRunFacts(run({ formFound: false }))).toEqual([]);
    expect(formRunFactsLine(run({ formFound: false }))).toBeNull();
  });
});

describe('the engine’s own doubt survives the trim', () => {
  it('carries the low-confidence reason, and puts it before the details', () => {
    const facts = formRunFacts(
      run({
        formFound: true,
        fieldCount: 1,
        formConfidenceLevel: 'low',
        lowConfidenceReason: 'Only one field — this may be a search box',
        formsOnPage: { total: 4, native: 4, embeds: 0, tested: null, others: [], multipleContacts: true },
        captchaDetected: true,
      }),
    );
    // Ahead of the field count: a message that sounds certain when the engine
    // was not is worse than one missing a number. FR-73.
    expect(facts.indexOf('Only one field — this may be a search box')).toBeLessThan(
      facts.indexOf('1 field'),
    );
  });

  it('hedges even when no reason text was recorded', () => {
    const facts = formRunFacts(run({ formFound: true, formConfidenceLevel: 'low' }));
    expect(facts.some((f) => /not sure/i.test(f))).toBe(true);
  });
});

describe('the line stays small enough for Slack', () => {
  it('never exceeds the budget, however much the engine found', () => {
    const line = formRunFactsLine(
      run({
        formType: 'third-party',
        embedProvider: 'A provider with an absurdly long marketing name'.repeat(4),
        formConfidenceLevel: 'low',
        lowConfidenceReason: 'x'.repeat(200),
        fieldCount: 12,
        contactPage: 'https://hutch.example/a/very/deep/path/to/the/contact/page',
        formsOnPage: { total: 9, native: 8, embeds: 1, tested: null, others: [], multipleContacts: true },
        captchaDetected: true,
      }),
    )!;
    expect(line.length).toBeLessThanOrEqual(240);
  });

  it('caps the number of facts', () => {
    const facts = formRunFacts(
      run({
        formType: 'third-party',
        embedProvider: 'Typeform',
        formConfidenceLevel: 'low',
        lowConfidenceReason: 'Only one field',
        fieldCount: 3,
        contactPage: 'https://hutch.example/contact',
        formsOnPage: { total: 5, native: 4, embeds: 1, tested: null, others: [], multipleContacts: true },
        captchaDetected: true,
      }),
    );
    expect(facts.length).toBeLessThanOrEqual(5);
  });

  it('drops whole facts rather than cutting one in half', () => {
    const line = formRunFactsLine(
      run({
        formType: 'third-party',
        embedProvider: 'P'.repeat(150),
        fieldCount: 6,
        contactPage: 'https://hutch.example/contact',
      }),
    )!;
    // Whatever survived, it is complete — no dangling separator or ellipsis.
    expect(line.endsWith('·')).toBe(false);
    expect(line).not.toContain('· ·');
  });
});

describe('a notification cannot contradict the Form Tester for the same run', () => {
  /**
   * The real hutch.agency run, 2026-09-16. The Tester listed two forms — a
   * newsletter sign-up on the homepage and a HubSpot form on /contact-us — while
   * the Slack alert said "Found a form — not a contact form" and mentioned
   * neither. Both surfaces had the same run; only the Tester read the whole-site
   * inventory. Everything below asserts the notification now reads it too.
   */
  const raw = {
    finalStatus: 'warn',
    reasonCode: 'NON_CONTACT_FORM_FOUND',
    formFound: true,
    resolvedContactPage: 'https://hutch.agency/',
    fieldCount: 1,
    formsOnPage: { total: 2, native: 1, embeds: 1, tested: null, others: [], multipleContacts: false },
    siteForms: [
      { url: 'https://hutch.agency/', kind: 'newsletter', about: 'Newsletter', formType: 'native', fieldCount: 1, outcome: 'detected', primary: true },
      { url: 'https://hutch.agency/contact-us', kind: 'third-party', about: 'HubSpot', formType: 'third-party', provider: 'HubSpot', outcome: 'detected' },
    ],
  };
  const hutch = run({ formFound: true, fieldCount: 1, contactPage: 'https://hutch.agency/', formsOnPage: raw.formsOnPage });
  const record = { ...hutch, reasonCode: 'NON_CONTACT_FORM_FOUND', site: 'hutch.agency', url: 'https://hutch.agency' } as typeof hutch;

  it('names the form found on the OTHER page', () => {
    const line = formRunFactsLine(record, raw)!;
    expect(line).toContain('HubSpot form on /contact-us');
  });

  it('names what the tested form actually is, instead of "a form"', () => {
    expect(formRunFacts(record, raw)[0]).toBe('Newsletter');
  });

  it('calls the homepage the homepage', () => {
    expect(formRunFactsLine(record, raw)).toContain('found on the homepage');
  });

  it('tells the user the monitor may be pointed at the wrong page, and how to fix it', () => {
    const action = manualActionFor(record, raw)!;
    expect(action).toContain('HubSpot form on /contact-us');
    expect(action).toMatch(/point this monitor at that URL/i);
    expect(action).toMatch(/Landing-page mode/i);
    // And it must not imply the site has no contact form.
    expect(action).toMatch(/did not find a contact form there/i);
  });

  it('drops the page-level count when the site inventory says something better', () => {
    // "2 forms on the page we tested" beside "also found: HubSpot form on
    // /contact-us" reads as a contradiction, not an addition.
    expect(formRunFactsLine(record, raw)).not.toContain('on the page we tested');
    // With no inventory, the page count is still the best fact available.
    expect(formRunFactsLine(record)).toContain('forms on the page we tested');
  });

  it('claims nothing about other pages when the run found only one form', () => {
    const single = { ...raw, siteForms: [raw.siteForms[0]] };
    expect(formRunFactsLine(record, single)).not.toContain('also found');
  });

  it('the scope line no longer asserts a page count that the inventory contradicts', () => {
    expect(formRunScope(record)).not.toMatch(/on this page alone/);
    expect(formRunScope(record)).toMatch(/other forms may exist/i);
  });
});
