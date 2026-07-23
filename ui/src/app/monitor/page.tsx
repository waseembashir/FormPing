'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MonitorInputPanel } from '@/components/monitor/MonitorInputPanel';
import { MonitorConfigPanel } from '@/components/monitor/MonitorConfigPanel';
import { MonitorResultsPanel } from '@/components/monitor/MonitorResultsPanel';
import { SnapshotsManager } from '@/components/monitor/SnapshotsManager';
import { ProjectAssignQueue } from '@/components/projects/ProjectAssignQueue';
import { checkUrl } from '@/lib/urlCheck';
import * as monitorRun from '@/lib/monitorRun';
import type { MonitorConfig, ChangeReport } from '@/types';

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
  const [restored, setRestored] = useState(false);

  // The run (reports/snapshot/logs/running/watch/pendingAssign) lives OUTSIDE
  // this component so leaving the tab can't kill it — see lib/monitorRun.
  const { reports, snapshot, logs, running, watchDetached, pendingAssign, refreshKey } = useSyncExternalStore(
    monitorRun.subscribe,
    monitorRun.getSnapshot,
    monitorRun.getServerSnapshot,
  );

  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState<string | null>(null);
  const forceRef = useRef(false);

  const watchActive = (running && config.monitorMode === 'watch') || watchDetached;

  // ── Restore URL + config from localStorage on first mount ─────────────
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
      // localStorage may be unavailable (private browsing) — silent fallback
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      if (url) window.localStorage.setItem(STORAGE_KEY_URL, url);
      else window.localStorage.removeItem(STORAGE_KEY_URL);
    } catch { /* ignore */ }
  }, [url, restored]);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
    } catch { /* ignore */ }
  }, [config, restored]);

  // ── On mount: auto-fill URL from active watches if URL is empty ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/monitor/watches').then((r) => r.json());
        if (cancelled) return;
        const watches = Array.isArray(res?.watches) ? res.watches : [];
        if (watches.length === 0) return;
        setUrl((current) => {
          if (current.trim()) return current;
          const latest = [...watches].sort(
            (a: { startedAt: string }, b: { startedAt: string }) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
          )[0];
          return latest.url;
        });
      } catch {
        /* best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Hydrate reports + watch state from server when the URL changes ──
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      monitorRun.setWatchDetached(false);
      if (!monitorRun.isRunning()) monitorRun.setReports([]);
      return;
    }
    const ourSite = siteKey(trimmed);
    if (!ourSite) {
      monitorRun.setWatchDetached(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [watchesRes, reportsRes, lastEventRes] = await Promise.all([
          fetch('/api/monitor/watches').then((r) => r.json()),
          fetch(`/api/monitor/reports?url=${encodeURIComponent(trimmed)}&limit=1`, { cache: 'no-store' }).then((r) => r.json()),
          fetch(`/api/monitor/last-event?url=${encodeURIComponent(trimmed)}`, { cache: 'no-store' })
            .then((r) => r.json())
            .catch(() => null),
        ]);
        if (cancelled) return;
        const watches = Array.isArray(watchesRes?.watches) ? watchesRes.watches : [];
        monitorRun.setWatchDetached(Boolean(watches.find((w: { site: string }) => w.site === ourSite)));
        // Don't clobber a live run's reports with the stored snapshot.
        if (!monitorRun.isRunning()) {
          const stored = Array.isArray(reportsRes?.reports) ? reportsRes.reports : [];
          const hydrated: ChangeReport[] = stored.map((r: { report: ChangeReport }) => r.report).filter(Boolean);
          hydrated.reverse();
          monitorRun.setReports(hydrated);

          // A `snapshot` run produces no report, so a page RELOAD used to show an
          // empty panel even though the baseline was recorded. Restore it from the
          // change event instead. Only when there is no report to show and nothing
          // already on screen — never overwrite a live/held result.
          const ev = lastEventRes?.event as
            | { mode?: string; site?: string; pagesScanned?: number }
            | null
            | undefined;
          if (hydrated.length === 0 && ev?.mode === 'snapshot' && !monitorRun.getSnapshot().snapshot) {
            monitorRun.setSnapshot({
              site: ev.site ?? ourSite,
              pagesScanned: typeof ev.pagesScanned === 'number' ? ev.pagesScanned : 0,
            });
          }
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  const handleClearView = useCallback(() => {
    setUrl('');
    monitorRun.clearView();
    try { window.localStorage.removeItem(STORAGE_KEY_URL); } catch { /* ignore */ }
  }, []);

  const handleRun = useCallback(async () => {
    if (!url.trim() || running || checking) return;
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
      target = c.url;
    } finally {
      setChecking(false);
    }
    // Hand off to the module store so the run survives leaving this tab.
    await monitorRun.startRun(target, config);
  }, [url, config, running, checking]);

  const handleStop = useCallback(() => monitorRun.stop(url, config), [url, config]);

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
              <div className={`rounded-lg border px-3 py-2 text-xs ${preflight ? 'border-amber-800/60 bg-amber-950/30 text-amber-200' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>
                {checking ? 'Checking URL…' : preflight}
              </div>
            )}
            <SnapshotsManager url={url} disabled={running} refreshKey={refreshKey} onCleared={monitorRun.onSnapshotsCleared} />
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
        <ProjectAssignQueue urls={pendingAssign} onDone={monitorRun.clearPendingAssign} />
      )}
    </div>
  );
}
