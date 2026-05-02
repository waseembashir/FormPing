'use client';

import { useCallback, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { MonitorInputPanel } from '@/components/monitor/MonitorInputPanel';
import { MonitorConfigPanel } from '@/components/monitor/MonitorConfigPanel';
import { MonitorResultsPanel } from '@/components/monitor/MonitorResultsPanel';
import { SnapshotsManager } from '@/components/monitor/SnapshotsManager';
import type { ChangeReport, MonitorConfig, MonitorSSEEvent, SnapshotResult } from '@/types';

const DEFAULT_CONFIG: MonitorConfig = {
  monitorMode: 'compare',
  maxPages: 10,
  takeScreenshots: false,
  aiSummary: false,
  watchIntervalMs: 60 * 60 * 1000, // 1 hour
};

export default function MonitorPage() {
  const [url, setUrl] = useState('');
  const [config, setConfig] = useState<MonitorConfig>(DEFAULT_CONFIG);
  const [reports, setReports] = useState<ChangeReport[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [snapshotsRefreshKey, setSnapshotsRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const watchActive = running && config.monitorMode === 'watch';

  const handleCleared = useCallback(() => {
    setReports([]);
    setSnapshot(null);
    setLogs((prev) => [...prev, 'Cleared all stored snapshots.']);
    setSnapshotsRefreshKey((k) => k + 1);
  }, []);

  const handleRun = useCallback(async () => {
    if (!url.trim()) return;

    setReports([]);
    setSnapshot(null);
    setLogs([]);
    setRunning(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), ...config }),
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
            const event = JSON.parse(line.slice(6)) as MonitorSSEEvent;

            if (event.type === 'snapshot') {
              setSnapshot(event.result);
              setSnapshotsRefreshKey((k) => k + 1);
            } else if (event.type === 'report') {
              setReports((prev) => [...prev, event.report]);
              setSnapshotsRefreshKey((k) => k + 1);
            } else if (event.type === 'log') {
              setLogs((prev) => [...prev.slice(-99), event.message]);
            } else if (event.type === 'done' || event.type === 'error') {
              if (event.type === 'error') {
                setLogs((prev) => [...prev, `⚠ ${event.message}`]);
              }
              setRunning(false);
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setLogs((prev) => [...prev, `Fatal: ${err.message}`]);
      }
    } finally {
      setRunning(false);
    }
  }, [url, config]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setLogs((prev) => [...prev, 'Stopped by user.']);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 pb-16 pt-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-100">Website Change Monitor</h2>
          <p className="text-sm text-slate-400 mt-1">
            Snapshot a site, compare it later, and see exactly what changed — content, SEO, forms, scripts, performance.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Left — input + config */}
          <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-20">
            <MonitorInputPanel
              url={url}
              onChange={setUrl}
              onRun={handleRun}
              onStop={handleStop}
              running={running}
              watchActive={watchActive}
            />
            <SnapshotsManager
              url={url}
              disabled={running}
              refreshKey={snapshotsRefreshKey}
              onCleared={handleCleared}
            />
            <MonitorConfigPanel config={config} onChange={setConfig} disabled={running} />
          </div>

          {/* Right — results */}
          <div className="lg:col-span-3">
            <MonitorResultsPanel
              reports={reports}
              snapshot={snapshot}
              logs={logs}
              running={running}
              watchActive={watchActive}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
