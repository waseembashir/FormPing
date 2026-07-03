'use client';

import { useCallback, useEffect, useState } from 'react';
import { SiteCard } from '@/components/siteWatch/SiteCard';
import { ProjectUrlPicker } from '@/components/projects/ProjectUrlPicker';
import { AddToProjectModal } from '@/components/projects/AddToProjectModal';
import type { SiteSchedule } from '@/lib/siteWatch/types';

type Unit = 'min' | 'hour' | 'day';
const UNIT_TO_MIN: Record<Unit, number> = { min: 1, hour: 60, day: 1440 };
const INTERVAL_PRESETS: { label: string; amount: number; unit: Unit }[] = [
  { label: 'Every 5 min', amount: 5, unit: 'min' },
  { label: 'Every 15 min', amount: 15, unit: 'min' },
  { label: 'Hourly', amount: 1, unit: 'hour' },
  { label: 'Daily', amount: 1, unit: 'day' },
];

export default function SiteWatchPage() {
  const [schedules, setSchedules] = useState<SiteSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const [url, setUrl] = useState('');
  const [amount, setAmount] = useState(5);
  const [unit, setUnit] = useState<Unit>('min');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True when the URL probed as down — show a warning + "Add anyway". */
  const [needsConfirm, setNeedsConfirm] = useState(false);
  /** URL just added — drives the non-blocking "add to a project?" nudge. */
  const [justAdded, setJustAdded] = useState<string | null>(null);

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
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const submit = useCallback(
    async (force: boolean) => {
      setError(null);
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
        const intervalMinutes = Math.max(1, amount) * UNIT_TO_MIN[unit];
        const res = await fetch('/api/site-watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, intervalMinutes, force }),
        });
        const data = await res.json().catch(() => ({}));
        // Down/unreachable → warn + offer "Add anyway" instead of hard-failing.
        if (res.status === 422 && data?.needsConfirm) {
          setError(data.error || 'This URL appears to be down right now.');
          setNeedsConfirm(true);
          return;
        }
        if (!res.ok) {
          setError(data?.error || 'Could not add monitor');
          setNeedsConfirm(false);
          return;
        }
        setUrl('');
        setNeedsConfirm(false);
        setJustAdded(target);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
      } finally {
        setAdding(false);
      }
    },
    [url, amount, unit, load],
  );

  const handleAdd = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void submit(false);
    },
    [submit],
  );

  const handleStop = useCallback(
    async (id: string) => {
      await fetch('/api/site-watch/stop', {
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
      await fetch('/api/site-watch/pause', {
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
          <h2 className="text-xl font-bold text-slate-100">Uptime &amp; SSL</h2>
          <p className="text-sm text-slate-400 mt-1">
            Monitor site availability (uptime) and SSL-certificate expiry on a schedule. Get a Slack
            alert when a site goes down or comes back, and a warning weeks before a cert expires.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Left — add a monitor */}
          <div className="lg:col-span-2 lg:sticky lg:top-20">
            <form onSubmit={handleAdd} className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">Add a site to monitor</h3>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Site URL
                  </label>
                  <ProjectUrlPicker
                    align="right"
                    onPick={(u) => {
                      setUrl(u);
                      setNeedsConfirm(false);
                      setError(null);
                    }}
                  />
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setNeedsConfirm(false);
                    setError(null);
                  }}
                  placeholder="client-site.com"
                  disabled={adding}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                  Check frequency
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {INTERVAL_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setAmount(p.amount);
                        setUnit(p.unit);
                      }}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                        amount === p.amount && unit === p.unit
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {/* Custom interval — any number + unit */}
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>Every</span>
                  <input
                    type="number"
                    min={1}
                    value={amount}
                    onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
                    disabled={adding}
                    className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40"
                  />
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as Unit)}
                    disabled={adding}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40"
                  >
                    <option value="min">minute(s)</option>
                    <option value="hour">hour(s)</option>
                    <option value="day">day(s)</option>
                  </select>
                </div>
                <p className="mt-1 text-[11px] text-slate-600">Minimum 1 minute.</p>
              </div>

              {error && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    needsConfirm
                      ? 'border-amber-800/60 bg-amber-950/30 text-amber-200'
                      : 'border-red-900/60 bg-red-950/40 text-red-300'
                  }`}
                >
                  {error}
                  {needsConfirm && (
                    <button
                      type="button"
                      onClick={() => void submit(true)}
                      disabled={adding}
                      className="mt-2 block w-full rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      {adding ? 'Adding…' : 'Add anyway — monitor for recovery'}
                    </button>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={adding || url.trim().length === 0}
                className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {adding ? 'Adding…' : 'Add to Site Watch'}
              </button>

              <p className="text-[11px] text-slate-600">
                Free — no browser, no proxy. Uptime is an HTTP check; SSL reads the certificate
                expiry. Alerts fire only on change (down / recovered / cert expiring).
              </p>
            </form>

          </div>

          {/* Right — monitor list */}
          <div className="lg:col-span-3 space-y-3">
            {loading && <p className="text-sm text-slate-500">Loading…</p>}

            {!loading && schedules.length > 0 && (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </span>
                <span className="text-xs font-medium text-emerald-300">
                  Monitoring {schedules.length} site{schedules.length === 1 ? '' : 's'} automatically
                </span>
              </div>
            )}

            {!loading && schedules.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center">
                <p className="text-sm text-slate-400">No sites are being monitored yet.</p>
                <p className="text-xs text-slate-600 mt-1">Add a URL on the left to start.</p>
              </div>
            )}

            {!loading &&
              schedules.map((s) => (
                <SiteCard
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
