'use client';

import { useState, useRef, useCallback } from 'react';
import { UrlInputPanel } from '@/components/UrlInputPanel';
import { ConfigPanel } from '@/components/ConfigPanel';
import { ResultsPanel } from '@/components/ResultsPanel';
import { ProjectAssignQueue } from '@/components/projects/ProjectAssignQueue';
import { checkUrl } from '@/lib/urlCheck';
import type { SiteResult, RunConfig, SSEEvent, RunProgress } from '@/types';

const DEFAULT_CONFIG: RunConfig = {
  mode: 'safe',
  email: 'formping-test@example.com',
  timeout: 30000,
  headed: false,
  aiProvider: 'off',
  concurrency: 2,
  residentialFallback: false,
};

export default function Home() {
  const [urlInput, setUrlInput] = useState('');
  const [config, setConfig] = useState<RunConfig>(DEFAULT_CONFIG);
  const [results, setResults] = useState<SiteResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /** Pre-flight URL check state. */
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState<string | null>(null);
  /** Set after an "unreachable" warning so a second Run click proceeds anyway. */
  const forceRef = useRef(false);
  /** URLs to prompt "add to a project?" for, after a run completes. */
  const [pendingAssign, setPendingAssign] = useState<string[]>([]);

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

    setResults([]);
    setLogs([]);
    setRunning(true);
    setProgress({ current: 0, total: urls.length, currentUrl: urls[0]! });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, ...config }),
        signal: abort.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(`Server error ${response.status}: ${text}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as SSEEvent;

            if (event.type === 'result') {
              setResults(prev => [...prev, event.result]);
              setProgress(prev =>
                prev ? { ...prev, current: prev.current + 1, currentUrl: '' } : null,
              );
            } else if (event.type === 'progress') {
              setProgress({
                current: event.index,
                total: event.total,
                currentUrl: event.url,
              });
            } else if (event.type === 'log') {
              setLogs(prev => [...prev.slice(-99), event.message]);
            } else if (event.type === 'done' || event.type === 'error') {
              if (event.type === 'error') {
                setLogs(prev => [...prev, `⚠ ${event.message}`]);
              } else {
                // Run finished — offer to file each tested URL under a project
                // (the modal self-skips ones already grouped or dismissed).
                setPendingAssign(urls);
              }
              setRunning(false);
              setProgress(null);
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setLogs(prev => [...prev, `Fatal: ${err.message}`]);
      }
    } finally {
      setRunning(false);
      setProgress(prev => prev ? { ...prev, currentUrl: '' } : null);
    }
  }, [urlInput, config, running, checking]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setProgress(null);
    setLogs(prev => [...prev, 'Stopped by user.']);
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
            />
          </div>
        </div>
      </main>

      {pendingAssign.length > 0 && (
        <ProjectAssignQueue urls={pendingAssign} onDone={() => setPendingAssign([])} />
      )}
    </div>
  );
}
