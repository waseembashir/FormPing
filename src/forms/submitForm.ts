import type { Page } from 'playwright';
import type { AppConfig, FormCandidate } from '../types.js';
import { analyzePostSubmit } from './detectSuccess.js';
import type { SuccessDetectionResult } from './detectSuccess.js';
import { logger } from '../utils/logger.js';

export interface SubmitResult extends SuccessDetectionResult {
  submitted: boolean;
  timedOut: boolean;
}

export async function submitForm(
  page: Page,
  form: FormCandidate,
  initialUrl: string,
  config: AppConfig,
): Promise<SubmitResult> {
  const formIndex = form.index;

  // Find the submit button in this form
  const submitSelector = await page.evaluate((idx: number) => {
    const forms = Array.from(document.querySelectorAll('form'));
    const f = forms[idx];
    if (!f) return null;
    const btn =
      f.querySelector('button[type="submit"]') ??
      f.querySelector('input[type="submit"]') ??
      f.querySelector('button:not([type])');
    if (!btn) return null;

    // Build a unique selector
    if (btn.id) return `#${btn.id}`;
    const tag = btn.tagName.toLowerCase();
    const type = (btn as HTMLButtonElement).type || '';
    // fallback: use nth-of-type on the form
    return null; // will use page.locator approach instead
  }, formIndex);

  let submitted = false;
  let timedOut = false;

  try {
    if (submitSelector) {
      logger.debug(`Clicking submit: ${submitSelector}`);
      await Promise.all([
        page.waitForNavigation({ timeout: config.navigationTimeout, waitUntil: 'domcontentloaded' }).catch(() => {}),
        page.click(submitSelector),
      ]);
      submitted = true;
    } else {
      // Locate submit button within the nth form
      const forms = page.locator('form');
      const targetForm = forms.nth(formIndex);
      const submitBtn = targetForm
        .locator('button[type="submit"], input[type="submit"], button:not([type])')
        .first();

      const count = await submitBtn.count();
      if (count === 0) {
        logger.warn(`No submit button found in form[${formIndex}]`);
        return buildResult(false, false, page, initialUrl, config, ['No submit button found']);
      }

      logger.debug('Clicking submit button via locator');
      await Promise.all([
        page.waitForNavigation({ timeout: config.navigationTimeout, waitUntil: 'domcontentloaded' }).catch(() => {}),
        submitBtn.click(),
      ]);
      submitted = true;
    }

    // Wait briefly for any JS-driven inline state change
    await page.waitForTimeout(1500);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('Timeout') || msg.includes('timeout')) {
      timedOut = true;
      logger.warn('Navigation timed out after submit — checking page state');
    } else {
      logger.error(`Submit error: ${err}`);
    }
  }

  return buildResult(submitted, timedOut, page, initialUrl, config, []);
}

async function buildResult(
  submitted: boolean,
  timedOut: boolean,
  page: Page,
  initialUrl: string,
  config: AppConfig,
  extraNotes: string[],
): Promise<SubmitResult> {
  const finalUrl = page.url();
  let pageHtml = '';
  let pageText = '';
  let pageTitle = '';

  try {
    pageHtml = await page.content();
    pageText = await page.evaluate(() => document.body?.innerText ?? '');
    pageTitle = await page.title();
  } catch {
    // page may have navigated away or closed
  }

  const analysis = analyzePostSubmit(finalUrl, initialUrl, pageHtml, pageText, pageTitle, config);

  return {
    ...analysis,
    submitted,
    timedOut,
    notes: [...analysis.notes, ...extraNotes],
  };
}
