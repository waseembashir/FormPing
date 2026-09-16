/**
 * FR-91 — every alert in the app is assembled the same way, and none of them
 * dresses a result as something it is not.
 *
 * Three senders exist: Form Watch, Site Watch and the Change Monitor. Each now
 * supplies `facts` (what we found), `scope` (what we looked at, so a reader does
 * not over-read the result) and `action` (what a person must still do by hand,
 * and why we could not do it).
 *
 * The severity rules are pinned here rather than per-sender because the whole
 * point is that they agree: a green tick means "we tested it and it worked", and
 * nothing else is allowed to wear one.
 */

import { describe, it, expect } from 'vitest';
import { formRunFacts, formRunScope, manualActionFor } from '@/lib/formWatch/alertFacts';
import { siteCheckFacts, siteCheckScope, siteManualActionFor } from '@/lib/siteWatch/alertFacts';
import {
  changeReportFacts,
  changeReportScope,
  changeManualActionFor,
} from '@/lib/changeAlertFacts';
import type { FormRunRecord } from '@/lib/formWatch/types';
import type { SiteCheckRecord } from '@/lib/siteWatch/types';

const formRun = (over: Record<string, unknown> = {}, fp: Record<string, unknown> = {}): FormRunRecord =>
  ({
    scheduleId: 's1',
    url: 'https://hutch.example/contact',
    site: 'hutch.example',
    mode: 'detect-only',
    ranAt: '2026-09-09T10:00:00.000Z',
    status: 'warn',
    reasonCode: 'THIRD_PARTY_EMBED_FORM',
    submissionResult: 'not_attempted',
    durationMs: 1000,
    notes: [],
    errors: [],
    ...over,
    fingerprint: {
      contactPage: 'https://hutch.example/contact',
      formFound: true,
      formConfidence: 0.9,
      formId: null,
      formAction: null,
      formMethod: null,
      captchaDetected: false,
      ...fp,
    },
  }) as unknown as FormRunRecord;

describe('Form Watch — the search mode is always stated', () => {
  it('a site-wide run says other forms may exist', () => {
    const scope = formRunScope(formRun());
    expect(scope).toMatch(/whole site/i);
    // The reader must not infer "this is the only form on the site".
    expect(scope).toMatch(/other forms may exist/i);
    expect(scope).toMatch(/main contact form/i);
  });

  it('does not assert a page-level count that the site inventory could contradict', () => {
    // The scope line used to say "N forms were found on this page alone", taken
    // from formsOnPage. On hutch.agency that sat beside a HubSpot form on a
    // DIFFERENT page and read as a contradiction. Counts belong in the facts,
    // where the whole-site inventory can correct them. FR-91.
    const scope = formRunScope(
      formRun({}, { formsOnPage: { total: 4, native: 3, embeds: 1, tested: null, others: [], multipleContacts: true } }),
    );
    expect(scope).not.toMatch(/\d+ forms/);
    expect(scope).not.toMatch(/on this page alone/i);
  });

  it('always states WHICH MODE ran — a Detect run proves nothing about delivery', () => {
    // The original Slack sender printed the mode; it was lost in the July 2026
    // dispatcher refactor and no alert carried it until FR-91. Without it,
    // "Contact form OK" on a Detect run reads as "your form works", which that
    // mode never tested.
    expect(formRunScope(formRun({ mode: 'detect-only' }))).toMatch(
      /Detect mode — we only confirmed a form exists; nothing was filled or submitted/i,
    );
    expect(formRunScope(formRun({ mode: 'safe' }))).toMatch(/filled, then deliberately not submitted/i);
    expect(formRunScope(formRun({ mode: 'live' }))).toMatch(/a real message was submitted/i);
  });

  it('states the mode AND the search together, in every combination', () => {
    for (const mode of ['detect-only', 'safe', 'live']) {
      for (const landingPageMode of [false, true]) {
        const scope = formRunScope(formRun({ mode }, { landingPageMode }));
        expect(scope, `${mode}/${landingPageMode}`).toMatch(/mode —/i);
        expect(scope, `${mode}/${landingPageMode}`).toMatch(
          landingPageMode ? /this exact URL/i : /whole site/i,
        );
      }
    }
  });

  it('landing-page mode makes the narrower promise, and says so', () => {
    const scope = formRunScope(formRun({}, { landingPageMode: true }));
    expect(scope).toMatch(/this exact URL/i);
    expect(scope).not.toMatch(/whole site/i);
  });
});

