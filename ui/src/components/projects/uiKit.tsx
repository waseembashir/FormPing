'use client';

/**
 * Shared Projects UI kit — ONE source for the tone maps, formatters, and small
 * presentational primitives used by the card grid, the client detail page, and
 * the Unassigned bucket. Nothing here is duplicated per-view (same DRY discipline
 * as the urlKey 6→1 consolidation): if a colour or format decision changes, it
 * changes here once.
 */

import type { ReactNode } from 'react';
import type {
  FormHealthLevel,
  ProjectRollup,
  SiteUpState,
  UrlHealth,
} from '@/lib/projects/types';
import { runVerdict } from '@/lib/formWatch/verdict';

export type Tone = 'emerald' | 'amber' | 'red' | 'slate';

export const TONE_DOT: Record<Tone, string> = {
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
  red: 'bg-red-400',
  slate: 'bg-slate-500',
};
export const TONE_TEXT: Record<Tone, string> = {
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  red: 'text-red-300',
  slate: 'text-slate-400',
};
/** Soft pill/badge fill + text for a tone. */
export const TONE_SOFT: Record<Tone, string> = {
  emerald: 'bg-emerald-500/12 text-emerald-300',
  amber: 'bg-amber-500/12 text-amber-300',
  red: 'bg-rose-500/12 text-rose-300',
  slate: 'bg-slate-500/12 text-slate-300',
};
/** Left severity edge for cards. */
export const TONE_EDGE: Record<Tone, string> = {
  emerald: 'bg-emerald-400/80',
  amber: 'bg-amber-400/80',
  red: 'bg-rose-400/90',
  slate: 'bg-slate-600',
};

export const FORM_TONE: Record<FormHealthLevel, Tone> = {
  healthy: 'emerald',
  attention: 'amber',
  failing: 'red',
  pending: 'slate',
};
export const UP_TONE: Record<SiteUpState, Tone> = {
  up: 'emerald',
  down: 'red',
  blocked: 'amber',
  unknown: 'slate',
};
export const UP_LABEL: Record<SiteUpState, string> = {
  up: 'Up',
  down: 'Down',
  blocked: 'Blocked',
  unknown: 'Unknown',
};

// ── Formatters ────────────────────────────────────────────────────────────────
export function rel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  const h = Math.round(diff / 3_600_000);
  const d = Math.round(diff / 86_400_000);
  return d >= 1 ? `${d}d ago` : h >= 1 ? `${h}h ago` : m >= 1 ? `${m}m ago` : 'just now';
}
export function sslText(days: number | null | undefined): { t: string; c: string } | null {
  if (days == null) return null;
  if (days < 0) return { t: 'expired', c: 'text-rose-300 font-semibold' };
  if (days <= 14) return { t: `${days}d left`, c: 'text-rose-300 font-semibold' };
  if (days <= 30) return { t: `${days}d`, c: 'text-amber-300' };
  return { t: `${days}d`, c: 'text-slate-300' };
}
export function formatInterval(ms?: number): string {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `every ${min} min`;
  const hr = Math.round(ms / 3_600_000);
  if (hr < 48) return `every ${hr} h`;
  const d = Math.round(ms / 86_400_000);
  return `every ${d} day${d === 1 ? '' : 's'}`;
}
export function modeLabel(mode?: string): string {
  return mode === 'live'
    ? 'Live'
    : mode === 'detect-only'
      ? 'Detect only'
      : mode === 'safe'
        ? 'Safe mode'
        : (mode ?? '');
}
export function monogram(name: string): string {
  const words = name.replace(/[|/]+/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]!).join('').toUpperCase();
}

/** Overall status word + tone for a project rollup. */
export function overallStatus(r: ProjectRollup): { tone: Tone; word: string; pulse: boolean } {
  // Nothing live. If we still hold a last result (monitors were stopped), say so
  // rather than a bare "Not monitored" — the view DOES show that last known data.
  if (!r.monitored) {
    const hasLastResult = Boolean(r.formLevel || r.upState || r.lastChecked);
    return {
      tone: 'slate',
      word: hasLastResult ? 'Not monitored · last result' : 'Not monitored',
      pulse: false,
    };
  }
  if (r.severity >= 30) return { tone: 'red', word: 'Failing', pulse: true };
  if (r.severity >= 15) return { tone: 'amber', word: 'Needs attention', pulse: true };
  return { tone: 'emerald', word: 'Healthy', pulse: true };
}

// ── Primitives ────────────────────────────────────────────────────────────────

