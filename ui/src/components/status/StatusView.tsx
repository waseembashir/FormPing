'use client';

import { useState } from 'react';
import type { ChangePoint, ClientStatus, OverallStatus, RespPoint, StatusSite, UptimeDay } from '@/lib/status/types';
import type { PageChange } from '@/types';
import { PageChangeCard } from '@/components/monitor/PageChangeCard';
import { getReasonMessage } from '@/lib/reasonMessages';
import type { FormRunFormSummary } from '@/lib/formRunDetail';

type StatusData = ClientStatus & { contact?: string | null; changes?: ChangePoint[] };

const WINDOWS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
] as const;
export type WindowId = (typeof WINDOWS)[number]['id'];

// ── helpers ──────────────────────────────────────────────────────────────────
function rel(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  const h = Math.round(diff / 3_600_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
function cadence(ms: number | null): string | null {
  if (!ms) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `every ${min} min`;
  const hr = Math.round(ms / 3_600_000);
  if (hr < 48) return `every ${hr}h`;
  return `every ${Math.round(ms / 86_400_000)}d`;
}
const pct = (p: number | null) => (p == null ? '—' : `${p}%`);
function windowLabel(d: number | null): string {
  if (d == null) return 'all time';
  if (d === 1) return 'today';
  return `last ${d} days`;
}
function modeLabel(mode: string | null | undefined): string {
  return mode === 'live' ? 'Live' : mode === 'detect-only' ? 'Detect only' : mode === 'safe' ? 'Safe mode' : (mode ?? '—');
}
/** "24 Oct 2026" — the calendar date `days` from now (for SSL/domain expiry). */
function fmtExpiry(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Small trend chip vs the previous equal window. `higherIsBetter` flips the
 *  colour (uptime↑ = good; response/incidents↑ = bad). Muted when unchanged. */
function DeltaChip({ delta, higherIsBetter, fmt }: { delta: number; higherIsBetter: boolean; fmt: (n: number) => string }) {
  if (delta === 0) return <span className="text-[10px] font-medium text-ink-faint">±0</span>;
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return (
    <span className={`text-[10px] font-semibold ${good ? 'text-ok' : 'text-warn'}`}>
      {delta > 0 ? '↑' : '↓'}
      {fmt(Math.abs(delta))}
    </span>
  );
}

/** SSL / domain expiry insight: real calendar date + days-left + urgency colour. */
function ExpiryRow({ label, days, valid }: { label: string; days: number; valid: boolean }) {
  const tone = !valid || days <= 14 ? 'text-danger' : days <= 30 ? 'text-warn' : 'text-ok';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-faint">{label}</span>
      <span className="tabular-nums text-ink-secondary">
        {valid ? (
          <>
            expires {fmtExpiry(days)} · <span className={`font-medium ${tone}`}>{days}d</span>
          </>
        ) : (
          <span className="font-medium text-danger">expired</span>
        )}
      </span>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="shrink-0 text-ink-faint">{k}</span>
      <span className="truncate text-right tabular-nums text-ink-secondary">{v}</span>
    </div>
  );
}
function Icon({ path, className = 'w-4 h-4' }: { path: string; className?: string }) {
  return <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden><path fillRule="evenodd" d={path} clipRule="evenodd" /></svg>;
}
const P = {
  check: 'M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z',
  shield: 'M9.6 1.8a1 1 0 01.8 0l6 2.5A1 1 0 0117 5.2V9c0 4.6-3 7.9-6.6 9.2a1 1 0 01-.7 0C6 16.9 3 13.6 3 9V5.2a1 1 0 01.6-.9l6-2.5zm3.1 6.5a1 1 0 00-1.4-1.4L9 9.2 7.9 8.1a1 1 0 10-1.4 1.4l1.8 1.8a1 1 0 001.4 0l3-3z',
  alert: 'M8.3 2.9a2 2 0 013.4 0l6.1 10.6A2 2 0 0116.1 17H3.9a2 2 0 01-1.7-3l6.1-10.6zM10 7a1 1 0 00-1 1v3a1 1 0 002 0V8a1 1 0 00-1-1zm0 7.5a1 1 0 100-2 1 1 0 000 2z',
};

const OVERALL: Record<OverallStatus, { label: string; dot: string; text: string; card: string }> = {
  operational: { label: 'All systems operational', dot: 'bg-ok', text: 'text-ok', card: 'bg-ok/10 ring-ok/30' },
  degraded: { label: 'Some systems degraded', dot: 'bg-warn', text: 'text-warn', card: 'bg-warn/10 ring-warn/30' },
  down: { label: 'Outage detected', dot: 'bg-danger', text: 'text-danger', card: 'bg-danger/10 ring-danger/30' },
};

function StatePill({ state }: { state: StatusSite['state'] }) {
  const map = {
    up: { t: 'Operational', c: 'text-ok bg-ok/12 ring-ok/20' },
    down: { t: 'Down', c: 'text-danger bg-danger/12 ring-danger/20' },
    blocked: { t: 'Unknown', c: 'text-ink-muted bg-panel ring-line-strong' },
    unknown: { t: 'Monitored', c: 'text-ink-muted bg-panel ring-line-strong' },
  }[state];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${map.c}`}>{map.t}</span>;
}
function StatTile({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-ground px-3 py-2.5 ring-1 ring-line">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <p className="text-lg font-bold leading-tight tabular-nums text-ink">{value}</p>
        {delta}
      </div>
      {sub && <p className="mt-0.5 text-[11px] text-ink-faint">{sub}</p>}
    </div>
  );
}

/** Window filter — Today / 7 days / 30 days / All time. */
function WindowFilter({ value, onChange }: { value: WindowId; onChange: (w: WindowId) => void }) {
  return (
    <div className="flex w-full rounded-xl bg-panel/70 p-1 ring-1 ring-line sm:inline-flex sm:w-auto">
      {WINDOWS.map((w) => (
        <button
          key={w.id}
          type="button"
          aria-pressed={value === w.id}
          onClick={() => onChange(w.id)}
          className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4 sm:py-2 sm:text-sm ${
            value === w.id ? 'bg-gradient-to-b from-accent to-accent-strong text-white shadow-sm shadow-accent-deep/40 ring-1 ring-accent-soft/20' : 'text-ink-muted hover:bg-panel hover:text-ink'
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

/** "24 Oct" from a YYYY-MM-DD day key. */
function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/**
 * Uptime day-strip — one cell per day, coloured by that day's result, with a
 * date axis, per-day hover tooltip, and a graceful note when history is sparse
 * (so a fresh monitor reads as "filling in", not a broken wall of grey).
 */
function UptimeChart({ days }: { days: UptimeDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const color = (p: number | null) => (p == null ? 'bg-line-strong' : p >= 99.9 ? 'bg-ok' : p >= 95 ? 'bg-warn' : 'bg-danger');
  const tracked = days.filter((d) => d.pct != null).length;
  const hv = hover != null ? days[hover] : null;
  const n = days.length;

  // Empty window → say so plainly, so switching the range clearly does something
  // even when there's no data (rather than an ambiguous grey grid).
  if (tracked === 0) {
    return (
      <div className="flex h-28 flex-col items-center justify-center rounded-lg bg-ground text-center ring-1 ring-line">
        <p className="text-[11px] text-ink-faint">No uptime checks in this window.</p>
        <p className="mt-0.5 text-[10px] text-ink-faint/70">Try a longer range — history fills in as monitoring runs.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <div className="flex h-14 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <div
              key={d.date}
              onMouseEnter={() => setHover(i)}
              className={`h-full flex-1 rounded-[2px] ${color(d.pct)} ${hover === i ? 'ring-1 ring-white/50' : ''}`}
            />
          ))}
        </div>
        {hv && (
          <div
            className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-panel-raised px-2 py-1 text-[10px] text-ink-secondary shadow-lg ring-1 ring-line-strong"
            style={{ left: `${((hover! + 0.5) / n) * 100}%` }}
          >
            {shortDate(hv.date)} · <span className="font-medium text-ink">{hv.pct == null ? 'no data' : `${hv.pct}% uptime`}</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
        <span>{n ? shortDate(days[0]!.date) : ''}</span>
        <span>today</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {([['bg-ok', 'Operational'], ['bg-warn', 'Partial'], ['bg-danger', 'Down'], ['bg-line-strong', 'No data']] as const).map(([c, t]) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-[10px] text-ink-faint"><span className={`h-2.5 w-2.5 rounded-[2px] ${c}`} />{t}</span>
          ))}
        </div>
        {tracked < n && <span className="text-[10px] text-ink-faint">{tracked} of {n} days tracked</span>}
      </div>
    </div>
  );
}

/**
 * Self-contained SVG response-time trend (internal only) — real y-axis (slowest
 * top → fastest bottom) + gridlines, a date x-axis, and an interactive hover
 * that reads out the day + ms at the cursor.
 */
function ResponseChart({ points }: { points: RespPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = points
    .map((p, i) => ({ i, ms: p.ms, date: p.date }))
    .filter((p): p is { i: number; ms: number; date: string } => p.ms != null);
  if (pts.length < 2) {
    return (
      <div className="flex h-28 flex-col items-center justify-center rounded-lg bg-ground text-center ring-1 ring-line">
        <p className="text-[11px] text-ink-faint">Not enough data in this window to chart a trend.</p>
        <p className="mt-0.5 text-[10px] text-ink-faint/70">Try a longer range — the trend builds as monitoring runs.</p>
      </div>
    );
  }
  const xMax = points.length - 1;
  const values = pts.map((p) => p.ms);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const W = 100, H = 40;
  const x = (i: number) => (i / xMax) * W;
  const y = (ms: number) => H - ((ms - min) / range) * H;
  const line = pts.map((p) => `${x(p.i).toFixed(2)},${y(p.ms).toFixed(2)}`).join(' ');
  const area = `M ${x(pts[0]!.i).toFixed(2)},${H} L ${pts.map((p) => `${x(p.i).toFixed(2)},${y(p.ms).toFixed(2)}`).join(' L ')} L ${x(pts[pts.length - 1]!.i).toFixed(2)},${H} Z`;
  const latest = pts[pts.length - 1]!;
  const hv = hover != null ? pts.find((p) => p.i === hover) ?? null : null;
  const gridStyle = { stroke: 'rgb(var(--fp-line-strong))', strokeWidth: 0.5 } as const;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = ratio * xMax;
    const nearest = pts.reduce((a, b) => (Math.abs(b.i - target) < Math.abs(a.i - target) ? b : a));
    setHover(nearest.i);
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex w-11 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-ink-faint">
          <span>{max}ms</span>
          <span className="opacity-70">{Math.round((max + min) / 2)}ms</span>
          <span>{min}ms</span>
        </div>
        <div className="relative flex-1" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full" aria-hidden>
            <defs>
              <linearGradient id="respFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: 'rgb(var(--fp-accent))', stopOpacity: 0.35 }} />
                <stop offset="1" style={{ stopColor: 'rgb(var(--fp-accent))', stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <line x1="0" y1="0" x2={W} y2="0" style={gridStyle} vectorEffect="non-scaling-stroke" />
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} style={gridStyle} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1={H} x2={W} y2={H} style={gridStyle} vectorEffect="non-scaling-stroke" />
            <path d={area} fill="url(#respFill)" />
            <polyline points={line} fill="none" className="stroke-accent" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {/* Markers on each measured day — so sparse/clustered data reads as real points, not a broken line. */}
            {pts.map((p) => (
              <circle key={p.i} cx={x(p.i)} cy={y(p.ms)} r={1.5} style={{ fill: 'rgb(var(--fp-accent))' }} vectorEffect="non-scaling-stroke" />
            ))}
            {hv && (
              <>
                <line x1={x(hv.i)} y1="0" x2={x(hv.i)} y2={H} style={{ stroke: 'rgb(var(--fp-accent))', strokeWidth: 0.75, opacity: 0.5 }} vectorEffect="non-scaling-stroke" />
                <circle cx={x(hv.i)} cy={y(hv.ms)} r={2.2} style={{ fill: 'rgb(var(--fp-accent))' }} vectorEffect="non-scaling-stroke" />
              </>
            )}
          </svg>
          {hv && (
            <div
              className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-panel-raised px-2 py-1 text-[10px] text-ink-secondary shadow-lg ring-1 ring-line-strong"
              style={{ left: `${(hv.i / xMax) * 100}%` }}
            >
              {shortDate(hv.date)} · <span className="font-medium text-ink">{hv.ms}ms</span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-[3.25rem] text-[10px] text-ink-faint">
        <span>{shortDate(pts[0]!.date)}</span>
        <span>latest <span className="font-medium text-ink-secondary">{latest.ms}ms</span></span>
        <span>today</span>
      </div>
    </div>
  );
}
/** How long a run took, in human terms ("98s", "2.4m"). */
function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)}m`;
}

/** Small chip for a form fact. `info` (sky) matches how the Form Tester marks
 *  site-wide/global things, so the two surfaces read the same. */
function Tag({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'info' }) {
  const cls =
    tone === 'warn' ? 'border-warn/30 bg-warn/10 text-warn'
    : tone === 'info' ? 'border-info/30 bg-info/10 text-info'
    : 'border-line-strong bg-panel-raised text-ink-secondary';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** What we did to one form: submitted / filled / detected / skipped / failed. */
const OUTCOME_CHIP: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'border-ok/30 bg-ok/10 text-ok' },
  filled: { label: 'Filled', cls: 'border-ok/30 bg-ok/10 text-ok' },
  detected: { label: 'Detected', cls: 'border-info/30 bg-info/10 text-info' },
  skipped: { label: 'Skipped', cls: 'border-line-strong bg-panel-raised text-ink-muted' },
  failed: { label: 'Failed', cls: 'border-danger/30 bg-danger/10 text-danger' },
};
function OutcomeChip({ state }: { state?: string }) {
  const c = OUTCOME_CHIP[state ?? 'detected'] ?? OUTCOME_CHIP.detected!;
  return <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold ${c.cls}`}>{c.label}</span>;
}

/**
 * FR-67 — the last Form Tester run's detail on the per-URL dashboard: what was
 * found (native vs embed + provider, structure, field count/names, CAPTCHA),
 * where it was found, and the plain reason it passed or failed. Reuses the
 * FR-64 reason vocabulary so Tester / Scheduler / Projects read the same.
 * INTERNAL ONLY — rendered from `tech`, which never reaches a client page.
 */
const KIND_LABEL: Record<string, string> = {
  contact: 'Contact form',
  newsletter: 'Newsletter',
  search: 'Search box',
  login: 'Login form',
  'third-party': 'Embedded form',
  other: 'Form',
};

/**
 * One found form as an expandable row: the full URL is the heading; opening it
 * reveals that form's own facts (type, fields, bot protection, what it's for,
 * whether it's site-wide). Field NAMES are deliberately left out here.
 */
function FormRow({ form }: { form: FormRunFormSummary }) {
  return (
    <details className="group rounded-lg border border-line bg-ground/40 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-open:rotate-90" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M7.21 5.23a.75.75 0 011.06.02l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 11-1.08-1.04L10.92 10 7.23 6.31a.75.75 0 01-.02-1.08z" clipRule="evenodd" />
        </svg>
        <span className="shrink-0 text-xs text-ink-faint">Form</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-accent-soft" title={form.url}>{form.url}</span>
        {/* "Primary", not "Tested": every lead form here was exercised — this is
            just the one the run picked as the site's main contact form, whose
            result drives the headline verdict above. */}
        {form.primary && (
          <span
            title="The site's main contact form — its result drives the verdict above"
            className="shrink-0 rounded border border-line-strong bg-panel-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted"
          >
            Primary
          </span>
        )}
        <OutcomeChip state={form.outcome} />
      </summary>

      <div className="space-y-2 border-t border-line px-3 py-2.5">
        {form.about && (
          <p className="text-xs text-ink-muted">
            <span className="text-ink-faint">About: </span>
            <span className="font-medium text-ink-secondary">&ldquo;{form.about}&rdquo;</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Tag>{KIND_LABEL[form.kind] ?? 'Form'}</Tag>
          {form.formType && (
            <Tag>{form.formType === 'third-party' ? `Third-party${form.provider ? ` · ${form.provider}` : ''}` : 'Native form'}</Tag>
          )}
          {typeof form.fieldCount === 'number' && form.fieldCount > 0 && (
            <Tag>{form.fieldCount} field{form.fieldCount === 1 ? '' : 's'}</Tag>
          )}
          {/* Claimed only when the widget is on THIS form. The old "No bot
              protection seen" fallback promised the opposite, which we can't
              see — an invisible reCAPTCHA leaves no per-form markup. FR-73. */}
          {form.captcha && <Tag tone="warn">CAPTCHA</Tag>}
          {form.siteWide && <Tag tone="info">Global{form.seenOn && form.seenOn > 1 ? ` · on ${form.seenOn} pages` : ''}</Tag>}
          {form.utm?.length ? <Tag>{form.utm.length} UTM param{form.utm.length === 1 ? '' : 's'}</Tag> : null}
        </div>
        {/* The same evidence the tester showed — the form as we saw it. Lazy, so
            a collapsed row costs nothing. FR-73. */}
        {form.shot && (
          <a
            href={form.shot}
            target="_blank"
            rel="noreferrer"
            title="Open the full-size screenshot"
            className="block overflow-hidden rounded-lg border border-line bg-ground/40 transition-colors hover:border-line-strong"
          >
            {/* The whole form, scaled to fit — never cropped to its first field. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={form.shot}
              alt={`Screenshot of the form on ${form.url}`}
              loading="lazy"
              decoding="async"
              className="mx-auto max-h-96 w-full object-contain"
            />
          </a>
        )}
        <a href={form.url} target="_blank" rel="noreferrer" className="inline-block text-xs text-ink-muted underline-offset-2 hover:text-accent hover:underline">
          Open page ↗
        </a>
      </div>
    </details>
  );
}

function FormRunDetails({ form }: { form: NonNullable<NonNullable<StatusSite['tech']>['form']> }) {
  const d = form.detail;
  const reason = form.reasonCode ? getReasonMessage(form.reasonCode) : null;
  const formList = d?.forms ?? [];
  const pagePath = (() => {
    if (!d?.resolvedPage) return null;
    try { return new URL(d.resolvedPage).pathname || '/'; } catch { return d.resolvedPage; }
  })();

  return (
    <div className="space-y-3">
      {/* Mode · when it ran · how long it took. */}
      <p className="text-xs text-ink-faint">
        {modeLabel(form.mode)}
        {form.lastRunAt ? ` · ${rel(form.lastRunAt)}` : ''}
        {form.durationMs ? ` · took ${duration(form.durationMs)}` : ''}
      </p>

      {/* The outcome in one plain line (FR-64 vocabulary). */}
      {reason && <p className="text-[13px] font-medium text-ink-secondary">{reason.title}</p>}

      {/* The run wasn't sure it found the right form — the dashboard hedges
          exactly where the tester did, rather than reading as settled fact. FR-73. */}
      {d?.confidence === 'low' && (
        <p className="rounded-lg border border-info/25 bg-info/8 px-3 py-2 text-xs leading-relaxed text-ink-muted">
          <span className="font-semibold text-info">Not certain this is the contact form.</span>{' '}
          {d.lowConfidenceReason
            ? `${d.lowConfidenceReason.charAt(0).toUpperCase()}${d.lowConfidenceReason.slice(1)}.`
            : 'The match was missing the usual contact signals.'}{' '}
          Re-run the Form Tester to see the form we matched.
        </p>
      )}

      {/* Say WHICH run the detail below describes. A URL can carry both a manual
          Form Tester run and a monitor's last check; we show whichever is newer,
          and naming it stops the panel reading as one merged event. FR-67. */}
      {d && form.detailRanAt && form.detailRanAt !== form.lastRunAt && (
        <p className="text-xs text-ink-faint">
          Detail below is from {form.detailSource === 'monitor' ? 'the monitor’s last check' : 'the last full Form Tester run'} · {rel(form.detailRanAt)}
        </p>
      )}

      {d && (
        <>
          {/* EVERY form the run found — mirrors the Form Tester log. Each row is
              headed by its full URL and expands to that form's own detail. */}
          {formList.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Forms found ({formList.length})
              </p>
              <div className="space-y-1.5">
                {formList.map((f, i) => <FormRow key={i} form={f} />)}
              </div>
            </div>
          ) : (
            // Runs recorded before the per-form list existed still carry the tested
            // form's own facts — show those rather than an empty panel.
            <>
              {/* WHAT we matched, in words. "This page has a form, but it is not a
                  contact form" told the reader what it ISN'T while the engine knew
                  perfectly well it was a search box — the one thing worth saying. FR-73. */}
              {d.formKind && d.formKind !== 'contact' && (
                <p className="text-[13px] text-ink-secondary">
                  What we found: <span className="font-semibold text-ink">{KIND_LABEL[d.formKind] ?? 'a form'}</span>
                  {d.formKind === 'search' && ' — a site search box, not a way to contact anyone.'}
                  {d.formKind === 'newsletter' && ' — an email sign-up, not a way to contact anyone.'}
                  {d.formKind === 'login' && ' — a sign-in form, not a way to contact anyone.'}
                  {d.formKind === 'other' && ' — a form for something else.'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {d.formType && (
                  <Tag>
                    {d.formType === 'third-party'
                      ? `Third-party${d.embedProvider ? ` · ${d.embedProvider}` : ''}`
                      : 'Native form'}
                  </Tag>
                )}
                {typeof d.isMultiStep === 'boolean' && <Tag>{d.isMultiStep ? 'Multi-step' : 'Single-step'}</Tag>}
                {typeof d.fieldCount === 'number' && d.fieldCount > 0 && <Tag>{d.fieldCount} field{d.fieldCount === 1 ? '' : 's'}</Tag>}
                {/* Only claimed when a widget is on the form itself. We never say
                    the opposite: an invisible reCAPTCHA leaves no markup to see,
                    so "no bot protection seen" was a promise we can't keep. FR-73. */}
                {d.captchaDetected && <Tag tone="warn">CAPTCHA</Tag>}
                {typeof d.siteFormsCount === 'number' && d.siteFormsCount > 1 && <Tag>{d.siteFormsCount} forms on site</Tag>}
              </div>
              {pagePath && (
                <p className="text-xs text-ink-muted">
                  <span className="text-ink-faint">Tested form on: </span>
                  <a href={d.resolvedPage!} target="_blank" rel="noreferrer" className="text-ink-secondary hover:text-accent" title={d.resolvedPage!}>{pagePath}</a>
                </p>
              )}
              <p className="text-xs text-ink-faint">Re-run the Form Tester to see every form found on this site.</p>
            </>
          )}

          <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {d.landingPageMode && <Detail k="Scope" v="Landing page only" />}
            {d.submissionAttempted && <Detail k="Submission" v={d.submissionResult || '—'} />}
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ ok, icon, children }: { ok: boolean; icon: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${ok ? 'text-ok bg-ok/12 ring-ok/20' : 'text-warn bg-warn/12 ring-warn/20'}`}>
      <Icon path={icon} className="h-3.5 w-3.5" />{children}
    </span>
  );
}

