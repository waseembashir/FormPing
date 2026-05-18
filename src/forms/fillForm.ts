import type { Locator, Page } from 'playwright';
import type { AppConfig, FormCandidate, FilledField } from '../types.js';
import { logger } from '../utils/logger.js';

type FieldRole =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'company'
  | 'message'
  | 'subject'
  | 'unknown';

function classifyField(name: string, id: string, placeholder: string, label: string, type: string): FieldRole {
  const combined = [name, id, placeholder, label].join(' ').toLowerCase();

  if (/first.?name|fname/.test(combined)) return 'firstName';
  if (/last.?name|lname|surname/.test(combined)) return 'lastName';
  if (/\bname\b/.test(combined) && !/company|org|business/.test(combined)) return 'fullName';
  if (/email/.test(combined) || type === 'email') return 'email';
  if (/phone|mobile|tel/.test(combined) || type === 'tel') return 'phone';
  if (/company|organization|org|business/.test(combined)) return 'company';
  if (/message|comment|enquiry|inquiry|description|details/.test(combined)) return 'message';
  if (/subject|topic/.test(combined)) return 'subject';
  return 'unknown';
}

function valueForRole(role: FieldRole, config: AppConfig): string {
  const d = config.testData;
  switch (role) {
    case 'fullName': return d.fullName;
    case 'firstName': return d.firstName;
    case 'lastName': return d.lastName;
    case 'email': return d.email;
    case 'phone': return d.phone;
    case 'company': return d.company;
    case 'message': return d.message;
    case 'subject': return 'Test Inquiry';
    default: return '';
  }
}

export interface FillResult {
  filledFields: FilledField[];
  skippedFields: string[];
  errors: string[];
  captchaDetected: boolean;
  /** Fields skipped because AI honeypot detection flagged them. */
  honeypotsSkipped: string[];
  /** AI provider that produced the honeypot verdict, if any. */
  honeypotProvider?: string;
  /** One-line AI explanation of the honeypot verdict, if any. */
  honeypotReason?: string;
  /** Steps traversed in a multi-step wizard (1 for normal forms). */
  stepsTraversed: number;
  /** Per-CAPTCHA state on the final step ("absent" | "pending" | "solved"). */
  captchaState: CaptchaState;
}

