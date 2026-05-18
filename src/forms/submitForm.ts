import type { Page, Response } from 'playwright';
import type { AppConfig, FormCandidate } from '../types.js';
import { analyzePostSubmit } from './detectSuccess.js';
import type { SuccessDetectionResult } from './detectSuccess.js';
import { logger } from '../utils/logger.js';

export interface CapturedSubmitResponse {
  url: string;
  status: number;
  isJson: boolean;
  bodyPreview: string;
  /** Parsed verdict if the response body contained a common success/failure pattern. */
  outcome: 'success' | 'failure' | 'unknown';
}

export interface SubmitResult extends SuccessDetectionResult {
  submitted: boolean;
  timedOut: boolean;
  /** POST responses captured during submit — gives visibility into AJAX submissions. */
  capturedResponses: CapturedSubmitResponse[];
  /** Aggregated verdict across captured responses. Lets the runner detect AJAX-only successes. */
  ajaxOutcome: 'success' | 'failure' | 'unknown';
}

/** Hosts whose responses we ignore — analytics, ads, error trackers, etc. */
const IGNORED_HOST_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /facebook\.com/i,
  /facebook\.net/i,
  /doubleclick\.net/i,
  /hotjar\.com/i,
  /segment\.(com|io)/i,
  /mixpanel\.com/i,
  /sentry\.io/i,
  /bugsnag\.com/i,
  /datadoghq\.com/i,
  /amplitude\.com/i,
  /clarity\.ms/i,
];

