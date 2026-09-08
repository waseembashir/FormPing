import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';

/**
 * FR-73 — photograph the form we matched, so "we found your contact form" is a
 * claim the user can check rather than one they have to trust.
 *
 * Two things this has to get right, both learned the hard way:
 *
 *  1. SHOOT THE FORM'S SECTION, NOT THE BARE <form>. A picture of naked input
 *     boxes tells you nothing about which form it is. The heading above it —
 *     "Request a demo", "Get in touch" — is the part that identifies it, and it
 *     lives OUTSIDE the <form> element. So we walk up to the smallest ancestor
 *     that carries a heading, bounded so we take the form's section and not the
 *     whole page.
 *
 *  2. GET THE FURNITURE OUT OF THE WAY. Cookie banners, chat bubbles and sticky
 *     headers float above the page and land squarely on top of the form — the
 *     first version of this shipped screenshots of an "Accept All" bar. Anything
 *     pinned or modal that isn't part of the form is hidden for the duration of
 *     the shot, through Playwright's injected stylesheet, so the page's own
 *     styles are never mutated and there is nothing to restore.
 *
 * SPEED IS PART OF THE CONTRACT. Bounded on every axis — a short timeout,
 * animations frozen, JPEG not PNG, a byte ceiling with one cheaper retry — and
 * every failure path returns null. A screenshot is evidence, never a reason for
 * a run to be slow or to fail.
 *
 * The returned `data:` URL is swapped for a hosted URL by the run route before
 * it reaches the browser, so these bytes never enter the client or its cache.
 */

/** Anything smaller than this is a stray element, not a form worth showing. */
const MIN_WIDTH = 40;
const MIN_HEIGHT = 20;
/** One capture may not hold up a run. */
const CAPTURE_TIMEOUT = 6000;
const QUALITY = 62;
/** Retry once at this quality when the first shot is over budget. */
const FALLBACK_QUALITY = 35;
/** Hard ceiling for one shot. Over this twice and we ship no evidence at all —
 *  an honest "no screenshot" beats a payload that slows every run that follows. */
const MAX_BYTES = 260_000;

/** Marks the overlays to hide. Set in the page, cleared right after the shot. */
const HIDE_ATTR = 'data-fp-shot-hide';
/** Injected for the duration of the screenshot only (Playwright reverts it). */
const HIDE_CSS = `[${HIDE_ATTR}]{visibility:hidden!important}`;



/**
 * Screenshot the section around the Nth `<form>` on the page.
 *
 * `formIndex` is the index from `extractForms`, which walks
 * `document.querySelectorAll('form')` — the same order used here.
 *
 * Returns a `data:image/jpeg;base64,…` URL, or null when there's nothing worth
 * showing (element gone, zero-size, too slow, or over the byte budget).
 */
