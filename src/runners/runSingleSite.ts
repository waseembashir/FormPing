import type { Browser } from 'playwright';
import type { AppConfig, SiteResult } from '../types.js';
import { normalizeUrl } from '../utils/url.js';
import { findContactPage } from '../discovery/findContactPage.js';
import { findContactForm } from '../forms/findContactForm.js';
import { fillForm } from '../forms/fillForm.js';
import { submitForm } from '../forms/submitForm.js';
import { detectCaptcha, detectAntiBot } from '../forms/detectSuccess.js';
import { newPage, closePage } from '../browser/playwrightClient.js';
import { logger } from '../utils/logger.js';

function makeErrorResult(
  inputUrl: string,
  normalizedUrl: string,
  config: AppConfig,
  err: unknown,
): SiteResult {
  return {
    inputUrl,
    normalizedUrl,
    mode: config.mode,
    resolvedContactPage: null,
    contactPageFound: false,
    contactPageConfidence: 0,
    formFound: false,
    formConfidence: 0,
    formIdentifier: null,
    submissionAttempted: false,
    submissionResult: 'not_attempted',
    redirectUrl: null,
    finalUrl: null,
    thankYouDetected: false,
    inlineSuccessDetected: false,
    captchaDetected: false,
    antiBotDetected: false,
    finalStatus: 'error',
    reasonCode: 'ERROR',
    notes: [String(err)],
    errors: [String(err)],
    durationMs: 0,
    error: String(err),
  };
}

