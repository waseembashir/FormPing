/**
 * Slack channel — deliberately SMALL.
 *
 * Slack is the PING ("something happened, here's the gist"), not the record.
 * Incoming webhooks are throttled at roughly 1 message/second and can be
 * disabled if abused, so we keep each message compact and send it through the
 * guarded sender (queued, spaced, backed off, circuit-broken).
 *
 * The complete detail already lives in the app — the project dashboard renders
 * every change, page by page. So instead of the old "+39 more change(s)", which
 * silently dropped the rest, a message states how much more there is and links
 * straight to the view that shows all of it.
 */

import type { AlertInput } from '../types';
import { sendGuarded, type SendResult } from '../rateLimit';

const COLOR: Record<string, string> = {
  critical: '#dc2626',
  warning: '#f59e0b',
  info: '#10b981',
};
const EMOJI: Record<string, string> = {
  critical: '🚨',
  warning: '⚠️',
  info: '✅',
};

/** Slack hard-caps a section's text at 3000 chars; stay well under. */
const MAX_SECTION = 2600;
/** How many suggestions to show before pointing at the record. */
const MAX_SUGGESTIONS = 4;

export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_WEBHOOK_URL);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function escapeSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the message. `moreNote` is how the caller says "there is more detail
 * than fits here" — it is always rendered, so nothing is ever dropped silently.
 */
function buildMessage(alert: AlertInput, detailUrl: string | null, moreNote: string | null) {
  const sev = alert.severity ?? 'info';
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: truncate(`${EMOJI[sev] ?? 'ℹ️'} ${alert.title}`, 150), emoji: true },
    },
  ];

  const lines: string[] = [];
  if (alert.summary) lines.push(escapeSlack(alert.summary));
  if (alert.url) lines.push(`*URL:* <${alert.url}|${escapeSlack(alert.url)}>`);
  else if (alert.site) lines.push(`*Site:* ${escapeSlack(alert.site)}`);
  if (lines.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(lines.join('\n'), MAX_SECTION) } });
  }

  const suggestions = alert.suggestions ?? [];
  if (suggestions.length) {
    const shown = suggestions.slice(0, MAX_SUGGESTIONS).map((s) => `• ${escapeSlack(s)}`);
    if (suggestions.length > MAX_SUGGESTIONS) {
      shown.push(`• _…and ${suggestions.length - MAX_SUGGESTIONS} more_`);
    }
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(`*Suggested next steps:*\n${shown.join('\n')}`, MAX_SECTION) },
    });
  }

  // Never a bare "+N more" — say where the rest actually is.
  const footer: string[] = [];
  if (moreNote) footer.push(moreNote);
  footer.push(detailUrl ? `<${detailUrl}|See the full detail in FormPing>` : 'Full detail is in FormPing.');
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: truncate(footer.join(' · '), MAX_SECTION) }] });

  return { attachments: [{ color: COLOR[sev] ?? COLOR.info, blocks }] };
}

/**
 * Post one alert to Slack. No-op (reported as a skip) when the webhook isn't
 * configured. Never throws.
 */
export async function sendToSlack(
  alert: AlertInput,
  opts: { detailUrl?: string | null; moreNote?: string | null } = {},
): Promise<SendResult> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return { ok: false, note: 'skipped — SLACK_WEBHOOK_URL not set' };

  const payload = buildMessage(alert, opts.detailUrl ?? null, opts.moreNote ?? null);
  return sendGuarded('slack', () =>
    fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

/** Exported for tests — the exact payload we would post, without posting it. */
export function __buildSlackPayload(
  alert: AlertInput,
  detailUrl: string | null = null,
  moreNote: string | null = null,
) {
  return buildMessage(alert, detailUrl, moreNote);
}
