/**
 * Module-level store for the Change Monitor run (snapshot / compare / watch).
 *
 * WHY: the run used to live in the monitor page's component state, so switching
 * tabs unmounted it and every `setState` from the stream reader became a no-op —
 * the run "died" and its "add to project?" prompt never fired. Living at module
 * scope, the run outlives navigation: the stream keeps filling this store while
 * you're on another tab, and the page re-subscribes on return. Mirrors the
 * Form Tester's `testerRun` store.
 *
 * `reports`/`snapshot`/`logs` are a DISPLAY cache; the authoritative reports are
 * saved server-side. `clearView()` wipes the view, never the server data.
 */

import type { ChangeReport, MonitorConfig, MonitorSSEEvent, SnapshotResult } from '@/types';

export interface MonitorRunState {
  reports: ChangeReport[];
  snapshot: SnapshotResult | null;
  logs: string[];
  running: boolean;
  /** A watch is running on the server for the current URL (maybe detached). */
  watchDetached: boolean;
  /** URLs to prompt "add to a project?" for. */
  pendingAssign: string[];
  /** Bump to make SnapshotsManager re-fetch. */
  refreshKey: number;
}

const EMPTY: MonitorRunState = {
  reports: [],
  snapshot: null,
  logs: [],
  running: false,
  watchDetached: false,
  pendingAssign: [],
  refreshKey: 0,
};

let state: MonitorRunState = EMPTY;
let abort: AbortController | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function set(patch: Partial<MonitorRunState>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getSnapshot(): MonitorRunState {
  return state;
}
export function getServerSnapshot(): MonitorRunState {
  return EMPTY;
}
export function isRunning(): boolean {
  return state.running;
}

/** Hydration setters (called by the page's URL effect from server data). */
export function setReports(reports: ChangeReport[]): void {
  set({ reports });
}
/** Restore a baseline result after a page reload (see the monitor page's
 *  hydration effect). A `snapshot` run stores no report, so without this a
 *  refresh showed an empty panel for a baseline that was recorded fine. */
export function setSnapshot(snapshot: SnapshotResult | null): void {
  set({ snapshot });
}
export function setWatchDetached(v: boolean): void {
  set({ watchDetached: v });
}
export function clearPendingAssign(): void {
  set({ pendingAssign: [] });
}
/** Snapshots were deleted server-side — reflect that + refresh. */
export function onSnapshotsCleared(): void {
  set({ reports: [], snapshot: null, logs: [...state.logs, 'Cleared all stored snapshots.'], refreshKey: state.refreshKey + 1 });
}
/** Wipe the on-screen view (keeps server-stored reports/snapshots). */
export function clearView(): void {
  set({ reports: [], snapshot: null, logs: [] });
}

/** Stop the run/watch. For watch mode, ask the server to kill it. */
export async function stop(url: string, config: MonitorConfig): Promise<void> {
  abort?.abort();
  abort = null;
  if (config.monitorMode === 'watch' || state.watchDetached) {
    try {
      await fetch('/api/monitor/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) });
      set({ logs: [...state.logs, 'Watch stopped.'] });
    } catch (err) {
      set({ logs: [...state.logs, `⚠ Failed to stop watch: ${err instanceof Error ? err.message : String(err)}`] });
    }
    set({ watchDetached: false, running: false });
  } else {
    set({ logs: [...state.logs, 'Stopped by user.'], running: false });
  }
}

/** Start a snapshot/compare/watch run and stream it into this store. Safe to
 *  leave the page while it runs. `target` is the normalized URL. */
export async function startRun(target: string, config: MonitorConfig): Promise<void> {
  if (state.running) return;

  // Watch mode preserves history on re-attach; one-off runs clear it.
  if (config.monitorMode !== 'watch') set({ reports: [], snapshot: null });
  set({ logs: [], running: true, pendingAssign: [] });
  let prompted = false;

  abort = new AbortController();
  try {
    const response = await fetch('/api/monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target, ...config }),
      signal: abort.signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      // 409 = a watch is already active for this site (detached).
      if (response.status === 409 && config.monitorMode === 'watch') {
        set({ watchDetached: true, running: false, logs: [...state.logs, 'A watch is already running for this site. Click "Stop watching" to end it.'] });
        return;
      }
      throw new Error(`Server error ${response.status}: ${text}`);
    }

    if (config.monitorMode === 'watch') set({ watchDetached: true });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
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
            set({ snapshot: event.result, refreshKey: state.refreshKey + 1 });
            if (!prompted) { prompted = true; set({ pendingAssign: [target] }); }
          } else if (event.type === 'report') {
            set({ reports: [event.report], refreshKey: state.refreshKey + 1 });
            if (!prompted) { prompted = true; set({ pendingAssign: [target] }); }
          } else if (event.type === 'log') {
            set({ logs: [...state.logs.slice(-99), event.message] });
          } else if (event.type === 'done' || event.type === 'error') {
            if (event.type === 'error') set({ logs: [...state.logs, `⚠ ${event.message}`] });
            else if (!prompted) { prompted = true; set({ pendingAssign: [target] }); }
            set({ running: false });
            if (config.monitorMode !== 'watch') set({ watchDetached: false });
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') set({ logs: [...state.logs, `Fatal: ${err.message}`] });
  } finally {
    abort = null;
    set({ running: false });
  }
}
