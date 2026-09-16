/**
 * FR-91 — what a Slack message actually contains.
 *
 * Two things were reported: a message that named nothing useful about the form
 * it had found, and a "See the full detail in FormPing" link that opened a 404.
 *
 * `__buildSlackPayload` returns the exact payload without posting, so both can
 * be asserted here without a webhook, a network call, or a real Slack workspace.
 */

import { describe, it, expect } from 'vitest';
import { __buildSlackPayload } from '@/lib/alerts/channels/slack';
import type { AlertInput } from '@/lib/alerts/types';

const base: AlertInput = {
  kind: 'form',
  event: 'form_ok',
  severity: 'info',
  title: 'Third-party form detected — hutch.example',
  summary: 'Third-party form detected',
  site: 'hutch.example',
  url: 'https://hutch.example/contact',
  dedupeKey: 'form:s1:2026-09-09T10:00:00.000Z',
  occurredAt: '2026-09-09T10:00:00.000Z',
};

/** Every bit of text in the payload, flattened — blocks nest awkwardly. */
function textOf(payload: unknown): string {
  return JSON.stringify(payload);
}

describe('the message says what was found', () => {
  it('carries the run facts, so an embed is identified rather than merely "detected"', () => {
    const payload = __buildSlackPayload({
      ...base,
      facts: ['Typeform form (embedded)', '6 fields', 'found on /contact'],
    });
    const text = textOf(payload);

    expect(text).toContain('Typeform form (embedded)');
    expect(text).toContain('6 fields');
    expect(text).toContain('found on /contact');
  });

  it('never posts an internal reason code', () => {
    // The summary used to be built as `${label} (${reasonCode})`, so a message
    // read "Third-party form detected (THIRD_PARTY_EMBED_FORM)".
    const text = textOf(__buildSlackPayload({ ...base, facts: ['Typeform form (embedded)'] }));
    expect(text).not.toContain('THIRD_PARTY_EMBED_FORM');
    expect(text).not.toMatch(/[A-Z]{4,}_[A-Z_]{4,}/);
  });

  it('is unchanged when a sender has no facts to offer', () => {
    const payload = __buildSlackPayload(base);
    expect(textOf(payload)).toContain('Third-party form detected');
  });

  it('drops empty facts rather than rendering a dangling separator', () => {
    const text = textOf(__buildSlackPayload({ ...base, facts: ['Typeform form (embedded)', '', '  '] }));
    expect(text).not.toContain('· ·');
    expect(text).not.toContain('·  ·');
  });
});

describe('the message stays small — Slack throttles, and phones are small', () => {
  it('shows at most five facts however many it is handed', () => {
    const payload = __buildSlackPayload({
      ...base,
      facts: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'],
    });
    expect(textOf(payload)).not.toContain('seven');
  });

  it('caps the facts line even when each fact is long', () => {
    const payload = __buildSlackPayload({
      ...base,
      facts: Array.from({ length: 5 }, (_, i) => `${'x'.repeat(200)}-${i}`),
    });
    // Read the facts line itself, not the whole section: the URL sits on its own
    // line below it and would otherwise be counted against the facts budget.
    const section = payload.attachments[0]!.blocks[1] as { text: { text: string } };
    const factsLine = section.text.text.split('\n').find((l) => l.includes('x'))!;
    expect(factsLine.length).toBeLessThanOrEqual(240);
    // And the section as a whole stays far inside Slack's own 3000 limit.
    expect(section.text.text.length).toBeLessThanOrEqual(2600);
  });

  it('stays within Slack’s header limit', () => {
    const payload = __buildSlackPayload({ ...base, title: 'T'.repeat(400) });
    const header = payload.attachments[0]!.blocks[0] as { text: { text: string } };
    expect(header.text.text.length).toBeLessThanOrEqual(150);
  });
});

describe('styling never dresses a result as something it is not', () => {
  /** The attachment bar + the header emoji, which is all Slack colours. */
  function look(severity: AlertInput['severity']) {
    const payload = __buildSlackPayload({ ...base, severity });
    const attachment = payload.attachments[0]!;
    const header = attachment.blocks[0] as { text: { text: string } };
    return { color: attachment.color, header: header.text.text };
  }

  it('a detected third-party form is neither red nor a green tick', () => {
    // The complaint: an untested third-party form should not arrive looking
    // like either a failure or a confirmed success. It is sky — the same tone
    // the app has always used for "recognised, not a problem".
    const { color, header } = look('notice');
    expect(color).toBe('#38bdf8');
    expect(header.startsWith('ℹ️')).toBe(true);
    expect(color).not.toBe('#ef4444');
    expect(header).not.toContain('✅');
    expect(header).not.toContain('🚨');
  });

  it('a genuine success still reads as one', () => {
    const { color, header } = look('info');
    expect(color).toBe('#34d399');
    expect(header.startsWith('✅')).toBe(true);
  });

  it('a real failure is still loud', () => {
    expect(look('critical').color).toBe('#ef4444');
    expect(look('warning').color).toBe('#fbbf24');
  });

  it('matches the app’s own status tokens, so a card and a message agree', () => {
    // --fp-ok / --fp-warn / --fp-danger / --fp-info in ui/src/app/globals.css.
    expect(look('info').color).toBe('#34d399');
    expect(look('warning').color).toBe('#fbbf24');
    expect(look('critical').color).toBe('#ef4444');
    expect(look('notice').color).toBe('#38bdf8');
  });
});

describe('the manual-check warning', () => {
  it('stands out, and carries the reason rather than a bare instruction', () => {
    const text = textOf(
      __buildSlackPayload({
        ...base,
        severity: 'notice',
        action:
          'We could not fill or submit this form: it runs on HubSpot’s own domain, and a browser cannot submit across domains.',
      }),
    );
    expect(text).toContain('Needs a manual check');
    expect(text).toContain('HubSpot');
    expect(text).toContain('cannot submit across domains');
  });

  it('is absent when nothing is owed', () => {
    expect(textOf(__buildSlackPayload(base))).not.toContain('Needs a manual check');
  });

  it('is bounded, like every other line', () => {
    const payload = __buildSlackPayload({ ...base, action: 'y'.repeat(900) });
    const section = payload.attachments[0]!.blocks[1] as { text: { text: string } };
    const line = section.text.text.split('\n').find((l) => l.includes('y'))!;
    expect(line.length).toBeLessThanOrEqual(360);
  });
});

describe('the search scope', () => {
  it('is rendered, so a site-wide result is not read as the whole story', () => {
    const text = textOf(
      __buildSlackPayload({
        ...base,
        scope: 'Searched the whole site — there may be other forms; this is the one we judged to be the main contact form.',
      }),
    );
    expect(text).toContain('Searched the whole site');
    expect(text).toContain('may be other forms');
  });
});

describe('the "see the full detail" link', () => {
  it('is rendered when a path was resolved', () => {
    const text = textOf(
      __buildSlackPayload(base, 'https://formping.up.railway.app/projects/p1/url/aHR0cHM6Ly9o'),
    );
    expect(text).toContain('See the full detail in FormPing');
    expect(text).toContain('/projects/p1/url/aHR0cHM6Ly9o');
  });

  it('says where the detail is rather than linking nowhere', () => {
    const text = textOf(__buildSlackPayload(base, null));
    expect(text).toContain('Full detail is in FormPing.');
  });
});
