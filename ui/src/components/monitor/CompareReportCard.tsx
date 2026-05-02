import type { ChangeReport } from '@/types';
import { PageChangeCard } from './PageChangeCard';

function StatPill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${color}`}>
      <span className="text-base font-bold font-mono">{count}</span>
      <span className="uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
}

export function CompareReportCard({ report }: { report: ChangeReport }) {
  const high = report.details.filter((d) => d.severity === 'high').length;
  const medium = report.details.filter((d) => d.severity === 'medium').length;
  const low = report.details.filter((d) => d.severity === 'low').length;
  const isInitial = report.previousSnapshot === null;

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `change-report-${report.site}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 animate-slide-in">
      {/* Summary card */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-100">{report.site}</h3>
            <p className="text-xs font-mono text-slate-500 truncate">{report.rootUrl}</p>
          </div>
          <button
            onClick={downloadJson}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors ring-1 ring-slate-700"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export JSON
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatPill count={report.pagesScanned} label="Scanned" color="bg-slate-800 text-slate-200" />
          <StatPill count={report.pagesChanged} label="Changed" color="bg-indigo-500/10 text-indigo-300" />
          <StatPill count={report.changesFound} label="Changes" color="bg-slate-800 text-slate-200" />
          {high > 0 && <StatPill count={high} label="High" color="bg-red-500/10 text-red-400" />}
          {medium > 0 && <StatPill count={medium} label="Medium" color="bg-amber-500/10 text-amber-400" />}
          {low > 0 && <StatPill count={low} label="Low" color="bg-slate-500/10 text-slate-400" />}
        </div>

        {isInitial ? (
          <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-3 py-2.5">
            <p className="text-sm text-indigo-300 font-semibold">📷 Initial baseline saved</p>
            <p className="text-xs text-slate-400 mt-1">Run compare again later to see what changed.</p>
          </div>
        ) : report.changesFound === 0 ? (
          (() => {
            const changedPages = report.hashStatus?.filter((h) => h.hashChanged) ?? [];
            if (changedPages.length === 0) {
              return (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
                  <p className="text-sm text-emerald-300 font-semibold">
                    ✓ No changes since last snapshot
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Site is byte-identical to the previous baseline (text-content hashes match).
                  </p>
                </div>
              );
            }
            // Hash differs but our extractor didn't pinpoint specific changes
            return (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                <p className="text-sm text-amber-300 font-semibold">
                  ⚠ Page changed, but specific text could not be pinpointed
                </p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  The body text hash differs vs the previous snapshot on{' '}
                  <strong className="text-slate-200">
                    {changedPages.length} page{changedPages.length !== 1 ? 's' : ''}
                  </strong>
                  , but the change is inside markup we don&apos;t extract semantically (deep
                  custom widgets, JS-rendered content, etc.). Try{' '}
                  <strong className="text-slate-200">--screenshots</strong> mode for full
                  JS-rendered comparison.
                </p>
                <ul className="mt-2 space-y-1">
                  {changedPages.slice(0, 5).map((h) => (
                    <li
                      key={h.url}
                      className="text-xs font-mono text-amber-200/80 flex items-center gap-2"
                    >
                      <span className="text-amber-400/60">·</span>
                      <span className="truncate">{new URL(h.url).pathname}</span>
                      <span className="text-slate-500 text-[10px]">
                        {h.oldLength}b → {h.newLength}b
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()
        ) : (
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2.5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Summary</p>
            <p className="text-sm text-slate-200 leading-relaxed">{report.summary}</p>
          </div>
        )}

        <div className="text-xs text-slate-500 flex items-center gap-3">
          <span>Checked: {new Date(report.checkedAt).toLocaleString()}</span>
          {report.previousSnapshot && (
            <span className="font-mono truncate">vs {report.previousSnapshot.split('/').pop()}</span>
          )}
        </div>
      </div>

      {/* Per-page change cards */}
      {report.details.length > 0 && (
        <div className="space-y-3">
          {[...report.details]
            .sort((a, b) => {
              const rank = { high: 0, medium: 1, low: 2 };
              return rank[a.severity] - rank[b.severity];
            })
            .map((d, i) => (
              <PageChangeCard key={`${d.url}-${i}`} change={d} />
            ))}
        </div>
      )}
    </div>
  );
}
