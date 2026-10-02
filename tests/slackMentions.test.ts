/**
 * FR-55 — resolving a monitor's owner into a Slack @mention.
 *
 * Almost every test here is a failure path, and that is the point. The happy
 * path has one shape; the ways this can go wrong are many, and each of them
 * sits directly in front of an alert somebody is waiting for:
 *
 *   no bot token · revoked token · missing scope · address Slack has never
 *   seen · person not in the channel · Slack slow · Slack down · database
 *   unreachable · monitor with no owner at all
 *
 * The rule is the same for all of them: answer `null`, meaning "post the alert
 * without a mention". An alert that arrives unmentioned is a small loss. An
 * alert that does not arrive, because building a mention threw, is the exact
 * failure this feature exists to prevent — and it would happen on the alert
 * that mattered, since outages are when lookups fail too.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const db = vi.hoisted(() => ({
  cached: null as string | null,
  readError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase', () => {
  const builder: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'maybeSingle') {
          return () =>
            Promise.resolve({
              data: db.readError ? null : { slack_user_id: db.cached },
              error: db.readError,
            });
        }
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
        }
        return () => builder;
      },
    },
  );
  return { supabaseAdmin: () => builder, supabaseEnabled: () => true, supabaseSchema: () => 'dev' };
});

const OWNER = 'owner@example.com';
const originalToken = process.env.SLACK_BOT_TOKEN;
const originalChannel = process.env.SLACK_ALERT_CHANNEL_ID;

/** Slack's Web API answers with HTTP 200 and `ok: false` on failure. */
function slackReplies(bodies: Record<string, unknown>[]) {
  const queue = [...bodies];
  vi.stubGlobal('fetch', vi.fn(async () =>
    ({ ok: true, json: async () => queue.shift() ?? { ok: false, error: 'exhausted' } }) as unknown as Response,
  ));
}

beforeEach(() => {
  db.cached = null;
  db.readError = null;
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  delete process.env.SLACK_ALERT_CHANNEL_ID;
  vi.restoreAllMocks();
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = originalToken;
  if (originalChannel === undefined) delete process.env.SLACK_ALERT_CHANNEL_ID;
  else process.env.SLACK_ALERT_CHANNEL_ID = originalChannel;
  vi.unstubAllGlobals();
});

describe('when there is nobody to mention', () => {
  it('returns null for a monitor with no owner', async () => {
    // Legacy monitors predate FR-74 and nobody can be named for them. They must
    // still alert — unowned is not the same as unimportant.
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(undefined)).toBeNull();
    expect(await mentionFor(null)).toBeNull();
    expect(await mentionFor('   ')).toBeNull();
  });

  it('returns null when no bot token is configured', async () => {
    // The state every environment is in until somebody sets it up, production
    // included on the deploy that first ships this.
    delete process.env.SLACK_BOT_TOKEN;
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBeNull();
  });
});

describe('when Slack refuses the lookup', () => {
  it('returns null on a revoked token', async () => {
    // Slack reports this with HTTP 200 and ok:false, so a naive check of
    // res.ok would sail past it and then read undefined as a user id.
    slackReplies([{ ok: false, error: 'invalid_auth' }]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBeNull();
  });

  it('returns null when the scope was removed', async () => {
    slackReplies([{ ok: false, error: 'missing_scope' }]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBeNull();
  });

  it('returns null for an address Slack has never seen', async () => {
    // Real and expected: somebody's Slack account can use a different address
    // from their Google one. They still get the alert, just unmentioned.
    slackReplies([{ ok: false, error: 'users_not_found' }]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBeNull();
  });

  it('returns null when Slack is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBeNull();
  });

  it('returns null rather than hanging when Slack is slow', async () => {
    // The mention sits in front of an alert somebody is waiting for, so a slow
    // lookup must not become a slow alert.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('The operation was aborted due to timeout'); }));
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBeNull();
  });
});

describe('when it works', () => {
  it('builds the mention Slack will deliver', async () => {
    slackReplies([{ ok: true, user: { id: 'U12345' } }]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBe('<@U12345>');
  });

  it('uses the cached id without asking Slack at all', async () => {
    // The cache is not only a saving. A cached id keeps mentioning correctly
    // while the token is revoked or Slack is down — which is exactly when
    // something else is likely to be going wrong too.
    db.cached = 'UCACHED';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBe('<@UCACHED>');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still resolves when the cache cannot be read', async () => {
    db.readError = { message: 'connection reset' };
    slackReplies([{ ok: true, user: { id: 'U999' } }]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBe('<@U999>');
  });
});

describe('channel membership', () => {
  it('does not mention somebody who has left the channel', async () => {
    // A ping nobody sees, on an alert that needed attention.
    process.env.SLACK_ALERT_CHANNEL_ID = 'C123';
    slackReplies([
      { ok: true, user: { id: 'U12345' } },
      { ok: true, members: ['UOTHER'] },
    ]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBeNull();
  });

  it('mentions somebody who is in the channel', async () => {
    process.env.SLACK_ALERT_CHANNEL_ID = 'C123';
    slackReplies([
      { ok: true, user: { id: 'U12345' } },
      { ok: true, members: ['UOTHER', 'U12345'] },
    ]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBe('<@U12345>');
  });

  it('mentions anyway when no channel is configured to check against', async () => {
    // Deliberate: without a channel the question has no answer, and refusing to
    // mention on an unanswerable question would let one missing config value
    // silently switch the whole feature off.
    slackReplies([{ ok: true, user: { id: 'U12345' } }]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBe('<@U12345>');
  });

  it('mentions anyway when the membership check itself fails', async () => {
    process.env.SLACK_ALERT_CHANNEL_ID = 'C123';
    slackReplies([
      { ok: true, user: { id: 'U12345' } },
      { ok: false, error: 'channel_not_found' },
    ]);
    const { mentionFor } = await import('@/lib/alerts/slackMentions');
    expect(await mentionFor(OWNER)).toBe('<@U12345>');
  });
});
