/**
 * What a scheduled run actually found, in a line short enough for Slack. FR-91.
 *
 * The v2.1.0 engine rebuild taught a run to report a great deal: what kind of
 * form it is, who hosts it, how many fields it has, how many forms sit on the
 * page, whether it is multi-step, and how sure the engine was that it found the
 * right one. The Tester card and the per-URL dashboard show all of it.
 *
 * The Slack message showed none of it. A third-party form on a client's site
 * produced "Third-party form detected" and nothing else — no provider name, no
 * page — which reads as "we found something, we don't know what", and that is
 * exactly how it was reported. The suggestion attached to it even told the
 * reader the provider was "named in the notes", and notes were never sent.
 *
 * So the same facts now travel with the alert. The constraint is real, though:
 * Slack throttles incoming webhooks and caps a section at 3000 characters, and
 * a message nobody reads because it is a wall of text is no better than a
 * message that says nothing. This is therefore a LINE, not a report — the most
 * useful facts first, hard-capped, with the link carrying everything else.
 */

import type { FormRunRecord } from './types';
import { extractFormRunDetail, type FormRunFormSummary } from '@/lib/formRunDetail';

/**
 * Forms the run found ANYWHERE on the site, not just on the page it tested.
 *
 * This is the inventory the Form Tester renders — and the reason a scheduled run
 * could contradict it. hutch.agency has a newsletter sign-up on the homepage and
 * a HubSpot form on /contact-us. The scheduler tested the homepage, reported
 * "Found a form — not a contact form", and said nothing about the HubSpot form,
 * because everything downstream was built from the FINGERPRINT — which carries
 * only the tested page — while the whole-site inventory sat unused in the same
 * run's stored detail.
 *
 * Passing the raw engine result here is what closes that gap: the notification
 * now reads from the same data the Tester does, so the two cannot disagree about
 * what a single run found.
 */
function otherForms(record: FormRunRecord, raw: unknown): FormRunFormSummary[] {
  if (!raw) return [];
  const detail = extractFormRunDetail(raw);
  const forms = detail?.forms ?? [];
  if (forms.length < 2) return [];
  const testedPage = record.fingerprint?.contactPage ?? null;
  return forms.filter((f) => !testedPage || f.url !== testedPage);
}

/** Plain names for the engine's form kinds. */
const KIND_LABELS: Record<string, string> = {
  newsletter: 'Newsletter sign-up',
  search: 'Search box',
  login: 'Login form',
  contact: 'Contact form',
  'third-party': 'Third-party form',
};

/** The form this run actually tested, from the whole-site inventory. */
function primaryForm(record: FormRunRecord, raw: unknown): FormRunFormSummary | null {
  if (!raw) return null;
  const forms = extractFormRunDetail(raw)?.forms ?? [];
  const tested = record.fingerprint?.contactPage ?? null;
  return forms.find((x) => tested && x.url === tested) ?? forms[0] ?? null;
}

/** A short, human phrase for one of those forms: "HubSpot form on /contact-us". */
function describeOtherForm(form: FormRunFormSummary): string {
  const what =
    form.provider?.trim() ||
    (form.formType === 'third-party' ? 'hosted' : null) ||
    (form.kind && form.kind !== 'other' ? form.kind : null) ||
    'another';
  let path = form.url;
  try {
    path = new URL(form.url).pathname.replace(/\/$/, '') || '/';
  } catch {
    /* keep the raw string if it isn't a URL */
  }
  return `${what} form on ${path}`;
}

/** At most this many facts, whatever else is true. */
const MAX_FACTS = 5;
/** And at most this many characters once joined. Slack allows far more; a
 *  reader glancing at a phone notification does not. */
const MAX_CHARS = 220;

/** The path part of a URL, for "found on /contact" without repeating the host. */
function pathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { pathname } = new URL(url);
    return pathname === '/' || pathname === '' ? 'the homepage' : pathname.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * The facts worth putting in a notification, most useful first.
 *
 * Ordered deliberately: what the form IS comes before how big it is, because a
 * reader scanning Slack wants to know "is this the Typeform we expected?" before
 * anything else. The honesty hedge (FR-73) is never dropped by the cap — it is
 * placed early, because a message that sounds certain when the engine was not is
 * worse than a message missing a field count.
 */
