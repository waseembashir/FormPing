'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { ProjectAction, ProjectEvent } from '@/lib/projects/eventStore';
import { PageHeader, Skeleton } from '@/components/ui';
import { monogram } from '@/components/projects/uiKit';
import { useMe, canRole } from '@/lib/auth/useMe';

/**
 * FR-66 — a project's activity log: who opened it, who changed it, and when.
 *
 * Owner/Admin only. This is a record of colleagues' activity on a client's
 * project, so it sits behind the same bar as the rest of team administration.
 * The API enforces it; this page mirrors the check so a Member sees a clear
 * explanation instead of an empty screen.
 */

/**
 * How each action reads and looks.
 *
 * Colour carries the meaning, so the shape of a project's history is legible
 * before a word is read: things GAINED are ok-green, things LOST or revoked are
 * danger-red, sharing is info-sky (a real event, but not a gain or a loss), and
 * ordinary edits take the app's own accent. Views are deliberately the quietest
 * thing on the page — they are context, not activity.
 */
const VERB: Record<
  ProjectAction,
  { text: string; showTarget: boolean; dot: string; ring: string; text2: string; icon: JSX.Element }
> = {
  created: {
    text: 'created the project', showTarget: false,
    dot: 'bg-ok', ring: 'ring-ok/30', text2: 'text-ok',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M10 5v10M5 10h10" />,
  },
  url_added: {
    text: 'added', showTarget: true,
    dot: 'bg-ok', ring: 'ring-ok/30', text2: 'text-ok',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M10 5v10M5 10h10" />,
  },
  url_removed: {
    text: 'removed', showTarget: true,
    dot: 'bg-danger', ring: 'ring-danger/30', text2: 'text-danger',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M5 10h10" />,
  },
  share_disabled: {
    text: 'revoked the public share link', showTarget: false,
    dot: 'bg-danger', ring: 'ring-danger/30', text2: 'text-danger',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l8 8M14 6l-8 8" />,
  },
  share_enabled: {
    text: 'created a public share link', showTarget: false,
    dot: 'bg-info', ring: 'ring-info/30', text2: 'text-info',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 11.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.5.5M11.5 8.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l.5-.5" />,
  },
  renamed: {
    text: 'renamed it to', showTarget: true,
    dot: 'bg-accent', ring: 'ring-accent/30', text2: 'text-accent-soft',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5l2 2L7 15H5v-2l8.5-8.5z" />,
  },
  notes_changed: {
    text: 'edited the notes', showTarget: false,
    dot: 'bg-accent', ring: 'ring-accent/30', text2: 'text-accent-soft',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M6 5h8M6 9h8M6 13h5" />,
  },
  contact_changed: {
    text: 'changed the contact', showTarget: false,
    dot: 'bg-accent', ring: 'ring-accent/30', text2: 'text-accent-soft',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M10 10a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM4.5 16a5.5 5.5 0 0111 0" />,
  },
  viewed: {
    text: 'opened the project', showTarget: false,
    dot: 'bg-idle', ring: 'ring-line-strong', text2: 'text-ink-faint',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 10S5.5 5 10 5s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z" />,
  },
};

/**
 * A stable colour per person, so two people working the same project are
 * telling apart at a glance — the same name always gets the same chip, in this
 * project and every other.
 */
const ACTOR_TONES = [
  'bg-accent/15 text-accent-soft ring-accent/25',
  'bg-info/15 text-info ring-info/25',
  'bg-ok/15 text-ok ring-ok/25',
  'bg-warn/15 text-warn ring-warn/25',
  'bg-ping/15 text-ping ring-ping/25',
];
function actorTone(name: string | null): string {
  if (!name) return 'bg-panel-raised text-ink-faint ring-line-strong';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACTOR_TONES[h % ACTOR_TONES.length]!;
}

