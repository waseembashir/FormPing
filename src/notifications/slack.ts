/**
 * Slack notifications for Change Monitor.
 *
 * When SLACK_WEBHOOK_URL is set, sends a Block Kit message summarizing the
 * changes detected on a given run. Used by runCompare() — fires whenever
 * a comparison surfaces changes (both watch mode and one-off compare runs).
 *
 * Setup for the user:
 *   1. In Slack, create an Incoming Webhook for the target channel:
 *      https://api.slack.com/messaging/webhooks
 *   2. Copy the webhook URL (looks like https://hooks.slack.com/services/T.../B.../...)
 *   3. Set as SLACK_WEBHOOK_URL env var on Railway (or in local .env)
 *   4. Run Change Monitor — notifications fire automatically on change.
 *
 * Notifications are best-effort: errors are logged but never thrown, so a
 * Slack outage or bad webhook won't break the monitor loop.
 */

import type { ChangeReport, PageChange, TextChange } from '../monitor/types.js';
import { logger } from '../utils/logger.js';

/** Returns true if Slack notifications are configured. */
export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_WEBHOOK_URL);
}

/**
 * Send a Slack notification for a change report. No-op when SLACK_WEBHOOK_URL
 * is not set or when the report has no changes. Errors are logged, not thrown.
 */
export async function sendSlackChangeNotification(report: ChangeReport): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return; // Not configured — silently skip

  if (report.changesFound === 0) return; // Nothing to announce

  try {
    const payload = buildSlackPayload(report);
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(`Slack notification failed: ${res.status} ${text.slice(0, 200)}`);
      return;
    }
    logger.info(
      `Slack notification sent: ${report.changesFound} change(s) on ${report.pagesChanged} page(s) of ${report.site}`,
    );
  } catch (err) {
    logger.warn(`Slack notification threw: ${err}`);
  }
}

/** Build the Block Kit JSON for the change report. */
function buildSlackPayload(report: ChangeReport): Record<string, unknown> {
  const siteLabel = `*<${report.rootUrl}|${report.site}>*`;
  const changeWord = report.changesFound === 1 ? 'change' : 'changes';
  const pageWord = report.pagesChanged === 1 ? 'page' : 'pages';
  const headerLine = `${report.changesFound} ${changeWord} detected on ${report.pagesChanged} ${pageWord} of ${siteLabel}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚨 FormPing: changes on ${report.site}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: headerLine },
    },
  ];

  // AI summary, if provided
  if (report.summary && report.summary.trim().length > 0) {
    const providerNote = report.summaryProvider ? ` _(via ${report.summaryProvider})_` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary*${providerNote}\n${truncate(report.summary, 2500)}`,
      },
    });
  }

  // Per-page detail blocks — cap at first 5 pages so we don't blow past
  // Slack's 50-block / 40KB-ish payload limits on large diffs.
  const pagesToShow = report.details.slice(0, 5);
  for (const page of pagesToShow) {
    blocks.push({ type: 'divider' });
    blocks.push(buildPageBlock(page));
  }

  if (report.details.length > pagesToShow.length) {
    const moreCount = report.details.length - pagesToShow.length;
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_+${moreCount} more page${moreCount === 1 ? '' : 's'} with changes — open FormPing for the full report._`,
        },
      ],
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Checked at ${report.checkedAt} • ${report.pagesScanned} page${report.pagesScanned === 1 ? '' : 's'} scanned`,
      },
    ],
  });

  return { blocks };
}

function buildPageBlock(page: PageChange): Record<string, unknown> {
  const severityEmoji =
    page.severity === 'high' ? '🔴' : page.severity === 'medium' ? '🟡' : '🟢';
  const pageLabel = `${severityEmoji} *<${page.url}|${shortPath(page.url)}>*`;

  const lines: string[] = [pageLabel];

  // Show up to 6 specific text changes per page; rest summarized as "+N more"
  const textChanges = page.textChanges ?? [];
  const shown = textChanges.slice(0, 6);
  for (const tc of shown) {
    lines.push(formatTextChange(tc));
  }
  if (textChanges.length > shown.length) {
    lines.push(`_+${textChanges.length - shown.length} more change(s) on this page_`);
  }

  // If no structured text changes, fall back to high-level change list
  if (textChanges.length === 0 && page.changes.length > 0) {
    for (const c of page.changes.slice(0, 6)) {
      lines.push(`• ${truncate(c, 200)}`);
    }
  }

  return {
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') },
  };
}

/** Render one text change as a single Slack-friendly line. */
function formatTextChange(tc: TextChange): string {
  const kindLabel =
    tc.kind === 'heading'
      ? tc.meta ?? 'Heading'
      : tc.kind === 'paragraph'
        ? 'Paragraph'
        : tc.kind === 'listItem'
          ? 'List item'
          : 'Text';
  const where = tc.location?.heading
    ? ` _in ${escapeSlack(tc.location.heading.slice(0, 60))}_`
    : tc.location?.section
      ? ` _in ${escapeSlack(tc.location.section.slice(0, 60))}_`
      : '';

  if (tc.type === 'added') {
    return `• ➕ *${kindLabel}*${where}: ${formatSnippet(tc.after)}`;
  }
  if (tc.type === 'removed') {
    return `• ➖ *${kindLabel}*${where}: ~${formatSnippet(tc.before)}~`;
  }
  // edited
  return `• ✏️ *${kindLabel}*${where}: ~${formatSnippet(tc.before)}~ → ${formatSnippet(tc.after)}`;
}

function formatSnippet(text: string | undefined): string {
  if (!text) return '_(empty)_';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return `"${escapeSlack(truncate(trimmed, 160))}"`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/** Escape characters that Slack mrkdwn would interpret. */
function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Pull a short path/host snippet out of a URL for the link label. */
function shortPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}
