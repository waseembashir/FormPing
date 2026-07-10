'use client';
import type { ChangeReport, SnapshotResult } from '@/types';
import { CompareReportCard } from './CompareReportCard';
import { SnapshotResultCard } from './SnapshotResultCard';

interface Props {
  reports: ChangeReport[];
  snapshot: SnapshotResult | null;
  logs: string[];
  running: boolean;
  watchActive: boolean;
  /** Clear the on-screen view + URL input (not the server-stored reports). */
  onClear?: () => void;
}

export function MonitorResultsPanel({ reports, snapshot, logs, running, watchActive, onClear }: Props) {
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-300 bg-rose-950/30 ring-1 ring-rose-800/50 hover:bg-rose-950/50 hover:text-rose-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear results
          </button>
        </div>
      )}

      {/* Live status / progress */}
      {running && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-sm font-semibold text-slate-200">
              {watchActive ? 'Watching for changes' : 'Running'}
            </span>
          </div>
          {logs.length > 0 && (
            <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
              {logs.slice(-12).map((log, i) => (
                <p key={i} className="text-xs font-mono text-slate-400 truncate">{log}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Snapshot result (only one at a time) */}
      {snapshot && <SnapshotResultCard result={snapshot} />}

      {/* Reports — newest first */}
      {reports.length > 0 && (
        <div className="space-y-6">
          {watchActive && reports.length > 1 && (
            <p className="text-xs text-slate-500 px-1">
              Showing {reports.length} report{reports.length !== 1 ? 's' : ''} (newest first)
            </p>
          )}
          {[...reports].reverse().map((report, i) => (
            <CompareReportCard key={`${report.checkedAt}-${i}`} report={report} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 px-8 py-16 text-center">
          <div className="text-4xl mb-4">👁</div>
          <p className="text-slate-300 font-semibold mb-1">No reports yet</p>
          <p className="text-slate-500 text-sm">
            Enter a URL and click <strong className="text-slate-400">Run</strong> to take a snapshot or compare against the previous one.
          </p>
        </div>
      )}
    </div>
  );
}
