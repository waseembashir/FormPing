'use client';

import Link from 'next/link';
import type { ProjectWithRollup } from '@/lib/projects/types';
import { Attribution } from './Attribution';
import {
  overallStatus,
  Monogram,
  StatusPill,
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
  detected: 'Detected',
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
      className={`fp-rise group relative block overflow-hidden rounded-xl border shadow-sm transition-all hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        dormant
          ? 'border-dashed border-line bg-panel/40 hover:border-line-strong'
          : 'border-line bg-panel/70 hover:border-line-strong'
      }`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${dormant ? 'bg-line-strong/60' : TONE_EDGE[st.tone]}`}
        aria-hidden
      />

      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <Monogram name={project.name} tone={st.tone} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{project.name}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-ink-faint">
            {hostOf(project.urls[0])} · {count} URL{count === 1 ? '' : 's'}
          </div>
          <Attribution project={project} className="mt-1 text-[11px] text-ink-faint" />
        </div>
      </div>

      <div className="grid grid-cols-3 border-t border-line/70">
        <Stat k="Forms">
          {r.formLevel ? (
            <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[formTone]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${formTone === 'emerald' ? 'bg-ok' : formTone === 'amber' ? 'bg-warn' : formTone === 'red' ? 'bg-danger' : 'bg-idle'}`} />
              {FORM_WORD[r.formLevel]}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Stat>
        <Stat k="Uptime">
          {r.upState ? (
            <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[upTone]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${upTone === 'emerald' ? 'bg-ok' : upTone === 'amber' ? 'bg-warn' : upTone === 'red' ? 'bg-danger' : 'bg-idle'}`} />
              {UP_LABEL[r.upState]}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Stat>
        <Stat k="SSL" last>
          {ssl ? <span className={`tabular-nums ${ssl.c}`}>{ssl.t}</span> : <span className="text-ink-faint">—</span>}
        </Stat>
      </div>

      <div className="flex items-center justify-between border-t border-line/70 bg-ground/40 px-5 py-3">
        <StatusPill tone={st.tone} pulse={st.pulse}>{st.word}</StatusPill>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent group-hover:text-accent-soft">
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
    <div className={`px-4 py-3 ${last ? '' : 'border-r border-line/70'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{k}</div>
      <div className="mt-1 text-[12.5px] font-medium">{children}</div>
    </div>
  );
}
