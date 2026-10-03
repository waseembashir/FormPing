'use client';
import type { ChangeReport, SnapshotResult, MonitorMode } from '@/types';
import { CompareReportCard } from './CompareReportCard';
import { SnapshotResultCard } from './SnapshotResultCard';
import { RunLoaderShell } from '@/components/ui/RunLoader';
import { emptyStateSite } from '@/lib/emptyRunState';

interface Props {
  reports: ChangeReport[];
  snapshot: SnapshotResult | null;
  logs: string[];
  running: boolean;
  watchActive: boolean;
  /** Current mode — drives the loader copy. */
  mode: MonitorMode;
  /** What is currently in the URL box, so an empty state can name the site
   *  rather than asking for a URL that is already there. */
  url?: string;
  /** Clear the on-screen view + URL input (not the server-stored reports). */
  onClear?: () => void;
}

// Plain, on-brand facts shown while a scan runs — purposeful wait, no raw logs. FR-65.
const SCAN_FACTS = [
  'A quietly changed price or a removed form can cost leads before anyone notices.',
  'We track content, SEO tags, forms and scripts — not just the visible text.',
  'Snapshot saves a baseline; Compare shows what changed since.',
  'Nothing on the site is changed — we only read it.',
];

// Real progress only: the crawler emits "Snapshotting page N/T" per page, which
// is the one place we genuinely know the total. No signal → null (indeterminate).
const SCAN_PAGE_RE = /Snapshotting page (\d+)\/(\d+)/;
function scanPct(logs: string[]): number | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = SCAN_PAGE_RE.exec(logs[i]!);
    if (m) {
      const done = Number(m[1]);
      const total = Number(m[2]);
      if (total > 0) return Math.min(done / total, 1);
    }
  }
  return null;
}

/** Mode-aware scan loader — never shows raw engine/crawler logs. FR-65.
 *  Shares the app-wide RunLoaderShell so its look + size match the Form Tester. */
function ScanLoader({ mode, watchActive, logs }: { mode: MonitorMode; watchActive: boolean; logs: string[] }) {
  const headline = watchActive
    ? 'Watching your site for changes'
    : mode === 'snapshot' ? 'Taking a baseline snapshot' : 'Comparing against the baseline';
  const sub = watchActive
    ? 'We re-scan your site on a schedule and flag anything that changed — leave this running.'
    : mode === 'snapshot'
      ? 'Scanning your site’s pages to save as the baseline you’ll compare against later.'
      : 'Scanning your site and diffing it against the last saved baseline.';

  return (
    <RunLoaderShell
      glyph={
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
          <rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      }
      headline={headline}
      sub={sub}
      pct={scanPct(logs)}
      facts={SCAN_FACTS}
    />
  );
}

export function MonitorResultsPanel({ reports, snapshot, logs, running, watchActive, mode, url, onClear }: Props) {
  // Raw crawler logs are still never SHOWN to users (FR-65) — they're only read
  // to derive how many pages have been scanned, for the loader's progress.
  const isEmpty = reports.length === 0 && !snapshot && !running;
  const hasContent = reports.length > 0 || !!snapshot;

  return (
    <div className="space-y-4">
      {/* Clear the view (keeps server-stored reports) */}
      {hasContent && !running && onClear && (
        <div className="flex justify-end">
          <button
            onClick={onClear}
            title="Clear the reports and URL from this tab. Does NOT delete the stored snapshots/reports."
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-danger bg-danger/10 ring-1 ring-danger/30 hover:bg-danger/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear results
          </button>
        </div>
      )}

      {/* Live status — friendly mode-aware loader, never raw crawler logs */}
      {running && <ScanLoader mode={mode} watchActive={watchActive} logs={logs} />}

      {/* Snapshot result (only one at a time) */}
      {snapshot && <SnapshotResultCard result={snapshot} />}

      {/* Reports — newest first */}
      {reports.length > 0 && (
        <div className="space-y-6">
          {watchActive && reports.length > 1 && (
            <p className="text-xs text-ink-faint px-1">
              Showing {reports.length} report{reports.length !== 1 ? 's' : ''} (newest first)
            </p>
          )}
          {[...reports].reverse().map((report, i) => (
            <CompareReportCard key={`${report.checkedAt}-${i}`} report={report} />
          ))}
        </div>
      )}

      {/* Empty state — an animated "page being watched" (scan line sweeps down). */}
      {isEmpty && (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line bg-panel/40 px-8 py-16 text-center">
          <div className="relative mb-5 flex h-[74px] w-24 items-center justify-center">
            <span className="absolute inset-2 rounded-2xl bg-accent/10 blur-xl" aria-hidden />
            <svg viewBox="0 0 96 74" className="relative h-[74px] w-24" fill="none" aria-hidden>
              <defs>
                <clipPath id="fp-scan-clip"><rect x="8" y="24" width="80" height="42" rx="2" /></clipPath>
              </defs>
              {/* browser frame */}
              <rect x="6" y="8" width="84" height="58" rx="9" className="fill-ground stroke-line-strong" strokeWidth="1.5" />
              {/* top bar */}
              <circle cx="15" cy="16" r="1.7" className="fill-line-strong" />
              <circle cx="22" cy="16" r="1.7" className="fill-line-strong" />
              <circle cx="29" cy="16" r="1.7" className="fill-line-strong" />
              <rect x="38" y="13" width="46" height="6" rx="3" className="fill-panel-raised" />
              {/* content lines */}
              <rect x="16" y="30" width="54" height="4" rx="2" className="fill-line-strong" />
              <rect x="16" y="40" width="64" height="4" rx="2" className="fill-line-strong" />
              <rect x="16" y="50" width="40" height="4" rx="2" className="fill-line-strong" />
              {/* scan line */}
              <g clipPath="url(#fp-scan-clip)">
                <g className="fp-scan">
                  <rect x="8" y="26" width="80" height="10" className="fill-accent" opacity="0.14" />
                  <rect x="8" y="34" width="80" height="2" className="fill-accent-soft" />
                </g>
              </g>
            </svg>
          </div>
          <p className="text-[15px] font-semibold text-ink">No reports yet</p>
          <p className="mt-1.5 max-w-sm text-sm text-ink-muted">
            {/* Asking for a URL that is already in the box reads as the app
                having lost it. Name the site instead, and the sentence becomes
                an invitation to press the button rather than a contradiction. */}
            {emptyStateSite(url) ? (
              <>
                Nothing recorded for <strong className="text-ink-secondary">{emptyStateSite(url)}</strong> yet — hit{' '}
                <strong className="text-ink-secondary">Run</strong> to take a snapshot or compare against the last one.
              </>
            ) : (
              <>
                Enter a URL above and hit <strong className="text-ink-secondary">Run</strong> to take a snapshot or compare against the last one.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
