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
}

export function MonitorResultsPanel({ reports, snapshot, logs, running, watchActive }: Props) {
  const isEmpty = reports.length === 0 && !snapshot && !running;

  return (
    <div className="space-y-4">
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