/** Animated status dot (the "live monitoring" indicator used across the app). */
export function StatusDot({ tone, pulse }: { tone: Tone; pulse: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {pulse && (
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full ${TONE_DOT[tone]} opacity-60`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
    </span>
  );
}

export function StatusPill({
  tone,
  children,
  pulse = false,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONE_SOFT[tone]}`}
    >
      {pulse ? <StatusDot tone={tone} pulse /> : <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />}
      {children}
    </span>
  );
}

export function Monogram({ name, tone, size = 'md' }: { name: string; tone: Tone; size?: 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'w-11 h-11 text-sm rounded-xl' : 'w-9 h-9 text-[11px] rounded-lg';
  return (
    <span
      className={`${dims} ring-1 ring-inset flex items-center justify-center font-bold shrink-0 ${TONE_SOFT[tone]} ring-white/10`}
    >
      {monogram(name)}
    </span>
  );
}

/** A labelled metric tile for the detail overview. */
export function Tile({
  k,
  v,
  s,
  tone,
}: {
  k: string;
  v: ReactNode;
  s?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{k}</div>
      <div className={`mt-1.5 text-lg font-bold tabular-nums ${tone ? TONE_TEXT[tone] : 'text-slate-100'}`}>{v}</div>
      {s && <div className="mt-0.5 text-[11.5px] text-slate-500">{s}</div>}
    </div>
  );
}

export function SectionHeader({ title, help }: { title: string; help?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      {help && <p className="mt-1 max-w-[62ch] text-xs text-slate-500">{help}</p>}
    </div>
  );
}

/** Small uppercase chip naming WHICH tool produced a detail line. */
function SourceTag({ label, dim = false }: { label: string; dim?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${
        dim ? 'bg-slate-900 text-slate-600 ring-slate-800' : 'bg-slate-800 text-slate-300 ring-slate-700'
      }`}
    >
      {label}
    </span>
  );
}

/**
 * Per-URL health detail — the 4-tool breakdown (Form Watch · Site Watch · Change
 * Monitor · Form Tester) including the FR-17 "stopped · last result" state.
 * Unchanged behaviour from the old ProjectRow.UrlDetailRow; relocated here so the
 * detail page and the Unassigned bucket share ONE implementation.
 */
export function UrlHealthDetail({ h }: { h: UrlHealth }) {
  const formTone = h.form.level ? FORM_TONE[h.form.level] : 'slate';
  const upTone = h.site.upState ? UP_TONE[h.site.upState] : 'slate';
  const ssl = sslText(h.site.sslDaysRemaining);
  const domain = sslText(h.site.domainDaysRemaining);

  const changeCount = h.change?.changesFound ?? 0;
  const changeTone: Tone = !changeCount
    ? 'slate'
    : h.change?.severity === 'high'
      ? 'red'
      : h.change?.severity === 'medium'
        ? 'amber'
        : 'emerald';

  const runV = h.lastRun
    ? runVerdict(
        h.lastRun.reasonCode ?? '',
        h.lastRun.formFound ?? false,
        h.lastRun.finalStatus === 'error' ? 'error' : undefined,
      )
    : null;
  const runTone: Tone = runV ? FORM_TONE[runV.level] : 'slate';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3.5 space-y-2">
      <a
        href={h.url}
        target="_blank"
        rel="noreferrer"
        className="block truncate font-mono text-xs font-medium text-indigo-200 hover:text-indigo-300"
        title={h.url}
      >
        {h.url}
      </a>

      {/* Form Watch */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <SourceTag label="Form Watch" dim={!h.form.monitored} />
        {h.form.monitored ? (
          <>
            <StatusDot tone={formTone} pulse />
            <span className="font-medium text-slate-300">Scheduled form test · {modeLabel(h.form.mode)}</span>
            <span className={TONE_TEXT[formTone]}>— {h.form.label}</span>
            <span className="text-slate-600">· {formatInterval(h.form.intervalMs)} · {rel(h.form.lastRunAt)}</span>
          </>
        ) : h.form.stopped ? (
          <>
            <StatusDot tone={formTone} pulse={false} />
            <span className="font-medium text-slate-400">Last form result</span>
            <span className={TONE_TEXT[formTone]}>— {h.form.label}</span>
            <span className="text-slate-600">· monitor stopped · {rel(h.form.lastRunAt)}</span>
          </>
        ) : (
          <span className="text-slate-600">Scheduled form test · not set up</span>
        )}
      </div>

      {/* Site Watch */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <SourceTag label="Site Watch" dim={!h.site.monitored} />
        {h.site.monitored || h.site.stopped ? (
          <>
            <StatusDot tone={upTone} pulse={h.site.monitored} />
            <span className="font-medium text-slate-300">{h.site.monitored ? 'Uptime & SSL' : 'Last uptime & SSL'}</span>
            <span className={TONE_TEXT[upTone]}>
              — {h.site.upState ? UP_LABEL[h.site.upState] : 'Unknown'}
              {h.site.statusCode ? ` · ${h.site.statusCode}` : ''}
            </span>
            {ssl && <span className="text-slate-500">· SSL <span className={ssl.c}>{ssl.t}</span></span>}
            {domain && <span className="text-slate-500">· Domain <span className={domain.c}>{domain.t}</span></span>}
            <span className="text-slate-600">
              · {h.site.monitored ? `${formatInterval(h.site.intervalMs)} · ${rel(h.site.lastCheckedAt)}` : `monitor stopped · ${rel(h.site.lastCheckedAt)}`}
            </span>
          </>
        ) : (
          <span className="text-slate-600">Uptime &amp; SSL · not set up</span>
        )}
      </div>

      {/* Change Monitor */}
      {h.change?.tracked && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <SourceTag label="Change Monitor" />
          <StatusDot tone={changeTone} pulse={false} />
          <span className="font-medium text-slate-300">Content changes</span>
          <span className={TONE_TEXT[changeTone]}>
            —{' '}
            {changeCount
              ? `${changeCount} change${changeCount === 1 ? '' : 's'} on ${h.change.pagesChanged} page${h.change.pagesChanged === 1 ? '' : 's'}`
              : 'no changes last check'}
          </span>
          <span className="text-slate-600">· {rel(h.change.lastCheckedAt)}</span>
        </div>
      )}

      {/* Form Tester */}
      {h.lastRun && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <SourceTag label="Form Tester" />
          <StatusDot tone={runTone} pulse={false} />
          <span className="font-medium text-slate-300">
            Manual form test{h.lastRun.mode ? ` · ${modeLabel(h.lastRun.mode)}` : ''}
          </span>
          <span className={TONE_TEXT[runTone]}>— {runV?.label ?? h.lastRun.finalStatus}</span>
          <span className="text-slate-600">· {rel(h.lastRun.ranAt)}</span>
        </div>
      )}
    </div>
  );
}
