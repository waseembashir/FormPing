'use client';

import { useState, useRef, useCallback } from 'react';
import { Header } from '@/components/Header';
import { UrlInputPanel } from '@/components/UrlInputPanel';
import { ConfigPanel } from '@/components/ConfigPanel';
import { ResultsPanel } from '@/components/ResultsPanel';
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

  const handleRun = useCallback(async () => {
    const urls = urlInput
      .split('\n')
      .map(u => u.trim())
      .filter(u => u && !u.startsWith('#'));

    if (urls.length === 0) return;

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
  }, [urlInput, config]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setProgress(null);
    setLogs(prev => [...prev, 'Stopped by user.']);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 pb-16 pt-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Left — input + config */}
          <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-20">
            <UrlInputPanel
              value={urlInput}
              onChange={setUrlInput}
              onRun={handleRun}
              onStop={handleStop}
              running={running}
            />
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
    </div>
  );
}
