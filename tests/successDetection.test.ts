import { describe, it, expect } from 'vitest';
import { analyzePostSubmit } from '../src/forms/detectSuccess.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const cfg = DEFAULT_CONFIG;

describe('analyzePostSubmit', () => {
  it('detects thank-you redirect when URL changes to /thank-you', () => {
    const result = analyzePostSubmit(
      'https://example.com/thank-you',
      'https://example.com/contact',
      '<html>Thank you for your message</html>',
      'Thank you for your message',
      'Thank You | Example',
      cfg,
    );
    expect(result.thankYouDetected).toBe(true);
    expect(result.inlineSuccessDetected).toBe(true);
    expect(result.validationErrorDetected).toBe(false);
    expect(result.captchaDetected).toBe(false);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('detects only inline success when URL stays the same', () => {
    const result = analyzePostSubmit(
      'https://example.com/contact',
      'https://example.com/contact',
      '<html><div class="success">Message sent successfully!</div></html>',
      'Message sent successfully!',
      'Contact Us',
      cfg,
    );
    expect(result.thankYouDetected).toBe(false);
    expect(result.inlineSuccessDetected).toBe(true);
  });

  it('detects validation error on unchanged URL with error text', () => {
    const result = analyzePostSubmit(
      'https://example.com/contact',
      'https://example.com/contact',
      '<html><span class="error">This field is required.</span></html>',
      'Contact Us This field is required.',
      'Contact Us',
      cfg,
    );
    expect(result.validationErrorDetected).toBe(true);
    expect(result.thankYouDetected).toBe(false);
    expect(result.inlineSuccessDetected).toBe(false);
  });

  it('detects captcha when recaptcha div present', () => {
    const result = analyzePostSubmit(
      'https://example.com/contact',
      'https://example.com/contact',
      '<html><div class="g-recaptcha"></div></html>',
      'Contact form',
      'Contact',
      cfg,
    );
    expect(result.captchaDetected).toBe(true);
  });

  it('detects anti-bot when Cloudflare challenge page', () => {
    const result = analyzePostSubmit(
      'https://example.com/contact',
      'https://example.com/contact',
      '<html>Checking your browser... powered by Cloudflare</html>',
      'Checking your browser...',
      'Just a moment...',
      cfg,
    );
    expect(result.antiBotDetected).toBe(true);
  });

  it('returns no detections for a plain page with no signals', () => {
    const result = analyzePostSubmit(
      'https://example.com/contact',
      'https://example.com/contact',
      '<html><body><form><input/></form></body></html>',
      'Contact page content',
      'Contact Us',
      cfg,
    );
    expect(result.thankYouDetected).toBe(false);
    expect(result.inlineSuccessDetected).toBe(false);
    expect(result.validationErrorDetected).toBe(false);
    expect(result.captchaDetected).toBe(false);
    expect(result.antiBotDetected).toBe(false);
  });

  it('includes note about URL change when URL changes without thank-you pattern', () => {
    const result = analyzePostSubmit(
      'https://example.com/new-page',
      'https://example.com/contact',
      '<html>Some other page</html>',
      'Some other page',
      'New Page',
      cfg,
    );
    expect(result.notes.some((n) => n.includes('URL changed'))).toBe(true);
  });

  it('correctly populates finalUrl and pageTitle', () => {
    const result = analyzePostSubmit(
      'https://example.com/sent',
      'https://example.com/contact',
      '<html>Message sent</html>',
      'Message sent',
      'Sent | Example',
      cfg,
    );
    expect(result.finalUrl).toBe('https://example.com/sent');
    expect(result.pageTitle).toBe('Sent | Example');
  });
});
