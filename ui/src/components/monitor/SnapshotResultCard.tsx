import type { SnapshotResult } from '@/types';

export function SnapshotResultCard({ result }: { result: SnapshotResult }) {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-slate-900 p-5 animate-slide-in">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400 text-lg shrink-0">
          ✓
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-100">Snapshot saved</h3>
          <p className="text-xs text-slate-400 mt-1">
            Crawled <strong className="text-slate-200">{result.pagesScanned}</strong> page{result.pagesScanned !== 1 ? 's' : ''} for <strong className="text-slate-200">{result.site}</strong>
          </p>
          <div className="mt-3 rounded-lg bg-slate-800/60 ring-1 ring-slate-700 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">File</p>
            <p className="text-xs font-mono text-slate-300 break-all">{result.snapshotPath}</p>
          </div>
          <p className="text-xs text-slate-500 mt-3 leading-relaxed">
            Run <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">compare</span> later to see what changed since this baseline.
          </p>
        </div>
      </div>
    </div>
  );
}
