/**
 * The Slack message for an in-app bug report.
 *
 * Lives here rather than inline in the route so it can be tested. A route file
 * may only export HTTP handlers, and a payload nobody can assert on is how this
 * one shipped for months missing the field below.
 */

export interface BugReportMessageInput {
  name: string | null;
  email: string | null;
  message: string;
  page: string | null;
  reporter: string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Slack caps a section at 3000 characters; stay well under. */
const MAX_MESSAGE = 2800;
/** How much of the report to put in the notification line. */
const MAX_PREVIEW = 90;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * The one-line notification fallback.
 *
 * Slack shows the top-level `text` in OS notifications and in unopened
 * previews. A payload with only `attachments` has nothing to show there, so it
 * renders "[no preview available]" — which is what a bug report looked like on
 * a phone until now: a notification that tells you something arrived and
 * nothing about what.
 *
 * FR-52 fixed exactly this for monitor alerts and never reached this route,
 * because the two build their payloads separately and nothing asserted on
 * either. So the line says WHO reported and the opening of WHAT they said,
 * which is usually enough to judge whether it needs looking at now.
 *
 * Deliberately NOT escaped: this is a plain-text notification line, not mrkdwn,
 * and escaping it would print "&amp;" in the preview.
 */
function previewLine(r: BugReportMessageInput): string {
  const who = r.name?.trim() || r.email?.trim() || r.reporter?.trim() || 'someone';
  const what = r.message.trim().replace(/\s+/g, ' ');
  const line = `🐞 Bug report from ${who}${what ? ` — ${what}` : ''}`;
  return truncate(line, MAX_PREVIEW + who.length);
}

export function buildBugReportPayload(r: BugReportMessageInput) {
  const message = esc(r.message).slice(0, MAX_MESSAGE);

  return {
    // Never empty — see previewLine.
    text: previewLine(r),
    attachments: [
      {
        color: '#dc2626', // red bar
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'New bug report', emoji: false } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Name*\n${r.name ? esc(r.name) : '—'}` },
              { type: 'mrkdwn', text: `*Email*\n${r.email ? esc(r.email) : '—'}` },
            ],
          },
          { type: 'section', text: { type: 'mrkdwn', text: `*Message*\n${message}` } },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Page: ${r.page ? esc(r.page) : 'n/a'}${r.reporter ? `  ·  signed in as ${esc(r.reporter)}` : ''}`,
              },
            ],
          },
        ],
      },
    ],
  };
}
