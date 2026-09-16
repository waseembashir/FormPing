/**
 * What a content-change run actually found, for a notification. FR-91.
 *
 * A change alert said "7 changes detected on example.com" and left it there.
 * That is a count, not a finding: it does not say how serious they were, how
 * much of the site was looked at, or whether one of them touched a contact form
 * — which is the one category that can silently cost a client leads.
 *
 * The report already carries all of it (`ChangeReport` in src/monitor/types.ts:
 * `pagesScanned`, `pagesChanged`, per-page `severity`, and a human-readable
 * `changes[]` per page). None of it reached the alert.
 */

const MAX_FACTS = 5;

/** The shape we rely on, kept loose because it crosses a CLI subprocess boundary. */
interface ReportLike {
  changesFound?: unknown;
  pagesChanged?: unknown;
  pagesScanned?: unknown;
  details?: unknown;
}

interface PageChangeLike {
  url?: unknown;
  severity?: unknown;
  changes?: unknown;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function pages(report: ReportLike): PageChangeLike[] {
  return Array.isArray(report.details) ? (report.details as PageChangeLike[]) : [];
}

/** Every human-readable change line across every page. */
function allChangeLines(report: ReportLike): string[] {
  return pages(report).flatMap((p) => (Array.isArray(p.changes) ? p.changes.filter((c): c is string => typeof c === 'string') : []));
}

/**
 * Changes that touched a form.
 *
 * Called out separately because of what this product is for: a removed or
 * newly-required field on a contact form is the difference between receiving
 * enquiries and silently losing them, and it should never be averaged into a
 * count alongside a changed heading.
 */
function formChangeCount(report: ReportLike): number {
  return allChangeLines(report).filter((line) => /\bform\b|\bfield\b/i.test(line)).length;
}

/** What the run found, most consequential first. */
export function changeReportFacts(report: ReportLike): string[] {
  const facts: string[] = [];
  const counts = { high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const page of pages(report)) {
    const sev = typeof page.severity === 'string' ? page.severity : null;
    if (sev && sev in counts) counts[sev]! += 1;
  }

  // 1. How serious, in pages — the first question a reader has.
  const bySeverity = (['high', 'medium', 'low'] as const)
    .filter((s) => counts[s]! > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ');
  if (bySeverity) facts.push(`${bySeverity} severity`);

  // 2. Forms, on their own, because this is the category that costs money.
  const forms = formChangeCount(report);
  if (forms > 0) facts.push(`${forms} form change${forms === 1 ? '' : 's'} — check the form still submits`);

  // 3. How much of the site moved.
  const changed = num(report.pagesChanged);
  const scanned = num(report.pagesScanned);
  if (changed > 0 && scanned > 0) facts.push(`${changed} of ${scanned} pages changed`);
  else if (changed > 0) facts.push(`${changed} page${changed === 1 ? '' : 's'} changed`);

  return facts.slice(0, MAX_FACTS);
}

/**
 * How much of the site this run actually looked at.
 *
 * The monitor snapshots a bounded set of important pages, not the whole site.
 * "No changes" therefore means "none on the pages we watch" — a narrower claim
 * than it appears, and one a reader should be told rather than left to assume.
 */
export function changeReportScope(report: ReportLike): string {
  const scanned = num(report.pagesScanned);
  return scanned > 0
    ? `Compared ${scanned} watched page${scanned === 1 ? '' : 's'} against the last snapshot — changes on pages outside that set are not covered.`
    : 'Compared this site’s watched pages against the last snapshot.';
}

/** What a person should verify by hand, when the machine cannot judge it. */
export function changeManualActionFor(report: ReportLike): string | null {
  const forms = formChangeCount(report);
  if (forms === 0) return null;
  return `We detected ${forms} change${forms === 1 ? '' : 's'} to a form, and we cannot tell from a page diff whether submissions still reach their destination. Send one test entry by hand, or run a Form Tester check on this URL.`;
}