export function formRunFacts(record: FormRunRecord, raw?: unknown): string[] {
  const f = record.fingerprint;
  if (!f) return [];
  const facts: string[] = [];

  // 1. What kind of form, and who hosts it.
  if (f.formType === 'third-party') {
    const provider = f.embedProvider?.trim();
    // The whole point of the ticket: name it when we know it, and say plainly
    // that we don't when we don't — never imply we failed to find anything.
    facts.push(provider ? `${provider} form (embedded)` : 'Embedded third-party form');
  } else if (f.isMultiStep) {
    facts.push('Multi-step form');
  } else if (f.formFound) {
    // Name what it actually is when the run's inventory says so. "Found a form"
    // next to "not a contact form" tells a reader nothing; "Newsletter sign-up"
    // tells them immediately why it did not qualify. FR-91.
    const primary = primaryForm(record, raw);
    const kind = primary?.about?.trim() || KIND_LABELS[primary?.kind ?? ''] || null;
    facts.push(kind ?? 'Form on the page');
  }

  // 2. The engine's own doubt, before any confident-sounding detail. FR-73.
  if (f.formConfidenceLevel === 'low') {
    facts.push(f.lowConfidenceReason?.trim() || 'Not sure this is the contact form');
  }

  // 3. How big it is — only when we actually counted fields.
  if (typeof f.fieldCount === 'number' && f.fieldCount > 0) {
    facts.push(`${f.fieldCount} field${f.fieldCount === 1 ? '' : 's'}`);
  }

  // 4. Where it was found. Only when something WAS found: the crawler still
  //    resolves a contact page when there is no form on it, and "found on
  //    /contact" under a "no form found" verdict would contradict the verdict.
  //    Landing-page mode tested this exact URL, which the message already
  //    shows, so repeating the path there would be noise.
  const path = pathOf(f.contactPage);
  if (f.formFound && path && !f.landingPageMode) {
    facts.push(path === 'the homepage' ? 'found on the homepage' : `found on ${path}`);
  }

  // 5. Forms the run found ELSEWHERE on the site. This goes before the
  //    page-level count because it is the fact most likely to change what a
  //    reader does: "not a contact form" plus "HubSpot form on /contact-us" is
  //    a completely different message from "not a contact form" alone. FR-91.
  const elsewhere = otherForms(record, raw);
  if (elsewhere.length === 1) {
    facts.push(`also found: ${describeOtherForm(elsewhere[0]!)}`);
  } else if (elsewhere.length > 1) {
    facts.push(`also found ${elsewhere.length} more forms, including ${describeOtherForm(elsewhere[0]!)}`);
  }

  // 6. Other forms competing for attention on the SAME page (FR-68). Worded as
  //    "on the page we tested" because `formsOnPage` counts exactly that, and
  //    the looser "on this page" read as a contradiction beside a note about
  //    another page entirely.
  // Only when we have nothing better. Beside "also found: HubSpot form on
  // /contact-us", a page-level count reads as a contradiction rather than an
  // addition — and the site-wide fact is the more useful of the two.
  const total = f.formsOnPage?.total ?? 0;
  if (total > 1 && elsewhere.length === 0) facts.push(`${total} forms on the page we tested`);

  // 7. Why an automated submit may never succeed here.
  if (f.captchaDetected) facts.push('CAPTCHA present');

  return facts.slice(0, MAX_FACTS);
}

/**
 * The facts as one line, within the character budget.
 *
 * Trimming drops whole facts from the end rather than cutting mid-phrase: half a
 * fact is worse than one fewer fact, and the earlier ones are the ones that
 * matter.
 */
export function formRunFactsLine(record: FormRunRecord, raw?: unknown): string | null {
  const facts = formRunFacts(record, raw);
  if (facts.length === 0) return null;

  let line = '';
  for (const fact of facts) {
    const next = line ? `${line} · ${fact}` : fact;
    if (next.length > MAX_CHARS) break;
    line = next;
  }
  return line || null;
}

/**
 * How the run looked for the form — which changes what its result means.
 *
 * A site-wide run crawls the site and reports on the form it judged to be the
 * main contact form. That is not the same claim as "this is the only form on
 * the site", and a reader who assumes it is will trust a green result that only
 * ever covered one of several forms. Landing-page mode makes the opposite,
 * narrower promise: this exact URL, nothing else. Saying which one ran is the
 * difference between an accurate result and a misread one. FR-91.
 */
