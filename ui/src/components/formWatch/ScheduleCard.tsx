'use client';

import { useEffect, useState } from 'react';
import type { FormSchedule, FormRunRecord } from '@/lib/formWatch/types';
import { runVerdict, type VerdictLevel } from '@/lib/formWatch/verdict';
import { TrendBar, type TrendTone } from '@/components/TrendBar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const LEVEL_STYLE: Record<VerdictLevel | 'pending', { dot: string; text: string; label: string }> = {
  healthy: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Healthy' },
  attention: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Needs attention' },
  failing: { dot: 'bg-red-400', text: 'text-red-300', label: 'Failing' },
  pending: { dot: 'bg-slate-500', text: 'text-slate-400', label: 'Pending first run' },
};

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const unit = days >= 1 ? `${days}d` : hrs >= 1 ? `${hrs}h` : `${mins}m`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

function intervalLabel(ms: number): string {
  const days = ms / 86_400_000;
  if (days >= 1 && Number.isInteger(days)) return `every ${days} day${days === 1 ? '' : 's'}`;
  const hrs = Math.round(ms / 3_600_000);
  return `every ${hrs}h`;
}

export function ScheduleCard({
  schedule,
  onStop,
  onTogglePause,
}: {
  schedule: FormSchedule;
  onStop: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<FormRunRecord[] | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  // Mode-aware verdict for the most recent run (green when the form is healthy
  // for the selected mode — e.g. SAFE "filled, not submitted" is a success).
  const verdict = schedule.lastStatus
    ? runVerdict(schedule.lastReasonCode ?? '', schedule.lastFormFound ?? false, schedule.lastStatus)
    : null;
  const level: VerdictLevel | 'pending' = verdict ? verdict.level : 'pending';
  const style = LEVEL_STYLE[level];

  // Recent-history trend (oldest → newest): % healthy + a status sparkline.
  const recentRuns = (runs ?? []).slice(0, 12).reverse();
  const levels = recentRuns.map(
    (r) => runVerdict(r.reasonCode, r.fingerprint.formFound, r.status).level,
  );
  const passPct = levels.length
    ? Math.round((levels.filter((l) => l === 'healthy').length / levels.length) * 100)
    : null;
  const trendTones: TrendTone[] = levels.map((l) =>
    l === 'healthy' ? 'emerald' : l === 'failing' ? 'red' : 'amber',
  );

  async function loadRuns() {
    setLoadingRuns(true);
    try {
      const res = await fetch(`/api/form-watch/results?id=${encodeURIComponent(schedule.id)}`, {
        cache: 'no-store', // never serve a stale (empty) first response from cache
      }).then((r) => r.json());
      setRuns(Array.isArray(res?.runs) ? res.runs : []);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }

  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    // Always refetch when opening. Fetching only when `runs === null` meant an
    // empty first fetch (the baseline run hadn't finished yet) stuck as
    // "No runs yet" until `lastRunAt` changed — a whole day on a daily schedule.
    if (next) void loadRuns();
  }

  // Re-fetch the run history whenever a new run completes (lastRunAt changes)
  // while the panel is open.
  // Load history on mount + when a new run lands, so the trend shows collapsed.
  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.lastRunAt]);

  async function doStop() {
    setStopping(true);
    try {
      await onStop(schedule.id);
    } finally {
      setStopping(false);
    }
  }

  async function handlePause() {
    setPausing(true);
    try {
      await onTogglePause(schedule.id, !schedule.paused);
    } finally {
      setPausing(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${style.text}`}>
                <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                {style.label}
              </span>
              {verdict && <span className="text-[11px] text-slate-400">· {verdict.label}</span>}
              {schedule.paused && (
                <span className="text-[11px] font-medium text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">
                  Paused
                </span>
              )}
            </div>
            <a
              href={schedule.url}
              target="_blank"
              rel="noreferrer"
              className="block text-sm font-medium text-slate-200 hover:text-indigo-300 truncate"
              title={schedule.url}
            >
              {schedule.url}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
              <span>{intervalLabel(schedule.intervalMs)}</span>
              <span className="uppercase tracking-wide rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                {schedule.mode}
              </span>
              {schedule.landingPage && (
                <span
                  className="uppercase tracking-wide rounded bg-indigo-500/15 ring-1 ring-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-300"
                  title="Landing-page mode: tested on this exact URL, no contact-page discovery"
                >
                  Landing
                </span>
              )}
              <span>last run {relativeTime(schedule.lastRunAt)}</span>
              <span>next {relativeTime(schedule.nextRunAt)}</span>
              {passPct != null && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-slate-400">{passPct}% healthy</span>
                  <TrendBar tones={trendTones} title={`last ${trendTones.length} runs`} />
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handlePause}
              disabled={pausing}
              className="rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1.5 text-xs font-medium text-slate-300"
            >
              {pausing ? '…' : schedule.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmStop(true)}
              disabled={stopping}
              title="Stops watching this URL and clears its run history. Its result stays in Projects. Use Pause to keep it."
              className="rounded-md border border-red-900/60 text-red-300 hover:bg-red-950/40 disabled:opacity-40 px-2.5 py-1.5 text-xs font-medium"
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleExpand}
          className="mt-3 text-xs font-medium text-slate-400 hover:text-slate-200"
        >
          {expanded ? '▾ Hide run history' : '▸ View run history'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 p-4 space-y-3">
          {loadingRuns && <p className="text-xs text-slate-500">Loading runs…</p>}
          {!loadingRuns && runs && runs.length === 0 && (
            <p className="text-xs text-slate-500">No runs yet — they appear here after the first check.</p>
          )}
          {!loadingRuns &&
            runs &&
            runs.map((run, i) => <RunRow key={`${run.ranAt}-${i}`} run={run} />)}
        </div>
      )}

      <ConfirmDialog
        open={confirmStop}
        variant="danger"
        title="Stop this form scheduler?"
        confirmLabel="Stop scheduler"
        message={
          <>
            Stops watching{' '}
            <span className="font-mono break-all text-slate-300">{schedule.url}</span> and clears its
            run history here.{' '}
            <strong className="text-slate-300">Its result stays in Projects</strong> — only deleting
            the project removes it. Want to keep it? Use{' '}
            <strong className="text-slate-300">Pause</strong>.
          </>
        }
        onConfirm={doStop}
        onCancel={() => setConfirmStop(false)}
      />
    </div>
  );
}

function RunRow({ run }: { run: FormRunRecord }) {
  const v = runVerdict(run.reasonCode, run.fingerprint.formFound, run.status);
  const s = LEVEL_STYLE[v.level];
  return (
    <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
          <span className={`w-2 h-2 rounded-full ${s.dot}`} />
          {s.label}
          <span className="text-slate-400 font-normal">· {v.label}</span>
        </span>
        <span className="text-[11px] text-slate-500">{new Date(run.ranAt).toLocaleString()}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {run.mode ? `${run.mode} · ` : ''}submission: {run.submissionResult} · {Math.round(run.durationMs / 1000)}s
        {run.fingerprint.captchaDetected ? ' · CAPTCHA present' : ''}
        <span className="text-slate-600"> · {run.reasonCode}</span>
      </div>

      {/* Form details — surfaced so the form info is visible on the page */}
      {run.fingerprint.formFound && (
        <div className="mt-1 text-[11px] text-slate-400">
          Form detected
          {run.fingerprint.formConfidence > 0 &&
            ` · ${Math.round(run.fingerprint.formConfidence * 100)}% confidence`}
          {run.fingerprint.formMethod && ` · ${run.fingerprint.formMethod.toUpperCase()}`}
          {run.fingerprint.formId && (
            <>
              {' '}· id{' '}
              <code className="rounded bg-slate-800/60 px-1 text-slate-300">
                {run.fingerprint.formId}
              </code>
            </>
          )}
        </div>
      )}

      {/* Detailed run notes (form found, fields filled, suggestions, etc.) */}
      {run.notes.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {run.notes.map((n, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-slate-500">
              <span className="shrink-0 text-slate-600">•</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      {run.errors.length > 0 && (
        <p className="mt-1.5 text-[11px] text-red-300/80">{run.errors.slice(0, 2).join('; ')}</p>
      )}
    </div>
  );
}
