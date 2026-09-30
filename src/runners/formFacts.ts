import type { DetectedFormField, FormBrief, FormCandidate, FormKind, FormsOnPage, TrackingParams } from '../types.js';
import type { EmbedDetection } from '../forms/detectEmbeds.js';

/**
 * FR-64 — pure helpers that turn raw detection output into the human-facing
 * "what we found" facts on SiteResult. Kept out of the browser-coupled runner so
 * they're unit-testable: given fields / embeds, derive form type, field count +
 * names, and multi-step-ness. No I/O, no Playwright.
 */

// Field `type`s that aren't things a person fills in — excluded from the count
// and the name list so "3 fields: Name, Email, Message" reflects what the user
// actually sees, not hidden tokens or the submit button.
const NON_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const GROUPED_TYPES = new Set(['radio', 'checkbox']);

/**
 * The ONE accurate field counter — used everywhere so counts never disagree.
 * Drops non-inputs (hidden/submit/…) AND collapses a radio/checkbox group that
 * shares a `name` into a single logical field (5 radio options is ONE choice,
 * not 5 fields). Fields without a name are kept as-is. FR-64/FR-68.
 */
export function meaningfulFields(fields: DetectedFormField[]): DetectedFormField[] {
  const out: DetectedFormField[] = [];
  const seenGroups = new Set<string>();
  for (const f of fields) {
    const type = f.type.toLowerCase();
    if (NON_INPUT_TYPES.has(type)) continue;
    if (GROUPED_TYPES.has(type) && f.name) {
      const key = `${type}:${f.name}`;
      if (seenGroups.has(key)) continue; // already counted this group once
      seenGroups.add(key);
    }
    out.push(f);
  }
  return out;
}

/**
 * A field that belongs to the SITE, not to this form — a header/footer search
 * box that sits near the form in the DOM (or is wired to it by a `form`
 * attribute) and gets swept up with it.
 *
 * It must not be counted. A rental form with seven boxes on screen reported
 * "8 fields" because a global search input came along for the ride, and a count
 * that disagrees with the form in front of you undermines every other number on
 * the card. The field is still LISTED — tagged as global — because pretending we
 * never saw it would be its own kind of dishonesty. FR-73.
 *
 * `\bsearch\b` deliberately: "Research budget" is a real field, not a search box.
 */
export function isGlobalField(f: DetectedFormField): boolean {
  if (f.type.toLowerCase() === 'search') return true;
  return /\bsearch\b/i.test(`${f.name ?? ''} ${f.label ?? ''}`);
}

/**
 * The fields that are genuinely this form's own — what "N fields" counts.
 *
 * `kind` matters: a SEARCH form's search input is its own field, not foreign
 * chrome. Filtering it would leave the site's search box reporting "0 fields",
 * which is how a nonsense count sneaks back in from the other direction. FR-73.
 */
export function ownFields(fields: DetectedFormField[], kind?: string): DetectedFormField[] {
  if (kind === 'search') return fields;
  return fields.filter((f) => !isGlobalField(f));
}

export interface NativeFormFacts {
  formType: 'native';
  /** Counts the form's OWN fields — site-wide inputs are excluded. */
  fieldCount: number;
  /** Every meaningful field, global ones included so the UI can show + tag them. */
  fields: DetectedFormField[];
  /**
   * Whether the form is a wizard — `undefined` when nothing measured it.
   *
   * Deliberately three-valued. It was a plain boolean derived from
   * `stepsTraversed`, which only exists after a fill, so Detect-only produced
   * `false` rather than "unknown" and a genuine wizard was labelled
   * "Single-step". A surface that shows this must render nothing when it is
   * undefined rather than picking a default. FR-94.
   */
  isMultiStep?: boolean;
}

/** Facts for a hand-coded DOM `<form>` we detected. */
export function nativeFormFacts(
  form: Pick<FormCandidate, 'fields'> & { kind?: string },
  opts: {
    hiddenMultiStep: boolean;
    stepsTraversed?: number;
    /** From `hasStepControl`, before any filling. Absent when not probed. */
    stepControlFound?: boolean;
  },
): NativeFormFacts {
  const fields = meaningfulFields(form.fields);
  // Any one of these is proof of a wizard; the absence of all three is only
  // proof when we actually looked, which is what stepControlFound records.
  const positive = opts.hiddenMultiStep || (opts.stepsTraversed ?? 0) > 1 || opts.stepControlFound === true;
  const measured = opts.hiddenMultiStep || opts.stepsTraversed !== undefined || opts.stepControlFound !== undefined;
  const isMultiStep = positive ? true : measured ? false : undefined;
  // Count what belongs to the form; list everything we saw. FR-73.
  return { formType: 'native', fieldCount: ownFields(fields, form.kind).length, fields, isMultiStep };
}

