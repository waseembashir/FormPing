import type { AppConfig } from '../types.js';
import { containsAny } from '../utils/text.js';

export interface SuccessDetectionResult {
  thankYouDetected: boolean;
  inlineSuccessDetected: boolean;
  validationErrorDetected: boolean;
  captchaDetected: boolean;
  antiBotDetected: boolean;
  finalUrl: string;
  pageTitle: string;
  notes: string[];
}

export function detectSuccessFromUrl(url: string, config: AppConfig): boolean {
  return config.thankYouUrlPatterns.some((p) => p.test(url));
}

export function detectInlineSuccess(pageText: string, config: AppConfig): boolean {
  return containsAny(pageText, config.inlineSuccessPatterns);
}

export function detectValidationError(pageText: string, config: AppConfig): boolean {
  return containsAny(pageText, config.validationErrorPatterns);
}

export function detectCaptcha(pageHtml: string, config: AppConfig): boolean {
  return containsAny(pageHtml, config.captchaPatterns);
}

/**
 * Strip <script>, <style> and <noscript> blocks so we only inspect markup the
 * user can actually see. Prevents challenge-related phrases that live inside a
 * site's own JavaScript (e.g. a Turnstile validation string like "please
 * complete the security check") from being mistaken for a real interstitial.
 */
function stripNonVisible(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
}

/**
 * True only when the page DISPLAYS a bot-challenge message. Genuine challenge
 * pages (Cloudflare "just a moment…", Sucuri / DDoS-Guard blocks) render their
 * text as visible body content, which survives stripNonVisible(); phrases baked
 * into the site's scripts do not — so a real page that merely *references* a
 * challenge string in its JS is no longer flagged as blocked.
 */
export function detectAntiBot(pageHtml: string, pageTitle: string, config: AppConfig): boolean {
  return (
    containsAny(stripNonVisible(pageHtml), config.antiBotPatterns) ||
    containsAny(pageTitle, config.antiBotPatterns)
  );
}

export function analyzePostSubmit(
  finalUrl: string,
  initialUrl: string,
  pageHtml: string,
  pageText: string,
  pageTitle: string,
  config: AppConfig,
): SuccessDetectionResult {
  const notes: string[] = [];

  const thankYouDetected = detectSuccessFromUrl(finalUrl, config);
  if (thankYouDetected) notes.push(`Thank-you URL pattern matched: ${finalUrl}`);

  const inlineSuccessDetected = detectInlineSuccess(pageText, config);
  if (inlineSuccessDetected) notes.push('Inline success message detected in page text');

  const validationErrorDetected = detectValidationError(pageText, config);
  if (validationErrorDetected) notes.push('Validation error text found on page');

  const captchaDetected = detectCaptcha(pageHtml, config);
  if (captchaDetected) notes.push('CAPTCHA widget detected');

  const antiBotDetected = detectAntiBot(pageHtml, pageTitle, config);
  if (antiBotDetected) notes.push(`Anti-bot/challenge page detected: "${pageTitle}"`);

  const urlChanged = finalUrl !== initialUrl;
  if (urlChanged && !thankYouDetected) notes.push(`URL changed to: ${finalUrl}`);

  return {
    thankYouDetected,
    inlineSuccessDetected,
    validationErrorDetected,
    captchaDetected,
    antiBotDetected,
    finalUrl,
    pageTitle,
    notes,
  };
}