export async function runSingleSite(
  inputUrl: string,
  browser: Browser,
  config: AppConfig,
): Promise<SiteResult> {
  const start = Date.now();
  const normalizedUrl = normalizeUrl(inputUrl);
  logger.info(`▶ Running: ${normalizedUrl} [mode=${config.mode}]`);

  const baseResult: Omit<SiteResult, 'finalStatus' | 'reasonCode' | 'durationMs'> = {
    inputUrl,
    normalizedUrl,
    mode: config.mode,
    resolvedContactPage: null,
    contactPageFound: false,
    contactPageConfidence: 0,
    formFound: false,
    formConfidence: 0,
    formIdentifier: null,
    submissionAttempted: false,
    submissionResult: 'not_attempted',
    redirectUrl: null,
    finalUrl: null,
    thankYouDetected: false,
    inlineSuccessDetected: false,
    captchaDetected: false,
    antiBotDetected: false,
    notes: [],
    errors: [],
  };

  try {
    // ── Step 1: Find contact page ────────────────────────────────────────────
    const { candidate, allCandidates, usedAiFallback } = await findContactPage(
      normalizedUrl,
      browser,
      config,
    );

    if (!candidate) {
      logger.warn(`No contact page found for ${normalizedUrl}`);
      return {
        ...baseResult,
        finalStatus: 'fail',
        reasonCode: 'CONTACT_PAGE_NOT_FOUND',
        notes: [`Tried ${allCandidates.length} candidate(s), none passed scoring`],
        durationMs: Date.now() - start,
      };
    }

    baseResult.resolvedContactPage = candidate.url;
    baseResult.contactPageFound = true;
    baseResult.contactPageConfidence = Math.min(
      Math.max(candidate.totalScore ?? candidate.score / 5, 0),
      1,
    );
    if (usedAiFallback) baseResult.notes.push('Used AI fallback for contact page selection');

    logger.info(`Contact page: ${candidate.url} (confidence=${baseResult.contactPageConfidence.toFixed(2)})`);

    if (config.mode === 'detect-only') {
      return {
        ...baseResult,
        finalUrl: candidate.url,
        finalStatus: 'warn',
        reasonCode: 'DETECT_ONLY',
        notes: [...baseResult.notes, 'detect-only mode: no form interaction'],
        durationMs: Date.now() - start,
      };
    }

    // ── Step 2: Load contact page in Playwright ──────────────────────────────
    const { context, page } = await newPage(browser, config);
    try {
      await page.goto(candidate.url, { waitUntil: 'domcontentloaded' });

      // Check for anti-bot on the contact page itself
      const pageHtml = await page.content();
      const pageTitle = await page.title();
      const antiBotDetected = detectAntiBot(pageHtml, pageTitle, config);
      const captchaDetected = detectCaptcha(pageHtml, config);

      if (antiBotDetected) {
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected,
          antiBotDetected: true,
          finalStatus: 'fail',
          reasonCode: 'ANTI_BOT_DETECTED',
          notes: [`Anti-bot/challenge page detected at ${page.url()}`],
          durationMs: Date.now() - start,
        };
      }

      // ── Step 3: Find contact form ──────────────────────────────────────────
      const { form, allForms } = await findContactForm(page, config);

      if (!form) {
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected,
          finalStatus: 'fail',
          reasonCode: 'FORM_NOT_FOUND',
          notes: [
            ...baseResult.notes,
            `${allForms.length} form(s) found but none passed contact form scoring`,
          ],
          durationMs: Date.now() - start,
        };
      }

      const formConfidence = Math.min(Math.max(form.score / 75, 0), 1);
      baseResult.formFound = true;
      baseResult.formConfidence = formConfidence;
      baseResult.formIdentifier = form.identifier;

      logger.info(`Form found (confidence=${formConfidence.toFixed(2)}): ${JSON.stringify(form.identifier)}`);

      // ── Step 4: Fill form ──────────────────────────────────────────────────
      const {
        filledFields,
        skippedFields,
        errors: fillErrors,
        captchaDetected: fillCaptcha,
      } = await fillForm(page, form, config);
      baseResult.errors.push(...fillErrors);

      if (fillCaptcha) {
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected: true,
          finalStatus: 'fail',
          reasonCode: 'CAPTCHA_DETECTED',
          notes: ['CAPTCHA detected during form fill — submission aborted'],
          durationMs: Date.now() - start,
        };
      }

      if (filledFields.length === 0) {
        return {
          ...baseResult,
          finalUrl: page.url(),
          finalStatus: 'warn',
          reasonCode: 'REQUIRED_FIELDS_UNSUPPORTED',
          notes: [`All ${skippedFields.length} field(s) skipped — see errors for details`],
          durationMs: Date.now() - start,
        };
      }

      baseResult.notes.push(
        `Filled ${filledFields.length} field(s): ${filledFields.map((f) => f.label || f.type).join(', ')}`,
      );
      if (skippedFields.length > 0) {
        baseResult.notes.push(`Skipped ${skippedFields.length} field(s): ${skippedFields.join(', ')}`);
      }

      // ── Step 5: Submit (live mode only) ───────────────────────────────────
      if (config.mode === 'safe') {
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected,
          finalStatus: 'warn',
          reasonCode: 'SAFE_MODE_NO_SUBMIT',
          notes: [...baseResult.notes, 'safe mode: form filled but not submitted'],
          durationMs: Date.now() - start,
        };
      }

      // live mode — actually submit
      const contactPageUrl = page.url();
      baseResult.submissionAttempted = true;

      const submitResult = await submitForm(page, form, contactPageUrl, config);

      if (submitResult.captchaDetected) {
        return {
          ...baseResult,
          finalUrl: submitResult.finalUrl,
          captchaDetected: true,
          submissionResult: 'captcha_blocked',
          finalStatus: 'fail',
          reasonCode: 'CAPTCHA_DETECTED',
          notes: [...baseResult.notes, ...submitResult.notes],
          durationMs: Date.now() - start,
        };
      }

      if (submitResult.antiBotDetected) {
        return {
          ...baseResult,
          finalUrl: submitResult.finalUrl,
          antiBotDetected: true,
          submissionResult: 'anti_bot_blocked',
          finalStatus: 'fail',
          reasonCode: 'ANTI_BOT_DETECTED',
          notes: [...baseResult.notes, ...submitResult.notes],
          durationMs: Date.now() - start,
        };
      }

      if (!submitResult.submitted) {
        return {
          ...baseResult,
          finalUrl: submitResult.finalUrl,
          submissionResult: 'submit_failed',
          finalStatus: 'fail',
          reasonCode: 'SUBMIT_FAILED',
          notes: [...baseResult.notes, ...submitResult.notes],
          durationMs: Date.now() - start,
        };
      }

      if (submitResult.validationErrorDetected) {
        return {
          ...baseResult,
          finalUrl: submitResult.finalUrl,
          submissionResult: 'validation_error',
          finalStatus: 'fail',
          reasonCode: 'VALIDATION_ERROR',
          notes: [...baseResult.notes, ...submitResult.notes],
          durationMs: Date.now() - start,
        };
      }

      const redirectUrl = submitResult.finalUrl !== contactPageUrl ? submitResult.finalUrl : null;

      if (submitResult.thankYouDetected) {
        return {
          ...baseResult,
          finalUrl: submitResult.finalUrl,
          redirectUrl,
          thankYouDetected: true,
          submissionResult: 'success',
          finalStatus: 'pass',
          reasonCode: 'THANK_YOU_REDIRECT',
          notes: [...baseResult.notes, ...submitResult.notes],
          durationMs: Date.now() - start,
        };
      }

      if (submitResult.inlineSuccessDetected) {
        return {
          ...baseResult,
          finalUrl: submitResult.finalUrl,
          redirectUrl,
          inlineSuccessDetected: true,
          submissionResult: 'success',
          finalStatus: 'pass',
          reasonCode: 'INLINE_SUCCESS_ONLY',
          notes: [...baseResult.notes, ...submitResult.notes],
          durationMs: Date.now() - start,
        };
      }

      return {
        ...baseResult,
        finalUrl: submitResult.finalUrl,
        redirectUrl,
        submissionResult: 'success',
        finalStatus: 'fail',
        reasonCode: 'NO_REDIRECT_NO_SUCCESS',
        notes: [
          ...baseResult.notes,
          ...submitResult.notes,
          'Form submitted but no thank-you/success signal detected',
        ],
        durationMs: Date.now() - start,
      };
    } finally {
      await closePage(context);
    }
  } catch (err) {
    logger.error(`Unhandled error for ${normalizedUrl}: ${err}`);
    return {
      ...makeErrorResult(inputUrl, normalizedUrl, config, err),
      durationMs: Date.now() - start,
    };
  }
}
