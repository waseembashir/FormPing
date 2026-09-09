// ─── Enums & Union Types ────────────────────────────────────────────────────

export type SubmitMode = 'live' | 'safe' | 'detect-only';

export type FinalStatus = 'pass' | 'fail' | 'warn' | 'error';

export type ReasonCode =
  | 'CONTACT_PAGE_NOT_FOUND'
  | 'CONTACT_PAGE_AMBIGUOUS'
  | 'FORM_NOT_FOUND'
  // A <form> exists on the page but none scored as a contact form (e.g. a
  // search/newsletter/quiz form). Distinct from FORM_NOT_FOUND (nothing at all)
  // so the user hears "found a form, but not a contact one" — FR-28.
  | 'NON_CONTACT_FORM_FOUND'
  // The only thing we could match is a single-input <form> — a stray search box,
  // a footer email capture, a hidden modal. Filling its one field and calling it
  // healthy is how the tester used to invent a contact form nobody could see, so
  // we now stop, say what we found, and ask the user to confirm. FR-73.
  | 'LOW_CONFIDENCE_FORM'
  // A known third-party embed (Typeform, HubSpot, Calendly, Jotform, Tally, …)
  // is present: the form provably exists but is a cross-origin embed we can't
  // auto-fill. Reported so the user knows it's there — FR-28.
  | 'THIRD_PARTY_EMBED_FORM'
  | 'FORM_AMBIGUOUS'
  | 'BLOCKED_BY_HOST'
  | 'CAPTCHA_DETECTED'
  | 'ANTI_BOT_DETECTED'
  | 'REQUIRED_FIELDS_UNSUPPORTED'
  // A contact form was DETECTED but it lives in a hidden multi-step widget
  // (a display:none step revealed on "Next"), so its fields aren't reachable for
  // a blind fill yet. Detected — not broken. Distinct from
  // REQUIRED_FIELDS_UNSUPPORTED (a visible form whose fields we couldn't touch)
  // so the card can say "found, multi-step" instead of "could not fill". Walking
  // the steps to fill/submit is Phase 2 (FR-63). FR-64.
  | 'MULTI_STEP_FORM_DETECTED'
  // Live mode: a multi-step/wizard form was filled through its steps, but the
  // submission was deliberately HELD because it wasn't a clean, complete entry
  // (didn't reach the final step, or no email was filled) — so we don't drop a
  // partial/junk submission into the client's inbox. FR-63.
  | 'SUBMIT_HELD_INCOMPLETE'
  | 'SAFE_MODE_NO_SUBMIT'
  | 'DETECT_ONLY'
  | 'SUBMIT_FAILED'
  | 'SUBMISSION_BLOCKED_BY_ANTISPAM'
  | 'PROXY_REJECTED_POST'
  | 'VALIDATION_ERROR'
  // The site's OWN endpoint returned 5xx when the form was submitted — the form
  // is wired up, we filled it correctly, and their server broke. Distinct from
  // VALIDATION_ERROR (which blames the data we entered) because the fix belongs
  // to whoever owns the site, not to us. FR-73.
  | 'SERVER_ERROR'
  | 'NO_REDIRECT_NO_SUCCESS'
  | 'INLINE_SUCCESS_ONLY'
  | 'THANK_YOU_REDIRECT'
  | 'PASS'
  | 'ERROR';

export type SubmissionResult =
  | 'not_attempted'
  | 'success'
  | 'validation_error'
  | 'captcha_blocked'
  | 'anti_bot_blocked'
  | 'submit_failed'
  | 'timeout';

// ─── Config ─────────────────────────────────────────────────────────────────

export interface AppConfig {
  mode: SubmitMode;
  headless: boolean;
  timeout: number;
  navigationTimeout: number;
  batchConcurrency: number;
  /** AI provider selection for form-tester ambiguity resolution.
   * 'off' = deterministic only; 'auto' = first configured in priority order. */
  aiProvider: 'off' | 'auto' | 'anthropic' | 'gemini' | 'groq' | 'ollama';
  /** When a site is BLOCKED_BY_HOST on the direct cloud-IP attempt, retry once
   * via Browserbase's residential-IP browser. Requires BROWSERBASE_API_KEY
   * and BROWSERBASE_PROJECT_ID env vars. Defaults to false because each
   * residential session is billed. */
  residentialFallback: boolean;
  /** "Landing page" mode. When true, skip contact-page discovery and run form
   * detection DIRECTLY on the given URL (no crawling to other pages). For
   * standalone landing pages whose form is inline and which have no separate
   * /contact page. Defaults to false — normal discovery behaviour. */
  landingPage: boolean;
  saveScreenshotOnFailure: boolean;
  saveHtmlSnapshotOnFailure: boolean;
  outputFile?: string;
  prettyJson: boolean;

