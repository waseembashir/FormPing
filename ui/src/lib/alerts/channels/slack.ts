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

/**
 * The attachment bar, matched to the app's own status tokens so a message and a
 * card never disagree about how serious something is. `notice` is the sky tone
 * the app uses for "detected / recognised, not a problem" (--fp-info) — a
 * third-party form must not arrive wearing a green tick it did not earn. FR-91.
 */
const COLOR: Record<string, string> = {
  critical: '#ef4444',
  warning: '#fbbf24',
  notice: '#38bdf8',
  info: '#34d399',
};
const EMOJI: Record<string, string> = {
  critical: '🚨',
  warning: '⚠️',
  notice: 'ℹ️',
  info: '✅',
};

/** Slack hard-caps a section's text at 3000 chars; stay well under. */
const MAX_SECTION = 2600;
/** How many suggestions to show before pointing at the record. */
const MAX_SUGGESTIONS = 4;
/**
 * How many run facts to show, and how long that line may get.
 *
 * A channel decides how much of an alert it can carry, and Slack's answer is
 * "not much": webhooks throttle, and a notification read on a phone competes
 * with every other one. Five short facts is a glance; a paragraph is ignored.
 * The senders already order them most-useful-first, so trimming from the end
 * loses the least. FR-91.
 */
const MAX_FACTS = 5;
const MAX_FACTS_CHARS = 240;

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
  // What the run found, on its own line so the verdict above it stays scannable.
  const facts = (alert.facts ?? []).filter((f) => f && f.trim()).slice(0, MAX_FACTS);
  if (facts.length) lines.push(truncate(escapeSlack(facts.join(' · ')), MAX_FACTS_CHARS));
  // How we looked — a site-wide search reports the form it judged to be the
  // main one, which is not the same as "this is the only form". FR-91.
  if (alert.scope?.trim()) lines.push(`_${escapeSlack(truncate(alert.scope.trim(), 200))}_`);
  // What a person still has to do. Slack colours the whole attachment, not a
  // line, so the emphasis is carried by the marker and the bold lead-in — the
  // bar itself stays the honest overall severity rather than turning red for a
  // form that is merely untestable. FR-91.
  if (alert.action?.trim()) {
    lines.push(`🔴 *Needs a manual check* — ${escapeSlack(truncate(alert.action.trim(), 320))}`);
  }
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

  // Top-level `text` is Slack's NOTIFICATION FALLBACK — the line shown in OS
  // pushes and unopened previews. Without it, an attachments/blocks-only payload
  // renders "[no preview available]" (FR-52). The rich `blocks` still drive the
  // in-app card; this is just the readable one-liner for the preview, built from
  // the same emoji + title as the header (with the site appended when it isn't
  // already part of the title).
  const previewParts = [`${EMOJI[sev] ?? 'ℹ️'} ${alert.title}`];
  if (alert.site && !alert.title.includes(alert.site)) previewParts.push(alert.site);
  const text = truncate(previewParts.join(' · '), 150);

  return { text, attachments: [{ color: COLOR[sev] ?? COLOR.info, blocks }] };
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
