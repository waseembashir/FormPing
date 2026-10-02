/**
 * FR-52 — every Slack payload must carry a top-level `text`.
 *
 * Slack shows that field, and only that field, in OS notifications and in
 * unopened previews. A payload built from `attachments`/`blocks` alone has
 * nothing to show there, so the notification reads:
 *
 *     formping_bugs_
 *     [no preview available]
 *
 * which tells you something arrived and nothing about what. On a phone that is
 * the entire message — you have to open Slack to learn whether it mattered,
 * which defeats the point of a ping.
 *
 * FR-52 fixed this for monitor alerts. It never reached the bug-report route,
 * because the two build their payloads independently and NOTHING ASSERTED ON
 * EITHER — so the regression was invisible in code review and only showed up as
 * a blank notification on a phone, months later.
 *
 * This guards both. It is deliberately a rule about the shape of what we send,
 * not about any one message's wording, so a future payload builder is covered
 * by the same test the moment it is added here.
 */

import { describe, it, expect } from 'vitest';
import { __buildSlackPayload } from '@/lib/alerts/channels/slack';
import { buildBugReportPayload } from '@/lib/alerts/bugReportMessage';

describe('a monitor alert can be read from the notification alone', () => {
  it('carries a non-empty top-level text', () => {
    const payload = __buildSlackPayload({
      kind: 'site',
      event: 'down',
      severity: 'critical',
      title: 'example.com is down',
      site: 'example.com',
    });
    expect(payload.text).toBeTruthy();
    expect(payload.text.trim().length).toBeGreaterThan(0);
  });

  it('says what happened, not just that something did', () => {
    const payload = __buildSlackPayload({
      kind: 'site',
      event: 'down',
      severity: 'critical',
      title: 'example.com is down',
      site: 'example.com',
    });
    expect(payload.text).toContain('example.com is down');
  });
});

describe('a bug report can be read from the notification alone', () => {
  const report = {
    name: 'Tajamul',
    email: 'reporter@example.com',
    message: 'The uptime chart shows yesterday twice',
    page: '/projects',
    reporter: 'reporter@example.com',
  };

  it('carries a non-empty top-level text', () => {
    // The field whose absence produced "[no preview available]".
    const payload = buildBugReportPayload(report);
    expect(payload.text).toBeTruthy();
    expect(payload.text.trim().length).toBeGreaterThan(0);
  });

  it('names who reported it and what they said', () => {
    // Enough to judge from a phone whether it needs looking at now.
    const payload = buildBugReportPayload(report);
    expect(payload.text).toContain('Tajamul');
    expect(payload.text).toContain('uptime chart');
  });

  it('still says something when the reporter gave no name', () => {
    // The form allows an anonymous report; a nameless one must not produce a
    // preview that trails off into nothing.
    const payload = buildBugReportPayload({ ...report, name: null, email: null, reporter: null });
    expect(payload.text.trim().length).toBeGreaterThan(0);
    expect(payload.text).toContain('uptime chart');
  });

  it('stays short enough to survive a notification', () => {
    // A preview is truncated by the OS, not by Slack, so a long first line
    // simply disappears mid-sentence on a phone.
    const payload = buildBugReportPayload({ ...report, message: 'x'.repeat(5000) });
    expect(payload.text.length).toBeLessThanOrEqual(200);
  });

  it('does not HTML-escape the preview line', () => {
    // The preview is plain text, not mrkdwn. Escaping it would print "&amp;"
    // in the notification — correct for the message body, wrong here.
    const payload = buildBugReportPayload({ ...report, name: 'Ben & Co' });
    expect(payload.text).toContain('Ben & Co');
    expect(payload.text).not.toContain('&amp;');
  });
});