function when(iso: string): { rel: string; exact: string; clock: string } {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60000);
  const h = Math.round(diff / 3_600_000);
  const rel =
    m < 1 ? 'just now' : m < 60 ? `${m}m ago` : h < 24 ? `${h}h ago` : `${Math.round(diff / 86_400_000)}d ago`;
  return {
    rel,
    exact: d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    clock: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  };
}

/** Group by calendar day, so a long log reads as a diary rather than a list. */
function byDay(events: ProjectEvent[]): [string, ProjectEvent[]][] {
  const groups = new Map<string, ProjectEvent[]>();
  for (const e of events) {
    const day = new Date(e.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const list = groups.get(day);
    if (list) list.push(e);
    else groups.set(day, [e]);
  }
  return Array.from(groups.entries());
}

/** Views are context, not activity — they get a quieter treatment entirely. */
function isView(a: ProjectAction): boolean {
  return a === 'viewed';
}

/**
 * One point on the timeline.
 *
 * A change gets a card with a coloured spine; a VIEW gets a single quiet line.
 * Giving both the same weight was the flaw in the first pass — opening a project
 * looked exactly as significant as deleting a URL from it, so the eye couldn't
 * find the things that actually changed.
 */
function Entry({ event, last }: { event: ProjectEvent; last: boolean }) {
  const v = VERB[event.action] ?? VERB.notes_changed;
  const t = when(event.at);
  const actor = event.actor ?? 'Unknown user';
  const view = isView(event.action);

  return (
    <li className="relative flex gap-4">
      {/* The rail runs through every entry but the last, so the thread reads as
          continuous and ends cleanly instead of trailing into nothing. */}
      {!last && <span className="absolute bottom-0 left-[13px] top-8 w-px bg-line" aria-hidden />}

      <span
        className={`relative z-10 mt-1.5 flex shrink-0 items-center justify-center rounded-full bg-ground ${
          view ? 'h-[27px] w-[27px]' : `h-[27px] w-[27px] ring-1 ${v.ring}`
        }`}
      >
        {view ? (
          <span className="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden />
        ) : (
          <span className={`flex h-[19px] w-[19px] items-center justify-center rounded-full ${v.dot}/15`}>
            <svg viewBox="0 0 20 20" className={`h-3 w-3 ${v.text2}`} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              {v.icon}
            </svg>
          </span>
        )}
      </span>

      {view ? (
        // No card, no border — a line of context that the eye can skim past.
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 py-2 text-xs text-ink-faint">
          <span className="font-medium text-ink-muted">{actor}</span>
          <span>{v.text}</span>
          <span className="ml-auto shrink-0 tabular-nums" title={t.exact}>{t.clock}</span>
        </p>
      ) : (
        <div className="relative mb-3 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-line-strong">
          {/* A coloured spine, so gains and losses are separable down the page
              without reading a word. */}
          <span className={`absolute inset-y-0 left-0 w-[3px] ${v.dot}`} aria-hidden />
          <div className="py-3 pl-5 pr-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span
                className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-md px-1.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${actorTone(event.actor)}`}
                title={actor}
              >
                {monogram(actor)}
              </span>
              <span className="text-[13px] font-semibold text-ink">{actor}</span>
              <span className={`text-[13px] ${v.text2}`}>{v.text}</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-faint" title={t.exact}>
                {t.clock} · {t.rel}
              </span>
            </div>
            {v.showTarget && event.target && (
              <p className="mt-2 break-all rounded-lg bg-ground/60 px-2.5 py-1.5 font-mono text-xs text-ink-secondary">
                {event.target}
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export default function ProjectLogPage() {
  const params = useParams<{ id: string }>();
  const me = useMe();
  const [events, setEvents] = useState<ProjectEvent[] | null>(null);
  const [name, setName] = useState<string>('');
  const [denied, setDenied] = useState(false);
  // Views are useful ("who has been in here?") but they outnumber real changes,
  // so they can be folded away without leaving the page. FR-66.
  const [showViews, setShowViews] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [logRes, projRes] = await Promise.all([
        fetch(`/api/projects/${params.id}/log`),
        fetch(`/api/projects/${params.id}`),
      ]);
      if (!live) return;
      if (logRes.status === 401 || logRes.status === 403) { setDenied(true); setEvents([]); return; }
      const log = await logRes.json().catch(() => ({}));
      const proj = await projRes.json().catch(() => ({}));
      setEvents(Array.isArray(log?.events) ? log.events : []);
      setName(proj?.project?.name ?? '');
    })();
    return () => { live = false; };
  }, [params.id]);

  const allowed = canRole(me.role, 'admin');
  const all = events ?? [];
  const changeCount = all.filter((e) => !isView(e.action)).length;
  const viewCount = all.length - changeCount;
  const people = Array.from(new Set(all.map((e) => e.actor ?? 'Unknown user')));
  const shown = showViews ? all : all.filter((e) => !isView(e.action));

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
      <Link href={`/projects/${params.id}`} className="text-sm text-ink-muted transition-colors hover:text-accent-soft">
        ← Back{name ? ` to ${name}` : ' to the project'}
      </Link>

      <div className="mt-4">
        <PageHeader
          title="Activity log"
          description="Every change to this project, and who made it. Visible to owners and admins only."
        />
      </div>

      {(denied || !allowed) && events !== null ? (
        <div className="mt-6 rounded-xl border border-line bg-panel p-6">
          <p className="text-sm font-semibold text-ink">This log is for owners and admins</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            It records what your colleagues have done on this project, so it&rsquo;s kept to the people who manage the
            team. You can still open and work on the project itself.
          </p>
        </div>
      ) : events === null ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-line bg-panel/60 p-4">
              <Skeleton className="h-3.5 w-64" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-panel/40 px-8 py-14 text-center">
          <p className="text-sm font-semibold text-ink">
            {events.length === 0 ? 'Nothing recorded yet' : 'No changes yet — only visits'}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {events.length === 0
              ? 'Changes made from now on — edits, URLs added or removed, share links — appear here.'
              : 'Nobody has changed this project. Turn views back on to see who has opened it.'}
          </p>
          {events.length > 0 && (
            <button
              type="button"
              onClick={() => setShowViews(true)}
              className="mt-3 rounded-lg border border-line-strong bg-panel-raised px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors hover:border-accent/40 hover:text-accent-soft"
            >
              Show views
            </button>
          )}
        </div>
      ) : (
        <>
        {/* What this log contains, and a way to see only the things that changed. */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
          <p className="text-xs text-ink-muted">
            <span className="font-mono text-sm font-bold tabular-nums text-ink">{changeCount}</span> change
            {changeCount === 1 ? '' : 's'}
            {viewCount > 0 && (
              <>
                {' · '}
                <span className="font-mono text-sm font-bold tabular-nums text-ink-secondary">{viewCount}</span> view
                {viewCount === 1 ? '' : 's'}
              </>
            )}
            {people.length > 1 && <> · {people.length} people</>}
          </p>
          {viewCount > 0 && (
            <button
              type="button"
              onClick={() => setShowViews((v) => !v)}
              className="rounded-lg border border-line-strong bg-panel-raised px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors hover:border-accent/40 hover:text-accent-soft"
            >
              {showViews ? 'Hide views' : 'Show views'}
            </button>
          )}
        </div>

        <div className="mt-5 space-y-7">
          {byDay(shown).map(([day, list], gi, groups) => (
            <section key={day}>
              {/* The day marker sits ON the rail, so the thread reads as one
                  continuous history broken into days rather than separate lists. */}
              <div className="flex items-center gap-3">
                <span className="flex h-[27px] w-[27px] shrink-0 items-center justify-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden />
                </span>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{day}</h2>
                <span className="h-px flex-1 bg-line" aria-hidden />
              </div>
              <ul className="mt-3">
                {list.map((e, i) => (
                  <Entry key={e.id} event={e} last={gi === groups.length - 1 && i === list.length - 1} />
                ))}
              </ul>
            </section>
          ))}
        </div>
        </>
      )}
    </main>
  );
}