/**
 * What a run ACTUALLY did with the form — as opposed to what its mode is for.
 *
 * FR-91 added a mode sentence to stop alerts over-claiming, and it over-claimed:
 * it was built from `record.mode` alone, so a Safe run that filled nothing still
 * read "the form was filled", and — far worse — a Live run whose submit failed
 * still read "a real message was submitted". Someone reading that believes a
 * lead was delivered when it was not. FR-96.
 *
 * The engine already states both facts; they just have to be read instead of
 * assumed:
 *
 *  - `submissionResult` is the engine's own word on the submit. Anything other
 *    than 'not_attempted' means the form was filled AND a submit was tried.
 *  - For the 'not_attempted' codes, the reason code says whether filling got
 *    anywhere. Two of them are emitted from BOTH sides of the submit, which is
 *    exactly why the reason code alone cannot be trusted: CAPTCHA_DETECTED and
 *    ANTI_BOT_DETECTED appear pre-fill (runSingleSite ~285/~630) and post-submit
 *    (~735/~748). `submissionResult` disambiguates them.
 */
type Submitted = 'confirmed' | 'unconfirmed' | 'failed' | 'none';

/** Submit outcomes that prove the form was filled and a submit was attempted. */
const ATTEMPTED: Record<string, Submitted> = {
  success: 'confirmed',
  validation_error: 'failed',
  captcha_blocked: 'failed',
  anti_bot_blocked: 'failed',
  submit_failed: 'failed',
  timeout: 'failed',
};

/**
 * Reason codes that reach 'not_attempted' having ALREADY filled the form —
 * filled, then stopped on purpose or blocked before the submit could fire.
 */
const FILLED_BUT_NOT_SUBMITTED = new Set([
  'SAFE_MODE_NO_SUBMIT',
  'SUBMIT_HELD_INCOMPLETE',
  'CAPTCHA_DETECTED',
]);

export interface RunOutcome {
  /** True when we know fields were filled, false when we know they were not. */
  filled: boolean;
  submitted: Submitted;
}

/** What the run did, read from the record rather than inferred from its mode. */
export function runOutcome(record: FormRunRecord): RunOutcome {
  const attempted = ATTEMPTED[record.submissionResult ?? ''];
  if (attempted) {
    // A submit outcome exists, so the form was necessarily filled first.
    // NO_REDIRECT_NO_SUCCESS reports 'success' because the submit action
    // completed — but nothing confirmed it, so it must not read as delivered.
    const submitted: Submitted =
      attempted === 'confirmed' && record.reasonCode === 'NO_REDIRECT_NO_SUCCESS'
        ? 'unconfirmed'
        : attempted;
    return { filled: true, submitted };
  }
  return { filled: FILLED_BUT_NOT_SUBMITTED.has(record.reasonCode), submitted: 'none' };
}

export function formRunScope(record: FormRunRecord): string {
  const f = record.fingerprint;
  const { filled, submitted } = runOutcome(record);

  /**
   * The mode stays as CONTEXT — it explains what this monitor is trying to do —
   * but every claim in the sentence comes from the outcome. Detect mode is the
   * one case where the mode IS the outcome: it fills nothing by design.
   */
  const mode =
    record.mode === 'live'
      ? submitted === 'confirmed'
        ? 'Live mode — a real message was submitted and confirmed'
        : submitted === 'unconfirmed'
          ? 'Live mode — the form was submitted, but no confirmation was seen'
          : submitted === 'failed'
            ? 'Live mode — the form was filled, but the submission did NOT go through'
            : filled
              ? 'Live mode — the form was filled, but nothing was submitted'
              : 'Live mode — the form could not be filled, so nothing was submitted'
      : record.mode === 'safe'
        ? filled
          ? 'Safe mode — the form was filled, then deliberately not submitted'
          : 'Safe mode — the form could not be filled; nothing was submitted'
        : 'Detect mode — we only confirmed a form exists; nothing was filled or submitted';

  const where = f?.landingPageMode
    ? 'only the form on this exact URL was checked'
    : 'searched the whole site, and this is the form we judged to be the main contact form — other forms may exist';

  return `${mode} · ${where}.`;
}

