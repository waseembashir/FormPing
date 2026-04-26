'use client';
import type { SiteResult, RunProgress } from '@/types';
import { ResultCard } from './ResultCard';

interface Props {
  results: SiteResult[];
  progress: RunProgress | null;
  logs: string[];
  running: boolean;
}

function StatPill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${color}`}>
      <span className="text-base font-bold font-mono">{count}</span>
      <span className="uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
      <div
        className="h-full rounded-full bg-indigo-500 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ResultsPanel({ results, progress, logs, running }: Props) {
  const pass = results.filter(r => r.finalStatus === 'pass').length;
  const fail = results.filter(r => r.finalStatus === 'fail').length;
  const warn = results.filter(r => r.finalStatus === 'warn').length;
  const error = results.filter(r => r.finalStatus === 'error').length;

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `formping-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isEmpty = results.length === 0 && !running;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {(results.length > 0 || running) && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          {/* Progress indicator */}
          {running && progress && (
            <div className="mb-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="text-slate-300 font-mono truncate max-w-xs">
                    {progress.currentUrl || 'Running…'}
                  </span>
                </div>
                <span className="text-slate-500 font-mono shrink-0">
                  {progress.current}/{progress.total}
                </span>
              </div>
              <ProgressBar current={progress.current} total={progress.total} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <StatPill count={results.length} label="Total" color="bg-slate-800 text-slate-200" />
            {pass > 0 && <StatPill count={pass} label="Pass" color="bg-emerald-500/10 text-emerald-400" />}
            {fail > 0 && <StatPill count={fail} label="Fail" color="bg-red-500/10 text-red-400" />}
            {warn > 0 && <StatPill count={warn} label="Warn" color="bg-amber-500/10 text-amber-400" />}
            {error > 0 && <StatPill count={error} label="Error" color="bg-slate-500/10 text-slate-400" />}

            {results.length > 0 && (
              <button
                onClick={downloadJson}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors ring-1 ring-slate-700"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export JSON
              </button>
            )}
          </div>
        </div>
      )}

      {/* Log feed */}
      {running && logs.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Live Log</span>
          </div>
          <div className="px-4 py-3 space-y-1 max-h-32 overflow-y-auto">
            {logs.slice(-20).map((log, i) => (
              <p key={i} className="text-xs font-mono text-slate-400 truncate">{log}</p>
            ))}
          </div>
        </div>
      )}

      {/* Results list */}
      <div className="space-y-3">
        {results.map((r, i) => (
          <ResultCard key={`${r.normalizedUrl}-${i}`} result={r} />
        ))}
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 px-8 py-16 text-center">
          <div className="text-4xl mb-4">🏓</div>
          <p className="text-slate-300 font-semibold mb-1">No results yet</p>
          <p className="text-slate-500 text-sm">Enter one or more URLs and click <strong className="text-slate-400">Run Tests</strong></p>
        </div>
      )}
    </div>
  );
}
