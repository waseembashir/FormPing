'use client';

import Link from 'next/link';
import type { ProjectWithRollup } from '@/lib/projects/types';
import {
  overallStatus,
  Monogram,
  StatusPill,
  StatusDot,
  FORM_TONE,
  UP_TONE,
  UP_LABEL,
  TONE_EDGE,
  TONE_TEXT,
  sslText,
} from './uiKit';

function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const FORM_WORD: Record<string, string> = {
  healthy: 'Healthy',
  attention: 'Attention',
  failing: 'Failing',
  pending: 'Pending',
};

/** One client, as a card. Clicking opens the full-screen detail at /projects/[id].
 *  Actively-monitored clients read solid + colour-edged; dormant ones (no live
 *  monitor — only a last result, or nothing) are muted + dashed, so the two are
 *  distinguishable at a glance. `index` staggers the entrance animation. */
export function ProjectCard({ project, index = 0 }: { project: ProjectWithRollup; index?: number }) {
  const r = project.rollup;
  const st = overallStatus(r);
  const dormant = !r.monitored;
  const formTone = r.formLevel ? FORM_TONE[r.formLevel] : 'slate';
  const upTone = r.upState ? UP_TONE[r.upState] : 'slate';
  const ssl = sslText(r.sslSoonest);
  const count = project.urls.length;

  return (
    <Link
      href={`/projects/${project.id}`}
      style={{ animationDelay: `${Math.min(index, 11) * 40}ms` }}
      className={`fp-rise group relative block overflow-hidden rounded-xl border shadow-sm transition-all hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${
        dormant
          ? 'border-dashed border-slate-800 bg-slate-900/40 hover:border-slate-700'
          : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
      }`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${dormant ? 'bg-slate-700/60' : TONE_EDGE[st.tone]}`}
        aria-hidden
      />

      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <Monogram name={project.name} tone={st.tone} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{project.name}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-slate-500">
            {hostOf(project.urls[0])} · {count} URL{count === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 border-t border-slate-800/70">
        <Stat k="Forms">
          {r.formLevel ? (
            <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[formTone]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${formTone === 'emerald' ? 'bg-emerald-400' : formTone === 'amber' ? 'bg-amber-400' : formTone === 'red' ? 'bg-red-400' : 'bg-slate-500'}`} />
              {FORM_WORD[r.formLevel]}
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </Stat>
        <Stat k="Uptime">
          {r.upState ? (
            <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[upTone]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${upTone === 'emerald' ? 'bg-emerald-400' : upTone === 'amber' ? 'bg-amber-400' : upTone === 'red' ? 'bg-red-400' : 'bg-slate-500'}`} />
              {UP_LABEL[r.upState]}
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </Stat>
        <Stat k="SSL" last>
          {ssl ? <span className={`tabular-nums ${ssl.c}`}>{ssl.t}</span> : <span className="text-slate-600">—</span>}
        </Stat>
      </div>

      <div className="flex items-center justify-between border-t border-slate-800/70 bg-slate-950/40 px-4 py-2.5">
        <StatusPill tone={st.tone} pulse={st.pulse}>{st.word}</StatusPill>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-300 group-hover:text-indigo-200">
          Open
          <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M7.3 5.3a1 1 0 011.4 0l4 4a1 1 0 010 1.4l-4 4a1 1 0 11-1.4-1.4L10.6 10 7.3 6.7a1 1 0 010-1.4z" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

function Stat({ k, children, last }: { k: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`px-3.5 py-2.5 ${last ? '' : 'border-r border-slate-800/70'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{k}</div>
      <div className="mt-1 text-[12.5px] font-medium">{children}</div>
    </div>
  );
}
