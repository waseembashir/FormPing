import { describe, it, expect } from 'vitest';

// We test the scoring logic by importing the private-ish internals
// via a small adapter. In a larger codebase these would be exported testably.
// Here we test the heuristic patterns directly.

import { DEFAULT_CONFIG } from '../src/config.js';
import { detectSuccessFromUrl, detectInlineSuccess, detectValidationError, detectCaptcha, detectAntiBot } from '../src/forms/detectSuccess.js';

describe('detectSuccessFromUrl', () => {
  const cfg = DEFAULT_CONFIG;

  it('detects /thank-you URL', () => {
    expect(detectSuccessFromUrl('https://example.com/thank-you', cfg)).toBe(true);
  });

  it('detects /thankyou URL', () => {
    expect(detectSuccessFromUrl('https://example.com/thankyou', cfg)).toBe(true);
  });

  it('detects /success URL', () => {
    expect(detectSuccessFromUrl('https://example.com/success/', cfg)).toBe(true);
  });

  it('detects /submitted URL', () => {
    expect(detectSuccessFromUrl('https://example.com/submitted', cfg)).toBe(true);
  });

  it('detects /confirmation URL', () => {
    expect(detectSuccessFromUrl('https://example.com/confirmation?id=123', cfg)).toBe(true);
  });

  it('does not detect a normal contact URL', () => {
    expect(detectSuccessFromUrl('https://example.com/contact', cfg)).toBe(false);
  });

  it('does not detect homepage', () => {
    expect(detectSuccessFromUrl('https://example.com/', cfg)).toBe(false);
  });
});

describe('detectInlineSuccess', () => {
  const cfg = DEFAULT_CONFIG;

  it('detects "thank you" text', () => {
    expect(detectInlineSuccess('Thank you for reaching out!', cfg)).toBe(true);
  });

  it('detects "thanks for contacting us"', () => {
    expect(detectInlineSuccess('Thanks for contacting us. We will reply soon.', cfg)).toBe(true);
  });

  it('detects "message sent"', () => {
    expect(detectInlineSuccess('Your message has been sent.', cfg)).toBe(true);
  });

  it('detects "we will be in touch"', () => {
    expect(detectInlineSuccess("We'll be in touch with you shortly.", cfg)).toBe(true);
  });

  it('detects "submission received"', () => {
    expect(detectInlineSuccess('Submission received — expect a reply within 24 hours.', cfg)).toBe(true);
  });

  it('detects "get back to you"', () => {
    expect(detectInlineSuccess('We will get back to you as soon as possible.', cfg)).toBe(true);
  });

  it('does not detect neutral contact page text', () => {
    expect(detectInlineSuccess('Contact us today for more information.', cfg)).toBe(false);
  });
});

describe('detectValidationError', () => {
  const cfg = DEFAULT_CONFIG;

  it('detects "this field is required"', () => {
    expect(detectValidationError('This field is required.', cfg)).toBe(true);
  });

  it('detects "please enter a valid email"', () => {
    expect(detectValidationError('Please enter a valid email address.', cfg)).toBe(true);
  });

  it('detects "cannot be empty"', () => {
    expect(detectValidationError('Name cannot be empty', cfg)).toBe(true);
  });

  it('does not flag normal success text', () => {
    // "thank you" doesn't contain validation error patterns
    expect(detectValidationError('Thank you for your message!', cfg)).toBe(false);
  });
});

describe('detectCaptcha', () => {
  const cfg = DEFAULT_CONFIG;

  it('detects g-recaptcha in HTML', () => {
    expect(detectCaptcha('<div class="g-recaptcha" data-sitekey="xyz"></div>', cfg)).toBe(true);
  });

  it('detects hcaptcha', () => {
    expect(detectCaptcha('<div class="h-captcha"></div>', cfg)).toBe(true);
  });

  it('detects I am not a robot text', () => {
    expect(detectCaptcha('I am not a robot', cfg)).toBe(true);
  });

  it('does not flag clean form HTML', () => {
    expect(detectCaptcha('<form><input type="text" name="name"></form>', cfg)).toBe(false);
  });
});

describe('detectAntiBot', () => {
  const cfg = DEFAULT_CONFIG;

  it('detects Cloudflare challenge page', () => {
    expect(
      detectAntiBot('<html>Checking your browser... Cloudflare</html>', 'Just a moment...', cfg),
    ).toBe(true);
  });

  it('detects "just a moment" title (Cloudflare)', () => {
    expect(detectAntiBot('<html>normal</html>', 'Just a moment...', cfg)).toBe(true);
  });

  it('detects DDoS-Guard', () => {
    expect(detectAntiBot('<html>ddos-guard protection</html>', 'Protected', cfg)).toBe(true);
  });

  it('does not flag normal page', () => {
    expect(detectAntiBot('<html>Contact Us</html>', 'Contact Us - Acme Corp', cfg)).toBe(false);
  });
});
