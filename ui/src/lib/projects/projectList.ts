/**
 * The project list as a PICKER needs it: a name, an id, and the URLs under it.
 *
 * Four tester tabs carry a "Use a project" dropdown, and the assign-to-project
 * chooser renders on mount. All of them called GET /api/projects, which exists
 * to draw the Projects page: it reads both schedule tables, both result tables,
 * the run store, the dismissed list and the change-tracked set, derives a
 * health rollup per project and works out the whole Unassigned bucket — eight
 * store reads to produce a payload from which the picker then used three
 * fields and threw the rest away. With `cache: 'no-store'`, every open paid it
 * again.
 *
 * Two things were wrong with that, and the second is the more important one.
 *
 * It was slow: eight reads where one would do.
 *
 * And it was loose with things the picker has no business holding. A full
 * `Project` carries `shareToken` — the unguessable token that makes a client's
 * status page readable WITHOUT a session. Every picker open sent every live
 * token for every client to the browser, to render a dropdown that needs a
 * name. Also `notes` and `contact`, which are about the client rather than
 * about picking one.
 *
 * Nobody was exposed by that: the endpoint is behind the session gate, so only
 * signed-in staff ever received it. But a token that unlocks a page without
 * auth should travel when something needs it, and the picker never did. The
 * narrow shape below is the fix, and `projectListItem` is where it is enforced
 * rather than remembered.
 *
 * Pure, and deliberately so: the rule worth pinning is which fields leave the
 * server, and that should be assertable without a database.
 */

import type { Project } from './types';

/** A project as a picker renders it. Everything else is deliberately absent. */
export interface ProjectListItem {
  id: string;
  name: string;
  urls: string[];
}

/**
 * Narrow one project to what a picker needs.
 *
 * Built by naming the three fields we want, never by deleting the ones we do
 * not. A field added to `Project` later — another token, another client note —
 * is then absent from here by default and has to be added on purpose. The
 * opposite spelling, spreading the project and deleting known-sensitive keys,
 * leaks every field nobody thought of at the time.
 */
export function projectListItem(p: Project): ProjectListItem {
  return { id: p.id, name: p.name, urls: p.urls };
}

/**
 * The whole list, narrowed and ordered for reading.
 *
 * Alphabetical, which the Projects page is not — it sorts worst-health-first,
 * so the thing most needing attention is at the top. That ordering is the point
 * of that page and meaningless in a picker, where nothing is being triaged and
 * the reader already knows the name they are looking for. A list that reorders
 * itself as monitors change state is also a list you cannot learn the shape of.
 *
 * Case-insensitive, or "Zenith" would sort above "acme".
 */
export function projectList(projects: Project[]): ProjectListItem[] {
  return projects
    .map(projectListItem)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
