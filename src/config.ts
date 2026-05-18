import type { AppConfig } from './types.js';
import type { MonitorOptions } from './monitor/types.js';

export const DEFAULT_MONITOR_OPTIONS: MonitorOptions = {
  maxPages: 10,
  takeScreenshots: false,
  aiProvider: 'off',
  watchIntervalMs: 60 * 60 * 1000, // 1 hour
  snapshotRoot: 'data/snapshots',
};

export const DEFAULT_CONFIG: AppConfig = {
  mode: 'safe',
  headless: true,
  // Modern marketing sites (Elementor / heavy Wordpress / Webflow with fonts
  // + analytics + chat widgets) routinely need 20-30s for DOMContentLoaded.
  // Previous 15s/20s defaults were timing out on legitimately-loading pages.
  timeout: 30000,
  navigationTimeout: 45000,
  batchConcurrency: 2,
  aiProvider: 'off',
  residentialFallback: false,
  saveScreenshotOnFailure: false,
  saveHtmlSnapshotOnFailure: false,
  prettyJson: false,

  testData: {
    fullName: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    email: 'formping-test@example.com',
    phone: '9999999999',
    company: 'Test Company',
    // Natural-sounding so Akismet and similar anti-spam filters don't auto-trash it.
    // Earlier wording ("automated test submission used to verify...") was getting
    // silently filtered server-side on WordPress/FluentForms sites.
    message:
      'Hi team, just sending a quick note through your contact form to make sure submissions are coming through on your end. Could you reply when you get a chance? Thanks!',
  },

  thankYouUrlPatterns: [
    /thank[-_]?you/i,
    /thankyou/i,
    /thank-you/i,
    /\/success(\/|$|\?)/i,
    /submitted/i,
    /confirmation/i,
    /\/sent(\/|$|\?)/i,
    /\/received(\/|$|\?)/i,
  ],

  inlineSuccessPatterns: [
    /thank\s+you/i,
    /thanks\s+for\s+(contacting|reaching|writing)/i,
    /message\s+(?:has\s+been\s+)?sent/i,
    /form\s+submitted/i,
    /we('ll|\s+will)\s+be\s+in\s+touch/i,
    /submission\s+received/i,
    /we\s+(?:have\s+)?received\s+your/i,
    /get\s+back\s+to\s+you/i,
    /shortly\s+be\s+in\s+contact/i,
    /contact\s+you\s+soon/i,
  ],

  validationErrorPatterns: [
    /this\s+field\s+is\s+required/i,
    /please\s+enter\s+a\s+valid/i,
    /is\s+required/i,
    /cannot\s+be\s+empty/i,
    /invalid\s+email/i,
    /error/i,
    /please\s+fill/i,
  ],

  captchaPatterns: [
    /recaptcha/i,
    /hcaptcha/i,
    /turnstile/i,
    /captcha/i,
    /i\s+am\s+not\s+a\s+robot/i,
    /verify\s+you('re|\s+are)\s+human/i,
  ],

  // Patterns that must appear in the HTML/title for a page to be considered
  // a bot challenge. We deliberately do NOT match bare brand names like
  // "cloudflare" or "akamai" — those appear on every site using those CDNs.
  // Match the *challenge page text* instead.
  antiBotPatterns: [
    /just\s+a\s+moment\.\.\./i,
    /checking\s+your\s+browser\s+before\s+accessing/i,
    /please\s+enable\s+javascript\s+and\s+cookies/i,
    /attention\s+required.*cloudflare/i,
    /cloudflare\s+ray\s+id:/i,
    /sorry,\s+you\s+have\s+been\s+blocked/i,
    /please\s+complete\s+the\s+security\s+check/i,
    /sucuri\s+website\s+firewall.*access\s+denied/i,
    /your\s+request\s+has\s+been\s+blocked.*(?:sucuri|akamai|reference)/i,
    /access\s+denied.*reference\s+#/i,
    /403\s+forbidden/i,
    /ddos[-_]?guard/i,
    /challenge[-_]?platform/i,
    /bot\s+detection/i,
  ],

  contactPathPatterns: [
    /\/contact(\/|$|\?)/i,
    /\/contact[-_]us(\/|$|\?)/i,
    /\/get[-_]in[-_]touch(\/|$|\?)/i,
    /\/reach[-_]us(\/|$|\?)/i,
    /\/support\/contact(\/|$|\?)/i,
    /\/contactus(\/|$|\?)/i,
    /\/talk[-_]to[-_]us(\/|$|\?)/i,
    /\/write[-_]to[-_]us(\/|$|\?)/i,
  ],

  excludePathPatterns: [
    /\/login/i,
    /\/signup/i,
    /\/sign[-_]up/i,
    /\/register/i,
    /\/cart/i,
    /\/checkout/i,
    /\/account/i,
    /\/privacy/i,
    /\/terms/i,
    /\/blog\//i,
    /\/news\//i,
    /\/article\//i,
    /\/post\//i,
    /\/search/i,
    /\/category\//i,
    /\/tag\//i,
    /\/product\//i,
    /\/shop\//i,
  ],

  contactTextPatterns: [
    /^contact(\s+us)?$/i,
    /get\s+in\s+touch/i,
    /talk\s+to\s+us/i,
    /reach\s+us/i,
    /write\s+to\s+us/i,
    /send\s+(us\s+)?a\s+message/i,
    /contact\s+support/i,
  ],
};
