'use client';

import { useEffect, useState } from 'react';
import type { SiteSchedule, SiteCheckRecord, UptimeClass } from '@/lib/siteWatch/types';
import { TrendBar, type TrendTone } from '@/components/TrendBar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const UPTIME_STYLE: Record<UptimeClass | 'pending', { dot: string; text: string; label: string }> = {
  up: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Up' },
  down: { dot: 'bg-red-400', text: 'text-red-300', label: 'Down' },
  blocked: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Reachable (challenged)' },
  pending: { dot: 'bg-slate-500', text: 'text-slate-400', label: 'Pending first check' },
};

/** Colour + label for an SSL days-remaining value. */
function sslStyle(days: number | null, valid: boolean | undefined): { text: string; label: string } {
  if (valid === false || days === null) return { text: 'text-slate-500', label: 'SSL: n/a' };
  if (days <= 0) return { text: 'text-red-300', label: 'SSL expired' };
  if (days <= 7) return { text: 'text-red-300', label: `SSL expires in ${days}d` };
  if (days <= 14) return { text: 'text-amber-300', label: `SSL: ${days}d left` };
  if (days <= 30) return { text: 'text-amber-200', label: `SSL: ${days}d left` };
  return { text: 'text-emerald-300', label: `SSL: ${days}d left` };
}

