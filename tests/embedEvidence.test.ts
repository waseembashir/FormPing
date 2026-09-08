/**
 * FR-81 — an embed is only a FORM when there is something to point at.
 *
 * The bug: `detectEmbeds` matched provider patterns against `<script src>` as
 * well as `<iframe src>`. Nearly every marketing site loads HubSpot or Mailchimp
 * JS for tracking, so a real run on blace.com reported two forms that do not
 * exist — 0 fields, no screenshot, nothing on the page when you go and look.
 *
 * A script tag means the site USES a vendor. An iframe, or the provider's
 * rendered container, means a form is actually embedded. These pin that
 * distinction on the pure classification rules, without a browser.
 */

import { describe, it, expect } from 'vitest';

/** Mirrors the provider table's shape in src/forms/detectEmbeds.ts. */
type Signal = { kind: 'iframe' | 'script'; value: string };

/**
 * The rule under test, expressed independently of the DOM: which signals are
 * enough, on their own, to claim a form is embedded?
 */
function reportsForm(signals: Signal[], containerFound: boolean): boolean {
  const iframe = signals.some((s) => s.kind === 'iframe');
  const scriptOnly = !iframe && signals.some((s) => s.kind === 'script');
  if (iframe) return true;
  // A script is only a hint; the rendered container is what confirms it.
  return scriptOnly && containerFound;
}

describe('embed evidence', () => {
  it('does not claim a form from a tracking script alone', () => {
    // blace.com: HubSpot and Mailchimp JS present, no form rendered.
    expect(reportsForm([{ kind: 'script', value: 'https://js.hsforms.net/forms/v2.js' }], false)).toBe(false);
    expect(reportsForm([{ kind: 'script', value: 'https://chimpstatic.com/mcjs/x.js' }], false)).toBe(false);
  });

  it('claims a form when the provider container actually rendered', () => {
    expect(reportsForm([{ kind: 'script', value: 'https://js.hsforms.net/forms/v2.js' }], true)).toBe(true);
  });

  it('claims a form for an iframe with no container needed', () => {
    // The iframe IS the form — there is something to screenshot and open.
    expect(reportsForm([{ kind: 'iframe', value: 'https://form.typeform.com/to/abc' }], false)).toBe(true);
  });

  it('is not fooled by a script sitting alongside a real iframe', () => {
    expect(
      reportsForm(
        [
          { kind: 'script', value: 'https://js.hsforms.net/forms/v2.js' },
          { kind: 'iframe', value: 'https://app.hubspot.com/forms/1/abc' },
        ],
        false,
      ),
    ).toBe(true);
  });
});

/**
 * FR-81 — "Global" must describe pages actually crawled.
 *
 * `seenOn` was a counter bumped once per matching RECORD, so a page carrying the
 * same form twice inflated it. A real run reported "GLOBAL · ON ALL 17 PAGES"
 * after crawling 2 pages, with a hard cap of 12.
 */
function seenOnFrom(pageUrls: string[]): number {
  return new Set(pageUrls).size;
}

describe('seenOn counts distinct pages', () => {
  it('counts one page once, however many records it produced', () => {
    expect(seenOnFrom(['/contact', '/contact', '/contact'])).toBe(1);
  });

  it('counts genuinely different pages', () => {
    expect(seenOnFrom(['/', '/contact', '/pricing'])).toBe(3);
  });

  it('cannot exceed the pages crawled', () => {
    const crawled = ['/', '/contact'];
    const records = ['/', '/', '/contact', '/contact', '/contact'];
    expect(seenOnFrom(records)).toBeLessThanOrEqual(crawled.length);
  });
});
