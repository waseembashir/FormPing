/**
 * How each tool tab gets its data — in one place, so two callers cannot
 * disagree about it.
 *
 * Every tab did this inline: fetch, pick the fields out of the JSON, defend
 * against the shapes it might not have, then hand the result to both React
 * state and `tabCache`. That was fine while the page was the only caller.
 * Prefetching gives each tab a second one, and a prefetcher that shapes the
 * payload even slightly differently writes a cache entry the page then renders
 * as if the page had built it. The bug would appear only on tabs the user
 * hovered, which is not a thing anyone would think to try.
 *
 * So the fetching and shaping live here, and the page keeps what is genuinely
 * the page's business: which state to set, and what to show when it fails.
 *
 * ## Failure is returned, never thrown
 *
 * A loader answers with `TabLoad`, and the caller decides. That matters
 * because the right answer differs per tab — Team must show a refusal as a
 * refusal, while the monitor lists should keep whatever is already on screen —
 * and because a prefetch must be able to tell "nothing to cache" from "cache
 * this", silently, with no user watching.
 *
 * ## A failed response is not an empty list
 *
 * Three of these tabs used to read `res.json()` without ever checking
 * `res.ok`. A 500 that answers with a JSON error body has no `schedules` key,
 * so the shaping turned it into `[]`, the page rendered "no monitors", and —
 * worse — wrote that empty list into `tabCache`, where it stayed until the
 * next successful refresh.
 *
 * Telling somebody their monitors are gone because a request failed is an
 * alarming and untrue thing to say about work they are paying us to watch. It
 * is the same mistake the existing `catch` branches were written to avoid;
 * they just never covered the case where the server answered politely with a
 * failure. Now a non-OK response takes the same path as a thrown one.
 */

import type { ProjectRollup, ProjectWithRollup } from '@/lib/projects/types';
import type { FormSchedule } from '@/lib/formWatch/types';
import type { SiteSchedule } from '@/lib/siteWatch/types';
import type { Role } from '@/lib/auth/roles';
import { TAB_KEYS } from '@/lib/tabCache';

/**
 * The outcome of loading a tab.
 *
 * `forbidden` is kept apart from `error` because only one of them means the
 * cache must not be consulted: a refusal has to look like a refusal, and
 * falling back to the roster somebody saw a minute ago would hide that their
 * access is gone.
 */
export type TabLoad<T> = { ok: true; data: T } | { ok: false; reason: 'forbidden' | 'error' };

/** A tab's data, and where it is remembered. Enough for anything to load it. */
export interface TabSource<T> {
  key: string;
  load(): Promise<TabLoad<T>>;
}

/** Monitors whose last run could not be stored, keyed by id. FR-87. */
type SaveFailures = Record<string, { at: string }>;

export interface Unassigned {
  urls: string[];
  rollup: ProjectRollup;
}

export interface ProjectsPayload {
  projects: ProjectWithRollup[];
  unassigned: Unassigned | null;
}

export interface SchedulesPayload<T> {
  schedules: T[];
  saveFailures: SaveFailures;
}

export interface TeamUser {
  email: string;
  role: Role;
  name: string | null;
  picture: string | null;
}

export interface TeamMe {
  email: string;
  role: Role;
}

export interface TeamPayload {
  users: TeamUser[];
  me: TeamMe | null;
}

/**
 * Fetch and parse, turning every way this can go wrong into a reason.
 *
 * A 401 or 403 is reported separately so Team can distinguish it; every other
 * non-OK status, and any thrown error or unparseable body, is an `error`. The
 * shaping is left to the caller because only it knows what the body should
 * contain.
 */
async function getJson(url: string, init?: RequestInit): Promise<TabLoad<unknown>> {
  try {
    const res = await fetch(url, init);
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'forbidden' };
    if (!res.ok) return { ok: false, reason: 'error' };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Narrow an unknown body to an array of T, or an empty one. */
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Narrow an unknown body to the save-failure map, or an empty one. */
function asSaveFailures(v: unknown): SaveFailures {
  return v && typeof v === 'object' ? (v as SaveFailures) : {};
}

/**
 * Projects, for a given search.
 *
 * The query is part of the cache key: two searches are two different answers,
 * and sharing one slot would show the results of whatever was typed last.
 */
export function projectsTab(query: string): TabSource<ProjectsPayload> {
  return {
    key: TAB_KEYS.projects(query),
    async load() {
      const res = await getJson(`/api/projects?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      if (!res.ok) return res;
      const body = res.data as { projects?: unknown; unassigned?: { urls?: unknown } } | null;
      return {
        ok: true,
        data: {
          projects: asArray<ProjectWithRollup>(body?.projects),
          unassigned:
            body?.unassigned && Array.isArray(body.unassigned.urls)
              ? (body.unassigned as unknown as Unassigned)
              : null,
        },
      };
    },
  };
}

/** The Form Scheduler's monitors. */
export function formWatchTab(): TabSource<SchedulesPayload<FormSchedule>> {
  return {
    key: TAB_KEYS.formWatch,
    async load() {
      const res = await getJson('/api/form-watch');
      if (!res.ok) return res;
      const body = res.data as { schedules?: unknown; saveFailures?: unknown } | null;
      return {
        ok: true,
        data: {
          schedules: asArray<FormSchedule>(body?.schedules),
          saveFailures: asSaveFailures(body?.saveFailures),
        },
      };
    },
  };
}

/** Uptime & SSL's monitors. Same shape as the Form Scheduler's, deliberately. */
export function siteWatchTab(): TabSource<SchedulesPayload<SiteSchedule>> {
  return {
    key: TAB_KEYS.siteWatch,
    async load() {
      const res = await getJson('/api/site-watch');
      if (!res.ok) return res;
      const body = res.data as { schedules?: unknown; saveFailures?: unknown } | null;
      return {
        ok: true,
        data: {
          schedules: asArray<SiteSchedule>(body?.schedules),
          saveFailures: asSaveFailures(body?.saveFailures),
        },
      };
    },
  };
}

/** The team roster. The one tab where a refusal is a state of its own. */
export function teamTab(): TabSource<TeamPayload> {
  return {
    key: TAB_KEYS.team,
    async load() {
      const res = await getJson('/api/users', { cache: 'no-store' });
      if (!res.ok) return res;
      const body = res.data as { users?: unknown; me?: unknown } | null;
      return {
        ok: true,
        data: {
          users: asArray<TeamUser>(body?.users),
          me: (body?.me as TeamMe | undefined) ?? null,
        },
      };
    },
  };
}
