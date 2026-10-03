'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MonitorCommandBar } from '@/components/monitor/MonitorCommandBar';
import { MonitorResultsPanel } from '@/components/monitor/MonitorResultsPanel';
import { SnapshotsManager } from '@/components/monitor/SnapshotsManager';
import { ProjectAssignQueue } from '@/components/projects/ProjectAssignQueue';
import { ReadOnlyBanner } from '@/components/ReadOnlyBanner';
import { PageHeader, KeptNotice } from '@/components/ui';
import { Toaster } from '@/components/Toaster';
import { checkUrl } from '@/lib/urlCheck';
import * as monitorRun from '@/lib/monitorRun';
import { markCleared, unmarkCleared, wasCleared } from '@/lib/clearedInput';
import type { MonitorConfig, ChangeReport } from '@/types';

const DEFAULT_CONFIG: MonitorConfig = {
  // Snapshot is the default mode — take a baseline first, then Compare later. FR-65.
  monitorMode: 'snapshot',
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

  /** Inline "cleared" confirmation shown in the results area (not a floating toast). */
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 7000);
  }, []);

  const watchActive = (running && config.monitorMode === 'watch') || watchDetached;

  // ── Restore URL + config from localStorage on first mount ─────────────
  useEffect(() => {
    try {
      // Respect a deliberate clear: don't restore the URL if the user emptied it.
      const savedUrl = wasCleared('monitor') ? null : window.localStorage.getItem(STORAGE_KEY_URL);
      if (savedUrl) setUrl(savedUrl);
      const savedConfigRaw = window.localStorage.getItem(STORAGE_KEY_CONFIG);
      if (savedConfigRaw) {
        // Restore the full saved config, INCLUDING the last-used mode — so a mode
        // switch persists across refresh. Default (no saved config) is Snapshot
        // via DEFAULT_CONFIG. FR-65.
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
    // A deliberate clear wins: never auto-fill from a running watch after the
    // user has emptied the input — that was a source of "Clear didn't stick".
    if (wasCleared('monitor')) return;
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
    markCleared('monitor'); // keep it empty until the user types again
    try { window.localStorage.removeItem(STORAGE_KEY_URL); } catch { /* ignore */ }
    showFlash('Cleared from view — change history is still tracked in Projects.');
  }, [showFlash]);

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
    <>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">
        <PageHeader
          title="Content Changes"
          description="Snapshot a site, compare it later, and see exactly what changed — content, SEO, forms, scripts, performance."
        />
        <div className="mt-5">
          <ReadOnlyBanner />
        </div>

        {/* Command bar */}
        <div className="mt-5">
          <MonitorCommandBar
            url={url}
            onUrl={(u) => {
              setUrl(u);
              if (u) unmarkCleared('monitor'); // user is filling it again
              forceRef.current = false;
              setPreflight(null);
            }}
            config={config}
            onConfig={setConfig}
            onRun={handleRun}
            onStop={handleStop}
            running={running}
            watchActive={watchActive}
            checking={checking}
            preflight={preflight}
          />
        </div>

        {/* Baselines / snapshots */}
        <div className="mt-5">
          <SnapshotsManager url={url} disabled={running} refreshKey={refreshKey} onCleared={monitorRun.onSnapshotsCleared} />
        </div>

        {/* Results — the full-width stage */}
        <div className="mt-6">
          <Toaster />
          {flash && (
            <div className="mb-3">
              <KeptNotice title={flash} onDismiss={() => setFlash(null)} />
            </div>
          )}
          <MonitorResultsPanel
            reports={reports}
            snapshot={snapshot}
            logs={logs}
            running={running}
            watchActive={watchActive}
            mode={config.monitorMode}
            url={url}
            onClear={handleClearView}
          />
        </div>
      </main>

      {pendingAssign.length > 0 && (
        <ProjectAssignQueue urls={pendingAssign} onDone={monitorRun.clearPendingAssign} />
      )}
    </>
  );
}
