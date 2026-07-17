/**
 * Module-level store for the Form Tester run.
 *
 * WHY THIS EXISTS: the run used to live in the page component's state. Switching
 * tabs unmounts that page, so every `setState` from the stream reader became a
 * no-op and the result never landed on screen or in localStorage — the run
 * looked like it "died" (the server actually finished it and persisted it, which
 * is why it still showed up in Projects). Scheduled monitors were unaffected
 * because they run server-side.
 *
 * Living at module scope, this store outlives route changes: the stream keeps
 * filling it while you're on another tab, and the page re-subscribes on return
 * to show live progress and the final result. Read it with `useSyncExternalStore`.
 *
 * This is a DISPLAY cache; the authoritative result is still saved server-side
 * (on-demand run store) for Projects/Status. `clear()` wipes the view only.
 */

import type { SiteResult, RunConfig, SSEEvent, RunProgress } from '@/types';

const STORAGE_KEY_RESULTS = 'fp:tester:results';
const STORAGE_KEY_LOGS = 'fp:tester:logs';

export interface TesterRunState {
  results: SiteResult[];
  running: boolean;
  progress: RunProgress | null;
  logs: string[];
  /** URLs to prompt "add to a project?" for once a run completes. */
  pendingAssign: string[];
}

const EMPTY: TesterRunState = { results: [], running: false, progress: null, logs: [], pendingAssign: [] };

let state: TesterRunState = EMPTY;
let hydrated = false;
let abort: AbortController | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Replace state (new object identity so useSyncExternalStore re-renders). */
function set(patch: Partial<TesterRunState>): void {
  state = { ...state, ...patch };
  persist();
  emit();
}

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    if (state.results.length) window.localStorage.setItem(STORAGE_KEY_RESULTS, JSON.stringify(state.results));
    else window.localStorage.removeItem(STORAGE_KEY_RESULTS);
    if (state.logs.length) window.localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(state.logs));
    else window.localStorage.removeItem(STORAGE_KEY_LOGS);
  } catch {
    /* quota/private-mode — the run still works, we just don't cache it */
  }
}

/** Restore the last view from localStorage. Runs once, client-side only. */
export function hydrate(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const r = window.localStorage.getItem(STORAGE_KEY_RESULTS);
    const l = window.localStorage.getItem(STORAGE_KEY_LOGS);
    const results = r ? (JSON.parse(r) as SiteResult[]) : [];
    const logs = l ? (JSON.parse(l) as string[]) : [];
    state = {
      ...state,
      results: Array.isArray(results) ? results : [],
      logs: Array.isArray(logs) ? logs : [],
    };
    emit();
  } catch {
    /* malformed cache — start clean */
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getSnapshot(): TesterRunState {
  return state;
}
/** Server render has no localStorage and never a live run. */
export function getServerSnapshot(): TesterRunState {
  return EMPTY;
}

/** Clear the on-screen view (never touches the server-side stored result). */
export function clear(): void {
  set({ results: [], logs: [], progress: null });
}

export function clearPendingAssign(): void {
  set({ pendingAssign: [] });
}

/** Abort the in-flight run. */
export function stop(): void {
  abort?.abort();
  abort = null;
  set({ running: false, progress: null, logs: [...state.logs, 'Stopped by user.'] });
}

/**
 * Start a run and stream it into this store. Safe to leave the page while it
 * runs — the stream keeps writing here.
 */
export async function startRun(urls: string[], config: RunConfig): Promise<void> {
  if (state.running) return;

  abort = new AbortController();
  set({
    results: [],
    logs: [],
    running: true,
    progress: { current: 0, total: urls.length, currentUrl: urls[0]! },
    pendingAssign: [],
  });

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

    for (;;) {
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
            set({
              results: [...state.results, event.result],
              progress: state.progress
                ? { ...state.progress, current: state.progress.current + 1, currentUrl: '' }
                : null,
            });
          } else if (event.type === 'progress') {
            set({ progress: { current: event.index, total: event.total, currentUrl: event.url } });
          } else if (event.type === 'log') {
            set({ logs: [...state.logs.slice(-99), event.message] });
          } else if (event.type === 'error') {
            set({ logs: [...state.logs, `⚠ ${event.message}`], running: false, progress: null });
          } else if (event.type === 'done') {
            // Run finished — offer to file each tested URL under a project
            // (the modal self-skips ones already grouped or dismissed).
            set({ pendingAssign: urls, running: false, progress: null });
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      set({ logs: [...state.logs, `Fatal: ${err.message}`] });
    }
  } finally {
    abort = null;
    set({ running: false, progress: null });
  }
}
