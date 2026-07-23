'use client';

import { useState } from 'react';
import type { ChangePoint, ClientStatus, OverallStatus, RespPoint, StatusSite, UptimeDay } from '@/lib/status/types';
import type { PageChange } from '@/types';
import { PageChangeCard } from '@/components/monitor/PageChangeCard';

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

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className="truncate text-right tabular-nums text-slate-300">{v}</span>
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
  operational: { label: 'All systems operational', dot: 'bg-emerald-400', text: 'text-emerald-300', card: 'bg-emerald-950/30 ring-emerald-500/30' },
  degraded: { label: 'Some systems degraded', dot: 'bg-amber-400', text: 'text-amber-300', card: 'bg-amber-950/30 ring-amber-500/30' },
  down: { label: 'Outage detected', dot: 'bg-rose-400', text: 'text-rose-300', card: 'bg-rose-950/30 ring-rose-500/30' },
};

function StatePill({ state }: { state: StatusSite['state'] }) {
  const map = {
    up: { t: 'Operational', c: 'text-emerald-300 bg-emerald-950/40 ring-emerald-500/20' },
    down: { t: 'Down', c: 'text-rose-300 bg-rose-950/40 ring-rose-500/20' },
    blocked: { t: 'Unknown', c: 'text-slate-400 bg-slate-800/60 ring-slate-600/30' },
    unknown: { t: 'Monitored', c: 'text-slate-400 bg-slate-800/60 ring-slate-600/30' },
  }[state];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${map.c}`}>{map.t}</span>;
}
function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-800/40 px-3 py-2.5 ring-1 ring-slate-700/50">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold leading-tight tabular-nums text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

/** Window filter — Today / 7 days / 30 days / All time. */
function WindowFilter({ value, onChange }: { value: WindowId; onChange: (w: WindowId) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-0.5">
      {WINDOWS.map((w) => (
        <button
          key={w.id}
          type="button"
          onClick={() => onChange(w.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === w.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

function UptimeBar({ days }: { days: UptimeDay[] }) {
  const color = (p: number | null) => (p == null ? 'bg-slate-800' : p >= 99.9 ? 'bg-emerald-500' : p >= 95 ? 'bg-amber-400' : 'bg-rose-500');
  return (
    <div className="flex h-9 items-end gap-[3px]">
      {days.map((d) => (
        <div key={d.date} className={`h-full flex-1 rounded-[2px] ${color(d.pct)} transition-colors`} title={`${d.date}: ${d.pct == null ? 'no data' : `${d.pct}% uptime`}`} />
      ))}
    </div>
  );
}
function Legend() {
  const items = [['bg-emerald-500', 'Operational'], ['bg-amber-400', 'Partial'], ['bg-rose-500', 'Down'], ['bg-slate-800', 'No data']] as const;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map(([c, t]) => (
        <span key={t} className="inline-flex items-center gap-1.5 text-[10px] text-slate-500"><span className={`h-2.5 w-2.5 rounded-[2px] ${c}`} />{t}</span>
      ))}
    </div>
  );
}

/** Self-contained SVG response-time trend (internal only). */
function TrendChart({ points }: { points: RespPoint[] }) {
  const pts = points.map((p, i) => ({ i, ms: p.ms })).filter((p): p is { i: number; ms: number } => p.ms != null);
  if (pts.length < 2) {
    return <div className="flex h-14 items-center justify-center rounded-xl bg-slate-800/30 ring-1 ring-slate-700/50"><p className="text-[11px] text-slate-500">Building trend — needs a bit more history.</p></div>;
  }
  const xMax = points.length - 1;
  const values = pts.map((p) => p.ms);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const W = 100, H = 32;
  const coord = (p: { i: number; ms: number }): [number, number] => [(p.i / xMax) * W, H - ((p.ms - min) / range) * H];
  const line = pts.map(coord).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const [fx] = coord(pts[0]!);
  const [lx] = coord(pts[pts.length - 1]!);
  const area = `M ${fx.toFixed(2)},${H} L ${line.replace(/ /g, ' L ')} L ${lx.toFixed(2)},${H} Z`;
  return (
    <div className="rounded-xl bg-slate-800/30 px-3 pb-1 pt-2 ring-1 ring-slate-700/50">
      <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500"><span>slowest {max}ms</span><span>fastest {min}ms</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-12 w-full" aria-hidden>
        <defs><linearGradient id="respFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#818cf8" stopOpacity="0.35" /><stop offset="1" stopColor="#818cf8" stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill="url(#respFill)" />
        <polyline points={line} fill="none" stroke="#818cf8" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
function Badge({ ok, icon, children }: { ok: boolean; icon: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${ok ? 'text-emerald-300 bg-emerald-950/30 ring-emerald-500/20' : 'text-amber-300 bg-amber-950/30 ring-amber-500/20'}`}>
      <Icon path={icon} className="h-3.5 w-3.5" />{children}
    </span>
  );
}