/** A titled sub-panel — the unit of the panel-grid dashboard (separation of
 *  concerns): each tool/metric gets its own bordered card with a clear heading. */
function Panel({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-xl bg-ground/40 p-4 ring-1 ring-line ${wide ? 'sm:col-span-2' : ''}`}>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{title}</p>
      {children}
    </div>
  );
}

function SiteCard({
  s,
  windowDays,
  changes,
  projectId,
  internal = false,
}: {
  s: StatusSite;
  windowDays: number | null;
  /** This host's content-change runs, rendered in-card. Internal-only: the public
   *  payload never carries `changes`, so this is always undefined there. */
  changes?: ChangePoint[];
  projectId?: string;
  /** Team dashboards only. Turns on the per-tool section labels (Site Watch /
   *  Contact form / Change Monitor) so the depth reads clearly by tool. Off on
   *  the public client pages, which keep the plain, jargon-free layout. */
  internal?: boolean;
}) {
  const uptimeMonitored = s.state !== 'unknown';
  const hasUptimeData = s.dailyUptime.some((d) => d.pct != null);
  const tech = s.tech; // present only on the internal view
  const ssl = s.ssl;
  // Full page URL (scheme stripped) so multiple URLs on one host are distinct.
  const displayUrl = s.url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // Trend deltas vs the previous equal window (hidden when no prior history).
  const uptimeDelta =
    s.uptimeWindowPct != null && s.uptimePrevPct != null
      ? <DeltaChip delta={Math.round((s.uptimeWindowPct - s.uptimePrevPct) * 10) / 10} higherIsBetter fmt={(n) => `${n}pt`} />
      : undefined;
  const incidentsDelta =
    s.incidentsPrev != null
      ? <DeltaChip delta={s.incidents - s.incidentsPrev} higherIsBetter={false} fmt={(n) => `${n}`} />
      : undefined;
  const responseDelta =
    tech?.avgResponseMs != null && tech.avgResponsePrevMs != null && tech.avgResponsePrevMs > 0
      ? <DeltaChip delta={Math.round(((tech.avgResponseMs - tech.avgResponsePrevMs) / tech.avgResponsePrevMs) * 100)} higherIsBetter={false} fmt={(n) => `${n}%`} />
      : undefined;

  return (
    <div className="rounded-2xl bg-panel/60 p-5 ring-1 ring-line">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${s.state === 'up' ? 'bg-ok' : s.state === 'down' ? 'bg-danger' : 'bg-idle'}`} />
          <span className="truncate font-semibold text-ink" title={s.url}>{displayUrl}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {s.stale && (
            <span className="rounded-full bg-idle/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted ring-1 ring-white/10">
              Monitoring paused
            </span>
          )}
          <StatePill state={s.state} />
        </div>
      </div>

      {s.stale && (
        <p className="-mt-2 mb-4 text-[11px] text-ink-faint">
          Showing the last known result{s.lastCheckedAt ? <> · checked {rel(s.lastCheckedAt)}</> : null}.
        </p>
      )}

      {/* KPI row — the scannable numbers (client-safe). */}
      {uptimeMonitored && (
        <div className={`mb-4 grid gap-2 ${tech ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          <StatTile label="Uptime" value={pct(s.uptimeWindowPct)} sub={windowLabel(windowDays)} delta={uptimeDelta} />
          <StatTile label="Incidents" value={String(s.incidents)} sub={windowLabel(windowDays)} delta={incidentsDelta} />
          {tech && <StatTile label="Response" value={tech.avgResponseMs != null ? `${tech.avgResponseMs}ms` : '—'} sub="avg" delta={responseDelta} />}
          <StatTile label="SSL" value={ssl?.daysRemaining != null ? `${ssl.daysRemaining}d` : ssl?.valid ? 'valid' : '—'} sub={ssl ? 'until renewal' : 'not monitored'} />
        </div>
      )}

      {/* Panel grid — each concern in its own titled card (separation of concerns). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {uptimeMonitored && (
          <Panel title={`Uptime · ${windowLabel(windowDays)}`}>
            {hasUptimeData ? (
              <UptimeChart days={s.dailyUptime} />
            ) : (
              <div className="flex h-24 items-center justify-center rounded-lg bg-ground ring-1 ring-line"><p className="text-[11px] text-ink-faint">Monitoring history fills in over time.</p></div>
            )}
          </Panel>
        )}

        {tech && (
          <Panel title={`Response time · ${windowLabel(windowDays)}`}>
            <ResponseChart points={tech.responseTrend} />
          </Panel>
        )}

        {(s.formWorking != null || internal) && (
          <Panel title="Contact form">
            {s.formWorking != null ? (
              <div className="space-y-2">
                <Badge ok={s.formWorking} icon={s.formWorking ? P.check : P.alert}>{s.formWorking ? 'Contact form working' : 'Contact form needs attention'}</Badge>
                {internal && tech?.form && <FormRunDetails form={tech.form} />}
              </div>
            ) : internal && tech?.form ? (
              // A manual run happened but the verdict is inconclusive (e.g. no
              // contact page located) — still show what the run actually found. FR-67.
              <FormRunDetails form={tech.form} />
            ) : (
              <p className="text-[11px] text-ink-faint">Not monitored for this page.</p>
            )}
          </Panel>
        )}

        {(ssl || (internal && tech?.domainDaysRemaining != null)) && (
          <Panel title="Certificates">
            <div className="space-y-1.5 text-[11px]">
              {ssl && ssl.daysRemaining != null ? (
                <ExpiryRow label="SSL certificate" days={ssl.daysRemaining} valid={ssl.valid} />
              ) : ssl ? (
                <div className="flex items-baseline justify-between gap-3"><span className="text-ink-faint">SSL certificate</span><span className={`font-medium ${ssl.valid ? 'text-ok' : 'text-danger'}`}>{ssl.valid ? 'valid' : 'expired'}</span></div>
              ) : null}
              {/* Who issued it, and the registrar behind the domain. The check
                  reads both on every run; until FR-67 the panel showed only a
                  day count, which tells you WHEN to worry but never who to ask. */}
              {internal && tech?.check?.sslIssuer && (
                <Detail k="Issued by" v={<span className="truncate" title={tech.check.sslIssuer}>{tech.check.sslIssuer}</span>} />
              )}
              {internal && tech?.domainDaysRemaining != null && <ExpiryRow label="Domain registration" days={tech.domainDaysRemaining} valid={tech.domainDaysRemaining > 0} />}
              {internal && tech?.check?.domainRegistrar && (
                <Detail k="Registrar" v={<span className="truncate" title={tech.check.domainRegistrar}>{tech.check.domainRegistrar}</span>} />
              )}
              {internal && (tech?.check?.sslError || tech?.check?.domainError) && (
                <p className="pt-1 text-[11px] leading-relaxed text-warn">
                  {tech.check.sslError ?? tech.check.domainError}
                </p>
              )}
            </div>
          </Panel>
        )}

        {internal && tech && (
          <Panel title="Technical details" wide>
            <div className="grid gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
              <Detail k="URL" v={<a href={tech.url} target="_blank" rel="noreferrer" className="truncate text-ink-secondary hover:text-accent" title={tech.url}>{tech.url.replace(/^https?:\/\//, '')}</a>} />
              <Detail k="HTTP status" v={tech.statusCode ?? '—'} />
              <Detail k="Last response" v={tech.lastResponseMs != null ? `${tech.lastResponseMs}ms` : '—'} />
              <Detail k="Last checked" v={rel(tech.lastCheckedAt)} />
              <Detail k="Checked every" v={cadence(tech.intervalMs) ?? '—'} />
              {tech.form && <Detail k="Form test" v={`${modeLabel(tech.form.mode)}${tech.form.label ? ` · ${tech.form.label}` : ''}`} />}
            </div>
            {/* Why a failing check failed. The reason was measured and thrown
                away, leaving a red status with no explanation. FR-67. */}
            {tech.check?.uptimeError && (
              <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-danger">
                <span className="font-semibold">Last error:</span> {tech.check.uptimeError}
              </p>
            )}
          </Panel>
        )}

        {changes && changes.length > 0 && (
          <ChangeBlock changes={changes} windowDays={windowDays} projectId={projectId} />
        )}
      </div>

      {!uptimeMonitored && s.formWorking == null && !(changes && changes.length > 0) && (
        <p className="mt-1 text-sm text-ink-muted">Monitoring for this page.</p>
      )}
    </div>
  );
}

/**
 * One run in the change timeline. Expands to show WHAT changed, fetched on
 * demand from the auth-gated drill-in endpoint so the heavy per-page detail is
 * never loaded until asked for. Reuses `PageChangeCard` — the same renderer the
 * Change tracking tab uses — so there is one implementation, not two.
 */
function ChangeRow({ c, busiest, projectId }: { c: ChangePoint; busiest: number; projectId?: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'gone' | 'error'>('idle');
  const [details, setDetails] = useState<PageChange[]>([]);

  const tone =
    c.mode === 'snapshot'
      ? 'bg-idle'
      : c.changesFound === 0
        ? 'bg-ok'
        : c.severity === 'high'
          ? 'bg-danger'
          : c.severity === 'medium'
            ? 'bg-warn'
            : 'bg-ok';
  const pct = c.mode === 'snapshot' ? 0 : Math.round((c.changesFound / busiest) * 100);
  // Only runs that actually found something have detail worth opening.
  const canExpand = Boolean(projectId) && c.mode !== 'snapshot' && c.changesFound > 0;

  async function toggle() {
    if (!canExpand) return;
    const next = !open;
    setOpen(next);
    if (!next || state !== 'idle') return;
    setState('loading');
    try {
      const res = await fetch(
        `/api/projects/${projectId}/changes?site=${encodeURIComponent(c.site)}&at=${encodeURIComponent(c.checkedAt)}`,
        { cache: 'no-store' },
      );
      const d = await res.json();
      if (!res.ok) return setState('error');
      if (!d.found) return setState('gone');
      setDetails(Array.isArray(d.details) ? d.details : []);
      setState('ready');
    } catch {
      setState('error');
    }
  }

  const label =
    c.mode === 'snapshot'
      ? 'baseline captured'
      : c.changesFound === 0
        ? 'no changes'
        : `${c.changesFound} change${c.changesFound === 1 ? '' : 's'} on ${c.pagesChanged} page${c.pagesChanged === 1 ? '' : 's'}`;

  return (
    <li className="rounded-lg ring-1 ring-line">
      <div
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            void toggle();
          }
        }}
        className={`px-3 py-2 ${canExpand ? 'cursor-pointer hover:bg-panel/60' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />
          <span className="font-medium text-ink-secondary">{rel(c.checkedAt)}</span>
          <span className="rounded bg-ground px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-muted">
            {c.mode}
          </span>
          <span className="text-ink-muted">{label}</span>
          {canExpand && (
            <span className="text-[10px] font-medium text-accent">
              {open ? '▾ hide detail' : '▸ what changed?'}
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-ink-faint">{c.site}</span>
        </div>
        {pct > 0 && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ground">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        {c.summary && <p className="mt-1.5 line-clamp-2 text-[11px] text-ink-faint">{c.summary}</p>}
      </div>

      {open && (
        <div className="border-t border-line px-3 py-3">
          {state === 'loading' && <div className="fp-skeleton h-16 rounded-lg" />}
          {state === 'error' && <p className="text-[11px] text-danger">Could not load the detail for this run.</p>}
          {state === 'gone' && (
            <p className="text-[11px] text-ink-faint">
              Full detail is no longer kept for this run — only the most recent runs retain their page-by-page
              breakdown. The run itself stays in the timeline.
            </p>
          )}
          {state === 'ready' &&
            (details.length === 0 ? (
              <p className="text-[11px] text-ink-faint">No per-page detail was recorded for this run.</p>
            ) : (
              <div className="space-y-2">
                {details.map((d, i) => (
                  <PageChangeCard key={`${d.url}-${i}`} change={d} />
                ))}
              </div>
            ))}
        </div>
      )}
    </li>
  );
}

/**
 * In-card content-change timeline — INTERNAL ONLY.
 *
 * Lives INSIDE a host's status card (FR-49) so every signal for that site —
 * uptime, form, SSL, and content changes — reads in one place, rather than in a
 * detached section. Content diffs are a technical QA signal (a client seeing "84
 * changes" would be alarmed by what is often their own team's edits), so this
 * only ever reaches the component through the internal payload: the public route
 * omits `changes` entirely, the same trust model as `tech`. Tracking is
 * site-level (the crawler walks a whole site from its homepage), so it attaches
 * to the HOST's card, not any single URL path.
 */
function ChangeBlock({
  changes,
  windowDays,
  projectId,
}: {
  changes: ChangePoint[];
  windowDays: number | null;
  projectId?: string;
}) {
  const [open, setOpen] = useState(false); // collapsed by default — the run list can be long
  const withChanges = changes.filter((c) => c.mode !== 'snapshot');
  const busiest = Math.max(1, ...withChanges.map((c) => c.changesFound));
  const totalChanges = withChanges.reduce((n, c) => n + c.changesFound, 0);
  // Insight: most-recent real change + severity mix (changes are newest-first).
  const lastChange = withChanges.find((c) => c.changesFound > 0);
  const sev = { high: 0, medium: 0, low: 0 };
  for (const c of withChanges) if (c.changesFound > 0 && c.severity) sev[c.severity] += 1;
  const sevParts = [
    sev.high ? `${sev.high} high` : null,
    sev.medium ? `${sev.medium} medium` : null,
    sev.low ? `${sev.low} low` : null,
  ].filter(Boolean);

  // Baselines vs comparisons. "7 runs" alone can't tell you whether this URL has
  // ever actually been COMPARED against anything — a site that only ever took
  // snapshots has never been checked for changes, and read as healthy. Each run
  // has always carried its mode; nothing was showing it. FR-67.
  const snapshots = changes.filter((c) => c.mode === 'snapshot').length;
  const compares = changes.filter((c) => c.mode === 'compare').length;
  const watches = changes.filter((c) => c.mode === 'watch').length;
  const runParts = [
    snapshots ? `${snapshots} baseline${snapshots === 1 ? '' : 's'}` : null,
    compares ? `${compares} comparison${compares === 1 ? '' : 's'}` : null,
    watches ? `${watches} watch check${watches === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  const neverCompared = changes.length > 0 && compares + watches === 0;

  return (
    <div className="rounded-xl bg-ground/40 p-4 ring-1 ring-line sm:col-span-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? 'Collapse' : 'Click to view all runs'}
        className="group -m-2 flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left transition-colors hover:bg-panel/50"
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Content changes</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">Whole-site crawl · {windowLabel(windowDays)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="hidden text-[11px] text-ink-faint sm:block">
            <span className="font-semibold text-ink-secondary">{changes.length}</span> run
            {changes.length === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-ink-secondary">{totalChanges}</span> change
            {totalChanges === 1 ? '' : 's'}
          </p>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-line-strong transition-colors group-hover:bg-accent/10 group-hover:ring-accent/40">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`h-4 w-4 text-ink-muted transition-transform duration-200 group-hover:text-accent ${open ? 'rotate-180' : ''}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </div>
      </button>

      {/* What those runs WERE — baselines captured vs actual comparisons. */}
      {runParts.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint">{runParts.join(' · ')}</p>
      )}

      {/* One-line insight — stays visible even when collapsed. */}
      <p className="mt-2 text-[11px] text-ink-muted">
        {neverCompared ? (
          <span className="text-warn">
            Baseline only — this site has been snapshotted but never compared, so nothing has been checked for changes yet.
          </span>
        ) : totalChanges === 0 ? (
          'Stable — no changes detected across the window.'
        ) : (
          <>
            Last change {lastChange ? rel(lastChange.checkedAt) : '—'}
            {sevParts.length ? <> · {sevParts.join(' · ')}</> : null}.
          </>
        )}
      </p>

      {open ? (
        <ol className="mt-2.5 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {changes.map((c, i) => (
            <ChangeRow key={`${c.site}-${c.checkedAt}-${i}`} c={c} busiest={busiest} projectId={projectId} />
          ))}
        </ol>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-[11px] font-semibold text-ink-secondary transition-colors hover:border-accent/50 hover:text-accent"
        >
          Click to view all {changes.length} run{changes.length === 1 ? '' : 's'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-3.5 w-3.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function StatusView({
  data,
  internal = false,
  window,
  onWindow,
  projectId,
}: {
  data: StatusData;
  internal?: boolean;
  window?: WindowId;
  onWindow?: (w: WindowId) => void;
  /** Enables the change-timeline drill-in (internal dashboard only). */
  projectId?: string;
}) {
  const o = OVERALL[data.overall];
  const monitors = data.sites.length;

  // Group content-change runs by host so each site's runs render INSIDE that
  // host's card (FR-49). Only the FIRST card for a host gets the block, so two
  // URLs sharing a host (tracking is whole-site) don't render it twice. The
  // public payload never carries `changes`, so `changesByHost` is empty there.
  const changesByHost = new Map<string, ChangePoint[]>();
  for (const c of data.changes ?? []) {
    const arr = changesByHost.get(c.site);
    if (arr) arr.push(c);
    else changesByHost.set(c.site, [c]);
  }
  const hostShown = new Set<string>();

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">{internal ? 'Internal dashboard · team view' : 'Live status'}</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">{data.name}</h1>
          {internal && (
            <p className="mt-1.5 text-xs text-ink-faint">
              {monitors} monitored service{monitors === 1 ? '' : 's'}
              {data.contact ? <> · notify <span className="text-ink-muted">{data.contact}</span></> : null}
            </p>
          )}
        </div>
        {window && onWindow && <WindowFilter value={window} onChange={onWindow} />}
      </div>

      <div className={`flex items-center justify-between gap-3 rounded-2xl px-5 py-4 ring-1 ${o.card}`}>
        <div className="flex items-center gap-3">
          <span className="relative flex h-3.5 w-3.5">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${o.dot}`} />
            <span className={`relative inline-flex h-3.5 w-3.5 rounded-full ${o.dot}`} />
          </span>
          <span className={`text-base font-semibold ${o.text}`}>{o.label}</span>
        </div>
        <span className="hidden text-xs text-ink-faint sm:block">updated {rel(data.generatedAt)}</span>
      </div>

      <div className="mt-5 space-y-4">
        {data.sites.length === 0 ? (
          <div className="rounded-2xl bg-panel/60 p-8 text-center ring-1 ring-line"><p className="text-sm text-ink-muted">No monitored services yet.</p></div>
        ) : (
          data.sites.map((s, i) => {
            // First card for this host carries its content-change block.
            const hostChanges = hostShown.has(s.host) ? undefined : changesByHost.get(s.host);
            if (hostChanges) hostShown.add(s.host);
            return (
              <SiteCard
                key={`${s.host}-${i}`}
                s={s}
                windowDays={data.windowDays}
                changes={hostChanges}
                projectId={projectId}
                internal={internal}
              />
            );
          })
        )}
      </div>

      <p className="mt-6 text-center text-[11px] text-ink-faint">Uptime over {windowLabel(data.windowDays)} · updated {rel(data.generatedAt)} · refreshes automatically</p>
    </>
  );
}