describe('Form Watch — “we could not fill it” always carries the reason', () => {
  it('names the provider and explains why a submit is impossible', () => {
    const action = manualActionFor(formRun({}, { embedProvider: 'HubSpot', formType: 'third-party' }))!;
    expect(action).toContain('HubSpot');
    expect(action).toMatch(/could not fill or submit/i);
    expect(action).toMatch(/across domains/i);
    // Reassurance matters: this is not a fault, and the alert must not imply one.
    expect(action).toMatch(/nothing is wrong/i);
  });

  it('explains a CAPTCHA rather than just reporting a block', () => {
    const action = manualActionFor(formRun({ reasonCode: 'CAPTCHA_DETECTED' }))!;
    expect(action).toMatch(/could not submit/i);
    expect(action).toMatch(/by design/i);
  });

  it('says nothing when the run genuinely tested the form', () => {
    // An alert that always asks for manual work trains people to ignore the ask.
    expect(manualActionFor(formRun({ reasonCode: 'SAFE_MODE_NO_SUBMIT' }))).toBeNull();
    expect(manualActionFor(formRun({ reasonCode: 'THANK_YOU_REDIRECT' }))).toBeNull();
  });

  it('every reason it does give explains itself, not just the instruction', () => {
    for (const code of [
      'THIRD_PARTY_EMBED_FORM',
      'CAPTCHA_DETECTED',
      'MULTI_STEP_FORM_DETECTED',
      'SUBMIT_HELD_INCOMPLETE',
      'BLOCKED_BY_HOST',
      'NON_CONTACT_FORM_FOUND',
      'LOW_CONFIDENCE_FORM',
    ]) {
      const action = manualActionFor(formRun({ reasonCode: code }))!;
      expect(action, code).toBeTruthy();
      // A reason, not a bare order: every one says what we could/couldn't do.
      expect(action, code).toMatch(/we (could not|did not|deliberately|are not)/i);
      expect(action.length, code).toBeGreaterThan(60);
    }
  });
});

const check = (over: Record<string, unknown> = {}): SiteCheckRecord =>
  ({
    scheduleId: 's2',
    url: 'https://acme.example',
    host: 'acme.example',
    checkedAt: '2026-09-09T10:00:00.000Z',
    uptime: { classification: 'up', statusCode: 200, responseMs: 142 },
    ssl: { ok: true, daysRemaining: 23, validTo: '2026-10-02T00:00:00Z', issuer: 'X' },
    domain: { ok: true, daysRemaining: 410, expiryDate: '2027-11-01T00:00:00Z', registrar: 'Y' },
    ...over,
  }) as unknown as SiteCheckRecord;

describe('Site Watch — facts, and an honest account of what was not checked', () => {
  it('reports reachability, certificate and domain as separate facts', () => {
    const facts = siteCheckFacts(check());
    expect(facts[0]).toContain('142 ms');
    expect(facts.join(' ')).toMatch(/Certificate valid, 23 days left/);
    expect(facts.join(' ')).toMatch(/Domain renews in 410 days/);
  });

  it('says a certificate check is absent rather than failed on plain HTTP', () => {
    const facts = siteCheckFacts(check({ ssl: null, domain: null }));
    expect(facts.join(' ')).not.toMatch(/certificate/i);
  });

  it('marks a domain figure that could not be refreshed this check', () => {
    const facts = siteCheckFacts(
      check({ domain: { ok: true, daysRemaining: 410, expiryDate: 'x', registrar: null, stale: true } }),
    );
    expect(facts.join(' ')).toContain('not refreshed this check');
  });

  it('states what an uptime check does NOT cover', () => {
    // A green uptime alert is not proof the forms or checkout work.
    expect(siteCheckScope(check())).toMatch(/not the pages, forms or content/i);
  });

  it('asks for a manual look when the site answered with a bot challenge', () => {
    const action = siteManualActionFor(check({ uptime: { classification: 'blocked', statusCode: 403, responseMs: 90 } }))!;
    expect(action).toMatch(/could not confirm/i);
    expect(action).toMatch(/firewall|bot challenge/i);
  });
});

const report = (over: Record<string, unknown> = {}) => ({
  changesFound: 7,
  pagesChanged: 3,
  pagesScanned: 12,
  details: [
    { url: '/contact', severity: 'high', changes: ['Form field "Phone" is now required'] },
    { url: '/pricing', severity: 'medium', changes: ['Price text changed'] },
    { url: '/about', severity: 'low', changes: ['Paragraph edited'] },
  ],
  ...over,
});

describe('Change Monitor — a count is not a finding', () => {
  it('breaks the changes down by severity', () => {
    expect(changeReportFacts(report()).join(' ')).toMatch(/1 high · 1 medium · 1 low severity/);
  });

  it('calls out a form change separately — it is the one that costs leads', () => {
    const facts = changeReportFacts(report()).join(' ');
    expect(facts).toMatch(/1 form change/);
    expect(facts).toMatch(/check the form still submits/i);
  });

  it('says how much of the site moved, against how much was looked at', () => {
    expect(changeReportFacts(report()).join(' ')).toContain('3 of 12 pages changed');
  });

  it('states that unwatched pages are not covered', () => {
    expect(changeReportScope(report())).toMatch(/not covered/i);
  });

  it('asks for a manual check only when a form actually moved', () => {
    expect(changeManualActionFor(report())).toMatch(/cannot tell from a page diff/i);
    const noForms = report({ details: [{ url: '/about', severity: 'low', changes: ['Paragraph edited'] }] });
    expect(changeManualActionFor(noForms)).toBeNull();
  });

  it('survives a malformed report from the CLI subprocess', () => {
    expect(() => changeReportFacts({})).not.toThrow();
    expect(() => changeReportFacts({ details: 'nonsense' })).not.toThrow();
    expect(changeReportScope({})).toBeTruthy();
  });
});