function SiteCard({ s, windowDays }: { s: StatusSite; windowDays: number | null }) {
  const uptimeMonitored = s.state !== 'unknown';
  const hasUptimeData = s.dailyUptime.some((d) => d.pct != null);
  const tech = s.tech; // present only on the internal view
  const ssl = s.ssl;
  const sslOk = ssl ? ssl.valid && (ssl.daysRemaining == null || ssl.daysRemaining > 14) : true;

  return (
    <div className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.state === 'up' ? 'bg-emerald-400' : s.state === 'down' ? 'bg-rose-400' : 'bg-slate-600'}`} />
          <span className="truncate font-semibold text-slate-100">{s.host}</span>
        </div>
        <StatePill state={s.state} />
      </div>

      {uptimeMonitored ? (
        <>
          <div className={`mb-4 grid gap-2 ${tech ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
            <StatTile label="Uptime" value={pct(s.uptimeWindowPct)} sub={windowLabel(windowDays)} />
            <StatTile label="Incidents" value={String(s.incidents)} sub={windowLabel(windowDays)} />
            {tech ? (
              <>
                <StatTile label="Response" value={tech.avgResponseMs != null ? `${tech.avgResponseMs}ms` : '—'} sub="avg" />
                <StatTile label="Checked" value={cadence(tech.intervalMs)?.replace('every ', '') ?? '—'} sub="frequency" />
              </>
            ) : (
              <StatTile label="SSL" value={ssl?.daysRemaining != null ? `${ssl.daysRemaining}d` : ssl?.valid ? 'valid' : '—'} sub={ssl ? 'until renewal' : 'not monitored'} />
            )}
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Uptime · {windowLabel(windowDays)}</span>
              <div className="flex items-center gap-3 text-[11px] tabular-nums text-slate-500">
                <span>Today <span className="font-medium text-slate-200">{pct(s.uptime.d1)}</span></span>
                <span>30d <span className="font-medium text-slate-200">{pct(s.uptime.d30)}</span></span>
              </div>
            </div>
            {hasUptimeData ? (
              <><UptimeBar days={s.dailyUptime} /><Legend /></>
            ) : (
              <div className="flex h-9 items-center rounded-xl bg-slate-800/30 px-3 ring-1 ring-slate-700/50"><p className="text-[11px] text-slate-500">Monitoring history fills in over time.</p></div>
            )}
          </div>

          {tech && (
            <div>
              <span className="text-xs font-semibold text-slate-400">Response time · {windowLabel(windowDays)}</span>
              <div className="mt-1.5"><TrendChart points={tech.responseTrend} /></div>
            </div>
          )}
        </>
      ) : (
        <p className="mb-4 text-sm text-slate-400">Contact-form monitoring for this page.</p>
      )}

      {(s.formWorking != null || ssl) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
          {s.formWorking != null && <Badge ok={s.formWorking} icon={s.formWorking ? P.check : P.alert}>{s.formWorking ? 'Contact form working' : 'Contact form needs attention'}</Badge>}
          {ssl && <Badge ok={sslOk} icon={P.shield}>{!ssl.valid ? 'SSL expired' : ssl.daysRemaining != null && ssl.daysRemaining <= 30 ? `SSL renews in ${ssl.daysRemaining}d` : 'SSL valid'}</Badge>}
        </div>
      )}

      {tech && (
        <div className="mt-4 border-t border-slate-800 pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Technical details</p>
          <div className="grid gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
            <Detail k="URL" v={<a href={tech.url} target="_blank" rel="noreferrer" className="truncate text-slate-300 hover:text-indigo-300" title={tech.url}>{tech.url.replace(/^https?:\/\//, '')}</a>} />
            <Detail k="HTTP status" v={tech.statusCode ?? '—'} />
            <Detail k="Last response" v={tech.lastResponseMs != null ? `${tech.lastResponseMs}ms` : '—'} />
            <Detail k="Last checked" v={rel(tech.lastCheckedAt)} />
            <Detail k="Domain expiry" v={tech.domainDaysRemaining != null ? `${tech.domainDaysRemaining}d` : '—'} />
            {tech.form && <Detail k="Form test" v={`${modeLabel(tech.form.mode)}${tech.form.label ? ` · ${tech.form.label}` : ''}`} />}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shared status presentation — used by BOTH the public page (/status/[token])
 * and the internal, auth-gated page (/projects/[id]/status). Response times +
 * latency + check frequency render ONLY when `tech` is present (internal), so
 * the public view never shows them.
 */
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
      ? 'bg-slate-500'
      : c.changesFound === 0
        ? 'bg-emerald-500'
        : c.severity === 'high'
          ? 'bg-red-500'
          : c.severity === 'medium'
            ? 'bg-amber-500'
            : 'bg-emerald-500';
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
    <li className="rounded-lg ring-1 ring-slate-800/80">
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
        className={`px-3 py-2 ${canExpand ? 'cursor-pointer hover:bg-slate-800/40' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />
          <span className="font-medium text-slate-300">{rel(c.checkedAt)}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-400">
            {c.mode}
          </span>
          <span className="text-slate-400">{label}</span>
          {canExpand && (
            <span className="text-[10px] font-medium text-indigo-400">
              {open ? '▾ hide detail' : '▸ what changed?'}
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-slate-600">{c.site}</span>
        </div>
        {pct > 0 && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        {c.summary && <p className="mt-1.5 line-clamp-2 text-[11px] text-slate-500">{c.summary}</p>}
      </div>

      {open && (
        <div className="border-t border-slate-800 px-3 py-3">
          {state === 'loading' && <div className="fp-skeleton h-16 rounded-lg" />}
          {state === 'error' && <p className="text-[11px] text-red-400">Could not load the detail for this run.</p>}
          {state === 'gone' && (
            <p className="text-[11px] text-slate-500">
              Full detail is no longer kept for this run — only the most recent runs retain their page-by-page
              breakdown. The run itself stays in the timeline.
            </p>
          )}
          {state === 'ready' &&
            (details.length === 0 ? (
              <p className="text-[11px] text-slate-500">No per-page detail was recorded for this run.</p>
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
 * Change-tracking timeline — INTERNAL ONLY.
 *
 * Content diffs are a technical QA signal (and a client seeing "84 changes"
 * would be alarmed by what is often their own team's edits), so this is never
 * rendered on the public status page. Tracking is site-level: the crawler walks
 * a whole site from its homepage, so rows are per HOST, not per URL.
 */
function ChangeTimeline({
  changes,
  windowDays,
  projectId,
}: {
  changes: ChangePoint[];
  windowDays: number | null;
  projectId?: string;
}) {
  const withChanges = changes.filter((c) => c.mode !== 'snapshot');
  const busiest = Math.max(1, ...withChanges.map((c) => c.changesFound));
  const totalChanges = withChanges.reduce((n, c) => n + c.changesFound, 0);

  return (
    <section className="mt-5 rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Content changes</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Tracked per site (whole-site crawl) · {windowLabel(windowDays)}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-300">{changes.length}</span> run
          {changes.length === 1 ? '' : 's'} ·{' '}
          <span className="font-semibold text-slate-300">{totalChanges}</span> change
          {totalChanges === 1 ? '' : 's'}
        </p>
      </div>

      <ol className="mt-4 space-y-1.5">
        {changes.map((c, i) => (
          <ChangeRow key={`${c.site}-${c.checkedAt}-${i}`} c={c} busiest={busiest} projectId={projectId} />
        ))}
      </ol>
    </section>
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
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">{internal ? 'Internal dashboard · team view' : 'Live status'}</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-100">{data.name}</h1>
          {internal && (
            <p className="mt-1.5 text-xs text-slate-500">
              {monitors} monitored service{monitors === 1 ? '' : 's'}
              {data.contact ? <> · notify <span className="text-slate-400">{data.contact}</span></> : null}
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
        <span className="hidden text-xs text-slate-500 sm:block">updated {rel(data.generatedAt)}</span>
      </div>

      <div className="mt-5 space-y-4">
        {data.sites.length === 0 ? (
          <div className="rounded-2xl bg-slate-900/60 p-8 text-center ring-1 ring-slate-800"><p className="text-sm text-slate-500">No monitored services yet.</p></div>
        ) : (
          data.sites.map((s, i) => <SiteCard key={`${s.host}-${i}`} s={s} windowDays={data.windowDays} />)
        )}
      </div>

      {/* Internal-only: never rendered on the public client page. */}
      {internal && data.changes && data.changes.length > 0 && (
        <ChangeTimeline changes={data.changes} windowDays={data.windowDays} projectId={projectId} />
      )}

      <p className="mt-6 text-center text-[11px] text-slate-600">Uptime over {windowLabel(data.windowDays)} · updated {rel(data.generatedAt)} · refreshes automatically</p>
    </>
  );
}
