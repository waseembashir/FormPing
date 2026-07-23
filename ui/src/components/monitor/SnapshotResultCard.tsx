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
          {/* The snapshot's absolute path used to be printed here. It is a path
              INSIDE the server container (e.g. /app/data/snapshots/…) — not
              openable and meaningless to the user, a leftover from when this
              tool was file-first. The baseline is now recorded against the
              project instead, which is the useful signal. */}
          <p className="text-xs text-slate-500 mt-3 leading-relaxed">
            This is now the baseline for <strong className="text-slate-300">{result.site}</strong>. Run{' '}
            <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">compare</span> later to see
            what changed since it — the project shows it as <em className="text-slate-400">Baseline captured</em>.
          </p>
        </div>
      </div>
    </div>
  );
}
