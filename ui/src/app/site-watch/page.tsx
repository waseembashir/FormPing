'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteCard } from '@/components/siteWatch/SiteCard';
import { SiteWatchCommandBar, type Unit } from '@/components/siteWatch/SiteWatchCommandBar';
import { AddToProjectModal } from '@/components/projects/AddToProjectModal';
import { ReadOnlyBanner } from '@/components/ReadOnlyBanner';
import { PageHeader, Skeleton } from '@/components/ui';
import type { SiteSchedule, UptimeClass } from '@/lib/siteWatch/types';

const UNIT_TO_MIN: Record<Unit, number> = { min: 1, hour: 60, day: 1440 };

export default function SiteWatchPage() {
  const [schedules, setSchedules] = useState<SiteSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const [url, setUrl] = useState('');
  const [amount, setAmount] = useState(5);
  const [unit, setUnit] = useState<Unit>('min');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // The monitor just created. The list sits below the form and grows downward, so
  // after adding one the user was left looking at the form with no sign anything
  // had happened — the new row could be several screens down. We scroll to it and
  // mark it briefly, so the result of the action is where the eye already is.
  // Matches the Form Scheduler exactly. FR-83.
  const [addedId, setAddedId] = useState<string | null>(null);
  // Kept separate from `addedId`: the ring fades after a couple of seconds, but
  // the wait for the first check can take a minute. FR-83.
  const [firstCheckId, setFirstCheckId] = useState<string | null>(null);

  const pollHold = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/site-watch').then((r) => r.json());
      setSchedules(Array.isArray(res?.schedules) ? res.schedules : []);
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (pollHold.current === 0) void load(); }, 15000);
    return () => clearInterval(t);
  }, [load]);

  const submit = useCallback(
    async (force: boolean) => {
      setError(null);
      let target = url.trim();
      if (!target) { setError('Enter a URL'); return; }
      if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
      try { new URL(target); } catch { setError('That doesn’t look like a valid URL'); return; }
      setAdding(true);
      try {
        const intervalMinutes = Math.max(1, amount) * UNIT_TO_MIN[unit];
        const res = await fetch('/api/site-watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, intervalMinutes, force }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 422 && data?.needsConfirm) {
          setError(data.error || 'This URL appears to be down right now.');
          setNeedsConfirm(true);
          return;
        }
        if (!res.ok) { setError(data?.error || 'Could not add monitor'); setNeedsConfirm(false); return; }
        setUrl('');
        setNeedsConfirm(false);
        setJustAdded(target);
        if (typeof data?.schedule?.id === 'string') {
          setAddedId(data.schedule.id);
          setFirstCheckId(data.schedule.id);
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
      } finally {
        setAdding(false);
      }
    },
    [url, amount, unit, load],
  );

  // API only — the card shows the in-place "stopped, kept in Projects" note.
  const handleStop = useCallback(async (id: string) => {
    await fetch('/api/site-watch/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  }, []);

  const handleTogglePause = useCallback(
    async (id: string, paused: boolean) => {
      await fetch('/api/site-watch/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, paused }),
      });
      await load();
    },
    [load],
  );

  // Scroll the new monitor into view once it has actually rendered, and let the
  // highlight fade on its own. Honours reduced-motion: the jump still happens,
  // it just doesn't glide.
  useEffect(() => {
    if (!addedId || !schedules.some((s) => s.id === addedId)) return;
    const el = document.getElementById(`site-${addedId}`);
    if (!el) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    const t = setTimeout(() => setAddedId(null), 2200);
    return () => clearTimeout(t);
  }, [addedId, schedules]);

  const holdPoll = useCallback((active: boolean) => {
    pollHold.current = Math.max(0, pollHold.current + (active ? 1 : -1));
  }, []);

  const setUrlClearErr = (v: string) => { setUrl(v); setNeedsConfirm(false); setError(null); };

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">
        <PageHeader
          title="Uptime & SSL"
          description="Monitor site availability and SSL / domain expiry on a schedule. Get a Slack alert when a site goes down or comes back, and a warning weeks before a certificate expires."
        />
        <div className="mt-5">
          <ReadOnlyBanner />
        </div>

        <div className="mt-5">
          <SiteWatchCommandBar
            url={url}
            onUrl={setUrlClearErr}
            amount={amount}
            onAmount={setAmount}
            unit={unit}
            onUnit={setUnit}
            onSubmit={submit}
            adding={adding}
            error={error}
            needsConfirm={needsConfirm}
          />
        </div>

        <div className="mt-6 space-y-3">
          {loading && (
            [0, 1].map((i) => (
              <div key={i} className="rounded-xl border border-line bg-panel/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-2.5 w-56" /></div>
                  <div className="flex gap-2"><Skeleton className="h-8 w-16 rounded-md" /><Skeleton className="h-8 w-16 rounded-md" /></div>
                </div>
              </div>
            ))
          )}

          {!loading && schedules.length > 0 && <SiteWatchStatus schedules={schedules} />}

          {!loading && schedules.length === 0 && (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-line bg-panel/40 px-8 py-14 text-center">
              <div className="relative mb-4 flex h-16 w-16 items-center justify-center">
                <span className="absolute inline-flex h-11 w-11 animate-ping rounded-full bg-accent/15 [animation-duration:2.2s] motion-reduce:animate-none" aria-hidden />
                <span className="absolute h-14 w-14 rounded-full border border-accent/15" aria-hidden />
                <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-panel-raised text-accent-soft ring-1 ring-line-strong">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden><path d="M2.5 10a7.5 7.5 0 1115 0 7.5 7.5 0 01-15 0zm7.5-5a.75.75 0 01.75.75v4l2.6 1.55a.75.75 0 01-.77 1.3l-2.95-1.77A.75.75 0 019.25 10V5.75A.75.75 0 0110 5z" /></svg>
                </span>
              </div>
              <p className="text-sm font-semibold text-ink">No sites are being monitored yet</p>
              <p className="mt-1 text-xs text-ink-muted">Add a URL above to start watching uptime & SSL.</p>
            </div>
          )}

          {!loading &&
            schedules.map((s) => (
              <div
                key={s.id}
                id={`site-${s.id}`}
                className={
                  s.id === addedId
                    ? 'rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-ground transition-shadow duration-500'
                    : 'rounded-xl ring-2 ring-transparent transition-shadow duration-500'
                }
              >
                <SiteCard
                  schedule={s}
                  onStop={handleStop}
                  onTogglePause={handleTogglePause}
                  onDone={load}
                  onHold={holdPoll}
                  awaitFirstCheck={s.id === firstCheckId}
                  onFirstCheckSeen={() => setFirstCheckId(null)}
                />
              </div>
            ))}
        </div>
      </main>

      {justAdded && <AddToProjectModal url={justAdded} onClose={() => setJustAdded(null)} />}
    </>
  );
}

/**
 * FR-83 — the "what's happening right now" panel, mirroring the Form Scheduler's
 * SchedulerStatus so the two tabs read as one product: a heartbeat, how many
 * sites are being watched, and worst-first counts.
 *
 * "Monitoring 3 sites automatically" told you the scheduler was alive but
 * nothing about whether anything was wrong — you had to read every card to find
 * out. The counts answer that at a glance.
 */
function SiteWatchStatus({ schedules }: { schedules: SiteSchedule[] }) {
  const counts: Record<UptimeClass | 'pending' | 'paused' | 'expiring', number> = {
    up: 0, down: 0, blocked: 0, pending: 0, paused: 0, expiring: 0,
  };
  for (const s of schedules) {
    if (s.paused) { counts.paused += 1; continue; }
    // No classification yet = the first check is still running (a new monitor).
    if (!s.lastClassification) { counts.pending += 1; continue; }
    counts[s.lastClassification] += 1;
    // A certificate about to lapse is worth surfacing even while the site is up
    // — it's the failure you can still prevent. Counted alongside, not instead.
    const sslDays = s.lastSslDaysRemaining;
    if (s.lastSslValid !== false && sslDays != null && sslDays <= 30) counts.expiring += 1;
  }

  // Worst-first, so what needs a look is read before what's fine.
  const stats: { n: number; label: string; cls: string }[] = [
    { n: counts.down, label: 'down', cls: 'bg-danger/12 text-danger ring-danger/30' },
    { n: counts.blocked, label: 'challenged', cls: 'bg-warn/12 text-warn ring-warn/30' },
    { n: counts.expiring, label: 'expiring soon', cls: 'bg-warn/12 text-warn ring-warn/30' },
    { n: counts.up, label: 'up', cls: 'bg-ok/12 text-ok ring-ok/30' },
    { n: counts.pending, label: 'setting up', cls: 'bg-idle/12 text-ink-muted ring-line-strong' },
    { n: counts.paused, label: 'paused', cls: 'bg-idle/12 text-ink-muted ring-line-strong' },
  ].filter((s) => s.n > 0);

  const active = schedules.length - counts.paused;
  const allWell = counts.down === 0 && counts.blocked === 0 && counts.expiring === 0;

  return (
    <div
      className={`fp-rise flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-xl border px-4 py-3.5 ${
        allWell ? 'border-ok/25 bg-ok/8' : 'border-warn/25 bg-warn/8'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* The heartbeat: a ping ring, on-brand for a tool called FormPing. */}
        <span className="relative flex h-3 w-3 shrink-0">
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 [animation-duration:2s] motion-reduce:animate-none ${allWell ? 'bg-ok' : 'bg-warn'}`}
          />
          <span className={`relative inline-flex h-3 w-3 rounded-full ${allWell ? 'bg-ok' : 'bg-warn'}`} />
        </span>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${allWell ? 'text-ok' : 'text-warn'}`}>Monitoring</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Checking <b className="font-mono tabular-nums text-ink-secondary">{active}</b> site
            {active === 1 ? '' : 's'} on their own schedules
            {counts.paused > 0 && <> · {counts.paused} paused</>}
          </p>
        </div>
      </div>

      {/* Canonical StatPills — the same shape the Form Scheduler uses. */}
      <div className="flex flex-wrap items-center gap-2">
        {stats.map((s) => (
          <div key={s.label} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ${s.cls}`}>
            <span className="font-mono text-base font-bold tabular-nums">{s.n}</span>
            <span className="uppercase tracking-wide opacity-80">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
