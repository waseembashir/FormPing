'use client';

import type { FormWatchMode } from '@/lib/formWatch/types';
import { ProjectUrlPicker } from '@/components/projects/ProjectUrlPicker';
import { cx } from '@/components/ui';

/**
 * "Add a monitor" command bar (FR-38) — the top control surface of the Form
 * Scheduler, matching the Form Tester's command bar: target URL, check frequency,
 * mode, Landing-page, and Add. The list of running monitors is the full-width
 * stage below it.
 */

const PRESETS = [
  { label: 'Daily', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Weekly', days: 7 },
];

const MODES: { value: FormWatchMode; label: string; desc: string; dot: string }[] = [
  { value: 'detect-only', label: 'Detect', desc: 'No interaction — just checks the form exists', dot: 'bg-idle' },
  { value: 'safe', label: 'Safe', desc: 'Fills the form but does not submit', dot: 'bg-warn' },
  { value: 'live', label: 'Live', desc: 'Fills and submits — sends a real message', dot: 'bg-danger' },
];

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cx('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40', checked ? 'bg-accent-strong' : 'bg-line-strong')}
    >
      <span className={cx('mt-0.5 inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200', checked ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  );
}

interface Props {
  url: string;
  onUrl: (v: string) => void;
  days: number;
  onDays: (v: number) => void;
  mode: FormWatchMode;
  onMode: (v: FormWatchMode) => void;
  landingPage: boolean;
  onLanding: (v: boolean) => void;
  onAdd: (e: React.FormEvent) => void;
  adding: boolean;
  error: string | null;
}

export function SchedulerCommandBar({ url, onUrl, days, onDays, mode, onMode, landingPage, onLanding, onAdd, adding, error }: Props) {
  return (
    <form onSubmit={onAdd} className="rounded-2xl border border-line-strong bg-gradient-to-b from-panel-raised to-panel shadow-lg shadow-black/30">
      {/* URL */}
      <div className="p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="sched-url" className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Form URL</label>
          <ProjectUrlPicker align="right" onPick={(u) => onUrl(u)} />
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-line-strong bg-ground px-3.5 py-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <svg className="h-4 w-4 shrink-0 text-ink-faint" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M10 2a8 8 0 100 16 8 8 0 000-16zM3.5 10a6.5 6.5 0 0112.06-3.4l-1.7 1.02a1 1 0 00-.46.7l-.28 1.68-1.5.6a1 1 0 00-.62.93v1.02l-1.3.86a1 1 0 00-.44.83v1.6A6.5 6.5 0 013.5 10z" /></svg>
          <input
            id="sched-url"
            type="text"
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            disabled={adding}
            placeholder="client-site.com/contact"
            spellCheck={false}
            autoComplete="off"
            className="w-full bg-transparent font-mono text-[15px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
          />
        </div>
        {/* Says a monitor covers ONE form on ONE page. Nothing said so before,
            which is why people reasonably expected a monitor to watch every form
            on a site — and why "each check searches the whole site" read as a
            feature rather than as the repeated crawl it was. FR-79. */}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {landingPage
            ? 'Landing page is on — a monitor watches one form, and every check tests only the exact page you enter, not the rest of the site.'
            : 'A monitor watches one form on one page: the first check searches the site for your contact form, then every check after it goes straight to the page it found. Monitoring one specific page? Turn on Landing page to check just the URL you enter.'}
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-4 py-3 sm:px-5">
        {/* Frequency */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Every</span>
          <div className="inline-flex gap-1 rounded-lg bg-ground p-1 ring-1 ring-line-strong">
            {PRESETS.map((p) => {
              const active = days === p.days;
              return (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => onDays(p.days)}
                  disabled={adding}
                  className={cx('rounded-md px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50', active ? 'bg-gradient-to-b from-accent to-accent-strong text-white shadow-sm shadow-accent-deep/40' : 'text-ink-muted hover:text-ink')}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            or
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => onDays(Math.max(1, Number(e.target.value) || 1))}
              disabled={adding}
              className="w-14 rounded-md border border-line-strong bg-ground px-2 py-1 text-center font-mono text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-40"
            />
            days
          </span>
        </div>

        <span className="hidden h-7 w-px shrink-0 self-center bg-line lg:block" aria-hidden />

        {/* Mode */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Mode</span>
          <div className="inline-flex gap-1 rounded-lg bg-ground p-1 ring-1 ring-line-strong">
            {MODES.map((m) => {
              const active = mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => onMode(m.value)}
                  disabled={adding}
                  title={m.desc}
                  className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50', active ? 'bg-gradient-to-b from-accent to-accent-strong text-white shadow-sm shadow-accent-deep/40' : 'text-ink-muted hover:text-ink')}
                >
                  <span className={cx('h-1.5 w-1.5 rounded-full', active ? 'bg-white/80' : m.dot)} />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <span className="hidden h-7 w-px shrink-0 self-center bg-line lg:block" aria-hidden />

        {/* Landing */}
        <label className="flex cursor-pointer items-center gap-2">
          <Toggle checked={landingPage} onChange={onLanding} disabled={adding} />
          <span className="text-xs font-medium text-ink-secondary" title="Check only this exact page — no site search. Use it for standalone landing pages, or when the form is a quiz / booking / 'work with me' style that the default whole-site search might skip. Also faster (no crawling).">Landing page</span>
        </label>

        <div className="ml-auto">
          <button type="submit" disabled={adding || url.trim().length === 0} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-accent to-accent-strong px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-accent-deep/40 ring-1 ring-accent-soft/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
            {adding ? (
              <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M10 5a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-3.5v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5v-3.5A.75.75 0 0110 5z" /></svg>
            )}
            {adding ? 'Adding monitor…' : 'Add monitor'}
          </button>
        </div>
      </div>

      {/* Per-mode note: neutral, informational for Detect/Safe; a red safety
          warning for Live (it submits on every run). FR-64 */}
      {mode === 'live' ? (
        <div className="border-t border-danger/20 bg-danger/5 px-4 py-2 text-xs text-danger last:rounded-b-2xl sm:px-5">
          ⚠ Live mode submits the form on every scheduled run. Use only on sites you own or are authorized to test.
        </div>
      ) : (
        <div className="border-t border-line bg-panel px-4 py-2 text-xs text-ink-muted last:rounded-b-2xl sm:px-5">
          {mode === 'detect-only'
            ? 'Detect mode — each check only confirms the contact form still exists. Nothing is filled or submitted.'
            : 'Safe mode — each check finds the form and fills it with test data, but never submits. Nothing is sent to the site.'}
        </div>
      )}

      {error && (
        <div className="border-t border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger last:rounded-b-2xl sm:px-5">{error}</div>
      )}

      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint last:rounded-b-2xl sm:px-5">
        The first check runs right away to set a baseline, then repeats on your schedule until you stop it.
      </p>
    </form>
  );
}
