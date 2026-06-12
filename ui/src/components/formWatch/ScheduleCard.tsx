'use client';

import { useEffect, useState } from 'react';
import type { FormSchedule, FormRunRecord, FormRunStatus } from '@/lib/formWatch/types';

const STATUS_STYLE: Record<FormRunStatus | 'pending', { dot: string; text: string; label: string }> = {
  pass: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Passing' },
  warn: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Warning' },
  fail: { dot: 'bg-red-400', text: 'text-red-300', label: 'Failing' },
  error: { dot: 'bg-red-500', text: 'text-red-400', label: 'Error' },
  pending: { dot: 'bg-slate-500', text: 'text-slate-400', label: 'Pending first run' },
};

function StatusBadge({ status }: { status: FormRunStatus | 'pending' }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

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
}: {
  schedule: FormSchedule;
  onStop: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<FormRunRecord[] | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [stopping, setStopping] = useState(false);

  const status: FormRunStatus | 'pending' = schedule.lastStatus ?? 'pending';

  async function loadRuns() {
    setLoadingRuns(true);
    try {
      const res = await fetch(`/api/form-watch/results?id=${encodeURIComponent(schedule.id)}`).then((r) => r.json());
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
    if (next && runs === null) void loadRuns();
  }

  // Re-fetch the run history whenever a new run completes (lastRunAt changes)
  // while the panel is open — so the automatic scheduled runs show up without
  // needing to collapse/re-expand.
  useEffect(() => {
    if (expanded) void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.lastRunAt]);

  async function handleStop() {
    setStopping(true);
    try {
      await onStop(schedule.id);
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={status} />
              {schedule.lastReasonCode && status !== 'pending' && (
                <span className="text-[11px] text-slate-500 font-mono">{schedule.lastReasonCode}</span>
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
              <span>last run {relativeTime(schedule.lastRunAt)}</span>
              <span>next {relativeTime(schedule.nextRunAt)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1.5 text-xs font-medium text-slate-300"
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
    </div>
  );
}

function RunRow({ run }: { run: FormRunRecord }) {
  const s = STATUS_STYLE[run.status] ?? STATUS_STYLE.error;
  return (
    <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
          <span className={`w-2 h-2 rounded-full ${s.dot}`} />
          {run.status.toUpperCase()}
          <span className="text-slate-500 font-mono">{run.reasonCode}</span>
        </span>
        <span className="text-[11px] text-slate-500">{new Date(run.ranAt).toLocaleString()}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        submission: {run.submissionResult} · {Math.round(run.durationMs / 1000)}s
        {run.fingerprint.captchaDetected ? ' · CAPTCHA present' : ''}
      </div>
      {run.errors.length > 0 && (
        <p className="mt-1.5 text-[11px] text-red-300/80">{run.errors.slice(0, 2).join('; ')}</p>
      )}
    </div>
  );
}