/** How much the detector's pick is worth trusting, and why. FR-73. */
export interface FormConfidence {
  level: 'high' | 'low';
  /** Plain, user-facing reason — empty when the match is a confident one. */
  reason: string;
  /** The match is too weak to fill at all: a single-input form is a search box
   *  or an email capture, never a contact form. Fill it and we'd be inventing a
   *  result nobody can verify — so we stop and ask instead. */
  tooWeakToFill: boolean;
}

/**
 * FR-73 — decide how honestly to present a detected form.
 *
 * The engine used to be biased to always say "found something": Landing-page
 * leniency accepts the best form even at a NEGATIVE score, and a stray one-field
 * `<form>` was then filled and reported as a green pass. Two different problems,
 * two different answers:
 *
 *   • one meaningful field  → too weak to fill; report it and ask the user.
 *   • leniency-accepted     → fill it (the user asserted the form is on this
 *                             page — that's the whole point of the mode), but
 *                             present it as a low-confidence match, never a
 *                             confident pass.
 *
 * Pure — unit-tested.
 */
export function assessFormConfidence(opts: {
  score: number;
  /** Count AFTER meaningfulFields() — hidden inputs and submit buttons dropped. */
  fieldCount: number;
  acceptedByLandingLeniency: boolean;
  /** A wizard shows one field at a time on purpose, so a low count says nothing
   *  about whether it's a real contact form. Never judged too weak on size. */
  isMultiStep?: boolean;
}): FormConfidence {
  if (opts.fieldCount <= 1 && !opts.isMultiStep) {
    return {
      level: 'low',
      reason:
        'the only form here has a single input — that reads like a search box or an email sign-up, not a contact form',
      tooWeakToFill: true,
    };
  }
  if (opts.acceptedByLandingLeniency || opts.score < 0) {
    return {
      level: 'low',
      reason:
        'this form is missing the usual contact signals (a message box, a name field, a "Send" button) — we took it because Landing-page mode says the form is on this page',
      tooWeakToFill: false,
    };
  }
  return { level: 'high', reason: '', tooWeakToFill: false };
}

export interface EmbedFormFacts {
  formType: 'third-party';
  embedProvider: string;
  embedKind: 'iframe' | 'script' | 'container';
}

/** Facts for a third-party hosted embed (Typeform, HubSpot, …). Uses the first
 *  detected provider — detectEmbeds reports the most specific one first. */
export function embedFormFacts(embeds: EmbedDetection[]): EmbedFormFacts | null {
  const first = embeds[0];
  if (!first) return null;
  return { formType: 'third-party', embedProvider: first.provider, embedKind: first.kind };
}

/**
 * FR-63 — decide whether to HOLD a live submission on a multi-step/wizard form.
 * Walking a wizard means we chose values on earlier steps, so we only submit for
 * real when we reached the final step AND filled an email (a real, lead-shaped
 * entry). Non-wizard forms are never held here. Pure — unit-tested.
 */
export function shouldHoldMultiStepSubmit(opts: {
  isWizard: boolean;
  reachedSubmit: boolean;
  filledEmail: boolean;
}): boolean {
  if (!opts.isWizard) return false;
  return !(opts.reachedSubmit && opts.filledEmail);
}

// ── FR-68: multi-form classification + summary ───────────────────────────────

/** Structural input for classification — accepts the engine's raw FieldInfo or a
 *  DetectedFormField; only the bits that hint at purpose are read. */
interface ClassifyField {
  type: string;
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
}
interface ClassifyInput {
  fields: ClassifyField[];
  submitText?: string;
  allText?: string;
}

const fieldHay = (f: ClassifyField): string =>
  `${f.type} ${f.name ?? ''} ${f.id ?? ''} ${f.placeholder ?? ''} ${f.label ?? ''}`.toLowerCase();

/**
 * Classify what a form is FOR from its fields + submit/text. Pure + order-
 * sensitive: password → login is the strongest signal, then search, then a
 * lone-email newsletter, then a real contact shape (email + message/name). FR-68.
 */
