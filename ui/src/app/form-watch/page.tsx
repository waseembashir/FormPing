'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScheduleCard } from '@/components/formWatch/ScheduleCard';
import { SchedulerCommandBar } from '@/components/formWatch/SchedulerCommandBar';
import { AddToProjectModal } from '@/components/projects/AddToProjectModal';
import { ReadOnlyBanner } from '@/components/ReadOnlyBanner';
import { PageHeader, Skeleton } from '@/components/ui';
import { runVerdict, type VerdictLevel } from '@/lib/formWatch/verdict';
import type { FormSchedule, FormWatchMode } from '@/lib/formWatch/types';

export default function FormWatchPage() {
  const [schedules, setSchedules] = useState<FormSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const [url, setUrl] = useState('');
  // Daily by default — a form that breaks is found within a day rather than
  // three. FR-81.
  const [days, setDays] = useState(1);
  // Default to Detect — the least intrusive check there is: it confirms the form
  // is still there and fills nothing. Safe fills on every run, and Live submits a
  // real message on every run; both are deliberate opt-ins. FR-64/FR-81.
  const [mode, setMode] = useState<FormWatchMode>('detect-only');
  const [landingPage, setLandingPage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // The monitor just created. The list sits below the form and grows downward, so
  // after adding one the user was left looking at the form with no sign anything
  // had happened — the new row could be several screens down. We scroll to it and
  // mark it briefly, so the result of the action is where the eye already is.
  const [addedId, setAddedId] = useState<string | null>(null);
  // Kept separate from `addedId`: the ring fades after a couple of seconds, but
  // the wait for the first run can take a minute or more. FR-83.
  const [firstRunId, setFirstRunId] = useState<string | null>(null);

  // While a card is showing its in-place "stopped" confirmation, hold the poll so
  // a background refresh doesn't yank the card (and its message) out from under it.
  const pollHold = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/form-watch').then((r) => r.json());
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

  useEffect(() => {
    try {
      const prefill = new URLSearchParams(window.location.search).get('url');
      if (prefill) setUrl(prefill);
    } catch { /* ignore */ }
  }, []);

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      let target = url.trim();
      if (!target) { setError('Enter a URL'); return; }
      if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
      try { new URL(target); } catch { setError('That doesn’t look like a valid URL'); return; }
      setAdding(true);
      try {
        const res = await fetch('/api/form-watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, intervalDays: days, mode, landingPage }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data?.error || 'Could not add schedule'); return; }
        setUrl('');
        setLandingPage(false);
        setJustAdded(target);
        if (typeof data?.schedule?.id === 'string') {
          setAddedId(data.schedule.id);
          setFirstRunId(data.schedule.id);
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
      } finally {
        setAdding(false);
      }
    },
    [url, days, mode, landingPage, load],
  );

  // API only — the card shows the in-place "stopped, kept in Projects" note, then
  // calls reload() itself when it's done (so the message stays at that card).
  const handleStop = useCallback(async (id: string) => {
    await fetch('/api/form-watch/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  }, []);

  const handleTogglePause = useCallback(
    async (id: string, paused: boolean) => {
      await fetch('/api/form-watch/pause', {
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
    const el = document.getElementById(`schedule-${addedId}`);
    if (!el) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    const t = setTimeout(() => setAddedId(null), 2200);
    return () => clearTimeout(t);
  }, [addedId, schedules]);

  const holdPoll = useCallback((active: boolean) => {
    pollHold.current = Math.max(0, pollHold.current + (active ? 1 : -1));
  }, []);

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">
        <PageHeader
          title="Form Scheduler"
          description="Automatically re-test contact forms on a schedule. Each run checks form health, detects changes, and sends a Slack alert with the URL."
        />
        <div className="mt-5">
          <ReadOnlyBanner />
        </div>

        {/* Add-monitor command bar */}
        <div className="mt-5">
          <SchedulerCommandBar
            url={url}
            onUrl={setUrl}
            days={days}
            onDays={setDays}
            mode={mode}
            onMode={setMode}
            landingPage={landingPage}
            onLanding={setLandingPage}
            onAdd={handleAdd}
            adding={adding}
            error={error}
          />
        </div>

        {/* Monitors — the full-width stage */}
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

          {!loading && schedules.length > 0 && <SchedulerStatus schedules={schedules} />}

          {!loading && schedules.length === 0 && (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-line bg-panel/40 px-8 py-14 text-center">
              <div className="relative mb-4 flex h-16 w-16 items-center justify-center">
                <span className="absolute inline-flex h-11 w-11 animate-ping rounded-full bg-accent/15 [animation-duration:2.2s] motion-reduce:animate-none" aria-hidden />
                <span className="absolute h-14 w-14 rounded-full border border-accent/15" aria-hidden />
                <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-panel-raised text-accent-soft ring-1 ring-line-strong">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 4a1 1 0 10-2 0v4a1 1 0 00.4.8l3 2.2a1 1 0 101.2-1.6L11 9.5V6z" /></svg>
                </span>
              </div>
              <p className="text-sm font-semibold text-ink">No forms are being watched yet</p>
              <p className="mt-1 text-xs text-ink-muted">Add a URL above to start monitoring on a schedule.</p>
            </div>
          )}

          {!loading &&
            schedules.map((s) => (
              <div
                key={s.id}
                id={`schedule-${s.id}`}
                className={
                  s.id === addedId
                    ? 'rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-ground transition-shadow duration-500'
                    : 'rounded-xl ring-2 ring-transparent transition-shadow duration-500'
                }
              >
                <ScheduleCard
                  schedule={s}
                  onStop={handleStop}
                  onTogglePause={handleTogglePause}
                  onDone={load}
                  onHold={holdPoll}
                  awaitFirstRun={s.id === firstRunId}
                  onFirstRunSeen={() => setFirstRunId(null)}
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
 * The scheduler's live status bar.
 *
 * It used to say one thing — "automatically watching 3 forms" — which told you
 * the scheduler was alive but nothing about whether the forms were. With more
 * than a couple of monitors, the only way to learn that anything needed
 * attention was to scroll the whole list and read each card.
 *
 * So it now BREAKS THE NUMBER DOWN, in the app's canonical status vocabulary and
 * colours: healthy / detected / needs attention / failing / setting up. The
 * counts are derived from the same `runVerdict` each card uses, so the summary
 * can never disagree with the rows beneath it.
 */
function SchedulerStatus({ schedules }: { schedules: FormSchedule[] }) {
  const counts: Record<VerdictLevel | 'pending' | 'paused', number> = {
    healthy: 0, detected: 0, attention: 0, failing: 0, pending: 0, paused: 0,
  };
  for (const s of schedules) {
    if (s.paused) { counts.paused += 1; continue; }
    // No status yet = the first check is still running (a new monitor).
    if (!s.lastStatus) { counts.pending += 1; continue; }
    counts[runVerdict(s.lastReasonCode ?? '', s.lastFormFound ?? false, s.lastStatus).level] += 1;
  }

  // Worst-first, so what needs a look is read before what's fine.
  const stats: { n: number; label: string; cls: string }[] = [
    { n: counts.failing, label: 'failing', cls: 'bg-danger/12 text-danger ring-danger/30' },
    { n: counts.attention, label: 'need a look', cls: 'bg-warn/12 text-warn ring-warn/30' },
    { n: counts.detected, label: 'detected', cls: 'bg-info/12 text-info ring-info/30' },
    { n: counts.healthy, label: 'healthy', cls: 'bg-ok/12 text-ok ring-ok/30' },
    { n: counts.pending, label: 'setting up', cls: 'bg-idle/12 text-ink-muted ring-line-strong' },
    { n: counts.paused, label: 'paused', cls: 'bg-idle/12 text-ink-muted ring-line-strong' },
  ].filter((s) => s.n > 0);

  const active = schedules.length - counts.paused;
  const allWell = counts.failing === 0 && counts.attention === 0;

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
          <p className={`text-sm font-semibold ${allWell ? 'text-ok' : 'text-warn'}`}>Scheduler running</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Checking <b className="font-mono tabular-nums text-ink-secondary">{active}</b> form
            {active === 1 ? '' : 's'} on their own schedules
            {counts.paused > 0 && <> · {counts.paused} paused</>}
          </p>
        </div>
      </div>

      {/* Canonical StatPills — the same shape the Form Tester report uses. */}
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
