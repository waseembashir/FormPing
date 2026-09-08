import type { Page } from 'playwright';
import type { AppConfig, FormCandidate, FormIdentifier } from '../types.js';
import { normalizeText } from '../utils/text.js';
import { logger } from '../utils/logger.js';
import { detectEmbeds, type EmbedDetection } from './detectEmbeds.js';
import { classifyFormKind } from '../runners/formFacts.js';

// Patterns that indicate this is NOT a contact form
const NEGATIVE_SUBMIT_PATTERNS = [/subscribe/i, /newsletter/i, /sign\s*up/i, /register/i, /search/i, /login/i, /log\s*in/i];
const NEGATIVE_FORM_PATTERNS = [/search/i, /newsletter/i, /subscribe/i];

// Positive submit button patterns
const POSITIVE_SUBMIT_PATTERNS = [/^send$/i, /^submit$/i, /send\b[\w\s]{0,20}\bmessage/i, /contact\s+us/i, /get\s+in\s+touch/i, /^send\s+it$/i, /^go$/i, /^submit\s+form$/i, /let'?s\s+(talk|connect|chat)/i, /send\s+(my\s+)?(enquiry|inquiry|request|details)/i];

export interface FormInfo {
  index: number;
  id: string | null;
  name: string | null;
  action: string | null;
  method: string | null;
  fields: FieldInfo[];
  submitText: string;
  allText: string;
  /** False when the form is inside a display:none / visibility:hidden / zero-size
   *  container — e.g. a step of a multi-step widget that's revealed on "Next"
   *  (FR-62). Kept (not filtered out) so a hidden-but-real contact form is still
   *  detected; visibility is weighed at selection time. */
  visible: boolean;
  /** Roughly where the form sits — nearest landmark, nearest heading above it,
   *  and an id to deep-link to. Empty strings when unknown. FR-68. */
  location: { landmark: string; heading: string; anchorId: string };
  /** A CAPTCHA widget inside THIS form's own subtree. Deliberately per-form: a
   *  site-wide reCAPTCHA script is not evidence that this form is protected, and
   *  claiming it was how a search box came back "CAPTCHA protected". FR-73. */
  captcha: boolean;
}

/**
 * What a form is CALLED on the page: its nearest heading, else its submit-button
 * text when that reads like a label rather than a sentence. Shared so the
 * single-page run and the whole-site inventory name a form identically. FR-73.
 */
export function formAbout(f: Pick<FormInfo, 'location' | 'submitText'>): string {
  const heading = (f.location?.heading ?? '').trim();
  if (heading) return heading;
  const submit = (f.submitText ?? '').trim();
  return submit && submit.length <= 40 ? submit : '';
}

export interface FieldInfo {
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  /** The input's current value — used to show hidden fields as name=value. FR-76. */
  value: string;
}

/**
 * Extract form metadata from the page via Playwright.
 * Returns serializable data so we can score without browser coupling.
 */
export async function extractForms(page: Page): Promise<FormInfo[]> {
  return page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'));
    return forms.map((form, index) => {
      const inputs = Array.from(form.querySelectorAll('input, textarea, select'));
      // Also fields wired to this form by the HTML `form="<id>"` attribute but
      // living OUTSIDE the <form> element — common on modern/React pages, and a
      // frequent cause of undercounted fields. FR-68.
      if (form.id) {
        const esc = window.CSS && CSS.escape ? CSS.escape(form.id) : form.id;
        document.querySelectorAll('input[form="' + esc + '"], textarea[form="' + esc + '"], select[form="' + esc + '"]').forEach((el) => {
          if (!inputs.includes(el)) inputs.push(el);
        });
      }
      const fields = inputs.map((el) => {
        const input = el as HTMLInputElement;
        const id = input.id || '';
        // Try to find associated label
        let label = '';
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) label = lbl.textContent?.trim() ?? '';
        }
        if (!label) {
          const closest = input.closest('label') ?? input.parentElement?.querySelector('label');
          label = closest?.textContent?.trim() ?? '';
        }
        return {
          type: input.type || el.tagName.toLowerCase(),
          name: input.name || '',
          id,
          placeholder: input.placeholder || '',
          label,
          value: (input.value || '').slice(0, 120),
        };
      });

      const submitEls = Array.from(
        form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])')
      );
      const submitText = submitEls.map((el) => el.textContent?.trim() ?? (el as HTMLInputElement).value ?? '').join(' ').trim();

      // Visibility: walk ancestors for display:none / visibility:hidden, then
      // check the bounding box for "rendered but zero-size" cases.
      //
      // We deliberately do NOT exclude on opacity. An opacity:0 ancestor is
      // still laid out and fully interactable — Playwright ignores opacity for
      // actionability, so a form we'd fill is one we must also detect. Crucially,
      // opacity-based scroll-reveal animations (AOS, framer-motion, ".reveal")
      // sit at opacity:0 until scrolled into view and frequently never fire in
      // headless automation; excluding them silently dropped real contact forms
      // (e.g. a "Send message" form inside `.reveal` scored ~65 yet was reported
      // "No contact form found"). Keep display:none / visibility:hidden (those
      // genuinely remove the element and block interaction) and zero-size. FR-28.
      let formVisible = true;
      let ancestor: Element | null = form;
      while (ancestor && ancestor !== document.body) {
        const s = window.getComputedStyle(ancestor);
        if (s.display === 'none' || s.visibility === 'hidden') {
          formVisible = false;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (formVisible) {
        const rect = form.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) formVisible = false;
      }

      // ── Location (FR-68): nearest landmark, nearest heading, an id to link to.
      // Inlined (no nested named functions) to avoid the esbuild `__name` wrap
      // that breaks inside page.evaluate.
      let landmark = '';
      let anchorId = form.id || '';
      let node: Element | null = form;
      while (node && node !== document.body) {
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute('role');
        if (!landmark) {
          if (tag === 'footer' || role === 'contentinfo') landmark = 'footer';
          else if (tag === 'header' || role === 'banner') landmark = 'header';
          else if (tag === 'nav' || role === 'navigation') landmark = 'navigation';
          else if (tag === 'aside' || role === 'complementary') landmark = 'sidebar';
          else if (tag === 'main' || role === 'main') landmark = 'main content';
        }
        if (!anchorId && node !== form && node.id) anchorId = node.id;
        node = node.parentElement;
      }
      // What the form is CALLED.
      //
      // Preferred: the nearest heading INSIDE one of the form's own ancestors —
      // i.e. the heading that structurally belongs to this form's section. That
      // is the same heading the screenshot frames when it climbs to a container,
      // so the title on the card and the title in the picture agree.
      //
      // The old rule took the nearest heading preceding the form in DOCUMENT
      // ORDER, which can belong to an entirely different section further up the
      // page. On a real site that printed "Enter Your Details" above a
      // screenshot of a form headed "Inquire for Pricing". FR-81.
      let heading = '';

      // NOTE: the text extraction below is repeated inline rather than pulled
      // into a helper. A named function declared inside page.evaluate is wrapped
      // by esbuild's keep-names as `__name(fn, "fn")`, and `__name` does not
      // exist in the browser — the whole evaluate throws
      // "ReferenceError: __name is not defined" and the run fails outright. The
      // comment on extractForms says this; I added a `headingText` helper here
      // anyway and broke every run until it came back. Keep it inline. FR-81.

      // FIRST: a heading INSIDE the form. Many designs put the form's own title
      // in the card with the fields ("Inquire for Pricing"), and that is the most
      // reliable name there is — it cannot belong to another section. The
      // ancestor rule alone missed it entirely, because a heading inside the form
      // does not PRECEDE the form, and then settled on a heading from a different
      // section further up the page. FR-81.
      //
      // Not just h1–h6: form builders very often render the title as a styled
      // <div> or <p>. On a real site the visible title "Inquire for Pricing" was
      // a plain div, so a semantic-only search found nothing here, climbed out,
      // and picked up the page's actual <h2> from a different section —
      // "Similar Venues" printed above a screenshot saying otherwise. So we also
      // accept a short, visually-prominent line sitting above the first field.
      let inside: Element | null = form.querySelector('h1,h2,h3,h4,h5,h6,legend,[role="heading"]');
      if (!inside) {
        const firstField = form.querySelector('input,select,textarea');
        for (const el of Array.from(form.querySelectorAll('div,p,span,strong,b'))) {
          // It has to sit ABOVE the fields to be a title rather than a caption.
          if (firstField && !(firstField.compareDocumentPosition(el) & 2)) continue;
          // A wrapper that contains controls is a layout box, not a title.
          if (el.querySelector('input,select,textarea,label,button')) continue;
          const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (!t || t.length > 60) continue;
          const cs = window.getComputedStyle(el);
          const size = parseFloat(cs.fontSize) || 0;
          const weight = parseInt(cs.fontWeight, 10) || 400;
          // Bigger than body text, or clearly bold — how a title looks when it
          // isn't marked up as one.
          if (size >= 17 || weight >= 600) { inside = el; break; }
        }
      }
      if (inside) heading = (inside.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

      // THEN: the nearest heading in an ancestor, bounded by the SAME size limits
      // the screenshot uses when it picks a container. Without that bound the
      // walk climbs into a section that merely contains the form and takes its
      // heading, so the title and the picture disagree.
      const formRect = form.getBoundingClientRect();
      let scope: Element | null = form;
      for (let up = 0; up < 6 && !heading && scope && scope !== document.body; up++) {
        scope = scope.parentElement;
        if (!scope) break;
        const r = scope.getBoundingClientRect();
        if (r.height > formRect.height * 3.5 + 400) break;
        if (r.width > formRect.width * 2.2 + 200) break;
        const scoped = Array.from(scope.querySelectorAll('h1,h2,h3,h4,h5,h6,legend'));
        for (let hi = scoped.length - 1; hi >= 0; hi--) {
          const el = scoped[hi]!;
          // Only a heading that PRECEDES the form labels it; one after it
          // belongs to whatever comes next.
          if (form.compareDocumentPosition(el) & 2) {
            const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
            if (text) { heading = text; break; }
          }
        }
      }
      // Fallback: nothing in any ancestor, so widen to document order — better a
      // distant heading than none at all.
      if (!heading) {
        const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
        for (let hi = heads.length - 1; hi >= 0; hi--) {
          if (form.compareDocumentPosition(heads[hi]!) & 2) {
            heading = (heads[hi]!.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
            if (heading) break;
          }
        }
      }

      // ── CAPTCHA, scoped to THIS form (FR-73). A widget must live inside the
      // form's own subtree to count. We deliberately do NOT fall back to a
      // page-wide script check: an invisible reCAPTCHA v3 leaves no per-form
      // markup, so "no widget here" means "we can't see one", never "no
      // protection" — which is why the UI never prints "No CAPTCHA".
      const captcha = Boolean(
        form.querySelector(
          '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], ' +
            'textarea[name="g-recaptcha-response"], input[name="cf-turnstile-response"], ' +
            'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]',
        ),
      );

      return {
        index,
        id: form.id || null,
        name: form.getAttribute('name'),
        action: form.getAttribute('action'),
        method: form.getAttribute('method')?.toLowerCase() ?? 'get',
        fields,
        submitText,
        allText: form.textContent?.slice(0, 500) ?? '',
        visible: formVisible,
        location: { landmark, heading, anchorId },
        captcha,
      };
    });
    // FR-62: return ALL forms (including hidden ones — multi-step steps sit at
    // display:none until revealed). Selection in findContactForm weighs `visible`.
  }) as Promise<FormInfo[]>;
}