/** Attribute-selector-safe quoting — handles field names like names[first_name] */
function attrSelector(attr: string, value: string): string {
  return `[${attr}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function shortenError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split('\n')[0]!.replace(/^[a-z]+:\s*/i, '').slice(0, 160);
}

// ─────────────────────────────────────────────────────────────────────────
// CAPTCHA STATE INSPECTION
//
// Modern "invisible" CAPTCHAs (Cloudflare Turnstile in auto mode, reCAPTCHA
// v3, hCaptcha invisible) often auto-solve themselves for trusted browsers
// — the page renders the widget, JS runs, and a hidden token field gets
// populated, all without user interaction. The old binary "widget present ?
// abort" check threw away submissions we could have completed. The state-
// ful check below lets us distinguish:
//   "absent"  — no widget at all → proceed
//   "solved"  — widget ran and produced a token → proceed (just submit)
//   "pending" — widget present but no token → abort (interactive challenge)
// ─────────────────────────────────────────────────────────────────────────

export interface CaptchaState {
  turnstile: 'absent' | 'pending' | 'solved';
  recaptcha: 'absent' | 'pending' | 'solved';
  hcaptcha: 'absent' | 'pending' | 'solved';
}

async function checkCaptchaState(page: Page): Promise<CaptchaState> {
  // NOTE: arrow function (not named function declaration) — tsx/esbuild
  // wraps named functions with __name() helper calls which don't exist in
  // the browser eval context, causing ReferenceError when serialized.
  return await page.evaluate(() => {
    const stateFor = (
      widgetSelector: string,
      tokenSelector: string,
    ): 'absent' | 'pending' | 'solved' => {
      const widget = document.querySelector(widgetSelector);
      const tokenEl = document.querySelector(tokenSelector) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (!widget && !tokenEl) return 'absent';
      const token = tokenEl?.value ?? '';
      return token.trim().length > 0 ? 'solved' : 'pending';
    };
    return {
      turnstile: stateFor(
        '.cf-turnstile, #cf-turnstile, [data-sitekey][class*="turnstile"], iframe[src*="turnstile"]',
        'input[name="cf-turnstile-response"]',
      ),
      recaptcha: stateFor(
        '.g-recaptcha, iframe[src*="recaptcha"], iframe[src*="recaptcha/api2"]',
        'textarea[name="g-recaptcha-response"]',
      ),
      hcaptcha: stateFor(
        '.h-captcha, iframe[src*="hcaptcha.com"]',
        'textarea[name="h-captcha-response"]',
      ),
    };
  });
}

/**
 * Wait briefly for invisible CAPTCHAs to auto-solve themselves. Turnstile
 * typically takes 1-3s to produce a token after the widget renders. We
 * poll the state until either all present widgets are solved, or the
 * timeout expires (then the caller decides based on the final state).
 */
async function waitForInvisibleCaptchas(page: Page, timeoutMs = 5000): Promise<CaptchaState> {
  const deadline = Date.now() + timeoutMs;
  let state = await checkCaptchaState(page);
  while (Date.now() < deadline) {
    const stillPending =
      state.turnstile === 'pending' ||
      state.recaptcha === 'pending' ||
      state.hcaptcha === 'pending';
    if (!stillPending) return state;
    await page.waitForTimeout(500);
    state = await checkCaptchaState(page);
  }
  return state;
}

// ─────────────────────────────────────────────────────────────────────────
// MULTI-STEP NAVIGATION
//
// Many B2B/agency contact forms (Typeform-style wizards, FluentForms with
// step containers, the apexure.com Cloudflare-protected form) split fields
// across multiple steps with "Next" buttons. Filling everything on step 1
// and submitting just advances to step 2, never sending the form. We
// detect Next-like buttons that are NOT submit-like, click through until
// no more Next buttons appear, then let submitForm.ts handle the final
// submit click.
// ─────────────────────────────────────────────────────────────────────────

const NEXT_BUTTON_TEXT = /^(?:next(?:\s+step)?|continue|proceed|→|>>)$/i;
const SUBMIT_BUTTON_TEXT = /^(?:submit|send(?:\s+message)?|send\s+it|go|contact\s+us|get\s+in\s+touch)$/i;

/**
 * Find a visible "Next" button inside the target form (or its closest
 * wizard wrapper). Returns null if there's nothing that looks like an
 * advance-to-next-step control — in that case, the caller treats the
 * current state as the final step.
 *
 * Heuristic: text matches NEXT_BUTTON_TEXT, NOT SUBMIT_BUTTON_TEXT,
 * element is visible, and type is not "submit" (or is a button[type]
 * = button|undefined). Some wizards put Next outside the <form>, so
 * we also look in the form's parent.
 */
async function findNextButton(page: Page, formIndex: number): Promise<Locator | null> {
  // Pull all candidate buttons from the form and its parent, with metadata
  const candidates = await page.evaluate(
    (args: { idx: number; nextRe: string; submitRe: string }) => {
      const { idx, nextRe, submitRe } = args;
      const nextR = new RegExp(nextRe.slice(1, -2), 'i');
      const submitR = new RegExp(submitRe.slice(1, -2), 'i');
      const forms = Array.from(document.querySelectorAll('form'));
      const target = forms[idx];
      if (!target) return [];

      // Search scope: the form itself + its parent (wizards sometimes put
      // nav buttons in a wrapper around the form)
      const searchRoots: Element[] = [target];
      if (target.parentElement) searchRoots.push(target.parentElement);

      const seen = new Set<Element>();
      const out: Array<{ text: string; tag: string; type: string; visible: boolean; cssPath: string }> = [];

      for (const root of searchRoots) {
        const btns = Array.from(
          root.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], a.btn, a[class*="next"]'),
        );
        for (const el of btns) {
          if (seen.has(el)) continue;
          seen.add(el);
          const text = (el.textContent || (el as HTMLInputElement).value || '').trim();
          if (!text || text.length > 50) continue;

          // Must match next pattern, must NOT match submit pattern
          if (!nextR.test(text)) continue;
          if (submitR.test(text)) continue;

          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const type = (el as HTMLInputElement).type || 'button';
          // Build a cssPath that's stable enough for re-locating
          let path = el.tagName.toLowerCase();
          if (el.id) path += `#${el.id}`;
          else if (el.className && typeof el.className === 'string') {
            const cls = el.className
              .split(/\s+/)
              .filter((c) => c && !/^(?:active|focus|hover|disabled)$/.test(c))
              .slice(0, 2)
              .join('.');
            if (cls) path += `.${cls}`;
          }

          out.push({
            text,
            tag: el.tagName.toLowerCase(),
            type,
            visible: true,
            cssPath: path,
          });
        }
      }
      return out;
    },
    {
      idx: formIndex,
      nextRe: NEXT_BUTTON_TEXT.toString(),
      submitRe: SUBMIT_BUTTON_TEXT.toString(),
    },
  );

  if (candidates.length === 0) return null;

  // Use Playwright's text-based locator since cssPath isn't always reliable.
  // The form parent scope keeps us from clicking unrelated Next buttons
  // elsewhere on the page (sliders, carousels, etc.).
  const firstText = candidates[0]!.text;
  const formLoc = page.locator('form').nth(formIndex);
  const wrapperLoc = formLoc.locator('xpath=..'); // form's parent

  // Try inside form first, then in the wrapper. Match the literal text.
  const inFormBtn = formLoc.getByRole('button', { name: firstText, exact: true });
  if ((await inFormBtn.count()) > 0) return inFormBtn.first();

  const inWrapperBtn = wrapperLoc.getByRole('button', { name: firstText, exact: true });
  if ((await inWrapperBtn.count()) > 0) return inWrapperBtn.first();

  // Fallback to plain text locator
  return formLoc.locator(`button:has-text("${firstText}")`).first();
}

