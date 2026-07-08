'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScheduleCard } from '@/components/formWatch/ScheduleCard';
import { ProjectUrlPicker } from '@/components/projects/ProjectUrlPicker';
import { AddToProjectModal } from '@/components/projects/AddToProjectModal';
import type { FormSchedule, FormWatchMode } from '@/lib/formWatch/types';

const INTERVAL_PRESETS = [
  { label: 'Daily', days: 1 },
  { label: 'Every 3 days', days: 3 },
  { label: 'Weekly', days: 7 },
];

const MODES: { value: FormWatchMode; label: string; hint: string }[] = [
  { value: 'live', label: 'Live (submit)', hint: 'Fills and submits — confirms real delivery' },
  { value: 'safe', label: 'Safe (no submit)', hint: 'Fills the form but does not submit' },
  { value: 'detect-only', label: 'Detect only', hint: 'Just checks the form exists' },
];

export default function FormWatchPage() {
  const [schedules, setSchedules] = useState<FormSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const [url, setUrl] = useState('');
  const [days, setDays] = useState(3);
  const [mode, setMode] = useState<FormWatchMode>('live');
  const [landingPage, setLandingPage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** URL just added — drives the non-blocking "add to a project?" nudge. */
  const [justAdded, setJustAdded] = useState<string | null>(null);

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
    // Light polling so statuses/next-run update after scheduled runs fire.
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  // Prefill the URL from ?url= — e.g. the "Monitor…" action on a Form Tester
  // result. The user still picks the mode + frequency before adding.
  useEffect(() => {
    try {
      const prefill = new URLSearchParams(window.location.search).get('url');
      if (prefill) setUrl(prefill);
    } catch {
      /* ignore */
    }
  }, []);

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      // Accept URLs typed without a scheme — prepend https:// automatically.
      let target = url.trim();
      if (!target) {
        setError('Enter a URL');
        return;
      }
      if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
      try {
        // eslint-disable-next-line no-new
        new URL(target);
      } catch {
        setError('That doesn’t look like a valid URL');
        return;
      }
      setAdding(true);
      try {
        const res = await fetch('/api/form-watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, intervalDays: days, mode, landingPage }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'Could not add schedule');
          return;
        }
        setUrl('');
        setLandingPage(false);
        setJustAdded(target);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
      } finally {
        setAdding(false);
      }
    },
    [url, days, mode, landingPage, load],
  );

  const handleStop = useCallback(
    async (id: string) => {
      await fetch('/api/form-watch/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    },
    [load],
  );

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

  return (
    <div className="min-h-screen bg-slate-950">
      <main className="max-w-7xl mx-auto px-4 pb-16 pt-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-100">Scheduled monitors</h2>
          <p className="text-sm text-slate-400 mt-1">
            Automatically test contact forms on a schedule. Each run checks form health, detects
            changes, and sends a Slack alert (success and failure) with the URL.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Left — add a schedule */}
          <div className="lg:col-span-2 lg:sticky lg:top-20">
            <form
              onSubmit={handleAdd}
              className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4"
            >
              <h3 className="text-sm font-semibold text-slate-200">Add a form to watch</h3>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Form URL
                  </label>
                  <ProjectUrlPicker align="right" onPick={(u) => setUrl(u)} />
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="client-site.com/contact"
                  disabled={adding}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Check frequency
                </label>
                <div className="flex gap-2 mb-2">
                  {INTERVAL_PRESETS.map((p) => (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => setDays(p.days)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                        days === p.days
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>Every</span>
                  <input
                    type="number"
                    min={1}
                    value={days}
                    onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                    disabled={adding}
                    className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span>day(s)</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Mode
                </label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as FormWatchMode)}
                  disabled={adding}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40"
                >
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  {MODES.find((m) => m.value === mode)?.hint}
                </p>
              </div>

              <div>
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={landingPage}
                    onChange={(e) => setLandingPage(e.target.checked)}
                    disabled={adding}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:ring-offset-0"
                  />
                  <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">
                    Landing page
                  </span>
                </label>
                <p className="mt-1 text-[11px] text-slate-500">
                  Test the form on this exact URL — skip searching for a separate contact page. Turn on
                  for landing pages with the form on the page itself.
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={adding || url.trim().length === 0}
                className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {adding ? 'Checking URL…' : 'Add to Form Watch'}
              </button>

              <p className="text-[11px] text-slate-600">
                The first check runs right away to set a baseline, then repeats on your schedule
                until you stop it.
              </p>
            </form>

          </div>

          {/* Right — schedule list */}
          <div className="lg:col-span-3 space-y-3">
            {loading && <p className="text-sm text-slate-500">Loading…</p>}

            {!loading && schedules.length > 0 && (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </span>
                <span className="text-xs font-medium text-emerald-300">
                  Scheduler running — automatically watching {schedules.length} form
                  {schedules.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
            {!loading && schedules.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center">
                <p className="text-sm text-slate-400">No forms are being watched yet.</p>
                <p className="text-xs text-slate-600 mt-1">Add a URL on the left to start monitoring.</p>
              </div>
            )}
            {!loading &&
              schedules.map((s) => (
                <ScheduleCard
                  key={s.id}
                  schedule={s}
                  onStop={handleStop}
                  onTogglePause={handleTogglePause}
                />
              ))}
          </div>
        </div>
      </main>

      {justAdded && (
        <AddToProjectModal url={justAdded} onClose={() => setJustAdded(null)} />
      )}
    </div>
  );
}