/**
 * What a person still has to do by hand, and why we could not do it.
 *
 * Returns null when the run genuinely tested the form, because an alert that
 * always asks for manual work trains people to ignore the ask.
 *
 * Every branch names the REASON. "Test it manually" on its own reads as the tool
 * giving up; "we cannot submit through a form hosted on the provider's own
 * domain" reads as a fact about the web, which is what it is.
 */
export function manualActionFor(record: FormRunRecord, raw?: unknown): string | null {
  // Every case where the engine could not fill the form owes the reader a
  // reason and an instruction — that is the whole point of this line. FR-96.
  const f = record.fingerprint;
  const provider = f?.embedProvider?.trim();
  const elsewhere = otherForms(record, raw);

  // Before anything else: if the run judged the tested page to have no contact
  // form BUT found one elsewhere on the site, that is the single most useful
  // thing we can say. Saying "no contact form" while the same run holds a
  // HubSpot form on /contact-us is how this tool loses a user's trust. FR-91.
  if (
    elsewhere.length > 0 &&
    (record.reasonCode === 'NON_CONTACT_FORM_FOUND' ||
      record.reasonCode === 'FORM_NOT_FOUND' ||
      record.reasonCode === 'LOW_CONFIDENCE_FORM')
  ) {
    const best = elsewhere.find((x) => x.formType === 'third-party') ?? elsewhere[0]!;
    return `We tested the page this monitor points at and did not find a contact form there — but this same run DID find a ${describeOtherForm(
      best,
    )}. If that is the form you want watched, point this monitor at that URL, or turn on Landing-page mode for it. Nothing was submitted either way.`;
  }

  switch (record.reasonCode) {
    case 'THIRD_PARTY_EMBED_FORM':
      return `We could not fill or submit this form: it runs on ${
        provider ? `${provider}'s` : "the provider's"
      } own domain, and a browser cannot submit across domains. Nothing is wrong — but nobody has confirmed an entry arrives, so send one test entry by hand${
        provider ? `, or rely on ${provider}'s own notifications` : ''
      }.`;

    case 'CAPTCHA_DETECTED':
    case 'ANTI_BOT_DETECTED':
      return 'We could not submit this form: a CAPTCHA or anti-bot check blocks automated entries by design. Send one test entry by hand, or whitelist the tester so scheduled checks can complete.';

    case 'MULTI_STEP_FORM_DETECTED':
      return 'We could not fill this form: it is a multi-step form, and none of its steps offered a field we could type into — usually custom inputs rather than standard ones. The form exists and may be perfectly healthy; confirm it end to end by hand.';

    case 'SUBMIT_HELD_INCOMPLETE':
      return 'We deliberately stopped before submitting: the run did not cleanly reach the final step, so sending a half-filled entry to a real inbox was the wrong call. Finish one entry by hand to confirm it delivers.';

    case 'BLOCKED_BY_HOST':
      return 'We could not reach the form: the site blocked our request, most likely a firewall or bot rule rather than a fault in the form. Check the page by hand, and whitelist the tester if the block is deliberate.';

    case 'NON_CONTACT_FORM_FOUND':
      return 'We did not submit anything: the form we found did not score as a contact form. If it IS the contact form, switch this monitor to Landing-page mode so it tests this URL directly.';

    case 'REQUIRED_FIELDS_UNSUPPORTED':
      return 'We could not fill this form: one or more required fields use an input type the tester cannot complete. The form itself may be perfectly healthy — send one entry by hand to confirm it delivers.';

    case 'VALIDATION_ERROR':
      return 'We filled this form, but the site rejected the entry at validation. A required field may have been added or its rules changed — check the form, then send one entry by hand.';

    case 'SUBMIT_FAILED':
      return 'We filled this form, but the submit itself failed. The submit button or its handler may have changed — confirm by sending one entry by hand.';

    case 'NO_REDIRECT_NO_SUCCESS':
      return 'We submitted this form, but no confirmation of any kind appeared — no thank-you page, no success message. It may have delivered silently, or it may have failed silently. Check the inbox or CRM for the test entry.';

    case 'LOW_CONFIDENCE_FORM':
      return `We are not confident this is your contact form${
        f?.lowConfidenceReason ? `: ${f.lowConfidenceReason.trim()}` : ''
      }. Open the page and confirm which form should be monitored.`;

    default:
      return null;
  }
}
