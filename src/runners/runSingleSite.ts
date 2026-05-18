import type { Browser } from 'playwright';
import type { AppConfig, SiteResult } from '../types.js';
import { normalizeUrl } from '../utils/url.js';
import { findContactPage } from '../discovery/findContactPage.js';
import { findContactForm } from '../forms/findContactForm.js';
import { fillForm } from '../forms/fillForm.js';
import { submitForm } from '../forms/submitForm.js';
import { detectCaptcha, detectAntiBot } from '../forms/detectSuccess.js';
import {
  newPage,
  closePage,
  connectResidentialBrowser,
  hasBrowserbaseCreds,
  launchProxiedBrowser,
  hasResidentialProxyCreds,
} from '../browser/playwrightClient.js';
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
    const { candidate, allCandidates, usedAiFallback, blockedByHost, diagnostic } =
      await findContactPage(normalizedUrl, browser, config);

    if (!candidate) {
      logger.warn(`No contact page found for ${normalizedUrl}`);
      const diagNotes: string[] = [];
      if (diagnostic) {
        diagNotes.push(`Lightweight fetch returned ${diagnostic.lightweightBytes}B`);
        if (diagnostic.playwrightBytes !== null)
          diagNotes.push(`Playwright fetch returned ${diagnostic.playwrightBytes}B`);
        if (diagnostic.retryBytes !== null)
          diagNotes.push(`Retry fetch returned ${diagnostic.retryBytes}B`);
      }
      if (blockedByHost) {
        // Distinguish "tiny/stripped response" from "no response at all" —
        // both are hosting-provider IP-block signatures, but the user
        // experience differs and the note should reflect what actually happened.
        const allZero =
          diagnostic &&
          diagnostic.lightweightBytes === 0 &&
          diagnostic.playwrightBytes === 0;
        return {
          ...baseResult,
          finalStatus: 'warn',
          reasonCode: 'BLOCKED_BY_HOST',
          notes: [
            allZero
              ? 'The site did not respond to any fetch attempt from this cloud IP (connection held open until timeout).'
              : 'Every attempt to load the homepage returned a tiny / stripped response.',
            ...diagNotes,
            'Hosting providers like Hostinger, Bluehost, GoDaddy, etc. routinely block cloud-IP traffic. Run FormPing from a residential network for sites with this protection.',
          ],
          durationMs: Date.now() - start,
        };
      }
      return {
        ...baseResult,
        finalStatus: 'fail',
        reasonCode: 'CONTACT_PAGE_NOT_FOUND',
        notes: [
          `Tried ${allCandidates.length} candidate(s), none passed scoring`,
          ...diagNotes,
        ],
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
      // Use 'domcontentloaded' (not 'load') — many sites have slow async
      // resources (analytics pixels, fonts, third-party widgets) that delay
      // the 'load' event past our timeout. JS-rendered forms (Elementor,
      // FluentForms, Webflow, React SPAs) are still handled by the
      // networkidle + waitForSelector waits below.
      await page.goto(candidate.url, { waitUntil: 'domcontentloaded' });

      // Give the network a brief chance to settle so JS-rendered forms appear.
      // We don't strictly require networkidle (some sites have long-polling
      // analytics that never go idle) — capped at 3.5s, ignore timeout.
      await page.waitForLoadState('networkidle', { timeout: 3500 }).catch(() => { /* ignore */ });

      // Explicitly wait for at least one <form> to be in the DOM (capped).
      // This is the most reliable signal that the page is "ready" for our
      // form-detection logic. If still no form appears, we proceed and report
      // FORM_NOT_FOUND as before.
      await page.waitForSelector('form', { timeout: 5000 }).catch(() => { /* ignore */ });

      // Diagnostic: what did Playwright actually see on this page?
      let pageHtml = await page.content();
      let pageTitle = await page.title();
      let formTagCount = (pageHtml.match(/<form\b/gi) ?? []).length;
      let visibleFormCount = await page.locator('form').count().catch(() => -1);
      logger.info(
        `Contact page loaded: url=${page.url()} title="${pageTitle.slice(0, 60)}" ` +
          `htmlSize=${pageHtml.length}B formTagsInHtml=${formTagCount} ` +
          `formLocatorCount=${visibleFormCount}`,
      );

      // If we got an empty page (CDN often returns this to bot IPs), warn loudly
      if (pageHtml.length < 2000) {
        logger.warn(
          `Contact page HTML is suspiciously small (${pageHtml.length}B) — likely a CDN ` +
            `challenge / WAF block. Dump: ${pageHtml.slice(0, 300).replace(/\s+/g, ' ')}`,
        );
      }

      // Second-chance: if no forms appeared after our waits, reload the page
      // and try once more. Often cures transient caching / partial-response
      // issues (especially LiteSpeed Cache miss → re-fetch → cache hit).
      if (formTagCount === 0) {
        logger.warn(
          `No <form> tags in contact page DOM after initial waits — reloading and trying once more`,
        );
        await new Promise((r) => setTimeout(r, 1500));
        try {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => { /* ignore */ });
          await page.waitForSelector('form', { timeout: 6000 }).catch(() => { /* ignore */ });
          pageHtml = await page.content();
          pageTitle = await page.title();
          formTagCount = (pageHtml.match(/<form\b/gi) ?? []).length;
          visibleFormCount = await page.locator('form').count().catch(() => -1);
          logger.info(
            `Contact page reload: htmlSize=${pageHtml.length}B ` +
              `formTagsInHtml=${formTagCount} formLocatorCount=${visibleFormCount}`,
          );
        } catch (err) {
          logger.warn(`Reload retry failed: ${err}`);
        }
      }

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
        // If the contact page itself looks like a hosting-provider block
        // page (tiny response or no real markup), surface BLOCKED_BY_HOST
        // instead of FORM_NOT_FOUND — way more actionable for the user.
        const contactPageLooksBlocked =
          pageHtml.length < 2000 ||
          (pageHtml.length < 20000 && formTagCount === 0 && !/<nav|<main|<article/i.test(pageHtml));
        if (contactPageLooksBlocked) {
          return {
            ...baseResult,
            finalUrl: page.url(),
            captchaDetected,
            finalStatus: 'warn',
            reasonCode: 'BLOCKED_BY_HOST',
            notes: [
              ...baseResult.notes,
              `Contact page response from cloud IP is suspiciously thin (${pageHtml.length}B, ${formTagCount} form tags).`,
              'Hosting providers like Hostinger, Bluehost, GoDaddy, etc. often serve different content to cloud-host IPs.',
              'Run FormPing from a residential network (your local machine) for sites with this protection.',
            ],
            durationMs: Date.now() - start,
          };
        }
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected,
          finalStatus: 'fail',
          reasonCode: 'FORM_NOT_FOUND',
          notes: [
            ...baseResult.notes,
            `${allForms.length} form(s) found but none passed contact form scoring (contact page was ${pageHtml.length}B, ${formTagCount} <form> tags in HTML)`,
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
        honeypotsSkipped,
        honeypotProvider,
        honeypotReason,
        stepsTraversed,
        captchaState,
      } = await fillForm(page, form, config);
      baseResult.errors.push(...fillErrors);

      // Surface honeypot detection in the result notes so users see the AI
      // contributed to a clean submission. Helps users trust the AI feature.
      if (honeypotsSkipped.length > 0) {
        baseResult.notes.push(
          `AI (${honeypotProvider}) flagged ${honeypotsSkipped.length} likely honeypot field(s) and skipped them: ${honeypotsSkipped.join(', ')}` +
            (honeypotReason ? ` — ${honeypotReason}` : ''),
        );
      }

      // Multi-step diagnostic: only surface when we actually advanced past
      // step 1, so we don't clutter notes on every single-step form.
      if (stepsTraversed > 1) {
        baseResult.notes.push(
          `Multi-step form: traversed ${stepsTraversed} step(s) before reaching submit`,
        );
      }

      // Surface auto-solved CAPTCHAs so the user can see FormPing got past
      // them rather than aborting. Pending CAPTCHAs would have set
      // fillCaptcha=true already (handled below).
      const solvedCaptchas = (Object.entries(captchaState) as Array<[string, string]>)
        .filter(([_, v]) => v === 'solved')
        .map(([k]) => k);
      if (solvedCaptchas.length > 0) {
        baseResult.notes.push(
          `Auto-solved CAPTCHA on final step: ${solvedCaptchas.join(', ')} (invisible/trusted-browser mode)`,
        );
      }

      if (fillCaptcha) {
        const pendingTypes = (Object.entries(captchaState) as Array<[string, string]>)
          .filter(([_, v]) => v === 'pending')
          .map(([k]) => k);
        const captchaSummary =
          pendingTypes.length === 1
            ? `${pendingTypes[0]} (interactive challenge required)`
            : `${pendingTypes.join(' + ')} (interactive challenges required)`;
        const stepLabel =
          stepsTraversed > 1
            ? `reached step ${stepsTraversed} (final), filled ${filledFields.length} field${filledFields.length === 1 ? '' : 's'} across all steps`
            : `${filledFields.length} field${filledFields.length === 1 ? '' : 's'} filled before CAPTCHA was detected`;

        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected: true,
          finalStatus: 'fail',
          reasonCode: 'CAPTCHA_DETECTED',
          notes: [
            ...baseResult.notes,
            `${stepLabel} — but ${captchaSummary} blocked submission.`,
            'Headless automation cannot pass interactive CAPTCHAs by design. To get a successful end-to-end run: disable CAPTCHA on the target site in staging, use a paid CAPTCHA-solving service (Browserbase Developer Plan, 2Captcha, NopeCHA), or test against a non-CAPTCHA-protected environment.',
          ],
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

      // ── AJAX response verdict ──────────────────────────────────────────────
      // Many form plugins submit via AJAX and never trigger a URL change or
      // visible success element. The submitForm wrapper inspected the XHR
      // response bodies for common success/failure JSON shapes — use that as
      // a definitive signal when neither URL nor DOM detection fired.
      if (submitResult.ajaxOutcome === 'success') {
        return {
          ...baseResult,
          finalUrl: submitResult.finalUrl,
          redirectUrl,
          inlineSuccessDetected: true,
          submissionResult: 'success',
          finalStatus: 'pass',
          reasonCode: 'INLINE_SUCCESS_ONLY',
          notes: [
            ...baseResult.notes,
            ...submitResult.notes,
            'Success detected via AJAX response body (no URL change or visible success element)',
          ],
          durationMs: Date.now() - start,
        };
      }

      if (submitResult.ajaxOutcome === 'failure') {
        // Pick the most specific reason code based on the HTTP status of
        // the failing response. Different status codes tell different
        // stories — surfacing the right one means the UI can render an
        // accurate banner instead of a generic "submit failed".
        const statuses = submitResult.capturedResponses.map((r) => r.status);
        const hasAntiSpamStatus = statuses.some((s) => s === 402 || s === 403 || s === 429);
        const hasValidationStatus = statuses.some((s) => s === 400 || s === 422);

        let reasonCode: SiteResult['reasonCode'] = 'SUBMIT_FAILED';
        let explanation =
          'AJAX response explicitly reported failure — submission was rejected server-side.';

        if (hasAntiSpamStatus) {
          reasonCode = 'SUBMISSION_BLOCKED_BY_ANTISPAM';
          const statusStr = statuses.filter((s) => s === 402 || s === 403 || s === 429).join('/');
          explanation =
            `Server returned HTTP ${statusStr} for the form submission — this is the signature of an anti-spam ` +
            `or WAF block (Akismet, Wordfence, Hostinger anti-spam, FluentForms honeypot, etc.). ` +
            'The site is actively protecting against automated submissions. ' +
            'To get the submission through: disable the relevant anti-spam plugin on the target site, ' +
            'or whitelist FormPing\'s residential proxy IPs in the site\'s firewall.';
        } else if (hasValidationStatus) {
          reasonCode = 'VALIDATION_ERROR';
          const statusStr = statuses.filter((s) => s === 400 || s === 422).join('/');
          explanation =
            `Server returned HTTP ${statusStr} for the form submission — typically a validation error. ` +
            'Required fields may be missing values, or a value didn\'t match the expected format.';
        }

        // AI diagnosis — picks the failing response with the most diagnostic
        // value (largest body or non-2xx status) and asks AI to categorize.
        // Can promote a misclassified "antispam" to "proxy_block" when the
        // body actually contains Bright Data / Luminati / proxy provider
        // error signatures (which we can't reliably match with a regex without
        // false positives).
        const aiNotes: string[] = [];
        if (config.aiProvider !== 'off' && submitResult.capturedResponses.length > 0) {
          // Pick the most informative failing response — one with a body and
          // a 4xx/5xx status, preferring those with longer bodies (more signal).
          const failing = submitResult.capturedResponses
            .filter((r) => r.status >= 400 && r.bodyPreview)
            .sort((a, b) => b.bodyPreview.length - a.bodyPreview.length);
          const target = failing[0];

          if (target) {
            const { diagnoseSubmitFailure } = await import('../ai/aiClassifier.js');
            const diagnosis = await diagnoseSubmitFailure(
              target.status,
              target.url,
              target.bodyPreview,
              config.aiProvider,
            );

            if (diagnosis) {
              aiNotes.push(
                `AI (${diagnosis.provider}) diagnosed failure as "${diagnosis.category}": ${diagnosis.explanation}`,
              );

              // Promote to more specific reason code when AI is highly
              // confident this is a proxy block (key insight that status
              // code alone can't reveal — both proxy and anti-spam often
              // use 402/403).
              if (diagnosis.category === 'proxy_block') {
                reasonCode = 'PROXY_REJECTED_POST';
                explanation =
                  'The proxy provider (not the target site) refused to forward the POST request. ' +
                  'See AI diagnosis below for specifics. Fix on the proxy side: complete KYC, ' +
                  'upgrade to a paid plan, or switch providers.';
              }
            }
          }
        }

        return {
          ...baseResult,
          finalUrl: submitResult.finalUrl,
          redirectUrl,
          submissionResult: 'submit_failed',
          finalStatus: 'fail',
          reasonCode,
          notes: [
            ...baseResult.notes,
            ...submitResult.notes,
            explanation,
            ...aiNotes,
          ],
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

/**
 * Run a single site, retrying once via a residential-IP browser if the direct
 * cloud-IP attempt returns BLOCKED_BY_HOST.
 *
 * Two transport options, picked in this order:
 *   1. Direct proxy (RESIDENTIAL_PROXY_URL) — cheaper, simpler, faster. Works
 *      with Webshare/IPRoyal/Smartproxy/any HTTP-or-SOCKS proxy.
 *   2. Browserbase (BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID) — hosted
 *      browser with built-in residential pool, per-session billing.
 *
 * Gated on:
 *   - config.residentialFallback === true (user opt-in)
 *   - At least one transport configured
 *   - First attempt was specifically BLOCKED_BY_HOST
 *
 * The proxied/hosted browser is always closed in `finally` so we don't leak
 * sessions (Browserbase) or open Chrome processes (direct proxy).
 */
export async function runSingleSiteWithResidentialFallback(
  inputUrl: string,
  browser: Browser,
  config: AppConfig,
): Promise<SiteResult> {
  const result = await runSingleSite(inputUrl, browser, config);

  // Loud, easy-to-grep diagnostics so we can tell from logs exactly which
  // branch the wrapper took. Without these we end up reverse-engineering
  // partial Railway logs to guess whether the retry fired.
  logger.info(
    `[RES-FALLBACK] first attempt reasonCode=${result.reasonCode}, residentialFallback=${config.residentialFallback}, ` +
      `proxyUrl=${process.env.RESIDENTIAL_PROXY_URL ? 'set' : 'unset'}, ` +
      `proxyUser=${process.env.RESIDENTIAL_PROXY_USER ? 'set' : 'unset'}, ` +
      `proxyPass=${process.env.RESIDENTIAL_PROXY_PASS ? 'set' : 'unset'}, ` +
      `browserbase=${hasBrowserbaseCreds() ? 'set' : 'unset'}`,
  );

  if (result.reasonCode !== 'BLOCKED_BY_HOST') {
    logger.info('[RES-FALLBACK] skipped: first attempt was not BLOCKED_BY_HOST');
    return result;
  }
  if (!config.residentialFallback) {
    logger.info('[RES-FALLBACK] skipped: residentialFallback toggle is OFF');
    return result;
  }

  const useDirectProxy = hasResidentialProxyCreds();
  const useBrowserbase = !useDirectProxy && hasBrowserbaseCreds();

  if (!useDirectProxy && !useBrowserbase) {
    logger.warn('[RES-FALLBACK] skipped: no proxy configured (set RESIDENTIAL_PROXY_URL or BROWSERBASE_API_KEY)');
    result.notes.push(
      'Residential fallback enabled but no proxy configured — set RESIDENTIAL_PROXY_URL (Webshare/IPRoyal/etc.) or BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID',
    );
    return result;
  }

  const providerLabel = useDirectProxy ? 'residential proxy' : 'Browserbase';
  logger.info(`[RES-FALLBACK] >>> RETRYING ${inputUrl} via ${providerLabel} <<<`);

  // Residential proxies add 10-30s of real latency per request — far-away exits
  // (e.g. ZA → US sites) routinely push page.goto past the 22.5s default. Bump
  // both timeouts for the retry only, so direct attempts stay snappy.
  const proxyConfig: AppConfig = {
    ...config,
    timeout: Math.max(config.timeout, 30000),
    navigationTimeout: Math.max(config.navigationTimeout, 60000),
  };

  let residentialBrowser: Browser | null = null;
  try {
    residentialBrowser = useDirectProxy
      ? await launchProxiedBrowser(proxyConfig)
      : await connectResidentialBrowser();
    logger.info(
      `[RES-FALLBACK] ${providerLabel} browser ready — re-running site ` +
        `(timeout=${proxyConfig.timeout}ms, navigationTimeout=${proxyConfig.navigationTimeout}ms)`,
    );
    const retryResult = await runSingleSite(inputUrl, residentialBrowser, proxyConfig);
    logger.info(`[RES-FALLBACK] retry complete: reasonCode=${retryResult.reasonCode}`);
    retryResult.notes = [
      `Retried via ${providerLabel} after direct attempt was BLOCKED_BY_HOST`,
      ...retryResult.notes,
    ];
    return retryResult;
  } catch (err) {
    logger.warn(`[RES-FALLBACK] ${providerLabel} retry threw: ${err}`);
    result.notes.push(`Residential fallback (${providerLabel}) attempted but failed: ${String(err)}`);
    return result;
  } finally {
    if (residentialBrowser) {
      try {
        await residentialBrowser.close();
      } catch (err) {
        logger.debug(`Closing residential browser failed: ${err}`);
      }
    }
  }
}
