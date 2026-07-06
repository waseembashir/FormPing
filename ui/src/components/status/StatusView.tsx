'use client';

import type { ClientStatus, OverallStatus, RespPoint, StatusSite, UptimeDay } from '@/lib/status/types';

/** StatusView accepts the public payload or the internal one (which adds an
 *  optional per-project contact + per-site `tech`). */
type StatusData = ClientStatus & { contact?: string | null };

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

function modeLabel(mode: string | null | undefined): string {
  return mode === 'live'
    ? 'Live'
    : mode === 'detect-only'
      ? 'Detect only'
      : mode === 'safe'
        ? 'Safe mode'
        : (mode ?? '—');
}

/** One key/value line in the internal "Technical details" block. */
function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 min-w-0">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-slate-300 text-right truncate tabular-nums">{v}</span>
    </div>
  );
}

// ── icons ────────────────────────────────────────────────────────────────────
function Icon({ path, className = 'w-4 h-4' }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path fillRule="evenodd" d={path} clipRule="evenodd" />
    </svg>
  );
}
const P = {
  check: 'M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z',
  shield: 'M9.6 1.8a1 1 0 01.8 0l6 2.5A1 1 0 0117 5.2V9c0 4.6-3 7.9-6.6 9.2a1 1 0 01-.7 0C6 16.9 3 13.6 3 9V5.2a1 1 0 01.6-.9l6-2.5zm3.1 6.5a1 1 0 00-1.4-1.4L9 9.2 7.9 8.1a1 1 0 10-1.4 1.4l1.8 1.8a1 1 0 001.4 0l3-3z',
  alert: 'M8.3 2.9a2 2 0 013.4 0l6.1 10.6A2 2 0 0116.1 17H3.9a2 2 0 01-1.7-3l6.1-10.6zM10 7a1 1 0 00-1 1v3a1 1 0 002 0V8a1 1 0 00-1-1zm0 7.5a1 1 0 100-2 1 1 0 000 2z',
};

// ── overall banner styling (dark, matches FormPing) ──────────────────────────
const OVERALL: Record<OverallStatus, { label: string; dot: string; text: string; card: string }> = {
  operational: {
    label: 'All systems operational',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    card: 'bg-emerald-950/30 ring-emerald-500/30',
  },
  degraded: {
    label: 'Some systems degraded',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    card: 'bg-amber-950/30 ring-amber-500/30',
  },
  down: {
    label: 'Outage detected',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
    card: 'bg-rose-950/30 ring-rose-500/30',
  },
};

function StatePill({ state }: { state: StatusSite['state'] }) {
  const map = {
    up: { t: 'Operational', c: 'text-emerald-300 bg-emerald-950/40 ring-emerald-500/20' },
    down: { t: 'Down', c: 'text-rose-300 bg-rose-950/40 ring-rose-500/20' },
    blocked: { t: 'Unknown', c: 'text-slate-400 bg-slate-800/60 ring-slate-600/30' },
    unknown: { t: 'Monitored', c: 'text-slate-400 bg-slate-800/60 ring-slate-600/30' },
  }[state];
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ${map.c}`}>{map.t}</span>;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-800/40 ring-1 ring-slate-700/50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-100 tabular-nums leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function UptimeBar({ days }: { days: UptimeDay[] }) {
  const color = (p: number | null) => {
    if (p == null) return 'bg-slate-800';
    if (p >= 99.9) return 'bg-emerald-500';
    if (p >= 95) return 'bg-amber-400';
    return 'bg-rose-500';
  };
  return (
    <div>
      <div className="flex items-end gap-[3px] h-9">
        {days.map((d) => (
          <div
            key={d.date}
            className={`flex-1 h-full rounded-[2px] ${color(d.pct)} transition-colors`}
            title={`${d.date}: ${d.pct == null ? 'no data' : `${d.pct}% uptime`}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-600">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    ['bg-emerald-500', 'Operational'],
    ['bg-amber-400', 'Partial'],
    ['bg-rose-500', 'Down'],
    ['bg-slate-800', 'No data'],
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
      {items.map(([c, t]) => (
        <span key={t} className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className={`w-2.5 h-2.5 rounded-[2px] ${c}`} />
          {t}
        </span>
      ))}
    </div>
  );
}

