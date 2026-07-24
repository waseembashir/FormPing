/**
 * Where a notification should send you for the full detail.
 *
 * Slack messages stay small deliberately, so the useful thing a message can do
 * is point at the view that already renders everything. For a URL we track, that
 * is its project dashboard — the change timeline there expands to show every
 * change, page by page (FR-21). Falling back to the relevant tool tab when the
 * URL isn't in a project yet.
 *
 * Best-effort: a lookup failure returns a sensible default rather than throwing,
 * because this runs inside an alert path that must never break a monitor run.
 */

import { projectStore, urlKey } from '@/lib/projects/projectStore';
import type { AlertKind } from './types';

/** Fallback tab per alert kind, when no project owns the URL. */
const FALLBACK: Record<AlertKind, string> = {
  change: '/monitor',
  form: '/form-watch',
  site: '/site-watch',
};

/**
 * App-relative path for "see the full detail". Returns the owning project's
 * dashboard when there is one, else the relevant tab.
 */
export async function detailPathFor(kind: AlertKind, url: string | null | undefined): Promise<string> {
  try {
    if (!url) return FALLBACK[kind];
    const key = urlKey(url);
    const projects = await projectStore.list();
    const owner = projects.find((p) => p.urls.some((u) => urlKey(u) === key));
    return owner ? `/projects/${owner.id}/status` : FALLBACK[kind];
  } catch {
    return FALLBACK[kind];
  }
}
