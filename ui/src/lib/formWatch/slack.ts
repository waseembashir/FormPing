/**
 * Slack notifications for Form Watch runs.
 *
 * Reuses the same SLACK_WEBHOOK_URL the monitor uses, but is a separate sender
 * with its own message format — it does not import or modify the existing
 * monitor Slack module. Best-effort: a Slack outage never breaks a run.
 *
 * Fires on EVERY run (success and failure) as requested, so the dev gets a
 * positive "submitted OK" ping as well as failure alerts. The message always
 * includes the URL so the dev can jump straight to the form.
 */

import type { FormSchedule, FormRunRecord } from './types';

export interface FormNotification {
  schedule: FormSchedule;
  record: FormRunRecord;
  changes: string[];
  suggestions: string[];
  regression: boolean;
}

const STATUS_EMOJI: Record<string, string> = {
  pass: '✅',
  warn: '🟡',
  fail: '🔴',
  error: '⛔',
};

export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_WEBHOOK_URL);
}

export async function sendFormSlack(n: FormNotification): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return; // not configured — silently skip

  try {
    const payload = buildPayload(n);
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[formWatch/slack] notification failed: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[formWatch/slack] notification threw: ${err}`);
  }
}

function buildPayload(n: FormNotification): Record<string, unknown> {
  const { record, changes, suggestions, regression } = n;
  const emoji = STATUS_EMOJI[record.status] ?? '•';
  const ok = record.status === 'pass';

  const headline = ok
    ? `Form submitted successfully — ${record.site}`
    : `Form check ${record.status.toUpperCase()} — ${record.site}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} FormPing: ${headline}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*URL:* <${record.url}|${record.url}>\n` +
          `*Status:* ${record.status} (\`${record.reasonCode}\`)\n` +
          `*Submission:* ${record.submissionResult}`,
      },
    },
  ];

  if (regression) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '⚠️ *Regression:* health is worse than the previous check.' },
    });
  }

  if (changes.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Changes since last check:*\n${changes.map((c) => `• ${c}`).join('\n')}` },
    });
  }

  if (suggestions.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Suggestions:*\n${suggestions.map((s) => `• ${s}`).join('\n')}` },
    });
  }

  if (record.errors.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Errors:* ${record.errors.slice(0, 3).join('; ').slice(0, 400)}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Checked at ${record.ranAt} • ${Math.round(record.durationMs / 1000)}s` }],
  });

  return { blocks };
}
