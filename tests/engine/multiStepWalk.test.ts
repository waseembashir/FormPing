/**
 * FR-98 / FR-63 — the wizard walk must survive the "never choose a hidden form"
 * rule.
 *
 * FR-98 stops the engine picking a form nobody can see, because a hidden login
 * modal was being monitored as a client's contact form. A multi-step wizard is
 * *made of* hidden panels, so that rule could plausibly have killed the walk
 * FR-63 built — and nothing would have noticed until a real contact form
 * quietly stopped being tested.
 *
 * So this is the counterweight: the same engine, the same run, against a wizard
 * whose step 1 is visible and whose later steps are not.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { findContactForm } from '../../src/forms/findContactForm.js';
import { fillForm } from '../../src/forms/fillForm.js';
import { openFixture, startBrowser, stopBrowser, testConfig } from './harness.js';

const FIXTURE = 'multi-step-wizard.html';

beforeAll(startBrowser, 60_000);
afterAll(stopBrowser);

describe('a multi-step wizard is still found and still filled', () => {
  it('chooses the wizard — its first panel is visible, so the rule does not exclude it', async () => {
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig({ landingPage: true }));

    expect(form).not.toBeNull();
    expect((form?.fields ?? []).map((f) => (f as { name?: string }).name)).toContain('email');
    await page.close();
  });

  it('fills step 1 and advances through "Continue ›"', async () => {
    const page = await openFixture(FIXTURE);
    const config = testConfig({ landingPage: true, mode: 'safe' });
    const { form } = await findContactForm(page, config);
    expect(form).not.toBeNull();

    const result = await fillForm(page, form!, config);

    // Step 1's own fields.
    const filled = result.filledFields.map((f) => f.label);
    expect(filled.join(' ')).toMatch(/work email/i);
    expect(filled.join(' ')).toMatch(/country/i);

    // And it did not stop at the first panel: the arrow-suffixed "Continue ›"
    // is recognised as an advance control, not as a submit.
    expect(result.stepsTraversed).toBeGreaterThan(1);
    await page.close();
  });

  /**
   * CHARACTERISATION — this pins what the engine does TODAY, not what it should
   * do. When FR-94 makes the walk fill later panels, this test will fail, and
   * that failure is the signal to update it rather than a regression.
   *
   * The limitation: each panel of this wizard is its own `<form>` element, but
   * `fillSingleStep` stays scoped to the form that was originally chosen. So the
   * walk advances through the panels and fills nothing after the first one.
   * The live run against fautons.com/contact-sales shows the same shape —
   * "traversed 2 step(s)" alongside "Filled 2 field(s)", both from step 1.
   */
  it('today: advances past step 1 but does not fill later panels (FR-94)', async () => {
    const page = await openFixture(FIXTURE);
    const config = testConfig({ landingPage: true, mode: 'safe' });
    const { form } = await findContactForm(page, config);
    const result = await fillForm(page, form!, config);

    const labels = result.filledFields.map((f) => f.label).join(' ');
    expect(labels).toMatch(/work email/i); // step 1 — filled
    expect(labels).not.toMatch(/full name/i); // step 2 — reached, never filled
    expect(result.stepsTraversed).toBeGreaterThan(1); // it DID walk past step 1
    await page.close();
  });
});
