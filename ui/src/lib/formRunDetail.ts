/**
 * FR-67 — the rich Form Tester run detail we persist alongside the thin
 * pass/fail row, so the per-URL dashboard can show WHICH form / type / fields /
 * why-it-failed, not just a badge. Stored as `form_tester_runs.detail` jsonb.
 *
 * Self-contained on purpose: no imports, so it's importable from the engine's
 * Vitest suite for the raw→stored mapping test (a shape change can't silently
 * drop fields again). `extractFormRunDetail` is pure + defensive — the input is
 * the raw SiteResult streamed off the CLI's stdout (`unknown`), so every field is
 * validated before it's kept, and a bad shape yields `{}` rather than throwing.
 */

/**
 * One form the run found anywhere on the site — enough to reproduce the Form
 * Tester's per-form panel on the dashboard (everything EXCEPT the field names,
 * which are noise once you're looking at a URL-level summary).
 */
export interface FormRunFormSummary {
  /** The full page URL the form lives on. */
  url: string;
  /** contact | newsletter | search | login | other | third-party */
  kind: string;
  /** The form's headline / what it's for ("Request a Rental"). */
  about?: string;
  formType?: 'native' | 'third-party';
  provider?: string;
  fieldCount?: number;
  /** Bot protection seen on the form. */
  captcha?: boolean;
  /** A site-wide header/footer form that appears on every page. */
  siteWide?: boolean;
  seenOn?: number;
  /** Marketing params the form captures (utm_*). */
  utm?: string[];
  /** detected | filled | submitted | skipped | failed */
  outcome?: string;
  /** True for the one form the run actually tested. */
  primary?: boolean;
  /** Hosted URL of this form's screenshot, so the per-URL dashboard can show the
   *  same evidence the tester did. Only ever an http(s) URL — an inline `data:`
   *  image would bloat every stored row, so it is rejected here. FR-73. */
  shot?: string;
}

