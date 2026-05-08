export type SubmitMode = 'live' | 'safe' | 'detect-only';

// ─── AI provider types ──────────────────────────────────────────────────────

export type AiProviderId = 'anthropic' | 'gemini' | 'groq' | 'ollama';
export type AiProviderSelection = 'off' | 'auto' | AiProviderId;

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  modelLabel: string;
  configured: boolean;
  available: boolean;
  setupHint: string;
}

export interface AiProvidersResponse {
  providers: AiProviderInfo[];
  fallback: AiProviderId | null;
}
export type FinalStatus = 'pass' | 'fail' | 'warn' | 'error';

export interface FormIdentifier {
  id: string | null;
  name: string | null;
  action: string | null;
  method: string | null;
}

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
  submissionResult: string;
  redirectUrl: string | null;
  finalUrl: string | null;
  thankYouDetected: boolean;
  inlineSuccessDetected: boolean;
  captchaDetected: boolean;
  antiBotDetected: boolean;
  finalStatus: FinalStatus;
  reasonCode: string;
  notes: string[];
  errors: string[];
  durationMs: number;
  error?: string;
}

export interface RunConfig {
  mode: SubmitMode;
  email: string;
  timeout: number;
  headed: boolean;
  /** AI provider for ambiguity disambiguation in form-tester */
  aiProvider: AiProviderSelection;
  concurrency: number;
}

export type SSEEvent =
  | { type: 'progress'; url: string; index: number; total: number }
  | { type: 'result'; result: SiteResult }
  | { type: 'log'; message: string }
  | { type: 'done'; exitCode: number | null }
  | { type: 'error'; message: string };

export interface RunProgress {
  current: number;
  total: number;
  currentUrl: string;
}

// ─── Monitor types ──────────────────────────────────────────────────────────

export type MonitorMode = 'snapshot' | 'compare' | 'watch';
export type ChangeSeverity = 'low' | 'medium' | 'high';

export type TextChangeType = 'added' | 'removed' | 'edited';
export type TextChangeKind = 'heading' | 'paragraph' | 'listItem' | 'other';

export interface TextLocation {
  section?: string;
  heading?: string;
  selector?: string;
  tag?: string;
}

export interface TextChange {
  type: TextChangeType;
  kind: TextChangeKind;
  before?: string;
  after?: string;
  meta?: string;
  location?: TextLocation;
}

export interface PageChange {
  url: string;
  changes: string[];
  textChanges?: TextChange[];
  severity: ChangeSeverity;
}

export interface PageHashStatus {
  url: string;
  hashChanged: boolean;
  oldLength: number;
  newLength: number;
}

export interface ChangeReport {
  site: string;
  rootUrl: string;
  checkedAt: string;
  previousSnapshot: string | null;
  pagesScanned: number;
  pagesChanged: number;
  changesFound: number;
  summary: string;
  /** Model label that produced the summary (e.g. "Gemini 2.5 Flash") */
  summaryProvider?: string;
  details: PageChange[];
  hashStatus?: PageHashStatus[];
}

export interface SnapshotResult {
  snapshotPath: string;
  site: string;
  pagesScanned: number;
}

export interface MonitorConfig {
  monitorMode: MonitorMode;
  maxPages: number;
  takeScreenshots: boolean;
  /** AI provider for the change-summary call */
  aiProvider: AiProviderSelection;
  watchIntervalMs: number;
}

export type MonitorSSEEvent =
  | { type: 'log'; message: string }
  | { type: 'snapshot'; result: SnapshotResult }
  | { type: 'report'; report: ChangeReport }
  | { type: 'done'; exitCode: number | null }
  | { type: 'error'; message: string };