  testData: TestData;

  thankYouUrlPatterns: RegExp[];
  inlineSuccessPatterns: RegExp[];
  validationErrorPatterns: RegExp[];
  captchaPatterns: RegExp[];
  antiBotPatterns: RegExp[];

  contactPathPatterns: RegExp[];
  contactTextPatterns: RegExp[];
  excludePathPatterns: RegExp[];
}

export interface TestData {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  message: string;
}

// ─── Discovery ──────────────────────────────────────────────────────────────

export interface ContactCandidate {
  url: string;
  score: number;
  signals: string[];
  pageScore?: number;
  pageSignals?: string[];
  totalScore?: number;
}

// ─── Forms ──────────────────────────────────────────────────────────────────

export interface FormIdentifier {
  id: string | null;
  name: string | null;
  action: string | null;
  method: string | null;
}

/** A light classification of what a form is FOR — derived from its fields +
 *  submit/text, so a page with several forms can be described honestly. FR-68. */
export type FormKind = 'contact' | 'newsletter' | 'search' | 'login' | 'other';

/** Roughly WHERE a form sits on the page, so we can say "in the footer" /
 *  "under 'Subscribe'" and offer a jump-to link. All optional. FR-68. */
export interface FormLocation {
  /** Nearest landmark region: header | footer | navigation | sidebar | main content. */
  landmark?: string;
  /** Nearest heading text above the form. */
  heading?: string;
  /** id of the form (or nearest ancestor with one) — for a `page#id` deep link. */
  anchorId?: string;
}

export interface FormCandidate {
  index: number;
  identifier: FormIdentifier;
  score: number;
  signals: string[];
  negativeSignals: string[];
  /** What this form looks like it's for (contact / newsletter / search / …). FR-68. */
  kind: FormKind;
  /** Roughly where this form sits on the page. FR-68. */
  location?: FormLocation;
  /** The form's detected fields (label + input type), so the caller can report
   *  "N fields: Name, Email, Message …" without re-reading the DOM. FR-64. */
  fields: DetectedFormField[];
  /** A CAPTCHA widget inside THIS form. Page-wide bot protection is tracked
   *  separately — it says nothing about whether this form is protected. FR-73. */
  captcha?: boolean;
  /** What the form is called on the page — nearest heading, else submit text. FR-73. */
  about?: string;
}

/** A single field detected on a form — the bits worth showing a user. FR-64. */
export interface DetectedFormField {
  label: string;
  type: string;
  /** The field's `name` — used to collapse radio/checkbox groups into one
   *  logical field so counts are accurate (5 radio options ≠ 5 fields). FR-68. */
  name?: string;
}

/** A compact, human-facing summary of ONE of the other forms on the page. FR-68. */
export interface FormBrief {
  kind: FormKind | 'third-party';
  identifier: FormIdentifier | null;
  /** Provider name when kind === 'third-party' (Typeform, HubSpot, …). */
  provider?: string;
  /** Fillable-field count for a native form. */
  fieldCount?: number;
  /** Roughly where on the page this form sits. FR-68. */
  location?: FormLocation;
}

/** Hidden tracking params a form captures — campaign attribution for its leads.
 *  `utm` = utm_source/medium/campaign/…; `other` = gclid/fbclid/… FR-68. */
export interface TrackingParams {
  utm: string[];
  other: string[];
}

/** What actually happened to a detected lead form when we tried to fill it (site
 *  inventory now fills every lead form, not just the primary). `detected` = we
 *  didn't attempt a fill (detect-only, or a utility form like search/newsletter);
 *  `filled` = fields entered, not submitted; `submitted` = a live submit went
 *  through; `skipped` = nothing fillable reached (e.g. hidden multi-step);
 *  `failed` = the fill attempt errored. FR-76. */
