'use client';

import { ProjectUrlPicker } from '../projects/ProjectUrlPicker';

interface Props {
  url: string;
  onChange: (v: string) => void;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  watchActive: boolean;
}

export function MonitorInputPanel({ url, onChange, onRun, onStop, running, watchActive }: Props) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Site URL</h2>
          <p className="text-xs text-slate-500 mt-0.5">The homepage of the site to monitor</p>
        </div>
        <ProjectUrlPicker align="right" onPick={(u) => onChange(u)} />
      </div>

      <input
        type="url"
        value={url}
        onChange={(e) => onChange(e.target.value)}
        disabled={running}
        placeholder="https://example.com"
        spellCheck={false}
        className="w-full bg-transparent px-4 py-3 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none disabled:opacity-50"
      />

      <div className="px-4 py-3 border-t border-slate-800">
        {running || watchActive ? (
          // Stop button — appears for any actively-running mode AND for
          // detached watches (server has a watch running but no live SSE
          // stream from this browser, e.g. after a refresh). Without this
          // OR-watchActive the post-refresh "Stop watching" button never
          // showed up and users were stuck with a stale Run button.
          <button
            onClick={onStop}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 ring-1 ring-red-500/30 hover:bg-red-500/20 transition-colors text-sm font-medium"
          >
            <span className="w-2 h-2 rounded-sm bg-red-400" />
            {watchActive ? 'Stop watching' : 'Stop'}
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={!url.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-lg shadow-indigo-900/30"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
            Run
          </button>
        )}
      </div>
    </div>
  );
}
