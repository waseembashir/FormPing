import { NextResponse } from 'next/server';
import { projectStore } from '@/lib/projects/projectStore';
import { projectList } from '@/lib/projects/projectList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/list — every project as a picker needs it: id, name, URLs.
 *
 * Sibling to GET /api/projects, which draws the Projects page and costs eight
 * store reads to do it: both schedule tables, both result tables, the run
 * store, the dismissed list, the change-tracked set, and the projects
 * themselves — then a health rollup per project and the whole Unassigned
 * bucket. The "Use a project" dropdown on four tester tabs was calling that,
 * with `cache: 'no-store'`, and using three fields of the answer.
 *
 * This reads the project store and nothing else. It also sends only those
 * three fields, so a client's `shareToken` — which makes their status page
 * readable without a session — stops travelling to screens that never needed
 * it. See projectList.ts for why that shape is built by naming fields rather
 * than deleting them.
 *
 * Unfiltered on purpose. Projects is the shared record: every project is
 * visible to everybody, which is what lets you see a URL is already covered
 * before you add it again. Searching is the caller's business — both pickers
 * already filter as you type, over a list this small, and a round trip per
 * keystroke would be slower than the thing being fixed.
 *
 * Auth is the middleware's: everything under /api/ that is not explicitly
 * public gets a 401 without a session, so there is no gate to repeat here.
 */
export async function GET() {
  const projects = await projectStore.list();
  return NextResponse.json({ projects: projectList(projects) });
}
