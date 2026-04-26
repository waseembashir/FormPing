'use client';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
}

export function UrlInputPanel({ value, onChange, onRun, onStop, running }: Props) {
  const urlCount = value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).length;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Target URLs</h2>
          <p className="text-xs text-slate-500 mt-0.5">One URL per line · Lines starting with # are ignored</p>
        </div>
        {urlCount > 0 && (
          <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-1 rounded-md ring-1 ring-slate-700">
            {urlCount} URL{urlCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={running}
        placeholder={'https://example.com\nhttps://another-site.com\n# comments are ignored'}
        spellCheck={false}
        className="w-full bg-transparent px-4 py-3 text-sm font-mono text-slate-200 placeholder-slate-600 resize-none focus:outline-none disabled:opacity-50 leading-relaxed"
        rows={8}
      />

      <div className="px-4 py-3 border-t border-slate-800 flex gap-2">
        {running ? (
          <button
            onClick={onStop}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 ring-1 ring-red-500/30 hover:bg-red-500/20 transition-colors text-sm font-medium"
          >
            <span className="w-2 h-2 rounded-sm bg-red-400" />
            Stop
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={urlCount === 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-lg shadow-indigo-900/30"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            Run Tests
          </button>
        )}
      </div>
    </div>
  );
}
