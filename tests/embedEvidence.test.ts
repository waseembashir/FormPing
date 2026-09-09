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

/**
 * FR-84 — what we could not read must not be reported as what we looked at and
 * found empty.
 *
 * A HubSpot form on hutch.agency was correctly detected and photographed — the
 * screenshot plainly showed six labelled fields and a reCAPTCHA badge — while
 * the panel beneath it read "0 fields" and "bot protection… not attached to
 * this form". The inventory recorded the absence of knowledge as concrete
 * values: `fieldCount: 0`, `captcha: false`.
 *
 * Zero is not unknown. These pin the distinction on the record itself.
 */

/** The shape the two rules below care about, mirroring SiteForm. */
type Reported = { fieldCount?: number; security: { captcha?: boolean } };

/** What the UI must decide from a record: show a number, or say nothing. */
function showsFieldCount(f: Reported): boolean {
  return typeof f.fieldCount === 'number';
}

/** Only an iframe embed is genuinely unreadable — a container embed renders a
 *  real <form> into this page's DOM. */
function isUnreadable(embedKind: 'iframe' | 'script' | 'container' | undefined): boolean {
  return embedKind !== 'container';
}

describe('a form we could not read', () => {
  it('carries no field count at all, rather than zero', () => {
    const embed: Reported = { security: {} };
    expect(showsFieldCount(embed)).toBe(false);
    // The bug: 0 is a number, so every renderer printed it.
    expect(showsFieldCount({ fieldCount: 0, security: {} })).toBe(true);
  });

  it('makes no claim about a CAPTCHA it cannot see', () => {
    const embed: Reported = { security: {} };
    expect(embed.security.captcha).toBeUndefined();
    // `false` would assert the form is unprotected — under a screenshot that
    // may show a reCAPTCHA badge sitting on it.
    expect(embed.security.captcha).not.toBe(false);
  });

  it('still reports a genuine zero for a native form with no fillable fields', () => {
    // Absent means "we could not look". Zero must stay available for "we looked
    // and there are none", or this fix would blank out honest counts.
    expect(showsFieldCount({ fieldCount: 0, security: { captcha: false } })).toBe(true);
  });
});

describe('only a cross-origin embed is unreadable', () => {
  it('treats an iframe embed as unreadable', () => {
    expect(isUnreadable('iframe')).toBe(true);
  });

  it('does not claim we cannot read a container embed', () => {
    // Marketo's mktoForm and Mailchimp's mc_embed_signup render a real <form>
    // into the page's own DOM — saying "we can't see inside" would be false.
    expect(isUnreadable('container')).toBe(false);
  });

  it('treats a record with no embedKind as an iframe', () => {
    // Records stored before FR-84 carry no kind, and were all iframes.
    expect(isUnreadable(undefined)).toBe(true);
  });
});

/**
 * FR-84 — attributing a CAPTCHA to a hosted form, via the frame tree.
 *
 * A cross-origin form's DOM is unreadable, which is why bot-protection
 * detection could only say "reCAPTCHA is somewhere on this page". But every
 * frame in a page is visible to us, including nested cross-origin ones, and
 * each knows its parent. So "is the challenge inside THIS form?" is answerable
 * after all: does a reCAPTCHA frame's ancestry lead back to the form's frame?
 *
 * These mirror `descendsFrom` in src/forms/inspectEmbedFrames.ts on a stub tree,
 * so the rule is pinned without a browser.
 */

interface StubFrame { url: string; parent: StubFrame | null }

const frame = (url: string, parent: StubFrame | null = null): StubFrame => ({ url, parent });

function descendsFrom(f: StubFrame, ancestor: StubFrame): boolean {
  let current = f.parent;
  for (let hops = 0; current && hops < 10; hops += 1) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

const CAPTCHA_RE = /(?:www\.)?(?:google\.com|recaptcha\.net)\/recaptcha\//i;

/** The reported verdict: true only when found INSIDE the form; else unknown. */
function captchaOnForm(frames: StubFrame[], formFrame: StubFrame): boolean | undefined {
  const hit = frames.find((f) => CAPTCHA_RE.test(f.url) && descendsFrom(f, formFrame));
  return hit ? true : undefined;
}

describe('a CAPTCHA inside a hosted form', () => {
  const page = frame('https://hutch.agency/contact-us');
  const hubspot = frame('https://share.hsforms.com/embed/45358498', page);

  it('is attributed to the form when its frame sits inside the form frame', () => {
    const captcha = frame('https://www.google.com/recaptcha/api2/anchor?k=abc', hubspot);
    expect(captchaOnForm([page, hubspot, captcha], hubspot)).toBe(true);
  });

  it('is NOT attributed to the form when it belongs to the page instead', () => {
    // The original bug in reverse: page-level protection was reported as if it
    // said something about the embedded form. It sits beside it, not inside it.
    const captcha = frame('https://www.google.com/recaptcha/api2/anchor?k=abc', page);
    expect(captchaOnForm([page, hubspot, captcha], hubspot)).toBeUndefined();
  });

  it('finds one nested deeper than a single hop', () => {
    const inner = frame('https://share.hsforms.com/inner', hubspot);
    const captcha = frame('https://recaptcha.net/recaptcha/api2/bframe', inner);
    expect(captchaOnForm([page, hubspot, inner, captcha], hubspot)).toBe(true);
  });

  it('reports unknown rather than false when no challenge frame is present', () => {
    // Not seeing one is not evidence there isn't one — a challenge can attach on
    // first interaction. Absence stays unknown, as FR-73 established.
    const verdict = captchaOnForm([page, hubspot], hubspot);
    expect(verdict).toBeUndefined();
    expect(verdict).not.toBe(false);
  });
});