/** Lightweight self-contained SVG response-time trend (no external libs). */
function TrendChart({ points }: { points: RespPoint[] }) {
  const pts = points
    .map((p, i) => ({ i, ms: p.ms }))
    .filter((p): p is { i: number; ms: number } => p.ms != null);

  if (pts.length < 2) {
    return (
      <div className="h-14 flex items-center justify-center rounded-xl bg-slate-800/30 ring-1 ring-slate-700/50">
        <p className="text-[11px] text-slate-500">Building trend — needs a bit more history.</p>
      </div>
    );
  }

  const xMax = points.length - 1;
  const values = pts.map((p) => p.ms);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 100;
  const H = 32;
  const coord = (p: { i: number; ms: number }): [number, number] => [
    (p.i / xMax) * W,
    H - ((p.ms - min) / range) * H,
  ];
  const line = pts.map(coord).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const [fx] = coord(pts[0]!);
  const [lx] = coord(pts[pts.length - 1]!);
  const area = `M ${fx.toFixed(2)},${H} L ${line.replace(/ /g, ' L ')} L ${lx.toFixed(2)},${H} Z`;

  return (
    <div className="rounded-xl bg-slate-800/30 ring-1 ring-slate-700/50 px-3 pt-2 pb-1">
      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
        <span>slowest {max}ms</span>
        <span>fastest {min}ms</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-12" aria-hidden>
        <defs>
          <linearGradient id="respFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#818cf8" stopOpacity="0.35" />
            <stop offset="1" stopColor="#818cf8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#respFill)" />
        <polyline
          points={line}
          fill="none"
          stroke="#818cf8"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function Badge({ ok, icon, children }: { ok: boolean; icon: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ${
        ok
          ? 'text-emerald-300 bg-emerald-950/30 ring-emerald-500/20'
          : 'text-amber-300 bg-amber-950/30 ring-amber-500/20'
      }`}
    >
      <Icon path={icon} className="w-3.5 h-3.5" />
      {children}
    </span>
  );
}

function SiteCard({ s }: { s: StatusSite }) {
  const uptimeMonitored = s.intervalMs != null;
  const hasUptimeData = s.dailyUptime.some((d) => d.pct != null);
  const uptime30 = s.uptime.d30 ?? s.uptime.d7 ?? s.uptime.d1;

  const ssl = s.ssl;
  const sslOk = ssl ? ssl.valid && (ssl.daysRemaining == null || ssl.daysRemaining > 14) : true;

  return (
    <div className="rounded-2xl bg-slate-900/60 ring-1 ring-slate-800 p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="min-w-0 flex items-center gap-2.5">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              s.state === 'up' ? 'bg-emerald-400' : s.state === 'down' ? 'bg-rose-400' : 'bg-slate-600'
            }`}
          />
          <span className="font-semibold text-slate-100 truncate">{s.host}</span>
        </div>
        <StatePill state={s.state} />
      </div>

      {uptimeMonitored ? (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <StatTile label="Uptime" value={pct(uptime30)} sub="last 30 days" />
            <StatTile label="Response" value={s.avgResponseMs != null ? `${s.avgResponseMs}ms` : '—'} sub="avg · 7d" />
            <StatTile label="Checked" value={cadence(s.intervalMs)?.replace('every ', '') ?? '—'} sub="frequency" />
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-400">Uptime history</span>
              <div className="flex items-center gap-3 text-[11px] tabular-nums text-slate-500">
                <span>24h <span className="text-slate-200 font-medium">{pct(s.uptime.d1)}</span></span>
                <span>7d <span className="text-slate-200 font-medium">{pct(s.uptime.d7)}</span></span>
              </div>
            </div>
            {hasUptimeData ? (
              <>
                <UptimeBar days={s.dailyUptime} />
                <Legend />
              </>
            ) : (
              <div className="h-9 flex items-center rounded-xl bg-slate-800/30 ring-1 ring-slate-700/50 px-3">
                <p className="text-[11px] text-slate-500">Monitoring just started — history fills in over time.</p>
              </div>
            )}
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-400">Response time</span>
            <div className="mt-1.5">
              <TrendChart points={s.responseTrend} />
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400 mb-4">Contact-form monitoring for this page.</p>
      )}

      {(s.formWorking != null || ssl) && (
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-800">
          {s.formWorking != null && (
            <Badge ok={s.formWorking} icon={s.formWorking ? P.check : P.alert}>
              {s.formWorking ? 'Contact form working' : 'Contact form needs attention'}
            </Badge>
          )}
          {ssl && (
            <Badge ok={sslOk} icon={P.shield}>
              {!ssl.valid
                ? 'SSL expired'
                : ssl.daysRemaining != null && ssl.daysRemaining <= 30
                  ? `SSL renews in ${ssl.daysRemaining}d`
                  : 'SSL valid'}
            </Badge>
          )}
        </div>
      )}

      {/* Internal-only technical detail (never present on the public payload). */}
      {s.tech && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Technical details
          </p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
            <Detail
              k="URL"
              v={
                <a
                  href={s.tech.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-300 hover:text-indigo-300 truncate"
                  title={s.tech.url}
                >
                  {s.tech.url.replace(/^https?:\/\//, '')}
                </a>
              }
            />
            <Detail k="HTTP status" v={s.tech.statusCode ?? '—'} />
            <Detail k="Last response" v={s.tech.lastResponseMs != null ? `${s.tech.lastResponseMs}ms` : '—'} />
            <Detail k="Last checked" v={rel(s.tech.lastCheckedAt)} />
            <Detail
              k="Domain expiry"
              v={s.tech.domainDaysRemaining != null ? `${s.tech.domainDaysRemaining}d` : '—'}
            />
            {s.tech.form && (
              <Detail
                k="Form test"
                v={`${modeLabel(s.tech.form.mode)}${s.tech.form.label ? ` · ${s.tech.form.label}` : ''}`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shared presentation for a client's status snapshot — used by BOTH the public
 * page (/status/[token]) and the internal, auth-gated page
 * (/projects/[id]/status). Pure render from `data`; each caller handles its own
 * fetch + loading/not-found states.
 *
 * `internal` slightly changes the eyebrow copy so the team view reads as
 * "Internal status" rather than the client-facing "Live status".
 */
export function StatusView({ data, internal = false }: { data: StatusData; internal?: boolean }) {
  const o = OVERALL[data.overall];
  const monitors = data.sites.length;
  return (
    <>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
          {internal ? 'Internal status · team view' : 'Live status'}
        </p>
        <h1 className="text-3xl font-bold text-slate-100 mt-1">{data.name}</h1>
        {internal && (
          <p className="text-xs text-slate-500 mt-1.5">
            {monitors} monitored service{monitors === 1 ? '' : 's'}
            {data.contact ? <> · notify <span className="text-slate-400">{data.contact}</span></> : null}
          </p>
        )}
      </div>

      <div className={`rounded-2xl ring-1 px-5 py-4 flex items-center justify-between gap-3 ${o.card}`}>
        <div className="flex items-center gap-3">
          <span className="relative flex h-3.5 w-3.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-50 ${o.dot}`} />
            <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${o.dot}`} />
          </span>
          <span className={`text-base font-semibold ${o.text}`}>{o.label}</span>
        </div>
        <span className="text-xs text-slate-500 hidden sm:block">updated {rel(data.generatedAt)}</span>
      </div>

      <div className="mt-5 space-y-4">
        {data.sites.length === 0 ? (
          <div className="rounded-2xl bg-slate-900/60 ring-1 ring-slate-800 p-8 text-center">
            <p className="text-sm text-slate-500">No monitored services yet.</p>
          </div>
        ) : (
          data.sites.map((s, i) => <SiteCard key={`${s.host}-${i}`} s={s} />)
        )}
      </div>

      <p className="text-[11px] text-slate-600 mt-6 text-center">
        Uptime &amp; response over the last {data.windowDays} days · updated {rel(data.generatedAt)} · refreshes
        automatically
      </p>
    </>
  );
}
