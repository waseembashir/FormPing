import { NextRequest, NextResponse } from 'next/server';
import { currentUser, requireRole } from '@/lib/auth/authorize';
import { buildBugReportPayload } from '@/lib/alerts/bugReportMessage';
import {
  insertBugReport,
  listBugReports,
  setBugReportStatus,
  deleteBugReport,
  type BugStatus,
} from '@/lib/bugReportStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Report {
  name: string | null;
  email: string | null;
  message: string;
  page: string | null;
  reporter: string | null;
}

/** Best-effort Slack ping so a report is seen immediately. Never throws. */
async function pingSlack(r: Report): Promise<void> {
  // Bug reports go to their OWN channel if BUG_REPORT_SLACK_WEBHOOK_URL is set;
  // otherwise they fall back to the main alerts webhook so nothing is lost.
  const webhook = process.env.BUG_REPORT_SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  const payload = buildBugReportPayload(r);
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    /* best-effort — the row is still stored */
  }
}

/**
 * POST /api/bug-reports — the footer "Report a bug" form.
 * Body: { name?, email?, message, page? }. Stores a row (durable) AND pings
 * Slack (immediate). Any signed-in user may report a bug (no role gate). The
 * middleware already ensures the caller is authenticated.
 */
export async function POST(request: NextRequest) {
  let body: { name?: unknown; email?: unknown; message?: unknown; page?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'A description is required' }, { status: 400 });

  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const actor = await currentUser(request).catch(() => null);

  const report: Report = {
    name: str(body.name, 200),
    email: str(body.email, 200),
    message: message.slice(0, 5000),
    page: str(body.page, 300),
    reporter: actor?.email ?? null,
  };

  // Durable record (best-effort — a store hiccup must not lose the Slack ping).
  try {
    await insertBugReport(report);
  } catch (err) {
    console.warn(`[bug-reports] insert failed: ${err}`);
  }

  await pingSlack(report);

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/bug-reports — the admin inbox list (FR-31). Admin+ only. Returns all
 * reports newest-first, each with its triage status + resolver stamps.
 */
export async function GET(request: NextRequest) {
  const denied = await requireRole(request, 'admin');
  if (denied) return denied;
  try {
    const reports = await listBugReports();
    return NextResponse.json({ reports });
  } catch (err) {
    console.warn(`[bug-reports] list failed: ${err}`);
    return NextResponse.json({ error: 'Could not load bug reports' }, { status: 500 });
  }
}

/**
 * PATCH /api/bug-reports — resolve or reopen a report (FR-31). Admin+ only.
 * Body: { id, status: 'open' | 'resolved' }. Resolving stamps the acting admin
 * + timestamp; reopening clears them.
 */
export async function PATCH(request: NextRequest) {
  const denied = await requireRole(request, 'admin');
  if (denied) return denied;

  let body: { id?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const status: BugStatus | null =
    body.status === 'resolved' ? 'resolved' : body.status === 'open' ? 'open' : null;
  if (!id || !status) {
    return NextResponse.json({ error: 'id and status ("open" | "resolved") are required' }, { status: 400 });
  }

  const actor = await currentUser(request).catch(() => null);
  try {
    const ok = await setBugReportStatus(id, status, status === 'resolved' ? actor?.email ?? null : null);
    if (!ok) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn(`[bug-reports] status update failed: ${err}`);
    return NextResponse.json({ error: 'Could not update the report' }, { status: 500 });
  }
}

/**
 * DELETE /api/bug-reports — hard-delete a report (FR-31). Admin+ only. These
 * are disposable (unlike monitoring data), so a real delete with a confirm.
 * Body: { id }.
 */
export async function DELETE(request: NextRequest) {
  const denied = await requireRole(request, 'admin');
  if (denied) return denied;

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const ok = await deleteBugReport(id);
    if (!ok) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn(`[bug-reports] delete failed: ${err}`);
    return NextResponse.json({ error: 'Could not delete the report' }, { status: 500 });
  }
}
