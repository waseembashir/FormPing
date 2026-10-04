/**
 * How the engine decides which page to test.
 *
 * This is the first decision a run makes and the one with the longest reach: a
 * run tests ONE page, and everything downstream — the form chosen, the fields
 * reported, the verdict, the screenshot, the alert — describes whichever page
 * this picked. Get it wrong and every later layer is correct about the wrong
 * thing.
 *
 * It had no tests at all, which is how a run asked for `/contact-sales` came to
 * test `/contact` instead and report a different form's facts beside the first
 * one's name. The behaviour may well be right — a crawl is supposed to find the
 * best contact page — but nothing recorded what "best" meant, so nothing could
 * be argued with.
 *
 * These assert the engine's CONCLUSIONS on fixed markup: no browser, no
 * network, no site touched.
 */

import { describe, it, expect } from 'vitest';
import { scorePageContent, rankCandidate } from '../../src/discovery/findContactPage.js';

const page = (body: string, title = 'Example') =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

const CONTACT_FORM = `
  <h1>Get in touch</h1>
  <form>
    <input name="name" />
    <input type="email" name="email" />
    <textarea name="message"></textarea>
    <button type="submit">Send</button>
  </form>`;

describe('a page that is obviously a contact page', () => {
  it('scores well above one that is obviously not', () => {
    const contact = scorePageContent(page(CONTACT_FORM, 'Contact Us'), 'https://x.com/contact');
    const about = scorePageContent(page('<h1>Our story</h1><p>We began in 2011.</p>'), 'https://x.com/about');

    expect(contact.score).toBeGreaterThan(about.score);
  });

  it('explains itself, so a surprising result can be argued with', () => {
    // A score with no account of itself is untraceable, and this one routinely
    // surprises: pages lose to rivals for reasons nobody would guess.
    const { signals } = scorePageContent(page(CONTACT_FORM, 'Contact Us'), 'https://x.com/contact');

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.join(' ')).toMatch(/form/i);
  });

  it('never exceeds 1, however many signals a page piles up', () => {
    // The result is weighted against a link score that is also 0..1. An
    // unbounded page score would quietly make the link half meaningless.
    const everything = scorePageContent(
      page(
        `<h1>Contact us</h1>${CONTACT_FORM}
         <p>Call 020 7946 0123 — 12 High Street, London</p>
         <iframe src="https://google.com/maps/embed"></iframe>`,
        'Contact Us — Get in touch',
      ),
      'https://x.com/contact-us',
    );
    expect(everything.score).toBeLessThanOrEqual(1);
    expect(everything.score).toBeGreaterThan(0.5);
  });
});

describe('what actually earns a page its score', () => {
  it('counts a form, and the fields that make it a contact form', () => {
    const withForm = scorePageContent(page(CONTACT_FORM), 'https://x.com/x');
    const without = scorePageContent(page('<h1>Get in touch</h1>'), 'https://x.com/x');

    expect(withForm.score).toBeGreaterThan(without.score);
    expect(withForm.signals.join(' ')).toMatch(/email field/i);
  });

  it('rewards the URL saying contact, but not enough to win alone', () => {
    // A path is a claim; the markup is the evidence. A page whose only
    // qualification is its URL must not beat one carrying an actual form.
    const urlOnly = scorePageContent(page('<h1>Careers</h1><p>Join us.</p>'), 'https://x.com/contact');
    const formElsewhere = scorePageContent(page(CONTACT_FORM), 'https://x.com/support');

    expect(formElsewhere.score).toBeGreaterThan(urlOnly.score);
  });

  it('gives a page with no contact signals nothing', () => {
    const { score, signals } = scorePageContent(page('<h1>Privacy policy</h1><p>We store data.</p>'), 'https://x.com/privacy');
    expect(score).toBe(0);
    expect(signals).toEqual([]);
  });
});

describe('combining the link with the page it points at', () => {
  it('lets the page outweigh the link that led to it', () => {
    // The whole point of visiting a candidate is that the markup can overrule
    // the promise. A perfect link to an empty page must lose to a weak link to
    // a real contact page.
    const perfectLinkEmptyPage = rankCandidate(5, 0);
    const weakLinkRealPage = rankCandidate(1, 0.9);

    expect(weakLinkRealPage).toBeGreaterThan(perfectLinkEmptyPage);
  });

  it('still lets the link count for something', () => {
    // Two identical pages, one linked as "Contact" and one stumbled upon: the
    // one the site itself points at as its contact page should win.
    expect(rankCandidate(5, 0.5)).toBeGreaterThan(rankCandidate(0, 0.5));
  });

  it('normalises the link score, so a strong link cannot swamp the page', () => {
    // The raw link score has its own scale (path +3, text +2). Left unnormalised
    // it would dwarf a page score that can only ever reach 1.
    expect(rankCandidate(5, 1)).toBeLessThanOrEqual(1);
    expect(rankCandidate(50, 1)).toBeLessThanOrEqual(1);
  });

  it('treats a nonsensical link score as no worse than none', () => {
    // Scores arrive from a crawl, not from a test. A negative must not drag a
    // good page below a bad one.
    expect(rankCandidate(-10, 0.8)).toBe(rankCandidate(0, 0.8));
  });
});
