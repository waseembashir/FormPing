// ─── Enums & Union Types ────────────────────────────────────────────────────

export type SubmitMode = 'live' | 'safe' | 'detect-only';

export type FinalStatus = 'pass' | 'fail' | 'warn' | 'error';

export type ReasonCode =
  | 'CONTACT_PAGE_NOT_FOUND'
  | 'CONTACT_PAGE_AMBIGUOUS'
  | 'FORM_NOT_FOUND'
  | 'FORM_AMBIGUOUS'
  | 'BLOCKED_BY_HOST'
  | 'CAPTCHA_DETECTED'
  | 'ANTI_BOT_DETECTED'
  | 'REQUIRED_FIELDS_UNSUPPORTED'
  | 'SAFE_MODE_NO_SUBMIT'
  | 'DETECT_ONLY'
  | 'SUBMIT_FAILED'
  | 'SUBMISSION_BLOCKED_BY_ANTISPAM'
  | 'PROXY_REJECTED_POST'
  | 'VALIDATION_ERROR'
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

export interface FormCandidate {
  index: number;
  identifier: FormIdentifier;
  score: number;
  signals: string[];
  negativeSignals: string[];
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
}