export function classifyFormKind(form: ClassifyInput): FormKind {
  const text = `${form.submitText ?? ''} ${form.allText ?? ''}`.toLowerCase();
  const fillable = meaningfulFields(form.fields as DetectedFormField[]);

  // Login — a password field is unambiguous.
  if (form.fields.some((f) => f.type.toLowerCase() === 'password')) return 'login';

  // Search — a search input, or "search" text on a tiny form.
  if (form.fields.some((f) => f.type.toLowerCase() === 'search')) return 'search';
  if (/\bsearch\b/.test(text) && fillable.length <= 1) return 'search';

  const hasEmail = form.fields.some(
    (f) => f.type.toLowerCase() === 'email' || /email/.test(fieldHay(f)),
  );

  // Newsletter — subscribe-style intent, or just a lone email input.
  if (/subscribe|newsletter|sign\s?up|join (our|the|my)?\s*(list|newsletter)|get (updates|the newsletter)/.test(text)) {
    return 'newsletter';
  }
  if (hasEmail && fillable.length <= 1) return 'newsletter';

  // Contact — an email plus a message or a name field: a real contact shape.
  const hasMessage = form.fields.some((f) => f.type.toLowerCase() === 'textarea');
  const hasName = form.fields.some((f) => /name/.test(fieldHay(f)) && !/(user|screen)name/.test(fieldHay(f)));
  if (hasEmail && (hasMessage || hasName)) return 'contact';

  return 'other';
}

/**
 * A lead-capture form we'd actually fill — a contact form, or a real multi-field
 * "other" (rental / demo request). Newsletter / search / login are utility inputs
 * and are never filled. Drives which forms the site inventory fills (FR-76).
 */
export function isLeadForm(kind: FormKind, fieldCount: number): boolean {
  if (kind === 'contact') return true;
  if (kind === 'other') return fieldCount > 1;
  return false;
}

/**
 * Build the "N forms on this page" summary from the already-scored native forms
 * + detected embeds. Returns null when the page has fewer than 2 forms, so a
 * single-form page stays exactly as before. Pure — no DOM, unit-tested. FR-68.
 */
export function buildFormsOnPage(
  allForms: Pick<FormCandidate, 'index' | 'identifier' | 'kind' | 'fields' | 'location'>[],
  embeds: EmbedDetection[],
  chosenIndex: number | null,
): FormsOnPage | null {
  const total = allForms.length + embeds.length;
  if (total < 2) return null;

  const tested =
    chosenIndex != null ? allForms.find((f) => f.index === chosenIndex) ?? null : null;

  const others: FormBrief[] = [];
  for (const f of allForms) {
    if (chosenIndex != null && f.index === chosenIndex) continue;
    others.push({ kind: f.kind, identifier: f.identifier, fieldCount: meaningfulFields(f.fields).length, location: f.location });
  }
  for (const e of embeds) {
    others.push({ kind: 'third-party', identifier: null, provider: e.provider });
  }

  return {
    total,
    native: allForms.length,
    embeds: embeds.length,
    tested: tested ? { kind: tested.kind, identifier: tested.identifier } : null,
    others,
    multipleContacts: allForms.filter((f) => f.kind === 'contact').length >= 2,
  };
}

// ── FR-68: hidden tracking / UTM params ──────────────────────────────────────

// Known click/campaign tracking params that lead-gen forms capture as hidden
// fields, so a lead can be attributed to its source. UTM (utm_*) is matched by
// prefix; these are the common non-UTM ones.
const TRACKING_NAMES = new Set([
  'gclid', 'gclsrc', 'wbraid', 'gbraid', 'dclid', // Google
  'fbclid', 'fbc', 'fbp', // Meta
  'msclkid', // Microsoft
  'ttclid', // TikTok
  'li_fat_id', // LinkedIn
  'mc_eid', 'mc_cid', // Mailchimp
  'irclickid', // Impact
  '_hsenc', '_hsmi', 'hsa_cam', // HubSpot
  'referrer', 'ref', 'source', 'campaign',
]);

/**
 * Pull the hidden tracking params a form captures from its field names. `utm`
 * holds utm_* (campaign attribution); `other` holds known click ids. Pure +
 * order-preserving + de-duplicated. FR-68.
 */
export function detectTrackingParams(fields: Pick<DetectedFormField, 'name'>[]): TrackingParams {
  const utm: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const name = (f.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (/^utm_[a-z]+/i.test(name)) {
      utm.push(name);
      seen.add(key);
    } else if (TRACKING_NAMES.has(key)) {
      other.push(name);
      seen.add(key);
    }
  }
  return { utm, other };
}

/** Whether a field name is a marketing/tracking param — utm_* or a known click id
 *  (gclid, fbclid, msclkid…). Used to keep the "Hidden fields" disclosure to the
 *  marketing params that matter, not framework nonces/ids. FR-76. */
export function isMarketingParam(name: string): boolean {
  const key = (name ?? '').trim().toLowerCase();
  if (!key) return false;
  return /^utm_[a-z]+/i.test(key) || TRACKING_NAMES.has(key);
}

/** Human phrase for how an embed is mounted — for the card copy. */
export function embedKindLabel(kind: EmbedDetection['kind']): string {
  switch (kind) {
    case 'iframe':
      return 'embedded in an iframe';
    case 'script':
      return 'injected by a provider script';
    case 'container':
      return 'mounted into a provider container';
  }
}
