/**
 * Shared subprocess spawner for monitor runs (snapshot, compare, watch).
 *
 * Two callers:
 *   - /api/monitor/route.ts — needs to stream events to the client over SSE
 *   - watchResume.ts        — silently re-spawns persisted watches on server
 *                              startup; no SSE listener
 *
 * Persisting reports to disk happens here (not in the API route) so resumed
 * watches still write their reports — same as live ones.
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { saveReport } from './reportStore';
import { recordChangeEvent } from './changeEventStore';
import { siteKey } from './watchRegistry';
import type { ChangeSeverity } from '@/types';

const SEV_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Highest severity across a report's per-page details, or null if none. */
function topSeverity(parsed: Record<string, unknown>): ChangeSeverity | null {
  const details = Array.isArray(parsed.details) ? parsed.details : [];
  let top: ChangeSeverity | null = null;
  for (const d of details) {
    const sev = (d as { severity?: string } | null)?.severity;
    if (sev && (top === null || (SEV_RANK[sev] ?? -1) > (SEV_RANK[top] ?? -1))) {
      top = sev as ChangeSeverity;
    }
  }
  return top;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export interface SpawnMonitorOptions {
  url: string;
  monitorMode: 'snapshot' | 'compare' | 'watch';
  maxPages: number;
  takeScreenshots: boolean;
  aiSummary: boolean;
  aiProvider?: string;
  watchIntervalMs: number;
}

export interface SpawnEventHandlers {
  /** Called for each snapshot result JSON line from stdout. */
  onSnapshot?: (data: Record<string, unknown>) => void;
  /** Called for each report JSON line from stdout. Reports are also
   *  persisted to disk regardless of whether a handler is attached. */
  onReport?: (data: Record<string, unknown>) => void;
  /** Called for each INFO/WARN/ERROR log line from stderr. */
  onLog?: (message: string) => void;
  /** Spawn-time / unrecoverable error from the child process. */
  onError?: (message: string) => void;
  /** Child process exited (any cause). */
  onClose?: (code: number | null) => void;
}

/**
 * Spawn the CLI subprocess for the given monitor run. Returns the
 * ChildProcess so the caller can register it / kill it.
 *
 * The caller is responsible for child-process lifecycle (registry,
 * cleanup on exit, etc). This function only wires up stdout/stderr
 * parsing and report persistence.
 */
export function spawnMonitor(
  opts: SpawnMonitorOptions,
  handlers: SpawnEventHandlers = {},
): ChildProcess {
  const uiRoot = process.cwd();
  const formpingRoot = path.join(uiRoot, '..');
  const cliPath = path.join(formpingRoot, 'src', 'cli.ts');
  // Launch tsx's JS entry via node (process.execPath). The `.bin/tsx` shim is a
  // shell script Windows cannot exec — node + cli.mjs runs identically on Windows
  // (local dev) and Linux (Railway).
  const tsxCli = path.join(formpingRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  const args: string[] = [
    cliPath,
    '--url', opts.url,
    '--monitor', opts.monitorMode,
    '--pages', String(opts.maxPages),
  ];
  if (opts.takeScreenshots) args.push('--screenshots');
  // Prefer explicit --ai-provider; fall back to legacy --ai-summary (= 'auto')
  if (opts.aiProvider && opts.aiProvider !== 'off') args.push('--ai-provider', opts.aiProvider);
  else if (opts.aiSummary) args.push('--ai-summary');
  if (opts.monitorMode === 'watch') args.push('--watch-interval', String(opts.watchIntervalMs));

  const child = spawn(process.execPath, [tsxCli, ...args], {
    cwd: formpingRoot,
    env: { ...process.env, DEBUG: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const site = siteKey(opts.url);

  let stdoutBuf = '';

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if ('snapshotPath' in parsed) {
          // A baseline leaves no report — record an EVENT so Projects can show
          // "baseline captured" instead of looking untracked (FR-21).
          void recordChangeEvent({
            site,
            rootUrl: opts.url,
            mode: 'snapshot',
            pagesScanned: num(parsed.pagesScanned),
          });
          handlers.onSnapshot?.(parsed);
        } else if ('details' in parsed && 'pagesScanned' in parsed) {
          // Persist regardless of whether a handler is attached. Fire-and-
          // forget; failures are logged inside saveReport.
          void saveReport(site, parsed);
          void recordChangeEvent({
            site,
            rootUrl: opts.url,
            mode: opts.monitorMode === 'watch' ? 'watch' : 'compare',
            checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : undefined,
            pagesScanned: num(parsed.pagesScanned),
            pagesChanged: num(parsed.pagesChanged),
            changesFound: num(parsed.changesFound),
            severity: topSeverity(parsed),
            summary: typeof parsed.summary === 'string' ? parsed.summary : null,
          });
          handlers.onReport?.(parsed);
        }
      } catch {
        // ignore non-JSON output
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    // Forward to parent stderr so Railway/Docker log collectors see it
    process.stderr.write(chunk);

    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      if (/INFO|WARN|ERROR/.test(line)) {
        const cleaned = line.replace(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s+\w+\s+/, '').trim();
        if (cleaned) handlers.onLog?.(cleaned);
      }
    }
  });

  child.on('close', (code) => {
    // Drain any tail-end stdout in case the last line didn't end with '\n'
    if (stdoutBuf.trim()) {
      try {
        const parsed = JSON.parse(stdoutBuf.trim()) as Record<string, unknown>;
        if ('snapshotPath' in parsed) {
          void recordChangeEvent({
            site,
            rootUrl: opts.url,
            mode: 'snapshot',
            pagesScanned: num(parsed.pagesScanned),
          });
          handlers.onSnapshot?.(parsed);
        } else if ('details' in parsed) {
          void saveReport(site, parsed);
          void recordChangeEvent({
            site,
            rootUrl: opts.url,
            mode: opts.monitorMode === 'watch' ? 'watch' : 'compare',
            checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : undefined,
            pagesScanned: num(parsed.pagesScanned),
            pagesChanged: num(parsed.pagesChanged),
            changesFound: num(parsed.changesFound),
            severity: topSeverity(parsed),
            summary: typeof parsed.summary === 'string' ? parsed.summary : null,
          });
          handlers.onReport?.(parsed);
        }
      } catch { /* ignore */ }
    }
    handlers.onClose?.(code);
  });

  child.on('error', (err) => {
    handlers.onError?.(err.message);
  });

  return child;
}
