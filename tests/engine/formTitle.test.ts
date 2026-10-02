/**
 * What the engine is allowed to call a form's title.
 *
 * A monitored URL reported its contact form as being named `"*"`. Another form
 * on the same site was named `"50%"`. Neither is a title; both are what sits
 * directly above the first field on a great many forms — a required-field
 * marker and a discount badge, each styled bold and large, which is precisely
 * the signal the engine uses to recognise a title that has not been marked up
 * as a heading.
 *
 * The cost is not cosmetic. The title is printed as the form's NAME in the
 * report, the per-URL dashboard and the Slack alert, so a reader is told the
 * form is called "*" rather than that we could not name it — a confident wrong
 * answer in place of an honest absence.
 *
 * These run the real `findContactForm` against markup carrying both decoys.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { findContactForm } from '../../src/forms/findContactForm.js';
import { openFixture, startBrowser, stopBrowser, testConfig } from './harness.js';

const FIXTURE = 'asterisk-title.html';

beforeAll(startBrowser, 60_000);
afterAll(stopBrowser);

describe('a form title has to be words', () => {
  it('never names a form after a required-field marker', async () => {
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig());
    expect(form?.location?.heading ?? '').not.toBe('*');
    await page.close();
  });

  it('never names a form after a badge with no letters in it', async () => {
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig());
    expect(form?.location?.heading ?? '').not.toBe('50%');
    await page.close();
  });

  it('prefers the real heading, which is further away but is actually a title', async () => {
    // The fix must not merely reject the glyph and give up: the page HAS a
    // title, and rejecting the nearest candidate has to let the search carry on
    // rather than settle for nothing.
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig());
    expect(form?.location?.heading).toBe('Request a callback');
    await page.close();
  });

  it('whatever it settles on contains letters', async () => {
    // The rule itself, stated independently of this fixture's particular
    // decoys, so a future title source is covered by the same expectation.
    const page = await openFixture(FIXTURE);
    const { form } = await findContactForm(page, testConfig());
    const heading = form?.location?.heading;
    if (heading) expect(heading).toMatch(/[A-Za-z]{2}/);
    await page.close();
  });
});