export interface FormOutcome {
  state: 'detected' | 'filled' | 'submitted' | 'skipped' | 'failed';
  /** How many fields we actually filled (for `filled` / `submitted`). */
  filledCount?: number;
  /** A short, plain qualifier — e.g. "multi-step", "no fillable fields reached". */
  note?: string;
}

/** One form found anywhere on the SITE (across pages), for the site-level
 *  inventory: what it is, where it lives, its fields, security + tracking. FR-68. */
export interface SiteForm {
  /** The page URL where this form lives (its live source/address). */
  url: string;
  kind: FormKind | 'third-party';
  /** Human "what it's about" — nearest heading, else submit-button text. */
  about: string;
  formType: 'native' | 'third-party';
  /** Provider when third-party (Typeform, HubSpot, …). */
  provider?: string;
  /**
   * How the embed reaches the page, when this is a third-party form.
   *
   * `container` means the provider rendered a real <form> into THIS page's DOM,
   * so its fields are readable like any native form's. `iframe` means the form
   * lives in a cross-origin document we cannot read into — we can photograph it
   * (a screenshot captures rendered pixels either way) but not inspect it. The
   * two used to be collapsed, and everything unreadable was reported as if it
   * had been read and found empty. FR-84.
   */
  embedKind?: 'iframe' | 'script' | 'container';
  /**
   * Accurate fillable-field count (groups collapsed, hidden dropped).
   *
   * OMITTED when the fields could not be read at all — a cross-origin embed. It
   * is not `0`: zero asserts "we looked and there are none", which appeared under
   * a screenshot showing six. Absent means "we could not look", and every
   * renderer must show nothing rather than a number. FR-84.
   */
  fieldCount?: number;
  fields: DetectedFormField[];
  /** `captcha` = a widget on THIS form. `pageProtection` = bot-protection markup
   *  somewhere on the page it lives on — true of the whole page, not evidence
   *  about this form, so the two are never conflated on the card. FR-73. */
  security: {
    /**
     * A CAPTCHA widget on THIS form. OMITTED when it could not be determined —
     * inside a cross-origin embed, `false` would claim the form is unprotected
     * when the screenshot may plainly show a reCAPTCHA badge on it. FR-84.
     */
    captcha?: boolean;
    /** Bot-protection markup somewhere on the page it lives on — true of the
     *  whole page, not evidence about this form, so the two are never conflated
     *  on the card. FR-73. */
    pageProtection?: boolean;
  };
  /**
   * Which vendor's challenge widget was found on this form, when one was.
   *
   * For a hosted form this comes from the frame tree rather than the DOM: a
   * reCAPTCHA frame whose ancestors lead back to the form's own frame is on
   * that form. Absent means none was seen — never that none exists. FR-84.
   */
  captchaVendor?: string;
  tracking: TrackingParams;
  /** An element id to jump straight to this form — `url#anchorId`. FR-73. */
  anchorId?: string;
  /** Evidence: a cropped screenshot of the form as we saw it. A `data:` URL from
   *  the engine, swapped for a hosted URL by the run route before it reaches the
   *  browser, so the heavy bytes never touch the client or its cache. FR-73. */
  shot?: string;
  /** True when this same form appears on many pages (search/footer newsletter). */
  siteWide: boolean;
  /** How many crawled pages this form was seen on. */
  seenOn: number;
  /** What we did with it this run — fill every lead form, detect the rest. FR-76. */
  outcome?: FormOutcome;
  /** The form's hidden inputs (nonces, form/page ids, utm_*…) as name=value —
   *  dropped from the visible count, surfaced in a "Hidden fields" disclosure. The
   *  values differ per form, proving they're detected per form, not shared. FR-76. */
  hiddenFields?: { name: string; value: string }[];
}

/** "This page has N forms" — surfaced only when total ≥ 2, so single-form pages
 *  read exactly as before (no "1 form" noise). FR-68. */
export interface FormsOnPage {
  total: number;
  native: number;
  embeds: number;
  /** The form we actually tested (kind + identifier), or null if none chosen. */
  tested: { kind: FormKind; identifier: FormIdentifier | null } | null;
  /** Every OTHER form on the page, lightly classified. */
  others: FormBrief[];
  /** True when 2+ native forms look like plausible contact forms (ambiguity). */
  multipleContacts: boolean;
}

