import type { Browser } from 'playwright';
import type { AppConfig, SiteResult } from '../types.js';
import { normalizeUrl } from '../utils/url.js';
import { findContactPage } from '../discovery/findContactPage.js';
import { findContactForm } from '../forms/findContactForm.js';
import { inventorySiteForms } from '../forms/siteFormInventory.js';
import { fillForm, hasStepControl } from '../forms/fillForm.js';
import { submitForm } from '../forms/submitForm.js';
import { detectCaptcha, detectAntiBot } from '../forms/detectSuccess.js';
import { captureFormShot } from '../forms/captureFormShot.js';
import { nativeFormFacts, embedFormFacts, shouldHoldMultiStepSubmit, buildFormsOnPage, detectTrackingParams, assessFormConfidence } from './formFacts.js';
import { embedBeatsNativeForm, embedOverUtilityNote } from './embedPreference.js';
import {
  newPage,
  closePage,
  connectResidentialBrowser,
  hasBrowserbaseCreds,
  launchProxiedBrowser,
  hasResidentialProxyCreds,
} from '../browser/playwrightClient.js';
import { logger } from '../utils/logger.js';

/** Same page, ignoring protocol, www and a trailing slash — used to tell whether
 *  the site inventory already photographed the form we're about to test. */
function samePagePath(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.hostname.replace(/^www\./, '') === ub.hostname.replace(/^www\./, '') &&
      ua.pathname.replace(/\/+$/, '') === ub.pathname.replace(/\/+$/, '')
    );
  } catch {
    return a === b;
  }
}

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
    // ── Step 1: Resolve the page whose form we'll test ───────────────────────
    // Landing-page mode short-circuits discovery: the URL the user gave IS the
    // page with the form, so we test it directly (no crawling to other pages).
    // This is the fix for standalone landing pages that have an inline form and
    // no separate /contact page (which would otherwise fail CONTACT_PAGE_NOT_FOUND).
    let targetUrl: string;
    if (config.landingPage) {
      logger.info(
        `Landing-page mode: testing the form directly on ${normalizedUrl} (contact-page discovery skipped)`,
      );
      targetUrl = normalizedUrl;
      baseResult.resolvedContactPage = normalizedUrl;
      baseResult.contactPageFound = true;
      baseResult.contactPageConfidence = 1;
      // Flag so the card knows discovery was skipped — it must NOT render a
      // "contact page 100%" confidence bar (there was nothing to discover; the
      // user asserted the URL). FR-64.
      baseResult.landingPageMode = true;
      baseResult.notes.push(
        'Landing-page mode: tested the form on the given URL directly (contact-page discovery skipped)',
      );
    } else if (config.targetPage) {
      // A pinned page (FR-79): an earlier run already resolved this site's
      // contact page, so there is nothing to discover. A scheduled monitor
      // watches ONE form on ONE page — its verdict, fingerprint, diff and
      // alerts are all built around a single form — so re-crawling up to a
      // dozen pages of somebody's site on every check, and filling every lead
      // form found on them, produced an inventory nothing downstream could read.
      //
      // Unlike landing-page mode this makes no claim it cannot support. It does
      // NOT relax form selection (that leniency is the user's assertion being
      // spent, and a pinned monitor has not asserted anything), and it does NOT
      // report a contact-page confidence: no discovery ran here, and the
      // confidence that chose this page belongs to the run that pinned it and
      // is recorded there. `contactPageConfidence` therefore stays 0 and
      // `pinnedPageMode` tells the UI to render the page rather than a bar.
      logger.info(`Pinned page: testing the form on ${config.targetPage} (contact-page discovery skipped)`);
      targetUrl = config.targetPage;
      baseResult.resolvedContactPage = config.targetPage;
      baseResult.contactPageFound = true;
      baseResult.pinnedPageMode = true;
      baseResult.notes.push(
        `Pinned page: tested the form on ${config.targetPage} directly (resolved by an earlier run; site crawl skipped)`,
      );
    } else {
    // Discover the contact page FIRST, so the inventory below can skip re-filling
    // the contact form the main flow is about to test (no double-fill). FR-76.
    const { candidate, allCandidates, usedAiFallback, blockedByHost, diagnostic } =
      await findContactPage(normalizedUrl, browser, config);

    // Site-level form inventory (FR-68): crawl the site's reachable pages and
    // record EVERY form found — so forms on pages OTHER than the tested contact
    // page (rental, book-a-demo, …) are reported too, not just the one we test.
    // In safe/live it now fills each lead form (FR-76), except the primary
    // contact form (`candidate.url`), which the main flow fills once below.
    // Best-effort: a crawl failure never breaks the primary run.
    try {
      baseResult.siteForms = await inventorySiteForms(normalizedUrl, browser, config, candidate?.url ?? null);
    } catch (err) {
      logger.debug(`Site inventory failed (non-fatal): ${err}`);
    }

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
    targetUrl = candidate.url;
    }

    // Note: detect-only does NOT return here. It still loads the contact page
    // and runs form detection below (Step 2–3) so it can confirm the form
    // actually exists — it just stops before filling/submitting. Returning at
    // this point would leave formFound=false even when a form is present, which
    // the Form Watch health verdict reads as "No contact form found".

    // ── Step 2: Load contact page in Playwright ──────────────────────────────
    const { context, page } = await newPage(browser, config);
    try {
      // Use 'domcontentloaded' (not 'load') — many sites have slow async
      // resources (analytics pixels, fonts, third-party widgets) that delay
      // the 'load' event past our timeout. JS-rendered forms (Elementor,
      // FluentForms, Webflow, React SPAs) are still handled by the
      // networkidle + waitForSelector waits below.
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

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
      // Bot-protection markup somewhere on the PAGE. This is NOT evidence that
      // any particular form is protected — a site-wide reCAPTCHA script sits on
      // every page — and reporting it as "CAPTCHA protected" on an unrelated
      // form was exactly the false confidence FR-73 was raised for. It is now
      // reported as its own page-level fact; `captchaDetected` means "on the
      // form we tested", set from the form's own subtree below. FR-73.
      const pageProtection = detectCaptcha(pageHtml, config);
      baseResult.pageProtection = pageProtection;

      if (antiBotDetected) {
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected: false,
          antiBotDetected: true,
          finalStatus: 'fail',
          reasonCode: 'ANTI_BOT_DETECTED',
          notes: [`Anti-bot/challenge page detected at ${page.url()}`],
          durationMs: Date.now() - start,
        };
      }

      // ── Step 3: Find contact form ──────────────────────────────────────────
      const { form, allForms, embeds, acceptedByLandingLeniency, hiddenMultiStep } = await findContactForm(page, config);

      // "N forms on this page" — set once here so EVERY return path (embed-only,
      // no-contact-form, and the tested-form success) carries it. Only populated
      // when the page has 2+ forms, so single-form pages read as before. FR-68.
      baseResult.formsOnPage = buildFormsOnPage(allForms, embeds, form?.index ?? null) ?? undefined;

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
            captchaDetected: false,
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

        // ── Three-way "no testable contact form" taxonomy (FR-28) ────────────
        // The old code lumped every miss into FORM_NOT_FOUND ("No contact form
        // found"), which was misleading when a form clearly existed. Split it:

        // (3) A known third-party embed (Typeform/HubSpot/…) is present. The
        //     form provably exists; it's just a cross-origin embed we can't fill.
        //     Report it (Attention, not a hard fail — nothing is actually broken).
        if (embeds.length > 0) {
          const names = embeds.map((e) => e.provider).join(', ');
          const embedFacts = embedFormFacts(embeds);
          return {
            ...baseResult,
            ...embedFacts,
            finalUrl: page.url(),
            captchaDetected: false,
            finalStatus: 'warn',
            reasonCode: 'THIRD_PARTY_EMBED_FORM',
            notes: [
              ...baseResult.notes,
              `Found a ${names} embed — the form exists but is a third-party embed FormPing can't auto-fill. Verify it manually; monitoring can't submit through it.`,
            ],
            durationMs: Date.now() - start,
          };
        }

        // (2) Native <form>(s) exist but none scored as a contact form.
        //
        // This return used to carry NO facts about what it found, so the card
        // said "Found a form — but not a contact form" in its banner and "No
        // form found" directly underneath: one run, two answers. We now describe
        // the form we DID find — what it looks like, its fields, and a picture of
        // it — so the page agrees with itself and the user can judge it. FR-73.
        if (allForms.length > 0) {
          const b = allForms[0]!; // scored[] is sorted best-first
          const bFacts = nativeFormFacts(b, { hiddenMultiStep: false });
          const missing = (
            [
              ['email field', 'an email field'],
              ['textarea/message field', 'a message box'],
              ['name field', 'a name field'],
            ] as [string, string][]
          )
            .filter(([sig]) => !b.signals.includes(sig))
            .map(([, label]) => label);
          const looksLike =
            b.kind === 'search' ? 'a search box'
            : b.kind === 'newsletter' ? 'a newsletter sign-up'
            : b.kind === 'login' ? 'a login form'
            : bFacts.fieldCount <= 1 ? 'a single-field form (a search or sign-up box)'
            : 'a form for something else';
          return {
            ...baseResult,
            finalUrl: page.url(),
            captchaDetected: b.captcha === true,
            // The facts of the form we actually found — so the card can show it
            // rather than claim nothing is there.
            formType: 'native',
            fieldCount: bFacts.fieldCount,
            fields: bFacts.fields,
            ...(b.location?.anchorId ? { formAnchorId: b.location.anchorId } : {}),
            ...(b.about ? { formAbout: b.about } : {}),
            formKind: b.kind,
            formShot: (await captureFormShot(page, b.index)) ?? undefined,
            finalStatus: 'warn',
            reasonCode: 'NON_CONTACT_FORM_FOUND',
            notes: [
              ...baseResult.notes,
              allForms.length === 1
                ? `The one form on this page looks like ${looksLike}, not a contact form.`
                : `${allForms.length} forms on this page, and the closest match looks like ${looksLike}, not a contact form.`,
              ...(missing.length ? [`It has no ${missing.join(', no ')} — the things a contact form normally asks for.`] : []),
              'Check the screenshot. If this IS the form you wanted tested, re-run with Landing page on to test it directly.',
            ],
            durationMs: Date.now() - start,
          };
        }

        // (1) Genuinely nothing: no native form and no known embed on the page.
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected: false,
          finalStatus: 'fail',
          reasonCode: 'FORM_NOT_FOUND',
          notes: [
            ...baseResult.notes,
            `No form found on the page (${pageHtml.length}B, ${formTagCount} <form> tags in HTML).`,
            ...(config.landingPage
              ? ['Landing-page mode tested this exact URL — if the form lives on a different page, turn Landing-page mode off to let FormPing discover the contact page.']
              : []),
            ...(config.targetPage
              ? ['This monitor watches this exact page, resolved when it was set up. If the site has moved its contact form, use "Find the form again" to re-resolve it.']
              : []),
          ],
          durationMs: Date.now() - start,
        };
      }

      // Honesty guard (FR-68): the only form we could match is NOT a contact form
      // (a search box / newsletter / login). This is what landing-page leniency
      // used to accept, then "fail" trying to fill — a hidden search box reported
      // as "form found" AND "could not fill". Report it plainly instead: no
      // contact form here, nothing filled, no self-contradiction.
      if (form.kind === 'search' || form.kind === 'newsletter' || form.kind === 'login') {
        /**
         * Before calling this page form-less: is there an embed on it?
         *
         * The guard below is right that a newsletter is not a contact form, and
         * wrong to conclude the page has none. A footer sign-up appears on every
         * page of most sites, so on an embed-only contact page it is the native
         * form that gets matched — and the hosted contact form beside it was
         * never consulted. That is how a site whose contact form is plainly
         * visible was reported as having none. FR-95.
         */
        if (embedBeatsNativeForm(form.kind, embeds.length)) {
          const names = embeds.map((e) => e.provider).join(', ');
          return {
            ...baseResult,
            ...embedFormFacts(embeds),
            finalUrl: page.url(),
            captchaDetected: false,
            finalStatus: 'warn',
            reasonCode: 'THIRD_PARTY_EMBED_FORM',
            notes: [
              ...baseResult.notes,
              embedOverUtilityNote(form.kind, names),
              `It is a third-party embed FormPing can't auto-fill — verify it manually; monitoring can't submit through it.`,
            ],
            durationMs: Date.now() - start,
          };
        }

        const what =
          form.kind === 'search' ? 'a search box' : form.kind === 'newsletter' ? 'a newsletter sign-up' : 'a login form';
        const utilityFacts = nativeFormFacts(form, { hiddenMultiStep });
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected: form.captcha === true,
          formType: 'native',
          // Describe and photograph it, so "this is a search box, not your
          // contact form" is something the user can see rather than trust. FR-73.
          fieldCount: utilityFacts.fieldCount,
          fields: utilityFacts.fields,
          ...(form.location?.anchorId ? { formAnchorId: form.location.anchorId } : {}),
          ...(form.about ? { formAbout: form.about } : {}),
          formKind: form.kind,
          formShot: (await captureFormShot(page, form.index)) ?? undefined,
          finalStatus: 'warn',
          reasonCode: 'NON_CONTACT_FORM_FOUND',
          notes: [
            ...baseResult.notes,
            `The only form on this page is ${what} — not a contact form, so nothing was filled.`,
            ...(config.landingPage
              ? ['Landing-page mode tested this exact URL. If the contact form is on another page, turn Landing-page mode off to let FormPing find it.']
              : []),
            ...(config.targetPage
              ? ['This monitor watches this exact page, resolved when it was set up. If the contact form has moved, use "Find the form again" to re-resolve it.']
              : []),
          ],
          durationMs: Date.now() - start,
        };
      }

      const formConfidence = Math.min(Math.max(form.score / 75, 0), 1);
      baseResult.formFound = true;
      baseResult.formConfidence = formConfidence;
      baseResult.formIdentifier = form.identifier;

      // Attach the human-facing form facts (type / field count + names /
      // multi-step) so every downstream card — Tester and Scheduler, all modes —
      // can describe what was found. Refined after fill (stepsTraversed). FR-64.
      // Ask whether this is a wizard BEFORE anything is filled. Detect-only
      // never fills, so without this the flag came out false rather than
      // unknown and a genuine wizard was reported as "Single-step" — on the
      // app's default mode, in the confident direction. FR-94.
      const stepControlFound = await hasStepControl(page, form.index);
      const facts = nativeFormFacts(form, { hiddenMultiStep, stepControlFound });
      baseResult.formType = facts.formType;
      baseResult.fieldCount = facts.fieldCount;
      baseResult.fields = facts.fields;
      baseResult.isMultiStep = facts.isMultiStep;
      // An id to jump straight to the form, so the user can go look at what we
      // matched instead of taking our word for it. FR-73.
      if (form.location?.anchorId) baseResult.formAnchorId = form.location.anchorId;
      // What the page calls this form ("Request a Rental"). The whole-site report
      // has always led with it; the single-page card could only say "Contact
      // form" while the screenshot beside it said something else. FR-73.
      if (form.about) baseResult.formAbout = form.about;
      baseResult.formKind = form.kind;

      // ── Evidence + honest confidence (FR-73) ─────────────────────────────
      // Screenshot what we matched, so "here's the form" is something the user
      // can SEE. Best-effort: a failed capture must never fail the run.
      //
      // Skipped when the site inventory ALREADY photographed this same form: on
      // a whole-site run the report renders from `siteForms`, so capturing it
      // again here produced a second, near-identical image that nothing ever
      // displayed — a wasted capture and a wasted upload on every run. Only
      // skipped when the inventory genuinely has a shot for THIS page, so a form
      // beyond the inventory's shot cap still gets its own. FR-73.
      // The report only takes over at 2+ forms; a single-form result still
      // renders the card that reads `formShot`, so the skip must not apply there.
      const reportWillRender = (baseResult.siteForms?.length ?? 0) >= 2;
      const inventoryShotForThisPage =
        reportWillRender && baseResult.siteForms?.some((f) => f.shot && samePagePath(f.url, targetUrl));
      if (!inventoryShotForThisPage) {
        baseResult.formShot = (await captureFormShot(page, form.index)) ?? undefined;
      }

      const confidence = assessFormConfidence({
        score: form.score,
        fieldCount: facts.fieldCount,
        acceptedByLandingLeniency,
        isMultiStep: facts.isMultiStep,
      });
      baseResult.formConfidenceLevel = confidence.level;
      if (confidence.reason) baseResult.lowConfidenceReason = confidence.reason;

      // Too weak to fill: a single-input <form> is a search box or an email
      // capture. Filling its one field and calling it healthy is precisely how
      // the tester used to invent a contact form nobody could see — so stop
      // here, show the evidence, and ask the user. FR-73.
      if (confidence.tooWeakToFill) {
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected: form.captcha === true,
          formType: 'native',
          finalStatus: 'warn',
          reasonCode: 'LOW_CONFIDENCE_FORM',
          notes: [
            ...baseResult.notes,
            `We only matched a ${facts.fieldCount === 1 ? 'single-field' : 'very small'} form here, so nothing was filled — ${confidence.reason}.`,
            'Check the screenshot: if this IS your contact form, tell us and we will test it; if it is not, the real form may be on another page.',
          ],
          durationMs: Date.now() - start,
        };
      }
      // Hidden tracking/UTM params the form captures — from ALL its fields
      // (hidden ones included), so we can flag campaign-attribution coverage. FR-68.
      baseResult.tracking = detectTrackingParams(form.fields);

      // Plain, user-facing detection note (FR-64). The detector score + signal
      // list are developer-internal and confusing on the result card / run log —
      // they're logged for debugging just below, not surfaced to users.
      baseResult.notes.push(
        confidence.level === 'low'
          ? `Possible contact form detected — low confidence: ${confidence.reason}. Check the screenshot to confirm it is the right form.`
          : 'Contact form detected.',
      );
      logger.debug(`Form score=${form.score} signals=[${form.signals.join(', ')}]`);

      logger.info(`Form found (confidence=${formConfidence.toFixed(2)}): ${JSON.stringify(form.identifier)}`);

      // detect-only mode: the form has been located on the (loaded) contact
      // page — report it as found without filling or submitting. formFound /
      // formIdentifier / formConfidence are already populated on baseResult.
      if (config.mode === 'detect-only') {
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected: form.captcha === true,
          finalStatus: 'warn',
          reasonCode: 'DETECT_ONLY',
          notes: [...baseResult.notes, 'detect-only mode: form detected, not filled or submitted'],
          durationMs: Date.now() - start,
        };
      }

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
        reachedSubmit,
        wizardContainerUsed,
        fieldsSeen,
        stepShots,
      } = await fillForm(page, form, config);
      baseResult.errors.push(...fillErrors);
      if (wizardContainerUsed) baseResult.isMultiStep = true;
      // Carry the walk out of the engine so a card can say how far it got.
      // These existed only as note strings before, which meant every surface
      // re-derived the story or went without it. FR-94.
      baseResult.stepsWalked = stepsTraversed;
      baseResult.reachedFinalStep = reachedSubmit;
      // Empty unless the Form Tester asked for them AND the form had steps.
      if (stepShots.length) baseResult.stepShots = stepShots;
      // For a walked wizard, the accurate field count is what the walk saw across
      // ALL steps (radio groups collapsed) — form-scoped detection only counted
      // the fields inside the <form>, missing earlier steps' fields. FR-63.
      if ((wizardContainerUsed || stepsTraversed > 1) && fieldsSeen > 0) {
        baseResult.fieldCount = fieldsSeen;
      }

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
        baseResult.isMultiStep = true;
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

      // A CAPTCHA only matters for LIVE mode, where it blocks the actual
      // submission. In safe / detect-only we never submit, so a CAPTCHA on the
      // form does NOT stop us reporting the form as found & filled — fall
      // through to the safe-mode result below instead of failing here.
      if (fillCaptcha && config.mode === 'live') {
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
        // Walking the steps IS supported (FR-63: fillForm clicks Next/Continue
        // through up to MAX_WIZARD_STEPS). Reaching here means the walk ran and
        // still filled nothing — every step extracted no fillable field. Report
        // it as "found, multi-step, could not fill", NOT the scary "could not
        // fill required fields" that reads like a broken form (FR-64), and NOT
        // the old "not supported yet", which claimed a capability was missing
        // that had already shipped. FR-96.
        if (baseResult.isMultiStep || hiddenMultiStep) {
          return {
            ...baseResult,
            finalUrl: page.url(),
            finalStatus: 'warn',
            reasonCode: 'MULTI_STEP_FORM_DETECTED',
            notes: [
              ...baseResult.notes,
              `Detected a multi-step form (${baseResult.fieldCount ?? 0} field(s) across its steps). We walked its steps but could not fill a single field on any of them — most often the inputs are custom components rather than standard fields we can type into. Check this one by hand.`,
            ],
            durationMs: Date.now() - start,
          };
        }
        return {
          ...baseResult,
          finalUrl: page.url(),
          finalStatus: 'warn',
          reasonCode: 'REQUIRED_FIELDS_UNSUPPORTED',
          notes: [...baseResult.notes, `All ${skippedFields.length} field(s) skipped — see errors for details`],
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
        // Only this form's own CAPTCHA counts — plus one the fill actually ran
        // into. Page-wide protection is reported separately and never here. FR-73.
        const captchaPresent = form.captcha === true || fillCaptcha;
        return {
          ...baseResult,
          finalUrl: page.url(),
          captchaDetected: captchaPresent,
          finalStatus: 'warn',
          reasonCode: 'SAFE_MODE_NO_SUBMIT',
          notes: [
            ...baseResult.notes,
            captchaPresent
              ? 'safe mode: form filled but not submitted (a CAPTCHA is present — it would block a live submission, but does not affect detection or filling)'
              : 'safe mode: form filled but not submitted',
          ],
          durationMs: Date.now() - start,
        };
      }

      // live mode — actually submit
      const contactPageUrl = page.url();

      // Submit-only-if-clean gate for multi-step / wizard forms (FR-63). Walking
      // a wizard means we picked choices on earlier steps; only submit for real
      // when we actually reached the final step AND put in an email (a real,
      // lead-shaped entry). Otherwise HOLD the submission and say why, rather
      // than dropping a partial/mis-filled entry into the client's inbox.
      const isWizard = wizardContainerUsed || baseResult.isMultiStep || stepsTraversed > 1;
      const filledEmail = filledFields.some((f) => f.type === 'email' || /email/i.test(f.label));
      if (shouldHoldMultiStepSubmit({ isWizard, reachedSubmit, filledEmail })) {
        return {
          ...baseResult,
          finalUrl: page.url(),
          finalStatus: 'warn',
          reasonCode: 'SUBMIT_HELD_INCOMPLETE',
          notes: [
            ...baseResult.notes,
            `Filled ${filledFields.length} field(s) across ${stepsTraversed} step(s), but held back the live submission: ${
              !reachedSubmit
                ? 'the walk did not reach the final submit step'
                : 'no email value was filled, so this would not be a valid lead'
            }. Verify this multi-step form by hand.`,
          ],
          durationMs: Date.now() - start,
        };
      }

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

      // A 5xx from the site's own endpoint outranks anything written on the page.
      //
      // This check used to come first unconditionally, so a run that submitted a
      // form and got HTTP 500 back was reported as "Validation error" — blaming
      // the data we typed for the site's server crashing. Page text is a guess;
      // a status code is evidence. Defer to the HTTP-status branch below whenever
      // we captured a server error. FR-73.
      const sawServerError = submitResult.capturedResponses.some((r) => r.status >= 500);
      if (submitResult.validationErrorDetected && !sawServerError) {
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
        const hasServerError = statuses.some((s) => s >= 500);

        let reasonCode: SiteResult['reasonCode'] = 'SUBMIT_FAILED';
        let explanation =
          'AJAX response explicitly reported failure — submission was rejected server-side.';

        // Checked FIRST: a 5xx means the site's own backend fell over, which is
        // the clearest, most actionable thing we can report — and the one the
        // site's owner has to fix. FR-73.
        if (hasServerError) {
          reasonCode = 'SERVER_ERROR';
          const statusStr = statuses.filter((s) => s >= 500).join('/');
          explanation =
            `The site's own server returned HTTP ${statusStr} when the form was submitted. ` +
            'The form and its fields are fine — the code behind it failed, so the message was never delivered. ' +
            'Anyone filling in this form right now is hitting the same error.';
        } else if (hasAntiSpamStatus) {
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
 * Run a single site, picking between the regular cloud-IP browser and a
 * residential-IP browser based on config.residentialFallback (now meaning
 * "use residential IP", not "fall back to residential on block").
 *
 *   residentialFallback === false  → use the passed-in (cloud) browser
 *   residentialFallback === true   → launch a residential browser and use
 *                                    it from the start. No detection-then-
 *                                    retry cycle — direct attempt is
 *                                    skipped entirely. Saves the 10-30s
 *                                    we used to waste on the inevitable
 *                                    BLOCKED_BY_HOST + retry on Hostinger
 *                                    and similar.
 *
 * Two residential transport options, picked in this order:
 *   1. Direct proxy (RESIDENTIAL_PROXY_URL) — Webshare/IPRoyal/Smartproxy
 *      /any HTTP-or-SOCKS proxy.
 *   2. Browserbase (BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID) — hosted
 *      browser with built-in residential pool, per-session billing.
 *
 * The proxied/hosted browser is always closed in `finally` so we don't leak
 * sessions or open Chrome processes.
 */
export async function runSingleSiteWithResidentialFallback(
  inputUrl: string,
  browser: Browser,
  config: AppConfig,
): Promise<SiteResult> {
  // Loud, easy-to-grep diagnostics so logs show exactly which path the
  // wrapper took.
  logger.info(
    `[RES] mode=${config.residentialFallback ? 'use-residential' : 'cloud-only'}, ` +
      `proxyUrl=${process.env.RESIDENTIAL_PROXY_URL ? 'set' : 'unset'}, ` +
      `proxyUser=${process.env.RESIDENTIAL_PROXY_USER ? 'set' : 'unset'}, ` +
      `proxyPass=${process.env.RESIDENTIAL_PROXY_PASS ? 'set' : 'unset'}, ` +
      `browserbase=${hasBrowserbaseCreds() ? 'set' : 'unset'}`,
  );

  // Cloud-only mode (toggle off): use the passed-in browser, no proxy involved.
  if (!config.residentialFallback) {
    return runSingleSite(inputUrl, browser, config);
  }

  // Use-residential mode (toggle on): pick a transport and run via it.
  // We skip the direct cloud attempt entirely — no point wasting 10-30s
  // on a host that we already know we want to bypass via residential.
  const useDirectProxy = hasResidentialProxyCreds();
  const useBrowserbase = !useDirectProxy && hasBrowserbaseCreds();

  if (!useDirectProxy && !useBrowserbase) {
    logger.warn(
      '[RES] use-residential mode is ON but no proxy configured — set RESIDENTIAL_PROXY_URL or BROWSERBASE_API_KEY',
    );
    return {
      ...makeErrorResult(
        inputUrl,
        normalizeUrl(inputUrl),
        config,
        'Residential IP toggle is ON but no proxy credentials are configured. Set RESIDENTIAL_PROXY_URL (Webshare/IPRoyal/etc.) or BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID in your environment.',
      ),
      durationMs: 0,
    };
  }

  const providerLabel = useDirectProxy ? 'residential proxy' : 'Browserbase';
  logger.info(`[RES] >>> RUNNING ${inputUrl} via ${providerLabel} (direct attempt skipped) <<<`);

  // Residential proxies add 10-30s of real latency per request — far-away
  // exits routinely push page.goto past the default. Bump both timeouts.
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
      `[RES] ${providerLabel} browser ready — running site ` +
        `(timeout=${proxyConfig.timeout}ms, navigationTimeout=${proxyConfig.navigationTimeout}ms)`,
    );
    const result = await runSingleSite(inputUrl, residentialBrowser, proxyConfig);
    logger.info(`[RES] run complete: reasonCode=${result.reasonCode}`);
    result.notes = [
      `Routed via ${providerLabel} (residential IP — direct cloud attempt skipped)`,
      ...result.notes,
    ];
    return result;
  } catch (err) {
    logger.error(`[RES] ${providerLabel} run threw: ${err}`);
    return {
      ...makeErrorResult(inputUrl, normalizeUrl(inputUrl), config, err),
      durationMs: 0,
    };
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