function scoreForm(form: FormInfo): { score: number; signals: string[]; negativeSignals: string[] } {
  const signals: string[] = [];
  const negativeSignals: string[] = [];
  let score = 0;

  const allText = normalizeText(form.allText + ' ' + form.submitText);

  // Negative: clear non-contact patterns
  for (const pat of NEGATIVE_FORM_PATTERNS) {
    if (pat.test(allText)) {
      score -= 20;
      negativeSignals.push(`form text matches exclusion: ${pat.source}`);
    }
  }

  // Negative: password field
  if (form.fields.some((f) => f.type === 'password')) {
    score -= 15;
    negativeSignals.push('password field present');
  }

  // Negative: only single email field (likely newsletter)
  if (form.fields.filter((f) => f.type !== 'hidden' && f.type !== 'submit').length <= 1) {
    score -= 10;
    negativeSignals.push('single-field form');
  }

  // Positive: name field
  const hasName = form.fields.some(
    (f) =>
      /name/i.test(f.name + f.id + f.placeholder + f.label) &&
      !/(last|sur)name/i.test(f.name + f.id)
  );
  if (hasName) { score += 15; signals.push('name field'); }

  // Positive: first/last name fields
  const hasFirstName = form.fields.some((f) => /first.?name|fname/i.test(f.name + f.id + f.placeholder + f.label));
  const hasLastName = form.fields.some((f) => /last.?name|lname|surname/i.test(f.name + f.id + f.placeholder + f.label));
  if (hasFirstName || hasLastName) { score += 10; signals.push('first/last name fields'); }

  // Positive: email field
  const hasEmail = form.fields.some((f) => f.type === 'email' || /email/i.test(f.name + f.id + f.placeholder + f.label));
  if (hasEmail) { score += 15; signals.push('email field'); }

  // Positive: textarea / message field
  const hasTextarea = form.fields.some((f) => f.type === 'textarea');
  if (hasTextarea) { score += 20; signals.push('textarea/message field'); }

  // Positive: phone field
  const hasPhone = form.fields.some((f) => f.type === 'tel' || /phone|mobile/i.test(f.name + f.id + f.placeholder + f.label));
  if (hasPhone) { score += 5; signals.push('phone field'); }

  // Positive: submit button text
  for (const pat of POSITIVE_SUBMIT_PATTERNS) {
    if (pat.test(form.submitText)) {
      score += 15;
      signals.push(`submit button: "${form.submitText}"`);
      break;
    }
  }

  // Negative: negative submit text
  for (const pat of NEGATIVE_SUBMIT_PATTERNS) {
    if (pat.test(form.submitText)) {
      score -= 20;
      negativeSignals.push(`submit text exclusion: "${form.submitText}"`);
      break;
    }
  }

  return { score, signals, negativeSignals };
}

