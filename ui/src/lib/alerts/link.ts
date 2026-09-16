/**
 * Where a notification should send you for the full detail.
 *
 * Slack messages stay small deliberately, so the useful thing a message can do
 * is point at the view that already renders everything. For a URL we track that
 * is its PER-URL dashboard: the run detail, the evidence, the form facts and the
 * change timeline all live there, so the link lands on the answer rather than a
 * page the reader has to navigate from.
 *
 * FR-91: this used to return `/projects/{id}/status`, a route that has never
 * existed — so every alert about a URL inside a project linked to a 404, across
 * all three alert kinds. The paths below are now built the same way the app's
 * own links are (matchKey + encodeUrlKey), which is what keeps them real.
 *
 * Best-effort: a lookup failure returns a sensible default rather than throwing,
 * because this runs inside an alert path that must never break a monitor run.
 */

import { matchKey, projectStore, urlKey } from '@/lib/projects/projectStore';
import { encodeUrlKey } from '@/lib/projects/urlKeyRoute';
import type { AlertKind } from './types';

/** Fallback tab per alert kind, when no project owns the URL. */
const FALLBACK: Record<AlertKind, string> = {
  change: '/monitor',
  form: '/form-watch',
  site: '/site-watch',
};

/**
 * App-relative path for "see the full detail".
 *
 * The per-URL dashboard when a project owns this URL, the project itself if the
 * URL key can't be built, and the relevant tool tab when no project owns it.
 * Every branch returns a route that exists — see the e2e that walks them.
 */
export async function detailPathFor(kind: AlertKind, url: string | null | undefined): Promise<string> {
  try {
    if (!url) return FALLBACK[kind];
    const key = urlKey(url);
    const projects = await projectStore.list();
    const owner = projects.find((p) => p.urls.some((u) => urlKey(u) === key));
    if (!owner) return FALLBACK[kind];
    // Same encoding the project page uses for its own dashboard links, so the
    // two can never drift apart.
    const segment = encodeUrlKey(matchKey(url));
    return segment ? `/projects/${owner.id}/url/${segment}` : `/projects/${owner.id}`;
  } catch {
    return FALLBACK[kind];
  }
}