export interface FormRunDetail {
  formType?: 'native' | 'third-party';
  embedProvider?: string | null;
  embedKind?: 'iframe' | 'script' | 'container' | null;
  fieldCount?: number;
  fields?: { label: string; type: string }[];
  isMultiStep?: boolean;
  /**
   * One hosted screenshot per step of a multi-step walk, in order.
   *
   * Only the Form Tester produces these; a scheduled check keeps its single
   * shot. Hosted URLs only, for the same reason every other shot is: base64 in
   * a row would put a few hundred KB into every read of it.
   */
  stepShots?: string[];
  /** What the matched form is — contact / newsletter / search / login / other.
   *  Without it the dashboard could say "not a contact form" but never say what
   *  it WAS, which is the one thing the reader wants to know. FR-73. */
  formKind?: string;
  /** The page the form was actually found on (may differ from the entered URL). */
  resolvedPage?: string | null;
  landingPageMode?: boolean;
  /** FR-79 — the run loaded a pinned page instead of searching the site. */
  pinnedPageMode?: boolean;
  submissionAttempted?: boolean;
  submissionResult?: string;
  thankYouDetected?: boolean;
  inlineSuccessDetected?: boolean;
  /** A CAPTCHA widget on the tested FORM (page-level protection is `pageProtection`). */
  captchaDetected?: boolean;
  /** Bot-protection markup on the page — true of the page, not of the form. FR-73. */
  pageProtection?: boolean;
  antiBotDetected?: boolean;
  /** How sure we were that this is really the contact form. Persisted so the
   *  per-URL dashboard hedges exactly where the tester did — one story in both
   *  places, rather than a confident dashboard over an unsure run. FR-73. */
  confidence?: 'high' | 'low';
  /** Plain reason the match was low-confidence. FR-73. */
  lowConfidenceReason?: string;
  tracking?: { utm: string[]; other: string[] };
  /** How many forms were on the tested page (2+ only). */
  formsOnPageTotal?: number;
  /** How many forms the whole-site inventory found. */
  siteFormsCount?: number;
  /** Every form found on the site + what happened to it, so the dashboard can
   *  list them all rather than just the one we tested. */
  forms?: FormRunFormSummary[];
  notes?: string[];
  errors?: string[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
/** Trailing-slash-insensitive pathname, for matching the primary contact page. */
const pathOf = (u: string | null): string | null => {
  if (!u) return null;
  try { return (new URL(u).pathname || '/').replace(/\/+$/, '') || '/'; } catch { return u; }
};

/** Pull the rich facts out of a raw SiteResult, defensively. Never throws. */
export function extractFormRunDetail(raw: unknown): FormRunDetail {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const d: FormRunDetail = {};

  if (r.formType === 'native' || r.formType === 'third-party') d.formType = r.formType;
  if (typeof r.embedProvider === 'string' || r.embedProvider === null) d.embedProvider = r.embedProvider as string | null;
  if (r.embedKind === 'iframe' || r.embedKind === 'script' || r.embedKind === 'container') d.embedKind = r.embedKind;

  const fc = num(r.fieldCount);
  if (fc !== undefined) d.fieldCount = fc;

  if (Array.isArray(r.fields)) {
    const fields = r.fields
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({ label: str(f.label) ?? '', type: str(f.type) ?? '' }))
      .filter((f) => f.label || f.type)
      .slice(0, 40);
    if (fields.length) d.fields = fields;
  }

  const ms = bool(r.isMultiStep); if (ms !== undefined) d.isMultiStep = ms;

  // Hosted only, and capped. A wizard the engine walked to its limit could
  // otherwise put a dozen URLs in a row that is read on every dashboard load.
  if (Array.isArray(r.stepShots)) {
    const steps = (r.stepShots as unknown[])
      .filter((s): s is string => typeof s === 'string' && /^https?:\/\//.test(s))
      .slice(0, 12);
    if (steps.length) d.stepShots = steps;
  }
  const kind = str(r.formKind); if (kind !== undefined) d.formKind = kind;
  if (typeof r.resolvedContactPage === 'string' || r.resolvedContactPage === null) d.resolvedPage = r.resolvedContactPage as string | null;
  const lp = bool(r.landingPageMode); if (lp !== undefined) d.landingPageMode = lp;
  const pin = bool(r.pinnedPageMode); if (pin !== undefined) d.pinnedPageMode = pin;
  const sa = bool(r.submissionAttempted); if (sa !== undefined) d.submissionAttempted = sa;
  const sr = str(r.submissionResult); if (sr !== undefined) d.submissionResult = sr;
  const ty = bool(r.thankYouDetected); if (ty !== undefined) d.thankYouDetected = ty;
  const inl = bool(r.inlineSuccessDetected); if (inl !== undefined) d.inlineSuccessDetected = inl;
  const cap = bool(r.captchaDetected); if (cap !== undefined) d.captchaDetected = cap;
  const pp = bool(r.pageProtection); if (pp !== undefined) d.pageProtection = pp;
  const ab = bool(r.antiBotDetected); if (ab !== undefined) d.antiBotDetected = ab;
  if (r.formConfidenceLevel === 'high' || r.formConfidenceLevel === 'low') d.confidence = r.formConfidenceLevel;
  const lcr = str(r.lowConfidenceReason); if (lcr !== undefined) d.lowConfidenceReason = lcr;

  if (r.tracking && typeof r.tracking === 'object') {
    const t = r.tracking as Record<string, unknown>;
    d.tracking = { utm: strArr(t.utm) ?? [], other: strArr(t.other) ?? [] };
  }
  if (r.formsOnPage && typeof r.formsOnPage === 'object') {
    const total = num((r.formsOnPage as Record<string, unknown>).total);
    if (total !== undefined) d.formsOnPageTotal = total;
  }
  if (Array.isArray(r.siteForms)) {
    d.siteFormsCount = r.siteForms.length;

    // The inventory records the primary contact form as merely "detected" (it
    // deliberately doesn't re-fill it — the main run does). So for that one form,
    // report what the RUN actually did, otherwise the dashboard would under-claim.
    const primaryPath = pathOf(typeof r.resolvedContactPage === 'string' ? r.resolvedContactPage : null);
    const mode = str(r.mode) ?? '';
    const ranOutcome =
      mode === 'live' && r.submissionAttempted === true ? 'submitted'
      : (mode === 'live' || mode === 'safe') && r.formFound === true ? 'filled'
      : 'detected';

    const forms = r.siteForms
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => {
        const url = str(f.url) ?? '';
        const kind = str(f.kind) ?? 'other';
        const outcomeState = f.outcome && typeof f.outcome === 'object'
          ? str((f.outcome as Record<string, unknown>).state)
          : undefined;
        const isPrimary = kind === 'contact' && primaryPath !== null && pathOf(url) === primaryPath;
        const summary: FormRunFormSummary = {
          url,
          kind,
          outcome: isPrimary ? ranOutcome : (outcomeState ?? 'detected'),
        };
        if (isPrimary) summary.primary = true;

        const about = str(f.about); if (about) summary.about = about;
        if (f.formType === 'native' || f.formType === 'third-party') summary.formType = f.formType;
        const provider = str(f.provider); if (provider) summary.provider = provider;
        const fc = num(f.fieldCount); if (fc !== undefined) summary.fieldCount = fc;

        const sec = f.security && typeof f.security === 'object' ? (f.security as Record<string, unknown>) : undefined;
        const captcha = bool(sec?.captcha); if (captcha !== undefined) summary.captcha = captcha;

        const sw = bool(f.siteWide); if (sw !== undefined) summary.siteWide = sw;
        const seen = num(f.seenOn); if (seen !== undefined) summary.seenOn = seen;

        const tr = f.tracking && typeof f.tracking === 'object' ? (f.tracking as Record<string, unknown>) : undefined;
        const utm = strArr(tr?.utm); if (utm && utm.length) summary.utm = utm;

        // Hosted images only. The run route swaps the engine's inline `data:`
        // image for a URL before this ever runs; if that failed, storing the
        // base64 would put a few hundred KB in every row. FR-73.
        const shot = str(f.shot);
        if (shot && /^https?:\/\//.test(shot)) summary.shot = shot;

        return summary;
      })
      .filter((f) => f.url)
      .slice(0, 25);
    if (forms.length) d.forms = forms;
  }

  const notes = strArr(r.notes); if (notes && notes.length) d.notes = notes.slice(0, 20);
  const errors = strArr(r.errors); if (errors && errors.length) d.errors = errors.slice(0, 20);

  return d;
}
