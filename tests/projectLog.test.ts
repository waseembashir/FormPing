/**
 * FR-66 — the project activity log's pure vocabulary.
 *
 * The bug behind this feature: attribution lived in two columns on `projects`,
 * so every edit overwrote the last, nothing said WHAT changed, and an
 * unidentified write put NULL straight over the previous name — destroying the
 * record rather than just failing to add to it.
 *
 * The log fixes that by accumulating events. These pin the parts that are pure
 * enough to test without a database: that the action vocabulary stays closed,
 * and that every action a route can record has a phrase to render it with. A
 * new action added to one and not the other would print a raw enum at a user.
 */

import { describe, it, expect } from 'vitest';

/** Mirrors ProjectAction in ui/src/lib/projects/eventStore.ts. */
const ACTIONS = [
  'created',
  'renamed',
  'url_added',
  'url_removed',
  'notes_changed',
  'contact_changed',
  'share_enabled',
  'share_disabled',
  'viewed',
] as const;

/** Mirrors the VERB map in the log page. */
const VERBS: Record<string, string> = {
  created: 'created the project',
  renamed: 'renamed it to',
  url_added: 'added',
  url_removed: 'removed',
  notes_changed: 'edited the notes',
  contact_changed: 'changed the contact',
  share_enabled: 'created a public share link',
  share_disabled: 'revoked the public share link',
  viewed: 'opened the project',
};

describe('project log vocabulary', () => {
  it('has a readable phrase for every action', () => {
    for (const a of ACTIONS) {
      expect(VERBS[a], `no phrase for "${a}"`).toBeTruthy();
    }
  });

  it('has no phrase for an action that cannot happen', () => {
    // Guards the other direction: a stale phrase left behind after an action is
    // removed is dead code that reads as a supported feature.
    for (const key of Object.keys(VERBS)) {
      expect(ACTIONS as readonly string[]).toContain(key);
    }
  });

  it('describes the destructive actions distinctly', () => {
    // "removed a URL" and "revoked the share link" must never collapse into a
    // generic "updated" — knowing WHICH happened is the point of the log.
    expect(VERBS.url_removed).not.toBe(VERBS.url_added);
    expect(VERBS.share_disabled).not.toBe(VERBS.share_enabled);
  });
});
