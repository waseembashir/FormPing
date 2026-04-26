export type MonitorMode = 'snapshot' | 'compare' | 'watch';
export type ChangeSeverity = 'low' | 'medium' | 'high';

export interface FormFieldSnapshot {
  name: string;
  type: string;
  required: boolean;
  label: string;
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
  changes: string[];
  severity: ChangeSeverity;
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
}

export interface MonitorOptions {
  maxPages: number;
  takeScreenshots: boolean;
  aiSummary: boolean;
  outputFile?: string;
  watchIntervalMs: number;
  snapshotRoot: string;
}