export interface FindContactFormResult {
  form: FormCandidate | null;
  allForms: FormCandidate[];
  usedAiFallback: boolean;
  /** Third-party embed form providers detected on the page (Typeform, HubSpot,
   *  …). Populated regardless of whether a native form was found, so the caller
   *  can report an embed even when `form` is null (FR-28). */
  embeds: EmbedDetection[];
  /** True when `form` was accepted only because we're in landing-page mode and
   *  the user asserted the form is on this page — i.e. it scored below the
   *  contact-form threshold but was taken anyway (FR-28). */
  acceptedByLandingLeniency: boolean;
  /** True when the accepted form sits inside a hidden multi-step widget (a
   *  display:none step revealed via "Next"). It's DETECTED, but the runner should
   *  not attempt a blind fill in safe/live mode — stepping through is Phase 2 (FR-62). */
  hiddenMultiStep: boolean;
}

export async function findContactForm(
  page: Page,
  config: AppConfig,
): Promise<FindContactFormResult> {
  const rawForms = await extractForms(page);
  logger.debug(`Found ${rawForms.length} visible form(s) on contact page`);

  // Detect hosted/third-party embed forms (Typeform, HubSpot, …) up front so
  // every return path can report them — including the "no native form" case,
  // where an embed is the whole story (FR-28).
  const embeds = await detectEmbeds(page);
  if (embeds.length) {
    logger.debug(`Third-party embed(s) detected: ${embeds.map((e) => e.provider).join(', ')}`);
  }

  const scored: FormCandidate[] = rawForms.map((form) => {
    const { score, signals, negativeSignals } = scoreForm(form);
    const identifier: FormIdentifier = {
      id: form.id,
      name: form.name,
      action: form.action,
      method: form.method,
    };
    return {
      index: form.index,
      identifier,
      score,
      signals,
      negativeSignals,
      // What this form looks like it's for — reuses the fields + submit/text we
      // already have, no extra DOM pass. FR-68.
      kind: classifyFormKind({ fields: form.fields, submitText: form.submitText, allText: form.allText }),
      // Where it sits — only the parts we actually found. FR-68.
      location: (form.location.landmark || form.location.heading || form.location.anchorId)
        ? {
            ...(form.location.landmark ? { landmark: form.location.landmark } : {}),
            ...(form.location.heading ? { heading: form.location.heading } : {}),
            ...(form.location.anchorId ? { anchorId: form.location.anchorId } : {}),
          }
        : undefined,
      // Carry the detected fields (label + type + name) so the runner can report
      // "N fields: Name, Email, Message …" AND collapse radio/checkbox groups by
      // name for an accurate count. FR-64/FR-68.
      fields: form.fields.map((f) => ({ label: f.label || f.placeholder || f.name, type: f.type, name: f.name })),
      // A CAPTCHA on THIS form, not merely somewhere on the page. FR-73.
      captcha: form.captcha,
      // What the page calls this form — the report leads with it. FR-73.
      about: formAbout(form),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // FR-62: prefer a VISIBLE form. A hidden form (a multi-step step sitting at
  // display:none until "Next" is clicked) is only taken when it clearly signals a
  // contact form, so we never pick up stray hidden/junk forms.
  const visById = new Map(rawForms.map((f) => [f.index, f.visible]));
  const isVisible = (c: FormCandidate) => visById.get(c.index) === true;
  const HIDDEN_ACCEPT_MIN = 25;

  let usedAiFallback = false;
  const bestOverall = scored[0];
  let best = scored.find(isVisible);
  if ((!best || best.score < 0) && bestOverall && !isVisible(bestOverall) && bestOverall.score >= HIDDEN_ACCEPT_MIN) {
    best = bestOverall;
  }

  // AI rescue path: deterministic scoring rejected every form. Before giving
  // up, ask the AI to look at all forms (with their fields) and decide if any
  // is actually the contact form. Only fires when AI is configured.
  if ((!best || best.score < 0) && config.aiProvider !== 'off' && rawForms.length > 0) {
    const { rescueContactForm } = await import('../ai/aiClassifier.js');
    const rescueInput = rawForms.slice(0, 8).map((f) => ({
      index: f.index,
      fields: f.fields.map((field) => ({
        name: field.name,
        type: field.type,
        label: field.label,
      })),
      submitText: f.submitText,
      identifier: [f.id, f.name].filter(Boolean).join('/') || '(no id/name)',
    }));
    const rescue = await rescueContactForm(rescueInput, page.url(), config.aiProvider);
    if (rescue) {
      const picked = scored.find((f) => f.index === rescue.chosenIndex);
      if (picked) {
        usedAiFallback = true;
        logger.info(`AI rescue (${rescue.provider}) picked form index=${picked.index}: ${rescue.reasoning}`);
        return {
          form: { ...picked, signals: [...picked.signals, `AI rescue: ${rescue.reasoning}`] },
          allForms: scored,
          usedAiFallback,
          embeds,
          acceptedByLandingLeniency: false,
          hiddenMultiStep: !isVisible(picked),
        };
      }
    }
  }

  if (!best || best.score < 0) {
    // Landing-page leniency (FR-28): the user asserted "the form is on THIS
    // page", so accept the best-scoring form — visible OR a hidden multi-step one
    // (FR-62) — even below the contact-form threshold. Non-landing runs keep the
    // strict threshold (auto-discovery, so precision matters).
    if (config.landingPage && bestOverall) {
      const hidden = !isVisible(bestOverall);
      logger.debug(`Landing-page leniency: accepting form index=${bestOverall.index} score=${bestOverall.score}${hidden ? ' (hidden/multi-step)' : ''} (below threshold)`);
      return {
        form: {
          ...bestOverall,
          signals: [
            ...bestOverall.signals,
            'accepted in landing-page mode (below contact-form threshold)',
            ...(hidden ? ['hidden/multi-step form (revealed via steps)'] : []),
          ],
        },
        allForms: scored,
        usedAiFallback,
        embeds,
        acceptedByLandingLeniency: true,
        hiddenMultiStep: hidden,
      };
    }
    return { form: null, allForms: scored, usedAiFallback, embeds, acceptedByLandingLeniency: false, hiddenMultiStep: false };
  }

  // If ambiguous (two forms within 5 points) and AI is enabled, fall back to AI
  let chosen = best;
  if (scored.length >= 2 && scored[1]!.score >= best.score - 5 && config.aiProvider !== 'off') {
    const { pickContactForm } = await import('../ai/aiClassifier.js');
    const pageUrl = page.url();
    const choice = await pickContactForm(scored.slice(0, 5), pageUrl, config.aiProvider);
    if (choice) {
      const picked = scored.find((f) => f.index === choice.chosenIndex);
      if (picked) {
        usedAiFallback = true;
        chosen = picked;
        logger.info(`AI (${choice.provider}) picked form index=${picked.index}: ${choice.reasoning}`);
      }
    }
  }

  const chosenHidden = !isVisible(chosen);
  logger.debug(`Best form: index=${chosen.index} score=${chosen.score}${chosenHidden ? ' (hidden/multi-step)' : ''} signals=[${chosen.signals.join(', ')}]`);
  return {
    form: chosenHidden
      ? { ...chosen, signals: [...chosen.signals, 'hidden/multi-step form (revealed via steps)'] }
      : chosen,
    allForms: scored,
    usedAiFallback,
    embeds,
    acceptedByLandingLeniency: false,
    hiddenMultiStep: chosenHidden,
  };
}
