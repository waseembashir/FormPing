'use client';

import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
import { TesterCommandBar } from '@/components/TesterCommandBar';
import { ResultsPanel } from '@/components/ResultsPanel';
import { ProjectAssignQueue } from '@/components/projects/ProjectAssignQueue';
import { ReadOnlyBanner } from '@/components/ReadOnlyBanner';
import { PageHeader, KeptNotice } from '@/components/ui';
import { Toaster } from '@/components/Toaster';
import { checkUrl } from '@/lib/urlCheck';
import * as testerRun from '@/lib/testerRun';
import { submitLiveTest } from '@/lib/perFormLiveTest';
import { markCleared, unmarkCleared, wasCleared } from '@/lib/clearedInput';
import type { RunConfig, SiteResult } from '@/types';

const DEFAULT_CONFIG: RunConfig = {
  // Detect is the default: it only confirms a form is there, filling nothing and
  // sending nothing. Safe and Live are both deliberate choices the user makes,
  // and the least-intrusive option is the right thing to land on. FR-81.
  mode: 'detect-only',
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

  /** Inline "cleared" confirmation shown IN the results area (not a floating toast),
   *  so the "still saved in Projects" reassurance appears exactly where it happened. */
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 7000);
  }, []);

  // ── Restore the typed URL + the cached run view on first mount ─────────────
  // (results/logs are restored by the store, which owns that cache.)
  useEffect(() => {
    testerRun.hydrate();
    // A persisted result belongs to the mode it was run in, so restore that mode
    // with it — otherwise a refresh leaves a Safe-mode log sitting under a Detect
    // selector, and the page describes a run it didn't do. Applied once, here, so
    // the user can still change the mode afterwards. FR-81.
    const storedMode = testerRun.getSnapshot().mode;
    if (storedMode) setConfig((c) => ({ ...c, mode: storedMode }));
    try {
      // Respect a deliberate clear: don't restore the URL if the user emptied it.
      const u = wasCleared('tester') ? null : window.localStorage.getItem(STORAGE_KEY_URL);
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
    // Nothing left on screen to keep the mode honest — back to the default.
    setConfig((c) => ({ ...c, mode: DEFAULT_CONFIG.mode }));
    setUrlInput('');
    setPreflight(null);
    forceRef.current = false;
    markCleared('tester'); // keep it empty until the user types again
    try {
      window.localStorage.removeItem(STORAGE_KEY_URL);
    } catch { /* ignore */ }
    showFlash('Cleared from view — your test results are still saved in Projects.');
  }, [showFlash]);

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

  // Per-form "Submit a live test" — a real live+landing submission for one form's
  // URL, using the current run config (email, AI, proxy…). FR-76.
  const handleSubmitLiveTest = useCallback(
    (url: string): Promise<SiteResult | null> => submitLiveTest(url, config),
    [config],
  );

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">
        <PageHeader
          title="Form Tester"
          description="Point it at any contact form and run a real check — find the form, fill it, and (in Live mode) submit to confirm the message actually lands."
        />
        <div className="mt-5">
          <ReadOnlyBanner />
        </div>

        {/* Command bar — full width */}
        <div className="mt-5">
          <TesterCommandBar
            value={urlInput}
            onChange={(v) => {
              setUrlInput(v);
              if (v) unmarkCleared('tester'); // user is filling it again
              forceRef.current = false;
              setPreflight(null);
            }}
            onRun={handleRun}
            onStop={handleStop}
            running={running}
            config={config}
            onConfig={setConfig}
            checking={checking}
            preflight={preflight}
          />
        </div>

        {/* Results — the full-width stage */}
        <div className="mt-6">
          <Toaster />
          {flash && (
            <div className="mb-3">
              <KeptNotice title={flash} onDismiss={() => setFlash(null)} />
            </div>
          )}
          <ResultsPanel results={results} progress={progress} logs={logs} running={running} landingPage={config.landingPage} mode={config.mode} onClear={handleClear} onSubmitLiveTest={handleSubmitLiveTest} />
        </div>
      </main>

      {pendingAssign.length > 0 && (
        <ProjectAssignQueue urls={pendingAssign} onDone={testerRun.clearPendingAssign} />
      )}
    </>
  );
}
