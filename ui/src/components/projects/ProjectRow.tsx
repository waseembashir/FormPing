'use client';

import { useState } from 'react';
import type {
  FormHealthLevel,
  ProjectRollup,
  ProjectWithHealth,
  ProjectWithRollup,
  SiteUpState,
  UrlHealth,
} from '@/lib/projects/types';
import { runVerdict } from '@/lib/formWatch/verdict';

type Tone = 'emerald' | 'amber' | 'red' | 'slate';

const TONE_DOT: Record<Tone, string> = {
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

const FORM_TONE: Record<FormHealthLevel, Tone> = {
  healthy: 'emerald',
  attention: 'amber',
  failing: 'red',
  pending: 'slate',
};
const UP_TONE: Record<SiteUpState, Tone> = {
  up: 'emerald',
  down: 'red',
  blocked: 'amber',
  unknown: 'slate',
};
const UP_LABEL: Record<SiteUpState, string> = {
  up: 'Up',
  down: 'Down',
  blocked: 'Blocked',
  unknown: 'Unknown',
};

/** Animated status dot (matches the "live monitoring" indicator used elsewhere). */
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

export function overallStatus(r: ProjectRollup): { tone: Tone; word: string; pulse: boolean } {
  if (!r.monitored) return { tone: 'slate', word: 'Not monitored', pulse: false };
  if (r.severity >= 30) return { tone: 'red', word: 'Failing', pulse: true };
  if (r.severity >= 15) return { tone: 'amber', word: 'Needs attention', pulse: true };
  return { tone: 'emerald', word: 'Healthy', pulse: true };
}

function monogram(name: string): string {
  const words = name.replace(/[|/]+/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]!).join('').toUpperCase();
}
function monoTheme(r: ProjectRollup): string {
  if (!r.monitored) return 'bg-slate-700/50 ring-slate-600/40 text-slate-300';
  if (r.severity >= 30) return 'bg-rose-500/20 ring-rose-500/30 text-rose-300';
  if (r.severity >= 15) return 'bg-amber-500/20 ring-amber-500/30 text-amber-300';
  return 'bg-emerald-500/20 ring-emerald-500/30 text-emerald-300';
}

function rel(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  const h = Math.round(diff / 3_600_000);
  const d = Math.round(diff / 86_400_000);
  return d >= 1 ? `${d}d ago` : h >= 1 ? `${h}h ago` : m >= 1 ? `${m}m ago` : 'just now';
}
function sslText(days: number | null | undefined): { t: string; c: string } | null {
  if (days == null) return null;
  if (days < 0) return { t: 'expired', c: 'text-rose-300 font-semibold' };
  if (days <= 14) return { t: `${days}d left`, c: 'text-rose-300 font-semibold' };
  if (days <= 30) return { t: `${days}d`, c: 'text-amber-300' };
  return { t: `${days}d`, c: 'text-slate-300' };
}
function formatInterval(ms?: number): string {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `every ${min} min`;
  const hr = Math.round(ms / 3_600_000);
  if (hr < 48) return `every ${hr} h`;
  const d = Math.round(ms / 86_400_000);
  return `every ${d} day${d === 1 ? '' : 's'}`;
}
function modeLabel(mode?: string): string {
  return mode === 'live'
    ? 'Live'
    : mode === 'detect-only'
      ? 'Detect only'
      : mode === 'safe'
        ? 'Safe mode'
        : (mode ?? '');
}

