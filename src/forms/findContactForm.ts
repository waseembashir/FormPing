import type { Page } from 'playwright';
import type { AppConfig, FormCandidate, FormIdentifier } from '../types.js';
import { normalizeText } from '../utils/text.js';
import { logger } from '../utils/logger.js';

// Patterns that indicate this is NOT a contact form
const NEGATIVE_SUBMIT_PATTERNS = [/subscribe/i, /newsletter/i, /sign\s*up/i, /register/i, /search/i, /login/i, /log\s*in/i];
const NEGATIVE_FORM_PATTERNS = [/search/i, /newsletter/i, /subscribe/i];

// Positive submit button patterns
const POSITIVE_SUBMIT_PATTERNS = [/^send$/i, /^submit$/i, /send\s+message/i, /contact\s+us/i, /get\s+in\s+touch/i, /^send\s+it$/i, /^go$/i, /^submit\s+form$/i];

interface FormInfo {
  index: number;
  id: string | null;
  name: string | null;
  action: string | null;
  method: string | null;
  fields: FieldInfo[];
  submitText: string;
  allText: string;
}

interface FieldInfo {
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
}

/**
 * Extract form metadata from the page via Playwright.
 * Returns serializable data so we can score without browser coupling.
 */
async function extractForms(page: Page): Promise<FormInfo[]> {
  return page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'));
    return forms.map((form, index) => {
      const inputs = Array.from(form.querySelectorAll('input, textarea, select'));
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
        };
      });

      const submitEls = Array.from(
        form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])')
      );
      const submitText = submitEls.map((el) => el.textContent?.trim() ?? (el as HTMLInputElement).value ?? '').join(' ').trim();

      // Visibility: walk ancestors for display:none / visibility:hidden / opacity:0,
      // then check bounding box to catch any remaining "rendered but zero-size" cases.
      let formVisible = true;
      let ancestor: Element | null = form;
      while (ancestor && ancestor !== document.body) {
        const s = window.getComputedStyle(ancestor);
        if (
          s.display === 'none' ||
          s.visibility === 'hidden' ||
          parseFloat(s.opacity) < 0.1
        ) {
          formVisible = false;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (formVisible) {
        const rect = form.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) formVisible = false;
      }

      return {
        index,
        id: form.id || null,
        name: form.getAttribute('name'),
        action: form.getAttribute('action'),
        method: form.getAttribute('method')?.toLowerCase() ?? 'get',
        fields,
        submitText,
        allText: form.textContent?.slice(0, 500) ?? '',
        _visible: formVisible,
      };
    }).filter((f) => (f as any)._visible);
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
}

export async function findContactForm(
  page: Page,
  config: AppConfig,
): Promise<FindContactFormResult> {
  const rawForms = await extractForms(page);
  logger.debug(`Found ${rawForms.length} visible form(s) on contact page`);

  const scored: FormCandidate[] = rawForms.map((form) => {
    const { score, signals, negativeSignals } = scoreForm(form);
    const identifier: FormIdentifier = {
      id: form.id,
      name: form.name,
      action: form.action,
      method: form.method,
    };
    return { index: form.index, identifier, score, signals, negativeSignals };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0) {
    return { form: null, allForms: scored, usedAiFallback: false };
  }

  // If ambiguous (two forms within 5 points) and AI enabled, fall back to AI
  let usedAiFallback = false;
  if (scored.length >= 2 && scored[1]!.score >= best.score - 5 && config.aiEnabled) {
    usedAiFallback = true;
    // aiClassifier.pickForm() would be called here
  }

  logger.debug(`Best form: index=${best.index} score=${best.score} signals=[${best.signals.join(', ')}]`);
  return { form: best, allForms: scored, usedAiFallback };
}
