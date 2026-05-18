export type Severity = 'info' | 'warn' | 'error' | 'success';

export interface ReasonMessage {
  title: string;
  description: string;
  severity: Severity;
}

const MESSAGES: Record<string, ReasonMessage> = {
  CONTACT_PAGE_NOT_FOUND: {
    title: 'Contact page not found',
    description: 'Could not locate a contact page. The homepage may not link to one, or it uses an unusual URL pattern.',
    severity: 'error',
  },
  BLOCKED_BY_HOST: {
    title: 'Site appears to be blocking cloud-host IPs',
    description:
      'The site returned a tiny, content-less response — typical of a hosting-provider firewall (Hostinger, Bluehost, GoDaddy, etc. often block cloud IPs by default to prevent scrapers). FormPing works fine from a residential IP — run it locally on your machine for sites with this protection, or whitelist your cloud provider in the site\'s hosting panel.',
    severity: 'warn',
  },
  CONTACT_PAGE_AMBIGUOUS: {
    title: 'Multiple candidate contact pages',
    description: 'Several pages scored similarly as contact-page candidates. Enable AI fallback to disambiguate.',
    severity: 'warn',
  },
  FORM_NOT_FOUND: {
    title: 'No contact form detected',
    description: 'A contact page was found but no visible contact form passed the scoring threshold.',
    severity: 'error',
  },
  FORM_AMBIGUOUS: {
    title: 'Multiple candidate forms',
    description: 'Two or more forms on the page scored similarly. Enable AI fallback to disambiguate.',
    severity: 'warn',
  },
  CAPTCHA_DETECTED: {
    title: 'CAPTCHA blocks submission',
    description: 'The form is protected by reCAPTCHA, hCaptcha, or Turnstile. FormPing does not bypass CAPTCHAs.',
    severity: 'warn',
  },
  ANTI_BOT_DETECTED: {
    title: 'Anti-bot protection active',
    description: 'The page is behind an anti-bot service (Cloudflare, DDoS-Guard, etc.). FormPing does not bypass these.',
    severity: 'warn',
  },
  REQUIRED_FIELDS_UNSUPPORTED: {
    title: 'Could not fill required fields',
    description: 'Fields could not be interacted with. This can happen with custom inputs, shadow-DOM components, or JS-controlled widgets. See errors below.',
    severity: 'warn',
  },
  SAFE_MODE_NO_SUBMIT: {
    title: 'Safe mode — form filled, not submitted',
    description: 'The form was filled successfully. Switch to Live mode to submit for real.',
    severity: 'info',
  },
  DETECT_ONLY: {
    title: 'Detect-only mode',
    description: 'Contact page and form were detected. No fill or submit was attempted.',
    severity: 'info',
  },
  SUBMIT_FAILED: {
    title: 'Submit failed',
    description: 'The form was filled but the submission could not complete. The submit button may be unclickable, or the server returned an error response that did not match a known anti-spam or validation pattern.',
    severity: 'error',
  },
  SUBMISSION_BLOCKED_BY_ANTISPAM: {
    title: 'Anti-spam blocked the submission',
    description:
      'The server returned a status code (402/403/429) consistent with an anti-spam or WAF block — typically Akismet, Wordfence, FluentForms honeypot, or your host\'s built-in protection. The form is doing its job by rejecting suspicious traffic. FormPing cannot bypass this: disable the anti-spam plugin on the target site, or whitelist the residential proxy IPs in the site\'s firewall.',
    severity: 'warn',
  },
  VALIDATION_ERROR: {
    title: 'Form rejected submission',
    description: 'The form displayed validation errors after submission. Field values may be incorrect for this site.',
    severity: 'error',
  },
  NO_REDIRECT_NO_SUCCESS: {
    title: 'Submitted but no confirmation found',
    description: 'The form was submitted but no thank-you redirect or inline success message was detected.',
    severity: 'warn',
  },
  INLINE_SUCCESS_ONLY: {
    title: 'Submitted — inline success detected',
    description: 'The form submitted successfully and showed an inline success message (no redirect).',
    severity: 'success',
  },
  THANK_YOU_REDIRECT: {
    title: 'Submitted — thank-you redirect confirmed',
    description: 'The form submitted successfully and redirected to a thank-you page.',
    severity: 'success',
  },
  PASS: {
    title: 'All checks passed',
    description: 'The contact form works end-to-end.',
    severity: 'success',
  },
  ERROR: {
    title: 'Unhandled error',
    description: 'An unexpected error occurred during the run.',
    severity: 'error',
  },
};

export function getReasonMessage(code: string): ReasonMessage {
  return MESSAGES[code] ?? {
    title: code.replace(/_/g, ' ').toLowerCase(),
    description: '',
    severity: 'warn',
  };
}
