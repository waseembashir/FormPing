import type { Frame, Page } from 'playwright';
import { logger } from '../utils/logger.js';

/**
 * FR-84 — find out what's really inside a hosted form, without reading its DOM.
 *
 * A third-party form lives in a cross-origin iframe, so `document.querySelector`
 * stops at its boundary. That is why bot-protection detection went blind here
 * and the report could only say "we found reCAPTCHA somewhere on the page, but
 * not attached to this form" — a claim it had no basis for, printed underneath a
 * screenshot that plainly showed a reCAPTCHA badge sitting on the form.
 *
 * The way through is the frame tree, not the DOM. Playwright's `page.frames()`
 * lists EVERY frame in the page including nested cross-origin ones, and each
 * knows its own URL and its parent. So we can ask "is there a reCAPTCHA frame
 * whose ancestors lead back to this form's frame?" — and answer the exact
 * question we were ducking, while never reading a byte we aren't allowed to.
 *
 * It is also better than the DOM check we use on native forms: an invisible
 * reCAPTCHA v3 renders no widget for a selector to find, but still creates its
 * own frame.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: claim a form has NO CAPTCHA. Not finding
 * one means we didn't see it — a challenge can be attached lazily on first
 * interaction. Absence stays unknown, exactly as FR-73 established for native
 * forms. The field count inside the frame stays unreadable too; that really is
 * blocked, and no amount of frame walking changes it.
 */

/** Vendors whose challenge widgets load in a frame of their own. */
const CAPTCHA_FRAME = [
  { vendor: 'reCAPTCHA', re: /(?:www\.)?(?:google\.com|recaptcha\.net)\/recaptcha\//i },
  { vendor: 'hCaptcha', re: /\bhcaptcha\.com\//i },
  { vendor: 'Turnstile', re: /challenges\.cloudflare\.com\//i },
];

export interface EmbedFrameFacts {
  /** The embed's own frame was found in the page — it really rendered. */
  loaded?: boolean;
  /**
   * A challenge widget inside THIS form's frame tree.
   *
   * `true` only when found. Never `false`: see the note above — we do not claim
   * a form is unprotected on the strength of not having spotted a widget.
   */
  captcha?: boolean;
  /** Which vendor, when one was found. */
  captchaVendor?: string;
}

/** True when `frame` sits anywhere beneath `ancestor` in the frame tree. */
function descendsFrom(frame: Frame, ancestor: Frame): boolean {
  // Bounded walk: a malformed tree must not spin. Real nesting is 2-3 deep.
  let current: Frame | null = frame.parentFrame();
  for (let hops = 0; current && hops < 10; hops += 1) {
    if (current === ancestor) return true;
    current = current.parentFrame();
  }
  return false;
}

/**
 * Inspect one embed's frame. `embedUrl` is the iframe src the detector matched.
 *
 * Never throws and never waits on the network: it reads the frame tree as it
 * stands once the page has settled, so a hostile or slow embed can only cost us
 * information, never the run.
 */
export function inspectEmbedFrames(page: Page, embedUrl: string): EmbedFrameFacts {
  try {
    const frames = page.frames();

    // The embed's own frame. Compared by origin + path so a cache-busting query
    // string or a redirect to a regional host doesn't lose it.
    const target = frames.find((f) => sameDocument(f.url(), embedUrl));
    if (!target) return {};

    for (const { vendor, re } of CAPTCHA_FRAME) {
      const hit = frames.find((f) => re.test(f.url()) && descendsFrom(f, target));
      if (hit) return { loaded: true, captcha: true, captchaVendor: vendor };
    }

    // Found the form, found no challenge frame under it. `captcha` stays absent:
    // that is "we didn't see one", which is not the same as "there isn't one".
    return { loaded: true };
  } catch (err) {
    logger.debug(`Embed frame inspection skipped for ${embedUrl}: ${err}`);
    return {};
  }
}

/** Same origin + pathname, ignoring query and hash. */
function sameDocument(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}