export async function captureFormShot(page: Page, formIndex: number): Promise<string | null> {
  let handle;
  try {
    // Picks the element to photograph and hides whatever is floating over it.
    //
    // Written INLINE and anonymous on purpose: tsx/esbuild runs with keep-names,
    // which wraps a NAMED function in `__name(...)`. That helper does not exist
    // in the browser, so a named function throws the moment Playwright
    // serializes it into the page — and because capture swallows its own errors,
    // the only symptom is a screenshot that silently never appears. The
    // inventory's evaluate documents the same trap. Keep this anonymous.
    handle = await page.evaluateHandle((args: { index: number; hideAttr: string }): Element | null => {
      const form = document.querySelectorAll('form')[args.index];
      if (!form) return null;

      form.scrollIntoView({ block: 'center' });

      // ── The form's section: the smallest ancestor that names it ────────────────
      const fr = form.getBoundingClientRect();
      let best: Element = form;
      let node: Element = form;
      for (let i = 0; i < 6; i++) {
        const parent: Element | null = node.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) break;
        const pr = parent.getBoundingClientRect();
        // Stop before an ancestor balloons into "most of the page" — we want the
        // form and its heading, not the section's neighbours.
        if (pr.height > fr.height * 3.5 + 400) break;
        if (pr.width > fr.width * 2.2 + 200) break;
        best = parent;
        node = parent;
        // A heading (or a fieldset legend) means we now have what the form is
        // called, which is the whole point of climbing.
        if (parent.querySelector('h1,h2,h3,h4,h5,h6,legend')) break;
      }

      // ── Hide the furniture ─────────────────────────────────────────────────────
      // Anything pinned or modal that is NOT part of what we're shooting: consent
      // bars, chat widgets, sticky navs, back-to-top buttons. Never anything that
      // contains the form (a form inside a modal is legitimate) and never anything
      // inside the container itself.
      // Bounded scan: getComputedStyle per element isn't free, and pinned furniture
      // lives near the top of the tree anyway. 3000 elements covers any real page.
      const floating = Array.from(document.body.querySelectorAll('*')).slice(0, 3000).filter((el) => {
        if (el === best || el.contains(best) || best.contains(el)) return false;
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'sticky') return false;
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      // Consent/chat widgets that use absolute positioning + a high z-index rather
      // than fixed — matched by the names the common vendors use.
      const named = Array.from(
        document.querySelectorAll(
          '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],' +
            '[id*="gdpr" i],[class*="gdpr" i],[id*="onetrust" i],[class*="onetrust" i],' +
            '[id*="osano" i],[class*="osano" i],[id*="termly" i],[class*="iubenda" i],' +
            '[role="dialog"],[aria-modal="true"]',
        ),
      ).filter((el) => el !== best && !el.contains(best) && !best.contains(el));

      for (const el of [...floating, ...named]) el.setAttribute(args.hideAttr, '');
      return best;
    }, { index: formIndex, hideAttr: HIDE_ATTR });
    const el = handle.asElement();
    if (!el) return null;

    // Let the scroll land and any lazy image in the section decode. Short and
    // fixed — long enough to matter, too short to be felt.
    await page.waitForTimeout(200);

    const box = await el.boundingBox();
    // A display:none multi-step step has no box, and a 2px tracking form is not
    // evidence of anything — skip both rather than ship a blank rectangle.
    if (!box || box.width < MIN_WIDTH || box.height < MIN_HEIGHT) return null;

    const shoot = async (quality: number): Promise<Buffer> =>
      el.screenshot({
        type: 'jpeg',
        quality,
        timeout: CAPTURE_TIMEOUT,
        // Freeze CSS animations and hide the caret: a stable frame, captured
        // without waiting for a carousel to settle.
        animations: 'disabled',
        caret: 'hide',
        // Hides the marked overlays for this shot only — Playwright removes the
        // stylesheet afterwards, so the live page is untouched.
        style: HIDE_CSS,
      });

    let buf = await shoot(QUALITY);
    if (buf.byteLength > MAX_BYTES) buf = await shoot(FALLBACK_QUALITY);
    if (buf.byteLength > MAX_BYTES) {
      logger.debug(`Form screenshot skipped: ${buf.byteLength}B over the ${MAX_BYTES}B budget`);
      return null;
    }
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    // Never fatal. No picture is a smaller problem than a failed run.
    logger.debug(`Form screenshot failed: ${err}`);
    return null;
  } finally {
    // Clear the markers so the page we go on to FILL is exactly as we found it.
    await page
      .evaluate((attr) => {
        document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
      }, HIDE_ATTR)
      .catch(() => { /* page may be gone — nothing to clean */ });
    await handle?.dispose().catch(() => { /* ignore */ });
  }
}

/**
 * Photograph an EMBEDDED form — a provider's iframe or injected container.
 *
 * `captureFormShot` finds its target by `<form>` index, and an embed is not a
 * `<form>`: it is an iframe or a div the provider fills in. So a genuine
 * Typeform or HubSpot embed came back with no evidence at all — the one case
 * where a user most needs to see what we mean, since they cannot inspect a
 * cross-origin form themselves. FR-81.
 *
 * Takes the first selector that matches something with a real size, so a
 * provider's hidden fallback markup doesn't win over its visible embed.
 */
export async function captureEmbedShot(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if ((await el.count()) === 0) continue;

      const box = await el.boundingBox({ timeout: 1500 });
      if (!box || box.width < MIN_WIDTH || box.height < MIN_HEIGHT) continue;

      await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => { /* bounded */ });
      await page.waitForTimeout(200);

      const buf = await el.screenshot({
        type: 'jpeg',
        quality: QUALITY,
        timeout: CAPTURE_TIMEOUT,
        animations: 'disabled',
        caret: 'hide',
      });
      if (buf.byteLength > MAX_BYTES) continue;
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch {
      // Try the next selector — a provider may match several, and only one of
      // them is the rendered form.
    }
  }
  return null;
}
