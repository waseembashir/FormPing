'use client';

import { useEffect, useRef, useState } from 'react';
import type { SiteSchedule, SiteCheckRecord, UptimeClass } from '@/lib/siteWatch/types';
import { STATUS, type StatusLevel } from '@/lib/design/status';
import { TrendBar, type TrendTone } from '@/components/TrendBar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge, StatusPill, StatusText, cx, KeptNotice, RerunButton, RerunTag } from '@/components/ui';

// Canonical status vocabulary (FR-35/FR-65) — one language across every surface.
const UPTIME: Record<UptimeClass | 'pending', { level: StatusLevel; label: string }> = {
  up: { level: 'ok', label: 'Up' },
  down: { level: 'danger', label: 'Down' },
  blocked: { level: 'warn', label: 'Reachable — challenged' },
  pending: { level: 'idle', label: 'Setting up — first check running…' },
};

/** Cert / domain expiry → a canonical level + a plain label. */
function expiry(days: number | null, valid: boolean | undefined, kind: 'SSL' | 'Domain'): { level: StatusLevel; label: string } {
  if (valid === false || days == null) return { level: 'idle', label: `${kind} n/a` };
  if (days <= 0) return { level: 'danger', label: `${kind} expired` };
  if (days <= 7) return { level: 'danger', label: `${kind} expires in ${days}d` };
  if (days <= 30) return { level: 'warn', label: `${kind} ${days}d left` };
  return { level: 'ok', label: `${kind} ${days}d left` };
}

/**
 * FR-83 — the plain sentence beside the status word, so an Uptime card opens the
 * way a Form Scheduler card does: a verdict, then what it means. The badges that
 * follow are the evidence; this is the reading of it.
 */
