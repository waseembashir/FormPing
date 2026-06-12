/**
 * Rule-based, free suggestions derived from a run's reason code and the
 * detected changes. Turns a technical result into a plain-English next action
 * for the dev. (An optional AI layer can enrich these later; this stays the
 * always-available, zero-cost baseline.)
 */

import type { FormRunRecord } from './types';

export function buildSuggestions(record: FormRunRecord, changes: string[]): string[] {
  const out: string[] = [];

  switch (record.reasonCode) {
    case 'CAPTCHA_DETECTED':
      out.push(
        'The form is protected by CAPTCHA, so automated submission is blocked. Whitelist the tester (QA bypass token) or verify the form manually.',
      );
      break;
    case 'ANTI_BOT_DETECTED':
    case 'BLOCKED_BY_HOST':
      out.push(
        'The site blocked the test request (anti-bot/firewall). The form itself may be fine — check whether a security rule is rejecting automated traffic.',
      );
      break;
    case 'FORM_NOT_FOUND':
    case 'CONTACT_PAGE_NOT_FOUND':
      out.push(
        'No contact form was found this cycle. The contact page may have moved or the form may have been removed — open the page and confirm.',
      );
      break;
    case 'VALIDATION_ERROR':
      out.push(
        'Submission was rejected by form validation. A required field may have been added or its rules changed — review the form fields.',
      );
      break;
    case 'SUBMIT_FAILED':
      out.push(
        'The submit action failed. The submit button or handler may have changed — check the form on the page.',
      );
      break;
    case 'SUBMISSION_BLOCKED_BY_ANTISPAM':
      out.push(
        'The submission was silently filtered by an anti-spam system. Leads may be getting dropped server-side — verify the inbox/CRM is receiving entries.',
      );
      break;
    case 'NO_REDIRECT_NO_SUCCESS':
      out.push(
        'The form submitted but showed no success confirmation. It may have failed silently — confirm a test entry actually arrived.',
      );
      break;
    default:
      break;
  }

  if (changes.some((c) => /no longer detected/i.test(c))) {
    out.push('Priority: the form disappeared since the last check — investigate the page right away.');
  }
  if (changes.some((c) => /CAPTCHA newly appeared/i.test(c))) {
    out.push('A CAPTCHA was added since the last check — automated submissions will now fail until the tester is whitelisted.');
  }
  if (changes.some((c) => /submit endpoint\) changed/i.test(c))) {
    out.push('The form now posts to a different endpoint — confirm submissions still reach the intended inbox/CRM.');
  }

  return out;
}
