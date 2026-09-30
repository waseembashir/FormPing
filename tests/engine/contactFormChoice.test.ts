/**
 * FR-98 — what the engine is allowed to call "the contact form".
 *
 * A client monitor on fautons.com reported "Multi-step form found — needs
 * attention" on every check. The form it had chosen was the site's **login
 * modal**: hidden behind the `hidden` attribute, headed "Log in to Fautons",
 * posting to `/api/auth/request`. Landing-page leniency accepted it because the
 * user had asserted "the form is on this page", then nothing could be filled
 * (a hidden form has no visible fields) and the run fell back to the multi-step
 * label — blaming a capability we have for a choice we should never have made.
 *
 * These run the real `findContactForm` against the real markup, trimmed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { findContactForm } from '../../src/forms/findContactForm.js';
import { hasStepControl } from '../../src/forms/fillForm.js';
import { openFixture, startBrowser, stopBrowser, testConfig } from './harness.js';

const FIXTURE = 'login-modal-and-newsletter.html';

beforeAll(startBrowser, 60_000);
afterAll(stopBrowser);

describe('a login form is never the contact form', () => {
  it('does not choose the hidden login modal, even in landing-page mode', async () => {
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig({ landingPage: true }));

    // The exact wrong answer this issue was filed for.
    expect(form?.identifier?.action ?? '').not.toContain('/api/auth/request');
    await page.close();
  });

  it('does not choose it in ordinary (non-landing) mode either', async () => {
    // Leniency is the landing-page path, so this guards the other one.
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig({ landingPage: false }));

    expect(form?.identifier?.action ?? '').not.toContain('/api/auth/request');
    await page.close();
  });
});

describe('a form nobody can see is never the contact form', () => {
  it('never returns a hidden form as the tested form', async () => {
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig({ landingPage: true }));

    if (form) {
      // If a form was chosen at all, a visitor must be able to see it —
      // otherwise the run cannot fill it and cannot honestly report on it.
      const visible = await page.evaluate((index: number) => {
        const f = document.querySelectorAll('form')[index];
        if (!f) return false;
        const style = getComputedStyle(f);
        const rect = f.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }, form.index);
      expect(visible).toBe(true);
    }
    await page.close();
  });
});

describe('honeypots are not fields', () => {
  it('excludes _gotcha from the fields reported for a form', async () => {
    // `_gotcha` is display:none, aria-hidden, tabindex=-1 — a bot trap the
    // filler already refuses to touch. It was still counted, and because it sits
    // immediately before the labelled email input it even wore that input's
    // label: the run reported two fields, both called "Work email *".
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig({ landingPage: true }));

    const names = (form?.fields ?? []).map((f) => (f as { name?: string }).name ?? '');
    expect(names).not.toContain('_gotcha');
    await page.close();
  });
});

describe('a one-page form is not mistaken for a wizard', () => {
  it('finds no step control on a plain newsletter form', () => {
    // The other half of FR-94: the probe must answer "no" here, not merely
    // fail to answer. A detector that only ever says yes is no detector.
    return (async () => {
      const page = await openFixture(FIXTURE);
      const { form } = await findContactForm(page, testConfig({ landingPage: true }));
      expect(form).not.toBeNull();
      expect(await hasStepControl(page, form!.index)).toBe(false);
      await page.close();
    })();
  });
});