function siteSentence(up: UptimeClass | 'pending', responseMs: number | null | undefined): string {
  if (up === 'pending') return 'running the first check…';
  if (up === 'down') return 'we can’t reach it right now';
  if (up === 'blocked') return 'the host challenged our check, so we can’t confirm';
  if (responseMs != null && responseMs >= 3000) return 'responding, but slowly';
  return 'responding normally';
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
  onDone,
  onHold,
}: {
  schedule: SiteSchedule;
  onStop: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  onDone: () => void;
  onHold: (active: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [checks, setChecks] = useState<SiteCheckRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [justStopped, setJustStopped] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);

  const up: UptimeClass | 'pending' = schedule.lastClassification ?? 'pending';
  const u = UPTIME[up];
  const ssl = expiry(schedule.lastSslDaysRemaining ?? null, schedule.lastSslValid, 'SSL');
  const domain = expiry(schedule.lastDomainDaysRemaining ?? null, schedule.lastDomainValid, 'Domain');

  /** `silent` skips the loading state, so refreshing an already-open history
   *  doesn't swap it for skeletons and read as the panel flickering shut. */
  async function loadChecks(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch(`/api/site-watch/results?id=${encodeURIComponent(schedule.id)}`, { cache: 'no-store' }).then((r) => r.json());
      setChecks(Array.isArray(res?.checks) ? res.checks : []);
    } catch {
      setChecks([]);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }
  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next) void loadChecks();
  }
  useEffect(() => {
    void loadChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.lastCheckedAt]);

  useEffect(() => () => { if (holding.current) onHold(false); if (timer.current) clearTimeout(timer.current); }, [onHold]);


  // Scheduled checks only. This strip and its percentage answer "how has this
  // site been doing on its schedule?" — a check someone ran by hand is not part
  // of that answer, and letting re-runs in would mean the number moved every
  // time you pressed the button. FR-82.
  const scheduled = (checks ?? []).filter((c) => c.trigger !== 'manual');
  const recent = scheduled.slice(0, 12).reverse();
  const upCount = recent.filter((c) => c.uptime.classification !== 'down').length;
  const uptimePct = recent.length ? Math.round((upCount / recent.length) * 100) : null;
  const trendTones: TrendTone[] = recent.map((c) => (c.uptime.classification === 'up' ? 'emerald' : c.uptime.classification === 'blocked' ? 'amber' : 'red'));

  function finish() {
    if (timer.current) clearTimeout(timer.current);
    if (holding.current) { holding.current = false; onHold(false); }
    onDone();
  }
  async function doStop() {
    setStopping(true);
    try { await onStop(schedule.id); } finally { setStopping(false); }
    setConfirmStop(false);
    holding.current = true;
    onHold(true);
    setJustStopped(true);
    timer.current = setTimeout(finish, 7000);
  }
  /** Check this URL now. Adds one tagged row to the history below and changes
   *  nothing else — the schedule, its next check and its uptime figure all stay
   *  exactly as they were. FR-82. */
  async function handleRerun() {
    setRerunning(true);
    setRerunError(null);
    setExpanded(true); // the answer lands in the history — open it before it does
    try {
      const res = await fetch('/api/site-watch/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: schedule.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRerunError(data?.error || 'Could not run the check just now. Try again in a moment.');
        return;
      }
      await loadChecks({ silent: checks !== null }); // the new row is the result
    } catch {
      setRerunError('Could not reach the server. Your schedule is unaffected.');
    } finally {
      setRerunning(false);
    }
  }

  async function handlePause() {
    setPausing(true);
    try { await onTogglePause(schedule.id, !schedule.paused); } finally { setPausing(false); }
  }

  if (justStopped) {
    return <KeptNotice title="Stopped — its last results are kept in Projects" subtitle={schedule.url} onDismiss={finish} />;
  }

  return (
    <div className={cx('rounded-xl border bg-panel/60', schedule.paused ? 'border-dashed border-line-strong' : 'border-line')}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <StatusPill level={u.level} pulse={up === 'pending'}>{u.label}</StatusPill>
              {/* The reading of that verdict, exactly where a Form Scheduler card
                  puts its own. FR-83. */}
              <span className="text-[13px] text-ink-secondary">· {siteSentence(up, schedule.lastResponseMs)}</span>
              <StatusText level={ssl.level}>{ssl.label}</StatusText>
              <StatusText level={domain.level}>{domain.label}</StatusText>
              {schedule.paused && <Badge tone="neutral">Paused</Badge>}
            </div>
            <a href={schedule.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-ink hover:text-accent-soft" title={schedule.url}>
              {schedule.url}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-faint">
              <span>{intervalLabel(schedule.intervalMs)}</span>
              <span>checked {relativeTime(schedule.lastCheckedAt)}</span>
              <span>next {relativeTime(schedule.nextCheckAt)}</span>
              {up !== 'pending' && schedule.lastResponseMs != null && <span>{schedule.lastResponseMs} ms</span>}
              {uptimePct != null && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-ink-muted">{uptimePct}% up</span>
                  <TrendBar tones={trendTones} title={`last ${trendTones.length} checks`} />
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <RerunButton onClick={handleRerun} running={rerunning} what="site" />
            <button type="button" onClick={handlePause} disabled={pausing} className="rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-panel hover:text-ink disabled:opacity-40">
              {pausing ? '…' : schedule.paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={() => setConfirmStop(true)} disabled={stopping} title="Stops watching this URL and clears its check history here. Its result stays in Projects. Use Pause to keep it." className="rounded-md border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40">
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        </div>

        {schedule.paused && (
          <p className="mt-2.5 rounded-md border border-line bg-panel-raised px-3 py-2 text-[11px] text-ink-muted">
            Paused — not checking right now. Its last results stay in Projects; hit <strong className="text-ink-secondary">Resume</strong> to start again.
          </p>
        )}

        {rerunError && (
          <p className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{rerunError}</p>
        )}

        <button type="button" onClick={toggle} className="mt-3 text-xs font-medium text-ink-muted transition-colors hover:text-ink">
          {expanded ? '▾ Hide check history' : '▸ View check history'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-line p-4">
          {loading && <div className="space-y-2"><div className="fp-skeleton h-11 rounded-lg" /><div className="fp-skeleton h-11 rounded-lg" /></div>}
          {!loading && checks && checks.length === 0 && <p className="text-xs text-ink-faint">No checks yet — they appear after the first run.</p>}
          {!loading && checks && checks.slice(0, 40).map((c, i) => <CheckRow key={`${c.checkedAt}-${i}`} check={c} />)}
        </div>
      )}

      <ConfirmDialog
        open={confirmStop}
        variant="danger"
        title="Stop this uptime & SSL monitor?"
        confirmLabel="Stop monitor"
        message={
          <>
            Stops watching <span className="break-all font-mono text-ink-secondary">{schedule.url}</span> and clears its check history here.{' '}
            <strong className="text-ink-secondary">Its result stays in Projects</strong> — only deleting the project removes it. Want to keep it? Use <strong className="text-ink-secondary">Pause</strong>.
          </>
        }
        onConfirm={doStop}
        onCancel={() => setConfirmStop(false)}
      />
    </div>
  );
}

function Field({ label, value, valueClass = 'text-ink-secondary' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={cx('mt-0.5 text-[13px]', valueClass)}>{value}</p>
    </div>
  );
}

/** A sized check / cross / ! in a tinted circle — clear at a glance. FR-65. */
function UptimeMark({ level }: { level: StatusLevel }) {
  const cls =
    level === 'ok' ? 'bg-ok/15 text-ok'
    : level === 'warn' ? 'bg-warn/15 text-warn'
    : level === 'danger' ? 'bg-danger/15 text-danger'
    : 'bg-idle/15 text-ink-muted';
  return (
    <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', cls)}>
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
        {level === 'ok'
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M4 10.5l3.5 3.5L16 5.5" />
          : level === 'danger'
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M10 5.5v5M10 13.5v.5" />}
      </svg>
    </span>
  );
}

const UPTIME_SENTENCE: Record<UptimeClass, string> = {
  up: 'Your site is up',
  down: 'Your site is down',
  blocked: 'Your site is reachable — the host challenged us',
};
function httpMeaning(code: number | null): string {
  if (code == null) return '';
  if (code >= 200 && code < 300) return 'OK';
  if (code >= 300 && code < 400) return 'Redirect';
  if (code === 401 || code === 403) return 'Blocked / unauthorized';
  if (code === 404) return 'Not found';
  if (code === 429) return 'Rate-limited';
  if (code >= 500) return 'Server error';
  if (code >= 400) return 'Client error';
  return '';
}
function speedLabel(ms: number): string {
  return ms < 300 ? 'fast' : ms < 1000 ? 'okay' : 'slow';
}

function CheckRow({ check }: { check: SiteCheckRecord }) {
  const cls = check.uptime.classification;
  const u = UPTIME[cls] ?? UPTIME.down;
  const { statusCode, responseMs, error } = check.uptime;
  const meaning = httpMeaning(statusCode);
  const httpValue = statusCode != null
    ? `${statusCode}${meaning ? ` · ${meaning}` : ''}${error ? ` — ${error}` : ''}`
    : error ?? 'No response';

  const ssl = check.ssl;
  let sslValue = 'n/a — not served over HTTPS';
  let sslClass = 'text-ink-muted';
  if (ssl) {
    if (ssl.ok && ssl.daysRemaining != null) {
      const expiry = ssl.validTo ? new Date(ssl.validTo).toLocaleDateString() : '?';
      const issuer = ssl.issuer ? ` · ${ssl.issuer}` : '';
      sslValue = ssl.daysRemaining <= 0
        ? `Expired (was valid to ${expiry})${issuer}`
        : `${ssl.daysRemaining} day${ssl.daysRemaining === 1 ? '' : 's'} left${issuer} — expires ${expiry}`;
      sslClass = ssl.daysRemaining <= 7 ? 'text-danger' : ssl.daysRemaining <= 30 ? 'text-warn' : 'text-ink-secondary';
    } else {
      sslValue = ssl.error ?? 'check failed';
      sslClass = 'text-danger';
    }
  }

  const domain = check.domain;
  let domainValue = 'n/a';
  let domainClass = 'text-ink-muted';
  if (domain) {
    if (domain.ok && domain.daysRemaining != null) {
      const expiry = domain.expiryDate ? new Date(domain.expiryDate).toLocaleDateString() : '?';
      const registrar = domain.registrar ? ` · ${domain.registrar}` : '';
      domainValue = domain.daysRemaining <= 0
        ? `Expired (was valid to ${expiry})${registrar}`
        : `${domain.daysRemaining} day${domain.daysRemaining === 1 ? '' : 's'} left${registrar} — expires ${expiry}`;
      domainClass = domain.daysRemaining <= 7 ? 'text-danger' : domain.daysRemaining <= 30 ? 'text-warn' : 'text-ink-secondary';
    } else {
      domainValue = domain.error ?? 'check failed';
      domainClass = 'text-ink-muted';
    }
  }

  return (
    <div className="rounded-lg border border-line bg-ground/40 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <UptimeMark level={u.level} />
          <span className={cx('text-sm font-semibold', STATUS[u.level].text)}>{UPTIME_SENTENCE[cls] ?? u.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {check.trigger === 'manual' && <RerunTag />}
          <span className="text-[11px] text-ink-faint">{new Date(check.checkedAt).toLocaleString()}</span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2.5 pl-[34px] sm:grid-cols-2">
        <Field label="HTTP status" value={httpValue} />
        <Field label="Response time" value={`${responseMs} ms · ${speedLabel(responseMs)}`} />
        <Field label="SSL certificate" value={sslValue} valueClass={sslClass} />
        <Field label="Domain registration" value={domainValue} valueClass={domainClass} />
      </div>
    </div>
  );
}
