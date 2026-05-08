export type MonitorMode = 'snapshot' | 'compare' | 'watch';
export type ChangeSeverity = 'low' | 'medium' | 'high';

export interface FormFieldSnapshot {
  name: string;
  type: string;
  required: boolean;
  label: string;
}

export type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/** Location context for a single text block — surfaces as a breadcrumb in the UI. */
export interface TextLocation {
  /** Closest meaningful ancestor: section name (aria-label/id/semantic class) or tag. */
  section?: string;
  /** Most recent heading text in document order. */
  heading?: string;
  /** Short CSS-ish path, capped to 3-4 levels (e.g. "main > div > p"). */
  selector?: string;
  /** Element tag (p, div, span, etc.) — useful when section/heading are empty. */
  tag?: string;
}

export interface TextBlocks {
  headings: { tag: HeadingTag; text: string }[];
  paragraphs: string[];
  listItems: string[];
  /** Direct text inside divs, spans, sections, etc — catches non-semantic markup */
  other: string[];
  /** Optional per-block location metadata, keyed by the text content.
   * Old snapshots may not have this — new ones do. */
  locations?: Record<string, TextLocation>;
}

export type TextChangeType = 'added' | 'removed' | 'edited';
export type TextChangeKind = 'heading' | 'paragraph' | 'listItem' | 'other';

export interface TextChange {
  type: TextChangeType;
  kind: TextChangeKind;
  before?: string;   // present for 'edited' and 'removed'
  after?: string;    // present for 'edited' and 'added'
  meta?: string;     // e.g. heading tag like "H1", "H2"
  /** Where in the page this change occurred — used to render a breadcrumb above the diff card. */
  location?: TextLocation;
}

export interface PageSnapshot {
  url: string;
  title: string;
  metaDescription: string;
  metaRobots: string;
  canonical: string;
  h1: string;
  textContentHash: string;
  textContentLength: number;
  formFields: FormFieldSnapshot[];
  buttons: string[];
  links: string[];
  scripts: string[];
  textBlocks: TextBlocks;
  /** Full visible body text (nav/footer/header stripped), capped at 60 KB.
   * Used as a sentence-level fallback diff when structured extractors miss
   * changes inside inline tags (<a>, <strong>, custom spans, etc.). */
  fullBodyText: string;
  loadTime: number;
  screenshotPath: string | null;
  timestamp: string;
  fetchedVia: 'fetch' | 'playwright';
  error?: string;
}

export interface SiteSnapshot {
  site: string;
  rootUrl: string;
  timestamp: string;
  pagesScanned: number;
  pages: PageSnapshot[];
}

export interface PageChange {
  url: string;
  changes: string[];           // high-level human-readable change list
  textChanges?: TextChange[];  // structured text diffs (heading/paragraph/listItem)
  severity: ChangeSeverity;
}

export interface PageHashStatus {
  url: string;
  /** True if the body text hash differs vs previous snapshot (regardless of whether we surfaced specific changes) */
  hashChanged: boolean;
  /** Old body text length */
  oldLength: number;
  /** New body text length */
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
  details: PageChange[];
  /** Diagnostic — per-page hash comparison even when no specific changes were detected */
  hashStatus?: PageHashStatus[];
}

export interface MonitorOptions {
  maxPages: number;
  takeScreenshots: boolean;
  /** AI provider selection: 'off' | 'auto' | 'anthropic' | 'gemini' | 'groq' | 'ollama'.
   * Defaults to 'off' — see src/ai/providers.ts. */
  aiProvider: 'off' | 'auto' | 'anthropic' | 'gemini' | 'groq' | 'ollama';
  outputFile?: string;
  watchIntervalMs: number;
  snapshotRoot: string;
}
