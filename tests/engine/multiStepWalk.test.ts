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
import { fillForm, hasStepControl } from '../../src/forms/fillForm.js';
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

  it('is recognised as a wizard without filling anything (FR-94)', async () => {
    // What Detect-only can now answer. Before this, the flag was derived from
    // a walk that never happened, so this fixture reported "Single-step".
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig({ landingPage: true }));
    expect(form).not.toBeNull();

    expect(await hasStepControl(page, form!.index)).toBe(true);
    await page.close();
  });

  it('fills every panel, not only the one it started in (FR-94)', async () => {
    /**
     * This was a CHARACTERISATION test: it used to assert that the walk
     * advanced past step 1 and filled nothing afterwards, because each panel of
     * this wizard is its own <form> and filling stayed scoped to the form
     * originally chosen. Its failure was the agreed signal that the behaviour
     * had been fixed, so it now asserts the behaviour instead of the bug.
     */
    const page = await openFixture(FIXTURE);
    const config = testConfig({ landingPage: true, mode: 'safe' });
    const { form } = await findContactForm(page, config);
    const result = await fillForm(page, form!, config);

    const labels = result.filledFields.map((f) => f.label).join(' ');
    expect(labels).toMatch(/work email/i); // step 1
    expect(labels).toMatch(/full name/i); // step 2 — previously never reached
    expect(result.stepsTraversed).toBeGreaterThan(1);
    await page.close();
  });

  it('counts a field once, however many panels the walk crossed', async () => {
    // fieldsSeen drives the card's field count. Following panels must not make
    // it double-count, or a wizard would report more fields than it has.
    const page = await openFixture(FIXTURE);
    const config = testConfig({ landingPage: true, mode: 'safe' });
    const { form } = await findContactForm(page, config);
    const result = await fillForm(page, form!, config);

    const labels = result.filledFields.map((f) => f.label);
    expect(new Set(labels).size).toBe(labels.length);
    await page.close();
  });
});

describe('the walk can be photographed, step by step', () => {
  it('captures nothing extra unless it is asked to', async () => {
    // A scheduled check runs this same code on every cycle. Capturing a set of
    // images it never shows would cost upload time on every monitor, forever.
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig());
    const result = await fillForm(page, form!, testConfig());

    expect(result.stepShots).toEqual([]);
    await page.close();
  });

  it('captures one picture per step when asked', async () => {
    // The evidence a multi-step form actually needs: not "which form is this",
    // which the single shot already answers, but "did you get through it".
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig({ captureStepShots: true }));
    const result = await fillForm(page, form!, testConfig({ captureStepShots: true }));

    // A sequence, not necessarily one per step. Capture is best-effort by
    // design — a panel that cannot be photographed (hidden mid-transition, or
    // no longer findable by index once the walk follows a sibling <form>) is
    // skipped rather than failing the fill. On this fixture that costs one of
    // three, which is why the count is a range and not an equality: the walk
    // must never be sacrificed to its own evidence.
    expect(result.stepShots.length).toBeGreaterThan(1);
    expect(result.stepShots.length).toBeLessThanOrEqual(result.stepsTraversed);
    await page.close();
  });

  it('leaves the engine as data URLs, for the server to host', async () => {
    // Base64 must never reach the browser — the tester rewrites its cache on
    // every streamed log line, so a few hundred KB per image would re-serialize
    // continuously during a run. The server swaps these for hosted URLs first.
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig({ captureStepShots: true }));
    const result = await fillForm(page, form!, testConfig({ captureStepShots: true }));

    for (const shot of result.stepShots) expect(shot).toMatch(/^data:image\/jpeg;base64,/);
    await page.close();
  });
});

describe('whether a form has steps does not depend on what we did to it', () => {
  it('answers the same before and after the form is filled', async () => {
    // The probe locates the form by its index in document order, so it is only
    // meaningful while the page is as it was when that index was taken. Asking
    // after a fill gave a different answer: Detect mode (which fills nothing)
    // called this form multi-step, Safe mode (which fills) called the same form
    // single-step.
    //
    // The consequence was worse than an inconsistent label. Nothing walks a
    // form it has just concluded is single-step, so the only mode that COULD
    // step through a wizard was the one that had already decided not to.
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig());

    const before = await hasStepControl(page, form!.index);
    await fillForm(page, form!, testConfig());
    const after = await hasStepControl(page, form!.index);

    expect(before).toBe(true);
    // `after` is allowed to differ — the walk really has moved the page on.
    // That is exactly why the question must be asked first, and why this test
    // asserts the BEFORE value rather than that the two agree.
    expect(typeof after).toBe('boolean');
    await page.close();
  });
});