/** Common JSON shapes returned by form plugins; parse to a normalized verdict. */
function parseJsonOutcome(body: string): 'success' | 'failure' | 'unknown' {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return 'unknown';
  }
  if (!json || typeof json !== 'object') return 'unknown';
  const j = json as Record<string, unknown>;

  // Truthy/falsy success flag — used by FluentForms, WPForms, Forminator
  if (j.success === true) return 'success';
  if (j.success === false) return 'failure';

  // Status string — used by Contact Form 7 ("mail_sent"/"mail_failed"/"spam"), Gravity Forms
  if (typeof j.status === 'string') {
    if (/^(success|ok|mail_sent|sent)$/i.test(j.status)) return 'success';
    if (/^(error|fail|mail_failed|spam|aborted|invalid)$/i.test(j.status)) return 'failure';
  }

  // Nested result.status — FluentForms newer responses
  if (j.result && typeof j.result === 'object') {
    const r = j.result as Record<string, unknown>;
    if (typeof r.status === 'string') {
      if (/^(success|ok)$/i.test(r.status)) return 'success';
      if (/^(error|fail)$/i.test(r.status)) return 'failure';
    }
  }

  // data.status — Ninja Forms
  if (j.data && typeof j.data === 'object') {
    const d = j.data as Record<string, unknown>;
    if (typeof d.status === 'string') {
      if (/^(success|ok)$/i.test(d.status)) return 'success';
      if (/^(error|fail)$/i.test(d.status)) return 'failure';
    }
  }

  return 'unknown';
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

  // ── Set up response capture BEFORE clicking submit ─────────────────────────
  // Many modern forms (FluentForms, CF7, WPForms, Gravity, Ninja) submit via
  // AJAX and never trigger a page navigation. The visible page won't change,
  // so the only way to know whether the submit actually went through is to
  // intercept the XHR/fetch response. This handler captures every POST
  // response during the submit window and parses common success/failure
  // patterns out of JSON bodies.
  const captured: CapturedSubmitResponse[] = [];
  const pendingBodyReads: Promise<void>[] = [];

  const responseHandler = (response: Response) => {
    const req = response.request();
    if (req.method() !== 'POST') return;

    const url = response.url();
    if (IGNORED_HOST_PATTERNS.some((p) => p.test(url))) return;

    const status = response.status();
    const contentType = response.headers()['content-type'] ?? '';
    const isJson = /json/i.test(contentType);

    // Read the body async — track the promise so we can drain before returning
    const bodyRead = (async () => {
      let bodyPreview = '';
      let outcome: 'success' | 'failure' | 'unknown' = 'unknown';
      try {
        const text = await response.text();
        bodyPreview = text.length > 500 ? text.slice(0, 500) + '...' : text;
        if (isJson) outcome = parseJsonOutcome(text);
      } catch {
        // Response body unavailable (CORS, navigation closed it, etc.) — leave defaults
      }
      // HTTP-level signal: any 4xx/5xx on a POST to the form's origin is the
      // server explicitly refusing the submission (anti-spam plugin, WAF
      // rule, validation error, nonce mismatch, etc.). Real-world example:
      // Hostinger returns 402 from wp-admin/admin-ajax.php for rejected
      // FluentForms submissions. Promote to failure unless the JSON body
      // somehow indicated success (rare but possible).
      if (status >= 400 && outcome !== 'success') outcome = 'failure';
      captured.push({ url, status, isJson, bodyPreview, outcome });
    })();
    pendingBodyReads.push(bodyRead);
  };
  page.on('response', responseHandler);

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
        page.off('response', responseHandler);
        return buildResult(false, false, page, initialUrl, config, ['No submit button found'], [], 'unknown');
      }

      logger.debug('Clicking submit button via locator');
      await Promise.all([
        page.waitForNavigation({ timeout: config.navigationTimeout, waitUntil: 'domcontentloaded' }).catch(() => {}),
        submitBtn.click(),
      ]);
      submitted = true;
    }

    // Wait for any JS-driven inline state change AND for AJAX responses to land
    await page.waitForTimeout(2500);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('Timeout') || msg.includes('timeout')) {
      timedOut = true;
      logger.warn('Navigation timed out after submit — checking page state');
    } else {
      logger.error(`Submit error: ${err}`);
    }
  } finally {
    page.off('response', responseHandler);
  }

  // Drain any in-flight body reads so `captured` is complete
  await Promise.all(pendingBodyReads).catch(() => { /* individual failures already swallowed above */ });

  // Aggregate the captured outcomes into a single verdict.
  // If ANY response indicates explicit success, treat overall as success.
  // Else if ANY indicates failure, overall failure. Else unknown.
  let ajaxOutcome: 'success' | 'failure' | 'unknown' = 'unknown';
  if (captured.some((r) => r.outcome === 'success')) ajaxOutcome = 'success';
  else if (captured.some((r) => r.outcome === 'failure')) ajaxOutcome = 'failure';

  if (captured.length > 0) {
    logger.info(
      `Submit captured ${captured.length} POST response(s), ajaxOutcome=${ajaxOutcome}`,
    );
    for (const r of captured) {
      logger.info(`  POST ${r.status} ${r.url} (${r.isJson ? 'json' : 'non-json'}) outcome=${r.outcome}`);
      if (r.bodyPreview) {
        logger.debug(`    body: ${r.bodyPreview.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    }
  }

  return buildResult(submitted, timedOut, page, initialUrl, config, [], captured, ajaxOutcome);
}

async function buildResult(
  submitted: boolean,
  timedOut: boolean,
  page: Page,
  initialUrl: string,
  config: AppConfig,
  extraNotes: string[],
  capturedResponses: CapturedSubmitResponse[],
  ajaxOutcome: 'success' | 'failure' | 'unknown',
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

  // Append captured-response diagnostics to the notes. Always include the
  // summary line; include per-response details when there's useful signal.
  const responseNotes: string[] = [];
  if (capturedResponses.length > 0) {
    responseNotes.push(
      `Captured ${capturedResponses.length} POST response(s) during submit (ajaxOutcome=${ajaxOutcome})`,
    );
    for (const r of capturedResponses) {
      const tag =
        r.outcome === 'success' ? '✓' : r.outcome === 'failure' ? '✗' : '·';
      // Trim long URLs to keep notes readable
      const shortUrl = r.url.length > 80 ? r.url.slice(0, 77) + '...' : r.url;
      responseNotes.push(`${tag} POST ${r.status} → ${shortUrl}`);
      // Only include body preview for failures or unknowns where it might help diagnose
      if (r.outcome !== 'success' && r.bodyPreview && r.bodyPreview.length > 0) {
        const oneLine = r.bodyPreview.replace(/\s+/g, ' ').slice(0, 200);
        responseNotes.push(`   body: ${oneLine}`);
      }
    }
  }

  return {
    ...analysis,
    submitted,
    timedOut,
    capturedResponses,
    ajaxOutcome,
    notes: [...analysis.notes, ...extraNotes, ...responseNotes],
  };
}