/** Colour + label for a domain-expiry days-remaining value (mirrors SSL). */
function domainStyle(days: number | null, valid: boolean | undefined): { text: string; label: string } {
  if (valid === false || days == null) return { text: 'text-slate-500', label: 'Domain: n/a' };
  if (days <= 0) return { text: 'text-red-300', label: 'Domain expired' };
  if (days <= 7) return { text: 'text-red-300', label: `Domain expires in ${days}d` };
  if (days <= 14) return { text: 'text-amber-300', label: `Domain: ${days}d left` };
  if (days <= 30) return { text: 'text-amber-200', label: `Domain: ${days}d left` };
  return { text: 'text-emerald-300', label: `Domain: ${days}d left` };
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const unit = days >= 1 ? `${days}d` : hrs >= 1 ? `${hrs}h` : `${mins}m`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

function intervalLabel(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `every ${mins}m`;
  if (mins < 1440) return `every ${Math.round(mins / 60)}h`;
  return `every ${Math.round(mins / 1440)}d`;
}

export function SiteCard({
  schedule,
  onStop,
  onTogglePause,
}: {
  schedule: SiteSchedule;
  onStop: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [checks, setChecks] = useState<SiteCheckRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const up: UptimeClass | 'pending' = schedule.lastClassification ?? 'pending';
  const u = UPTIME_STYLE[up];
  const ssl = sslStyle(schedule.lastSslDaysRemaining ?? null, schedule.lastSslValid);
  const domain = domainStyle(schedule.lastDomainDaysRemaining ?? null, schedule.lastDomainValid);

  async function loadChecks() {
    setLoading(true);
    try {
      const res = await fetch(`/api/site-watch/results?id=${encodeURIComponent(schedule.id)}`, {
        cache: 'no-store', // never serve a stale (empty) first response from cache
      }).then((r) => r.json());
      setChecks(Array.isArray(res?.checks) ? res.checks : []);
    } catch {
      setChecks([]);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    // Always refetch when opening — see ScheduleCard: a first fetch that landed
    // before the baseline check finished would otherwise stick as "No checks yet".
    if (next) void loadChecks();
  }

  // Load history on mount + whenever a new check lands, so the trend sparkline
  // shows without expanding.
  useEffect(() => {
    void loadChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.lastCheckedAt]);

  // Recent-history trend (oldest → newest): uptime % + a status sparkline.
  const recent = (checks ?? []).slice(0, 12).reverse();
  const upCount = recent.filter((c) => c.uptime.classification !== 'down').length;
  const uptimePct = recent.length ? Math.round((upCount / recent.length) * 100) : null;
  const trendTones: TrendTone[] = recent.map((c) =>
    c.uptime.classification === 'up' ? 'emerald' : c.uptime.classification === 'blocked' ? 'amber' : 'red',
  );

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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.text}`}>
                <span className={`w-2 h-2 rounded-full ${u.dot}`} />
                {u.label}
              </span>
              {up !== 'pending' && schedule.lastResponseMs != null && (
                <span className="text-[11px] text-slate-500">{schedule.lastResponseMs}ms</span>
              )}
              <span className={`text-[11px] font-medium ${ssl.text}`}>{ssl.label}</span>
              <span className={`text-[11px] font-medium ${domain.text}`}>{domain.label}</span>
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
              <span>checked {relativeTime(schedule.lastCheckedAt)}</span>
              <span>next {relativeTime(schedule.nextCheckAt)}</span>
              {uptimePct != null && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-slate-400">{uptimePct}% up</span>
                  <TrendBar tones={trendTones} title={`last ${trendTones.length} checks`} />
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
              title="Stops watching this URL and clears its check history. Its result stays in Projects. Use Pause to keep it."
              className="rounded-md border border-red-900/60 text-red-300 hover:bg-red-950/40 disabled:opacity-40 px-2.5 py-1.5 text-xs font-medium"
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={toggle}
          className="mt-3 text-xs font-medium text-slate-400 hover:text-slate-200"
        >
          {expanded ? '▾ Hide check history' : '▸ View check history'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 p-4 space-y-2">
          {loading && (
            <div className="space-y-2">
              <div className="fp-skeleton h-11 rounded-lg" />
              <div className="fp-skeleton h-11 rounded-lg" />
            </div>
          )}
          {!loading && checks && checks.length === 0 && (
            <p className="text-xs text-slate-500">No checks yet — they appear after the first run.</p>
          )}
          {!loading &&
            checks &&
            checks.slice(0, 40).map((c, i) => <CheckRow key={`${c.checkedAt}-${i}`} check={c} />)}
        </div>
      )}

      <ConfirmDialog
        open={confirmStop}
        variant="danger"
        title="Stop this uptime &amp; SSL scheduler?"
        confirmLabel="Stop scheduler"
        message={
          <>
            Stops watching{' '}
            <span className="font-mono break-all text-slate-300">{schedule.url}</span> and clears its
            check history here.{' '}
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

/** One labeled key/value cell in the check log. */
function Field({ label, value, valueClass = 'text-slate-300' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="text-[11px]">
      <span className="text-slate-500">{label}: </span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function CheckRow({ check }: { check: SiteCheckRecord }) {
  const u = UPTIME_STYLE[check.uptime.classification] ?? UPTIME_STYLE.down;
  const { statusCode, responseMs, error } = check.uptime;
  const ssl = check.ssl;

  const httpValue =
    statusCode != null ? `${statusCode}${error ? ` — ${error}` : ''}` : error ?? 'no response';

  let sslValue = 'n/a (not HTTPS)';
  let sslClass = 'text-slate-400';
  if (ssl) {
    if (ssl.ok && ssl.daysRemaining != null) {
      const expiry = ssl.validTo ? new Date(ssl.validTo).toLocaleDateString() : '?';
      sslValue =
        ssl.daysRemaining <= 0
          ? `EXPIRED (was valid to ${expiry})`
          : `${ssl.daysRemaining} day${ssl.daysRemaining === 1 ? '' : 's'} left (expires ${expiry})`;
      sslClass =
        ssl.daysRemaining <= 7 ? 'text-red-300' : ssl.daysRemaining <= 30 ? 'text-amber-300' : 'text-slate-300';
    } else {
      sslValue = ssl.error ?? 'check failed';
      sslClass = 'text-red-300';
    }
  }

  const domain = check.domain;
  let domainValue = 'n/a';
  let domainClass = 'text-slate-400';
  if (domain) {
    if (domain.ok && domain.daysRemaining != null) {
      const expiry = domain.expiryDate ? new Date(domain.expiryDate).toLocaleDateString() : '?';
      domainValue =
        domain.daysRemaining <= 0
          ? `EXPIRED (was valid to ${expiry})`
          : `${domain.daysRemaining} day${domain.daysRemaining === 1 ? '' : 's'} left (expires ${expiry})`;
      domainClass =
        domain.daysRemaining <= 7
          ? 'text-red-300'
          : domain.daysRemaining <= 30
            ? 'text-amber-300'
            : 'text-slate-300';
    } else {
      domainValue = domain.error ?? 'check failed';
      domainClass = 'text-slate-400';
    }
  }

  return (
    <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.text}`}>
          <span className={`w-2 h-2 rounded-full ${u.dot}`} />
          {u.label}
        </span>
        <span className="text-[11px] text-slate-500">{new Date(check.checkedAt).toLocaleString()}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        <Field label="HTTP status" value={httpValue} />
        <Field label="Response time" value={`${responseMs} ms`} />
        <Field label="SSL certificate" value={sslValue} valueClass={sslClass} />
        <Field label="Domain registration" value={domainValue} valueClass={domainClass} />
      </div>
    </div>
  );
}