// ─────────────────────────────────────────────────────────────────────────
// FIELD EXTRACTION (per-step) + SINGLE-STEP FILL
// ─────────────────────────────────────────────────────────────────────────

interface ExtractedField {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  required: boolean;
  isCheckbox: boolean;
  isRadio: boolean;
  isSelect: boolean;
  checkboxLabel: string;
}

async function extractVisibleFields(page: Page, formIndex: number): Promise<ExtractedField[]> {
  return await page.evaluate((idx: number) => {
    const forms = Array.from(document.querySelectorAll('form'));
    const targetForm = forms[idx];
    if (!targetForm) return [];

    const inputs = Array.from(
      targetForm.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), textarea, select',
      ),
    );

    return inputs
      .map((el) => {
        const input = el as HTMLInputElement;
        const id = input.id || '';
        let label = '';
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) label = lbl.textContent?.trim() ?? '';
        }
        if (!label) {
          const closest = input.closest('label');
          if (closest) label = closest.textContent?.trim() ?? '';
        }
        // Visibility check: walk ancestors for display:none / visibility:hidden,
        // then check bounding box. Same logic as form-detection visibility check.
        let visible = true;
        let cur: Element | null = el;
        while (cur && cur !== document.body) {
          const s = window.getComputedStyle(cur);
          if (s.display === 'none' || s.visibility === 'hidden') {
            visible = false;
            break;
          }
          cur = cur.parentElement;
        }
        if (visible) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) visible = false;
        }
        const readonly = input.readOnly || input.disabled;

        return {
          tag: el.tagName.toLowerCase(),
          type: input.type || el.tagName.toLowerCase(),
          name: input.name || '',
          id,
          placeholder: input.placeholder || '',
          label,
          required: input.required,
          visible,
          readonly,
          isCheckbox: input.type === 'checkbox',
          isRadio: input.type === 'radio',
          isSelect: el.tagName.toLowerCase() === 'select',
          checkboxLabel: label.toLowerCase(),
        };
      })
      .filter((f) => f.visible && !f.readonly);
  }, formIndex);
}

interface SingleStepResult {
  filledFields: FilledField[];
  skippedFields: string[];
  errors: string[];
  honeypotsSkipped: string[];
  honeypotProvider?: string;
  honeypotReason?: string;
}

