import type { Page } from 'playwright';
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
}

/** Attribute-selector-safe quoting — handles field names like names[first_name] */
function attrSelector(attr: string, value: string): string {
  return `[${attr}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function shortenError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split('\n')[0]!.replace(/^[a-z]+:\s*/i, '').slice(0, 160);
}

export async function fillForm(
  page: Page,
  form: FormCandidate,
  config: AppConfig,
): Promise<FillResult> {
  const formIndex = form.index;
  const filledFields: FilledField[] = [];
  const skippedFields: string[] = [];
  const errors: string[] = [];
  let captchaDetected = false;

  // Get all fillable inputs within this specific form (metadata only)
  const fields = await page.evaluate((idx: number) => {
    const forms = Array.from(document.querySelectorAll('form'));
    const targetForm = forms[idx];
    if (!targetForm) return [];

    const inputs = Array.from(
      targetForm.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), textarea, select')
    );

    return inputs.map((el) => {
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
      const style = window.getComputedStyle(el);
      const visible = style.display !== 'none' && style.visibility !== 'hidden';
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
    }).filter((f) => f.visible && !f.readonly);
  }, formIndex);

  // CAPTCHA pre-check
  const hasCaptcha = await page.evaluate(() => {
    return !!(
      document.querySelector('.g-recaptcha, .h-captcha, [data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], #cf-turnstile') ||
      /recaptcha|hcaptcha|turnstile/i.test(document.body.innerHTML)
    );
  });

  if (hasCaptcha) {
    captchaDetected = true;
    logger.warn('CAPTCHA detected on form — will not fill');
    return { filledFields, skippedFields, errors, captchaDetected };
  }

  logger.debug(`Filling ${fields.length} visible field(s) in form[${formIndex}]`);

  // Scope all field lookups under this specific form instance — robust even
  // when the form is nested deep or when field names contain brackets.
  const formLocator = page.locator('form').nth(formIndex);

  for (const field of fields) {
    const role = classifyField(field.name, field.id, field.placeholder, field.label, field.type);
    const fieldKey = field.name || field.id || field.type;

    // Prefer id-based lookup, fall back to name-based. Both use attribute
    // selectors so they handle special chars (brackets, dots, colons) safely.
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

  return { filledFields, skippedFields, errors, captchaDetected };
}
