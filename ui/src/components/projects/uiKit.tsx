'use client';

/**
 * Shared Projects UI kit — ONE source for the tone maps, formatters, and small
 * presentational primitives used by the card grid, the client detail page, and
 * the Unassigned bucket. Nothing here is duplicated per-view (same DRY discipline
 * as the urlKey 6→1 consolidation): if a colour or format decision changes, it
 * changes here once.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import type {
  FormHealthLevel,
  ProjectRollup,
  SiteUpState,
  UrlHealth,
} from '@/lib/projects/types';
import { runVerdict } from '@/lib/formWatch/verdict';

export type Tone = 'emerald' | 'amber' | 'red' | 'slate' | 'sky';

export const TONE_DOT: Record<Tone, string> = {
  emerald: 'bg-ok',
  amber: 'bg-warn',
  red: 'bg-danger',
  slate: 'bg-idle',
  sky: 'bg-info',
};
export const TONE_TEXT: Record<Tone, string> = {
  emerald: 'text-ok',
  amber: 'text-warn',
  red: 'text-danger',
  slate: 'text-ink-muted',
  sky: 'text-info',
};
/** Soft pill/badge fill + text for a tone. */
export const TONE_SOFT: Record<Tone, string> = {
  emerald: 'bg-ok/12 text-ok',
  amber: 'bg-warn/12 text-warn',
  red: 'bg-danger/12 text-danger',
  slate: 'bg-idle/12 text-ink-secondary',
  sky: 'bg-info/12 text-info',
};
/** Left severity edge for cards. */
export const TONE_EDGE: Record<Tone, string> = {
  emerald: 'bg-ok/80',
  amber: 'bg-warn/80',
  red: 'bg-danger/90',
  slate: 'bg-idle/70',
  sky: 'bg-info/80',
};

export const FORM_TONE: Record<FormHealthLevel, Tone> = {
  healthy: 'emerald',
  detected: 'sky',
  limited: 'sky',
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
  if (days < 0) return { t: 'expired', c: 'text-danger font-semibold' };
  if (days <= 14) return { t: `${days}d left`, c: 'text-danger font-semibold' };
  if (days <= 30) return { t: `${days}d`, c: 'text-warn' };
  return { t: `${days}d`, c: 'text-ink-secondary' };
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
    <div className="rounded-lg border border-line bg-panel/60 p-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{k}</div>
      <div className={`mt-1.5 text-lg font-bold tabular-nums ${tone ? TONE_TEXT[tone] : 'text-ink'}`}>{v}</div>
      {s && <div className="mt-0.5 text-[11.5px] text-ink-faint">{s}</div>}
    </div>
  );
}

export function SectionHeader({ title, help }: { title: string; help?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {help && <p className="mt-1 max-w-[62ch] text-xs text-ink-faint">{help}</p>}
    </div>
  );
}