export function ProjectRow({
  project,
  onDelete,
  onEdit,
}: {
  project: ProjectWithRollup;
  onDelete: (id: string) => Promise<void>;
  onEdit: (project: ProjectWithRollup) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ProjectWithHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const r = project.rollup;
  const st = overallStatus(r);

  async function loadDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`).then((x) => x.json());
      setDetail(res?.project ?? null);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }
  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) void loadDetail();
  }

  const ssl = sslText(r.sslSoonest);
  const formTone = r.formLevel ? FORM_TONE[r.formLevel] : 'slate';
  const upTone = r.upState ? UP_TONE[r.upState] : 'slate';

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="w-full text-left grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-slate-900/40 transition-colors"
      >
        {/* Project + animated status */}
        <div className="col-span-12 sm:col-span-4 flex items-center gap-3 min-w-0">
          <span
            className={`w-9 h-9 rounded-lg ring-1 text-[11px] font-bold flex items-center justify-center shrink-0 ${monoTheme(r)}`}
          >
            {monogram(project.name)}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100 truncate">{project.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <StatusDot tone={st.tone} pulse={st.pulse} />
              <span className={`text-[11px] font-medium ${TONE_TEXT[st.tone]}`}>{st.word}</span>
              <span className="text-[11px] text-slate-600">
                · {project.urls.length} URL{project.urls.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>

        {/* Contact form (static specifics) */}
        <div className="col-span-6 sm:col-span-3 text-xs">
          {r.formLevel ? (
            <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[formTone]}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[formTone]}`} />
              {r.formLabel}
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </div>

        {/* Uptime */}
        <div className="col-span-6 sm:col-span-2 text-xs">
          {r.upState ? (
            <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[upTone]}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[upTone]}`} />
              {UP_LABEL[r.upState]}
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </div>

        {/* SSL */}
        <div className="col-span-6 sm:col-span-2 text-xs">
          {ssl ? <span className={ssl.c}>{ssl.t}</span> : <span className="text-slate-600">—</span>}
        </div>

        {/* Checked */}
        <div className="col-span-6 sm:col-span-1 text-right text-[11px] text-slate-500">
          {rel(r.lastChecked)}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-slate-950/30 border-t border-slate-800/60">
          {loading && <p className="text-xs text-slate-500 py-2">Loading…</p>}
          {!loading && detail && (
            <div className="space-y-2">
              {project.notes && <p className="text-[11px] text-slate-500 italic">{project.notes}</p>}
              {detail.health.length === 0 && (
                <p className="text-xs text-slate-500">No URLs in this project yet.</p>
              )}
              {detail.health.map((h) => (
                <UrlDetailRow key={h.url} h={h} />
              ))}
              <div className="pt-1 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => onEdit(project)}
                  className="text-[11px] text-slate-400 hover:text-indigo-300 transition-colors"
                >
                  Edit project
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `Delete project "${project.name}"? This also stops and removes its Form Watch / Site Watch monitors.`,
                      )
                    )
                      void onDelete(project.id);
                  }}
                  className="text-[11px] text-slate-500 hover:text-red-300 transition-colors"
                >
                  Delete project
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A small uppercase chip naming WHICH tool produced a detail line, so a
 *  manager can tell at a glance what test ran. Dimmed when that tool isn't
 *  set up for the URL. */
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

export function UrlDetailRow({ h }: { h: UrlHealth }) {
  const formTone = h.form.level ? FORM_TONE[h.form.level] : 'slate';
  const upTone = h.site.upState ? UP_TONE[h.site.upState] : 'slate';
  const ssl = sslText(h.site.sslDaysRemaining);

  // Content-change tone: no changes → neutral; otherwise by severity.
  const changeCount = h.change?.changesFound ?? 0;
  const changeTone: Tone = !changeCount
    ? 'slate'
    : h.change?.severity === 'high'
      ? 'red'
      : h.change?.severity === 'medium'
        ? 'amber'
        : 'emerald';

  // Manual run: derive the SAME mode-aware verdict Form Watch uses, so a
  // safe-mode pass reads "Form healthy — filled, not submitted" (green) rather
  // than the raw engine status. Needs the persisted reasonCode + formFound.
  const runV = h.lastRun
    ? runVerdict(
        h.lastRun.reasonCode ?? '',
        h.lastRun.formFound ?? false,
        h.lastRun.finalStatus === 'error' ? 'error' : undefined,
      )
    : null;
  const runTone: Tone = runV ? FORM_TONE[runV.level] : 'slate';

  return (
    <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-3 space-y-1.5">
      <a
        href={h.url}
        target="_blank"
        rel="noreferrer"
        className="block text-xs font-medium text-slate-200 hover:text-indigo-300 truncate"
        title={h.url}
      >
        {h.url}
      </a>

      {/* Form Watch — scheduled contact-form test */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <SourceTag label="Form Watch" dim={!h.form.monitored} />
        {h.form.monitored ? (
          <>
            <StatusDot tone={formTone} pulse />
            <span className="font-medium text-slate-300">Scheduled form test · {modeLabel(h.form.mode)}</span>
            <span className={TONE_TEXT[formTone]}>— {h.form.label}</span>
            <span className="text-slate-600">
              · {formatInterval(h.form.intervalMs)} · {rel(h.form.lastRunAt ?? null)}
            </span>
          </>
        ) : (
          <span className="text-slate-600">Scheduled form test · not set up</span>
        )}
      </div>

      {/* Site Watch — scheduled uptime + SSL */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <SourceTag label="Site Watch" dim={!h.site.monitored} />
        {h.site.monitored ? (
          <>
            <StatusDot tone={upTone} pulse />
            <span className="font-medium text-slate-300">Uptime &amp; SSL</span>
            <span className={TONE_TEXT[upTone]}>
              — {h.site.upState ? UP_LABEL[h.site.upState] : 'Unknown'}
              {h.site.statusCode ? ` · ${h.site.statusCode}` : ''}
            </span>
            {ssl && (
              <span className="text-slate-500">
                · SSL <span className={ssl.c}>{ssl.t}</span>
              </span>
            )}
            <span className="text-slate-600">
              · {formatInterval(h.site.intervalMs)} · {rel(h.site.lastCheckedAt ?? null)}
            </span>
          </>
        ) : (
          <span className="text-slate-600">Uptime &amp; SSL · not set up</span>
        )}
      </div>

      {/* Change Monitor — content changes (per hostname) */}
      {h.change?.tracked && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <SourceTag label="Change Monitor" />
          <StatusDot tone={changeTone} pulse={false} />
          <span className="font-medium text-slate-300">Content changes</span>
          <span className={TONE_TEXT[changeTone]}>
            —{' '}
            {changeCount
              ? `${changeCount} change${changeCount === 1 ? '' : 's'} on ${h.change.pagesChanged} page${
                  h.change.pagesChanged === 1 ? '' : 's'
                }`
              : 'no changes last check'}
          </span>
          <span className="text-slate-600">· {rel(h.change.lastCheckedAt ?? null)}</span>
        </div>
      )}

      {/* Form Tester — last on-demand (manual) run */}
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