export interface FilledField {
  label: string;
  type: string;
  value: string;
}

// ─── Results ────────────────────────────────────────────────────────────────

export interface SiteResult {
  inputUrl: string;
  normalizedUrl: string;
  mode: SubmitMode;
  resolvedContactPage: string | null;
  contactPageFound: boolean;
  contactPageConfidence: number;
  formFound: boolean;
  formConfidence: number;
  formIdentifier: FormIdentifier | null;
  submissionAttempted: boolean;
  submissionResult: SubmissionResult;
  redirectUrl: string | null;
  finalUrl: string | null;
  thankYouDetected: boolean;
  inlineSuccessDetected: boolean;
  captchaDetected: boolean;
  antiBotDetected: boolean;
  finalStatus: FinalStatus;
  reasonCode: ReasonCode;
  notes: string[];
  errors: string[];
  durationMs: number;
  error?: string;

  // ── Detected-form facts (FR-64) ────────────────────────────────────────────
  // Populated whenever a form (native or third-party) is present on the tested
  // page, so the result card can describe what was found instead of a bare
  // "detected". All optional — absent on discovery failures / error results.
  /** Whether the form we found is a hand-coded DOM form or a hosted embed. */
  formType?: 'native' | 'third-party';
  /** Provider of a third-party embed, e.g. "Typeform" (only when third-party). */
  embedProvider?: string | null;
  /** How a third-party embed is mounted — answers "iframe or normal DOM form". */
  embedKind?: 'iframe' | 'script' | 'container' | null;
  /** Number of fields detected on the chosen native form. */
  fieldCount?: number;
  /** The detected native fields (label + type) — for "Name, Email, Message …". */
  fields?: DetectedFormField[];
  /** True when the native form sits in a hidden multi-step widget (FR-62). */
  isMultiStep?: boolean;
  /** How sure we are this is really the contact form. `low` means we matched
   *  something weak — accepted only because Landing-page mode asserted the form
   *  is here — so the card must ask "is this your form?" instead of showing a
   *  confident green pass. FR-73. */
  formConfidenceLevel?: 'high' | 'low';
  /** Plain, user-facing reason the match is low-confidence. FR-73. */
  lowConfidenceReason?: string;
  /** Bot-protection markup was seen on the PAGE (a site-wide reCAPTCHA script,
   *  say) — separate from `captchaDetected`-on-this-form, so we never present
   *  page-level protection as evidence about the form we tested. FR-73. */
  pageProtection?: boolean;
  /** An element id to jump straight to the tested form — `page#anchorId`. FR-73. */
  formAnchorId?: string;
  /** What the form is CALLED on the page — its nearest heading ("Request a
   *  Rental"), else its submit-button text. The whole-site report has always
   *  shown this per form; without it here, a single-page run could only say
   *  "Contact form" while the form on screen said something else. FR-73. */
  formAbout?: string;
  /** WHAT the matched form is — contact / newsletter / search / login / other.
   *  The engine has always known this and uses it to decide whether to fill,
   *  but it never travelled, so a dashboard could say "not a contact form"
   *  without ever saying what it actually was. FR-73. */
  formKind?: FormKind;
  /** Evidence: a cropped screenshot of the tested form. `data:` URL from the
   *  engine, replaced with a hosted URL by the run route. FR-73. */
  formShot?: string;
  /** How many forms are on the tested page + what the others are — only set when
   *  the page has 2+ forms (native + embeds), else absent. FR-68. */
  formsOnPage?: FormsOnPage;
  /** Hidden tracking/UTM params the tested form captures — set whenever a native
   *  form was found (empty arrays = "found a form, but no UTM params"). FR-68. */
  tracking?: TrackingParams;
  /** Every form found across the SITE (site-level crawl) — set in whole-site mode
   *  when the crawl runs; each entry names its page, kind, fields, security,
   *  tracking. Absent in landing-page mode. FR-68. */
  siteForms?: SiteForm[];
  /** True when the run skipped discovery and tested the given URL directly
   *  (Landing-page mode) — the card must not show a "contact page" confidence. */
  landingPageMode?: boolean;
}