/** Fill all currently-visible fields in one pass. Used inside the multi-step loop. */
async function fillSingleStep(
  page: Page,
  form: FormCandidate,
  config: AppConfig,
  step: number,
): Promise<SingleStepResult> {
  const formIndex = form.index;
  const filledFields: FilledField[] = [];
  const skippedFields: string[] = [];
  const errors: string[] = [];
  const honeypotsSkipped: string[] = [];
  let honeypotProvider: string | undefined;
  let honeypotReason: string | undefined;

  const fields = await extractVisibleFields(page, formIndex);
  if (fields.length === 0) return { filledFields, skippedFields, errors, honeypotsSkipped };

  logger.debug(`Step ${step}: filling ${fields.length} visible field(s) in form[${formIndex}]`);

  // AI honeypot detection — per-step, since each step has different fields
  let honeypotKeys = new Set<string>();
  if (config.aiProvider !== 'off') {
    const { detectHoneypots } = await import('../ai/aiClassifier.js');
    const candidates = fields
      .filter((f) => !f.isCheckbox && !f.isRadio && !f.isSelect)
      .map((f) => ({
        key: f.id || f.name,
        name: f.name,
        id: f.id,
        type: f.type,
        label: f.label,
        placeholder: f.placeholder,
        required: f.required,
      }))
      .filter((c) => c.key);
    const verdict = await detectHoneypots(candidates, page.url(), config.aiProvider);
    if (verdict && verdict.skipKeys.length > 0) {
      honeypotKeys = new Set(verdict.skipKeys);
      honeypotProvider = verdict.provider;
      honeypotReason = verdict.reasoning;
    }
  }

  const formLocator = page.locator('form').nth(formIndex);

  for (const field of fields) {
    const role = classifyField(field.name, field.id, field.placeholder, field.label, field.type);
    const fieldKey = field.name || field.id || field.type;

    const aiKey = field.id || field.name;
    if (aiKey && honeypotKeys.has(aiKey)) {
      honeypotsSkipped.push(fieldKey);
      skippedFields.push(`${field.type}:${fieldKey}(ai-honeypot)`);
      continue;
    }

    let fieldLocator;
    if (field.id) {
      fieldLocator = formLocator.locator(attrSelector('id', field.id)).first();
    } else if (field.name) {
      fieldLocator = formLocator.locator(attrSelector('name', field.name)).first();
    } else {
      skippedFields.push(`${field.type}(no-selector)`);
      continue;
    }

    try {
      if (field.isCheckbox) {
        if (/consent|agree|accept|terms|privacy/i.test(field.checkboxLabel)) {
          await fieldLocator.check({ timeout: 5000 });
          filledFields.push({ label: field.label || fieldKey, type: 'checkbox', value: 'checked' });
        } else {
          skippedFields.push(`checkbox:${fieldKey}`);
        }
        continue;
      }

      if (field.isRadio) {
        if (field.required) {
          await fieldLocator.check({ timeout: 5000 });
          filledFields.push({ label: field.label || fieldKey, type: 'radio', value: 'first option' });
        } else {
          skippedFields.push(`radio:${fieldKey}`);
        }
        continue;
      }

      if (field.isSelect) {
        const options = await fieldLocator.locator('option').all();
        if (options.length === 0) {
          skippedFields.push(`select:${fieldKey}(no-options)`);
          continue;
        }
        const idx = options.length > 1 ? 1 : 0;
        const value = (await options[idx]!.getAttribute('value')) ?? '';
        await fieldLocator.selectOption({ index: idx });
        filledFields.push({ label: field.label || fieldKey, type: 'select', value });
        continue;
      }

      const value = valueForRole(role, config);
      if (!value) {
        if (field.required) {
          await fieldLocator.fill('N/A', { timeout: 5000 });
          filledFields.push({ label: field.label || fieldKey, type: field.type, value: 'N/A' });
        } else {
          skippedFields.push(`${field.type}:${fieldKey}(unknown optional)`);
        }
        continue;
      }

      await fieldLocator.fill(value, { timeout: 5000 });
      filledFields.push({ label: field.label || fieldKey, type: field.type, value });
      logger.debug(`  Filled [${field.type}] ${fieldKey} = "${value.slice(0, 30)}"`);
    } catch (err) {
      const msg = shortenError(err);
      logger.debug(`  Could not fill ${fieldKey}: ${msg}`);
      errors.push(`${fieldKey}: ${msg}`);
      skippedFields.push(`${field.type}:${fieldKey}(error)`);
    }
  }

  return {
    filledFields,
    skippedFields,
    errors,
    honeypotsSkipped,
    ...(honeypotProvider ? { honeypotProvider } : {}),
    ...(honeypotReason ? { honeypotReason } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC: fillForm
//
// Single entry point — supports both classic single-step forms (Next button
// not found on first pass → loop exits after one iteration) AND multi-step
// wizards (loops until no more Next button appears or MAX_STEPS reached).
//
// CAPTCHA detection runs ONCE at the end, on the final step, because
// invisible CAPTCHAs typically appear on the last step right before submit.
// ─────────────────────────────────────────────────────────────────────────

const MAX_WIZARD_STEPS = 8;

export async function fillForm(
  page: Page,
  form: FormCandidate,
  config: AppConfig,
): Promise<FillResult> {
  const filledFields: FilledField[] = [];
  const skippedFields: string[] = [];
  const errors: string[] = [];
  const honeypotsSkipped: string[] = [];
  let honeypotProvider: string | undefined;
  let honeypotReason: string | undefined;
  let stepsTraversed = 0;

  for (let step = 1; step <= MAX_WIZARD_STEPS; step++) {
    stepsTraversed = step;
    const stepResult = await fillSingleStep(page, form, config, step);
    filledFields.push(...stepResult.filledFields);
    skippedFields.push(...stepResult.skippedFields);
    errors.push(...stepResult.errors);
    honeypotsSkipped.push(...stepResult.honeypotsSkipped);
    if (stepResult.honeypotProvider && !honeypotProvider) {
      honeypotProvider = stepResult.honeypotProvider;
    }
    if (stepResult.honeypotReason && !honeypotReason) {
      honeypotReason = stepResult.honeypotReason;
    }

    // Look for a Next button — if none, we're on the final step.
    const nextBtn = await findNextButton(page, form.index);
    if (!nextBtn) {
      if (step > 1) logger.info(`Multi-step form: completed ${step} step(s)`);
      break;
    }

    logger.info(`Multi-step form: step ${step} filled — clicking Next to advance`);
    try {
      await nextBtn.click({ timeout: 5000 });
      // Wait for new fields to render. Animations, transitions, lazy
      // rendering all take time — generous wait, capped.
      await page.waitForTimeout(1500);
      // Also wait for any in-flight network calls triggered by the step
      // transition (some wizards POST step data via AJAX).
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    } catch (err) {
      logger.warn(`Failed to advance from step ${step}: ${shortenError(err)}`);
      break;
    }
  }

  if (stepsTraversed === MAX_WIZARD_STEPS) {
    logger.warn(`Hit MAX_WIZARD_STEPS (${MAX_WIZARD_STEPS}) — there may be more steps; submitting anyway`);
  }

  // ── Final-step CAPTCHA inspection ─────────────────────────────────────
  // Wait briefly for invisible CAPTCHAs (Turnstile in auto mode, reCAPTCHA
  // v3) to auto-solve themselves, then read state. We only abort when
  // there's a *pending* widget — auto-solved widgets are submittable.
  const captchaState = await waitForInvisibleCaptchas(page, 5000);
  const captchaPending =
    captchaState.turnstile === 'pending' ||
    captchaState.recaptcha === 'pending' ||
    captchaState.hcaptcha === 'pending';
  const captchaSolved =
    captchaState.turnstile === 'solved' ||
    captchaState.recaptcha === 'solved' ||
    captchaState.hcaptcha === 'solved';

  if (captchaSolved) {
    const solvedTypes = (Object.entries(captchaState) as Array<[string, string]>)
      .filter(([_, v]) => v === 'solved')
      .map(([k]) => k)
      .join(', ');
    logger.info(`CAPTCHA auto-solved (${solvedTypes}) — proceeding to submit`);
  }

  if (captchaPending) {
    const pendingTypes = (Object.entries(captchaState) as Array<[string, string]>)
      .filter(([_, v]) => v === 'pending')
      .map(([k]) => k)
      .join(', ');
    logger.warn(`CAPTCHA pending (${pendingTypes}) on final step — interactive challenge required, will not submit`);
    return {
      filledFields,
      skippedFields,
      errors,
      captchaDetected: true,
      honeypotsSkipped,
      ...(honeypotProvider ? { honeypotProvider } : {}),
      ...(honeypotReason ? { honeypotReason } : {}),
      stepsTraversed,
      captchaState,
    };
  }

  return {
    filledFields,
    skippedFields,
    errors,
    captchaDetected: false,
    honeypotsSkipped,
    ...(honeypotProvider ? { honeypotProvider } : {}),
    ...(honeypotReason ? { honeypotReason } : {}),
    stepsTraversed,
    captchaState,
  };
}
