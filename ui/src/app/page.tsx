'use client';

import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
import { UrlInputPanel } from '@/components/UrlInputPanel';
import { ConfigPanel } from '@/components/ConfigPanel';
import { ResultsPanel } from '@/components/ResultsPanel';
import { ProjectAssignQueue } from '@/components/projects/ProjectAssignQueue';
import { checkUrl } from '@/lib/urlCheck';
import * as testerRun from '@/lib/testerRun';
import type { RunConfig } from '@/types';

const DEFAULT_CONFIG: RunConfig = {
  mode: 'safe',
  email: 'formping-test@example.com',
  timeout: 30000,
  headed: false,
  aiProvider: 'off',
  concurrency: 2,
  residentialFallback: false,
  landingPage: false,
};

// The typed URL is persisted here; the run itself (results/logs/progress) lives
// in the module-level testerRun store so it survives tab switches — see
// lib/testerRun.ts. This is a DISPLAY cache only: the result is also saved
// server-side (on-demand run store) for Projects/Status; Clear wipes the view,
// never the server data.
const STORAGE_KEY_URL = 'fp:tester:url';

export default function Home() {
  const [urlInput, setUrlInput] = useState('');
  const [config, setConfig] = useState<RunConfig>(DEFAULT_CONFIG);

  // Run state lives OUTSIDE this component so leaving the tab can't kill it.
  const { results, running, progress, logs, pendingAssign } = useSyncExternalStore(
    testerRun.subscribe,
    testerRun.getSnapshot,
    testerRun.getServerSnapshot,
  );

  /** Pre-flight URL check state. */
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState<string | null>(null);
  /** Set after an "unreachable" warning so a second Run click proceeds anyway. */
  const forceRef = useRef(false);
  /** True once we've attempted to restore from localStorage — prevents the
   *  initial empty state from clobbering the saved copy before restore runs. */
  const [restored, setRestored] = useState(false);

  // ── Restore the typed URL + the cached run view on first mount ─────────────
  // (results/logs are restored by the store, which owns that cache.)
  useEffect(() => {
    testerRun.hydrate();
    try {
      const u = window.localStorage.getItem(STORAGE_KEY_URL);
      if (u) setUrlInput(u);
    } catch {
      /* localStorage unavailable (private mode) — silent fallback */
    }
    setRestored(true);
  }, []);

  // ── Persist the typed URL (skip until restored so we don't wipe the copy) ──
  useEffect(() => {
    if (!restored) return;
    try {
      if (urlInput) window.localStorage.setItem(STORAGE_KEY_URL, urlInput);
      else window.localStorage.removeItem(STORAGE_KEY_URL);
    } catch { /* ignore */ }
  }, [urlInput, restored]);

  /** Clear the on-screen view + URL input + the localStorage cache. Does NOT
   *  touch the server-stored run result (Projects/Status keep using it). */
  const handleClear = useCallback(() => {
    testerRun.clear();
    setUrlInput('');
    setPreflight(null);
    forceRef.current = false;
    try {
      window.localStorage.removeItem(STORAGE_KEY_URL);
    } catch { /* ignore */ }
  }, []);

  const handleRun = useCallback(async () => {
    if (running || checking) return;
    const rawUrls = urlInput
      .split('\n')
      .map(u => u.trim())
      .filter(u => u && !u.startsWith('#'));

    if (rawUrls.length === 0) return;

    // ── Pre-flight: validate format + reachability BEFORE launching the browser ──
    setPreflight(null);
    setChecking(true);
    let urls: string[];
    try {
      const checks = await Promise.all(rawUrls.map(checkUrl));
      const invalid = checks.filter(c => !c.ok);
      if (invalid.length) {
        setPreflight(`Not a valid URL: ${invalid.map(c => c.input).join(', ')}`);
        forceRef.current = false;
        return;
      }
      const unreachable = checks.filter(c => !c.reachable);
      if (unreachable.length && !forceRef.current) {
        setPreflight(
          `Couldn’t reach: ${unreachable.map(c => c.input).join(', ')}. Click “Run Tests” again to test anyway.`,
        );
        forceRef.current = true;
        return;
      }
      forceRef.current = false;
      urls = checks.map(c => c.url); // normalized (https:// added, etc.)
    } finally {
      setChecking(false);
    }

    // Hand off to the module-level store so the run survives leaving this tab.
    await testerRun.startRun(urls, config);
  }, [urlInput, config, running, checking]);

  const handleStop = useCallback(() => {
    testerRun.stop();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950">
      <main className="max-w-7xl mx-auto px-4 pb-16 pt-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-100">Test a form</h2>
          <p className="text-sm text-slate-400 mt-1">
            Run an on-demand check on one or more contact forms — find the form, fill it, and (in live
            mode) submit to confirm it actually works.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Left — input + config */}
          <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-20">
            <UrlInputPanel
              value={urlInput}
              onChange={(v) => {
                setUrlInput(v);
                forceRef.current = false;
                setPreflight(null);
              }}
              onRun={handleRun}
              onStop={handleStop}
              running={running}
            />
            {(checking || preflight) && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  preflight
                    ? 'border-amber-800/60 bg-amber-950/30 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {checking ? 'Checking URLs…' : preflight}
              </div>
            )}
            <ConfigPanel config={config} onChange={setConfig} disabled={running} />
          </div>

          {/* Right — results */}
          <div className="lg:col-span-3">
            <ResultsPanel
              results={results}
              progress={progress}
              logs={logs}
              running={running}
              onClear={handleClear}
            />
          </div>
        </div>
      </main>

      {pendingAssign.length > 0 && (
        <ProjectAssignQueue urls={pendingAssign} onDone={testerRun.clearPendingAssign} />
      )}
    </div>
  );
}
