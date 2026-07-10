'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorInputPanel } from '@/components/monitor/MonitorInputPanel';
import { MonitorConfigPanel } from '@/components/monitor/MonitorConfigPanel';
import { MonitorResultsPanel } from '@/components/monitor/MonitorResultsPanel';
import { SnapshotsManager } from '@/components/monitor/SnapshotsManager';
import { ProjectAssignQueue } from '@/components/projects/ProjectAssignQueue';
import { checkUrl } from '@/lib/urlCheck';
import type { ChangeReport, MonitorConfig, MonitorSSEEvent, SnapshotResult } from '@/types';

const DEFAULT_CONFIG: MonitorConfig = {
  monitorMode: 'compare',
  maxPages: 10,
  takeScreenshots: false,
  aiProvider: 'off',
  watchIntervalMs: 60 * 60 * 1000, // 1 hour
};

const STORAGE_KEY_URL = 'fp:monitor:url';
const STORAGE_KEY_CONFIG = 'fp:monitor:config';

/** Hostname-only key — mirrors siteKey() in lib/watchRegistry. */
function siteKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export default function MonitorPage() {
  const [url, setUrl] = useState('');
  const [config, setConfig] = useState<MonitorConfig>(DEFAULT_CONFIG);
  /** True after we've attempted to restore from localStorage. Prevents the
   * "save to localStorage" effect from clobbering the saved value with the
   * default initial state before restoration runs. */
  const [restored, setRestored] = useState(false);

  // ── Restore URL + config from localStorage on first mount ─────────────
  // Server-rendered initial state defaults to DEFAULT_CONFIG. On client
  // mount we read the persisted values (if any) and apply them. This lets
  // a refresh land back on the same URL + mode the user had set — critical
  // for "I started a watch, refreshed, want to come back to it" flow.
  useEffect(() => {
    try {
      const savedUrl = window.localStorage.getItem(STORAGE_KEY_URL);
      if (savedUrl) setUrl(savedUrl);
      const savedConfigRaw = window.localStorage.getItem(STORAGE_KEY_CONFIG);
      if (savedConfigRaw) {
        const parsed = JSON.parse(savedConfigRaw) as Partial<MonitorConfig>;
        setConfig((cur) => ({ ...cur, ...parsed }));
      }
    } catch {
      // localStorage may be unavailable (private browsing, etc.) — silent fallback
    }
    setRestored(true);
  }, []);

  // Save URL when it changes (skip empty + don't write until restored).
  useEffect(() => {
    if (!restored) return;
    try {
      if (url) window.localStorage.setItem(STORAGE_KEY_URL, url);
      else window.localStorage.removeItem(STORAGE_KEY_URL);
    } catch { /* ignore */ }
  }, [url, restored]);

  // Save config when it changes (don't write until restored).
  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
    } catch { /* ignore */ }
  }, [config, restored]);
  const [reports, setReports] = useState<ChangeReport[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  /** True when a watch is running on the server for the current URL — even
   * if we don't have a live SSE stream to it (e.g., after refresh). */
  const [watchDetached, setWatchDetached] = useState(false);
  const [snapshotsRefreshKey, setSnapshotsRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  /** Pre-flight URL check + post-run "add to project?" prompt. */
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState<string | null>(null);
  const forceRef = useRef(false);
  const [pendingAssign, setPendingAssign] = useState<string[]>([]);

  const watchActive =
    (running && config.monitorMode === 'watch') || watchDetached;

  // ── On mount: auto-fill URL from active watches if localStorage is empty ──
  // Handles the case where the user clears localStorage / opens FormPing on a
  // fresh browser but there's a watch running on the server (e.g. resumed
  // from disk after a deploy). Without this, the URL stays empty and the
  // URL-deps useEffect below never fetches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/monitor/watches').then((r) => r.json());
        if (cancelled) return;
        const watches = Array.isArray(res?.watches) ? res.watches : [];
        // eslint-disable-next-line no-console
        console.log('[MonitorPage] mount: active watches on server:', watches);
        if (watches.length === 0) return;
        // Only auto-fill if URL is still empty (don't clobber whatever
        // localStorage just restored).
        setUrl((current) => {
          if (current.trim()) return current;
          const latest = [...watches].sort(
            (a: { startedAt: string }, b: { startedAt: string }) =>
              new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
          )[0];
          // eslint-disable-next-line no-console
          console.log('[MonitorPage] mount: auto-filling URL from active watch:', latest.url);
          return latest.url;
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[MonitorPage] mount: failed to fetch /api/monitor/watches:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Hydrate state from server whenever the URL changes ────────────────
  // - Check /api/monitor/watches to see if a watch is already running for
  //   this URL (detached from any browser).
  // - Fetch /api/monitor/reports to populate the report history.
  useEffect(() => {
    const trimmed = url.trim();
    // eslint-disable-next-line no-console
    console.log('[MonitorPage] URL useEffect fired, url:', JSON.stringify(trimmed));
    if (!trimmed) {
      setWatchDetached(false);
      setReports([]);
      return;
    }
    const ourSite = siteKey(trimmed);
    // eslint-disable-next-line no-console
    console.log('[MonitorPage] our siteKey:', ourSite);
    if (!ourSite) {
      setWatchDetached(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [watchesRes, reportsRes] = await Promise.all([
          fetch('/api/monitor/watches').then((r) => r.json()),
          fetch(`/api/monitor/reports?url=${encodeURIComponent(trimmed)}&limit=1`).then((r) => r.json()),
        ]);
        if (cancelled) return;

        // Is there an active watch for this site?
        const watches = Array.isArray(watchesRes?.watches) ? watchesRes.watches : [];
        const ours = watches.find((w: { site: string }) => w.site === ourSite);
        // eslint-disable-next-line no-console
        console.log('[MonitorPage] watches from server:', watches, '| our match:', ours);
        setWatchDetached(Boolean(ours));

        // Report history (newest first from the API; we keep that order)
        const storedReports = Array.isArray(reportsRes?.reports) ? reportsRes.reports : [];
        const hydrated: ChangeReport[] = storedReports
          .map((r: { report: ChangeReport }) => r.report)
          .filter(Boolean);
        // Sort oldest-first to match the live-stream append order — newer
        // reports go at the end of the list (matches how MonitorResultsPanel
        // expects them).
        hydrated.reverse();
        setReports(hydrated);
      } catch (err) {
        // Best-effort: API down, hydration just fails silently
        // eslint-disable-next-line no-console
        console.warn('[MonitorPage] hydration failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleCleared = useCallback(() => {
    setReports([]);
    setSnapshot(null);
    setLogs((prev) => [...prev, 'Cleared all stored snapshots.']);
    setSnapshotsRefreshKey((k) => k + 1);
  }, []);

  /** Clear the on-screen view + URL input + the saved URL. Does NOT delete the
   *  server-stored reports/snapshots (they stay; re-entering the URL reloads
   *  them). "Clear = wipe the view, keep the data." */
  const handleClearView = useCallback(() => {
    setUrl(''); // also clears reports + watchDetached via the URL effect
    setReports([]);
    setSnapshot(null);
    setLogs([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY_URL);
    } catch {
      /* ignore */
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (!url.trim() || running || checking) return;

    // ── Pre-flight: validate format + reachability before the crawl ──
    setPreflight(null);
    setChecking(true);
    let target: string;
    try {
      const c = await checkUrl(url.trim());
      if (!c.ok) {
        setPreflight(`Not a valid URL: ${url.trim()}`);
        forceRef.current = false;
        return;
      }
      if (!c.reachable && !forceRef.current) {
        setPreflight(`Couldn’t reach ${url.trim()}. Click “Run” again to check anyway.`);
        forceRef.current = true;
        return;
      }
      forceRef.current = false;
      target = c.url; // normalized
    } finally {
      setChecking(false);
    }

    // For watch mode we want to PRESERVE the history when re-clicking Watch
    // (the user might be re-attaching after refresh, in which case starting
    // empty would feel wrong). For one-off snapshot/compare, clearing is fine.
    if (config.monitorMode !== 'watch') {
      setReports([]);
      setSnapshot(null);
    }
    setLogs([]);
    setRunning(true);
    let prompted = false; // prompt "add to project?" once we get a value

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch('/api/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, ...config }),
        signal: abort.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        // 409 = a watch is already active for this site (detached). Show that
        // state in the UI rather than treating it as an error.
        if (response.status === 409 && config.monitorMode === 'watch') {
          setWatchDetached(true);
          setLogs((prev) => [
            ...prev,
            'A watch is already running for this site. Click "Stop watching" to end it.',
          ]);
          setRunning(false);
          return;
        }
        throw new Error(`Server error ${response.status}: ${text}`);
      }

      if (config.monitorMode === 'watch') setWatchDetached(true);

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
              if (!prompted) { prompted = true; setPendingAssign([target]); }
            } else if (event.type === 'report') {
              // Keep only the most recent report — older ones stack up
              // visually with no value (the diff is point-in-time).
              setReports([event.report]);
              setSnapshotsRefreshKey((k) => k + 1);
              if (!prompted) { prompted = true; setPendingAssign([target]); }
            } else if (event.type === 'log') {
              setLogs((prev) => [...prev.slice(-99), event.message]);
            } else if (event.type === 'done' || event.type === 'error') {
              if (event.type === 'error') {
                setLogs((prev) => [...prev, `⚠ ${event.message}`]);
              } else if (!prompted) {
                prompted = true;
                setPendingAssign([target]);
              }
              setRunning(false);
              if (config.monitorMode !== 'watch') setWatchDetached(false);
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
  }, [url, config, running, checking]);

  // Stop button: for watch mode, ask the server to kill the detached
  // process; for snapshot/compare, just abort the local stream.
  const handleStop = useCallback(async () => {
    abortRef.current?.abort();

    if (config.monitorMode === 'watch' || watchDetached) {
      try {
        await fetch('/api/monitor/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        });
        setLogs((prev) => [...prev, 'Watch stopped.']);
      } catch (err) {
        setLogs((prev) => [
          ...prev,
          `⚠ Failed to stop watch: ${err instanceof Error ? err.message : String(err)}`,
        ]);
      }
      setWatchDetached(false);
    } else {
      setLogs((prev) => [...prev, 'Stopped by user.']);
    }
    setRunning(false);
  }, [config.monitorMode, watchDetached, url]);

  return (
    <div className="min-h-screen bg-slate-950">
      <main className="max-w-7xl mx-auto px-4 pb-16 pt-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-100">Change tracking</h2>
          <p className="text-sm text-slate-400 mt-1">
            Snapshot a site, compare it later, and see exactly what changed — content, SEO, forms, scripts, performance.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Left — input + config */}
          <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-20">
            <MonitorInputPanel
              url={url}
              onChange={(u) => {
                setUrl(u);
                forceRef.current = false;
                setPreflight(null);
              }}
              onRun={handleRun}
              onStop={handleStop}
              running={running}
              watchActive={watchActive}
            />
            {(checking || preflight) && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  preflight
                    ? 'border-amber-800/60 bg-amber-950/30 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {checking ? 'Checking URL…' : preflight}
              </div>
            )}
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
              onClear={handleClearView}
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