/** Small uppercase chip naming WHICH tool produced a detail line. */
function SourceTag({ label, dim = false }: { label: string; dim?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${
        dim ? 'bg-panel text-ink-faint ring-line' : 'bg-ground text-ink-secondary ring-line-strong'
      }`}
    >
      {label}
    </span>
  );
}

/**
 * The 4-tool test breakdown for one URL — Form Watch · Site Watch · Change
 * Monitor · Form Tester — each showing what ran, what it found, cadence, and
 * when. Extracted from `UrlHealthDetail` so ONE implementation is shared by the
 * project detail page AND the internal status dashboards (FR-49 follow-up).
 */
export function UrlTestRows({ h }: { h: UrlHealth }) {
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
    <div className="space-y-3 text-[11px]">
      {/* Form Watch */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
        <div className="shrink-0 sm:w-32"><SourceTag label="Form Watch" dim={!h.form.monitored} /></div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 leading-relaxed">
          {h.form.monitored ? (
            <>
              <StatusDot tone={formTone} pulse />
              <span className="font-medium text-ink-secondary">Scheduled form test · {modeLabel(h.form.mode)}</span>
              <span className={TONE_TEXT[formTone]}>— {h.form.label}</span>
              <span className="text-ink-faint">· {formatInterval(h.form.intervalMs)} · {rel(h.form.lastRunAt)}</span>
            </>
          ) : h.form.stopped ? (
            <>
              <StatusDot tone={formTone} pulse={false} />
              <span className="font-medium text-ink-muted">Last form result</span>
              <span className={TONE_TEXT[formTone]}>— {h.form.label}</span>
              <span className="text-ink-faint">· monitor stopped · {rel(h.form.lastRunAt)}</span>
            </>
          ) : (
            <span className="text-ink-faint">Scheduled form test · not set up</span>
          )}
        </div>
      </div>

      {/* Site Watch */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
        <div className="shrink-0 sm:w-32"><SourceTag label="Site Watch" dim={!h.site.monitored} /></div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 leading-relaxed">
          {h.site.monitored || h.site.stopped ? (
            <>
              <StatusDot tone={upTone} pulse={h.site.monitored} />
              <span className="font-medium text-ink-secondary">{h.site.monitored ? 'Uptime & SSL' : 'Last uptime & SSL'}</span>
              <span className={TONE_TEXT[upTone]}>
                — {h.site.upState ? UP_LABEL[h.site.upState] : 'Unknown'}
                {h.site.statusCode ? ` · ${h.site.statusCode}` : ''}
              </span>
              {ssl && <span className="text-ink-faint">· SSL <span className={ssl.c}>{ssl.t}</span></span>}
              {domain && <span className="text-ink-faint">· Domain <span className={domain.c}>{domain.t}</span></span>}
              <span className="text-ink-faint">
                · {h.site.monitored ? `${formatInterval(h.site.intervalMs)} · ${rel(h.site.lastCheckedAt)}` : `monitor stopped · ${rel(h.site.lastCheckedAt)}`}
              </span>
            </>
          ) : (
            <span className="text-ink-faint">Uptime &amp; SSL · not set up</span>
          )}
        </div>
      </div>

      {/* Change Monitor — tracked per SITE (hostname), so URLs sharing a host
          share this line. Always rendered, like Form/Site Watch above, so an
          untracked URL reads as "not set up" rather than silently missing. */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
        <div className="shrink-0 sm:w-32"><SourceTag label="Change Monitor" dim={!h.change?.tracked} /></div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 leading-relaxed">
          {!h.change?.tracked ? (
            <span className="text-ink-faint">Content changes · not set up</span>
          ) : h.change.mode === 'snapshot' ? (
            <>
              <StatusDot tone="slate" pulse={false} />
              <span className="font-medium text-ink-secondary">Baseline captured</span>
              <span className="text-ink-faint">— awaiting first compare</span>
              <span className="text-ink-faint">· site-wide · {rel(h.change.lastCheckedAt)}</span>
            </>
          ) : (
            <>
              <StatusDot tone={changeTone} pulse={h.change.mode === 'watch'} />
              <span className="font-medium text-ink-secondary">Content changes</span>
              <span className={TONE_TEXT[changeTone]}>
                —{' '}
                {changeCount
                  ? `${changeCount} change${changeCount === 1 ? '' : 's'} on ${h.change.pagesChanged} page${h.change.pagesChanged === 1 ? '' : 's'}`
                  : 'no changes last check'}
              </span>
              <span className="text-ink-faint">
                · site-wide{h.change.mode === 'watch' ? ' · watching' : ''} · {rel(h.change.lastCheckedAt)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Form Tester */}
      {h.lastRun && (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
          <div className="shrink-0 sm:w-32"><SourceTag label="Form Tester" /></div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 leading-relaxed">
            <StatusDot tone={runTone} pulse={false} />
            <span className="font-medium text-ink-secondary">
              Manual form test{h.lastRun.mode ? ` · ${modeLabel(h.lastRun.mode)}` : ''}
            </span>
            <span className={TONE_TEXT[runTone]}>— {runV?.label ?? h.lastRun.finalStatus}</span>
            <span className="text-ink-faint">· {rel(h.lastRun.ranAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Per-URL health detail — the 4-tool breakdown (Form Watch · Site Watch · Change
 * Monitor · Form Tester) including the FR-17 "stopped · last result" state.
 * Unchanged behaviour from the old ProjectRow.UrlDetailRow; relocated here so the
 * detail page and the Unassigned bucket share ONE implementation.
 */
export function UrlHealthDetail({
  h,
  dashboardHref,
  onRemove,
  onDelete,
}: {
  h: UrlHealth;
  dashboardHref?: string;
  /** When provided (Member+), a NON-destructive "remove from project" (→ Unassigned, keeps data). */
  onRemove?: () => void;
  /** When provided (admins), a DESTRUCTIVE "delete this URL + all its data" button. */
  onDelete?: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel/50 p-4">
      {/* Header — URL + actions on one aligned row. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line pb-3">
        <a
          href={h.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 max-w-full truncate font-mono text-sm font-semibold text-accent-soft hover:text-accent"
          title={h.url}
        >
          {h.url}
        </a>
        <div className="flex shrink-0 items-center gap-2">
          {dashboardHref && (
            <Link
              href={dashboardHref}
              className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-secondary transition-colors hover:border-accent/60 hover:text-accent-soft"
              title="Open this URL's dashboard"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden><path d="M3 3a1 1 0 011 1v11h13a1 1 0 110 2H4a2 2 0 01-2-2V4a1 1 0 011-1z" /><path d="M7 11l3-3 2 1.5 3.5-4 1.5 1.2-4.4 5-2-1.5L8.4 12 7 11z" /></svg>
              Dashboard
            </Link>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              title="Remove from project (keeps its data — moves to Unassigned)"
              className="inline-flex items-center rounded-md border border-line-strong bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
            >
              Remove
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Delete this URL and all its data (can't be undone)"
              aria-label="Delete this URL and all its data"
              className="inline-flex items-center rounded-md border border-line-strong bg-panel p-1.5 text-ink-faint transition-colors hover:border-danger/60 hover:text-danger"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
            </button>
          )}
        </div>
      </div>

      <UrlTestRows h={h} />
    </div>
  );
}
