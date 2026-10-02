/**
 * Turning the person who set a monitor up into an @mention Slack will deliver.
 *
 * FR-74 gave every monitor an `owner` — the email of whoever created it. Slack
 * will not mention an email, only a user id, and `users.lookupByEmail` is the
 * only way across. This module is that crossing, and everything in it exists
 * to make the crossing optional.
 *
 * THE RULE THIS MODULE IS BUILT AROUND: an alert that arrives without a mention
 * is a small loss; an alert that does not arrive is the failure the whole
 * feature exists to prevent. So every path here answers with `null` — "post it
 * unmentioned" — rather than throwing. A missing token, a revoked scope, an
 * address Slack has never seen, a person who left the channel, a timeout: all
 * of them degrade to exactly today's behaviour, and say why in the log.
 */

import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

/**
 * Slack's Web API. Two methods, both free on every plan:
 * `users.lookupByEmail` (needs users:read + users:read.email) and
 * `conversations.members` (needs channels:read for public channels,
 * groups:read for private ones).
 */
const SLACK_API = 'https://slack.com/api';

/**
 * How long to wait on Slack before giving up and posting unmentioned.
 *
 * Short on purpose. This sits in front of an alert that somebody is waiting
 * for, so a slow lookup must not become a slow alert — the mention is a nicety
 * and the alert is the point.
 */
const TIMEOUT_MS = 4000;

export function slackLookupConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

/** The channel to check membership against. Optional — see `isInChannel`. */
function alertChannelId(): string | undefined {
  return process.env.SLACK_ALERT_CHANNEL_ID?.trim() || undefined;
}

async function slackGet(method: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  const url = `${SLACK_API}/${method}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[slackMentions] ${method}: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as Record<string, unknown>;
    if (body.ok !== true) {
      // Slack reports failure in the BODY with HTTP 200, so this is the branch
      // that actually catches a revoked token (`invalid_auth`), a removed scope
      // (`missing_scope`) or an unknown address (`users_not_found`). Logged
      // rather than thrown: each one means "no mention", not "no alert".
      console.warn(`[slackMentions] ${method}: ${String(body.error ?? 'unknown error')}`);
      return null;
    }
    return body;
  } catch (err) {
    // Includes the timeout. Slack being slow must not hold up an alert.
    console.warn(`[slackMentions] ${method}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The id we already resolved for this address, if any. */
async function cachedId(email: string): Promise<string | null> {
  if (!supabaseEnabled()) return null;
  const { data, error } = await supabaseAdmin()
    .from('app_users')
    .select('slack_user_id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();
  if (error) {
    console.warn(`[slackMentions] cache read: ${error.message}`);
    return null;
  }
  return (data as { slack_user_id: string | null } | null)?.slack_user_id ?? null;
}

/**
 * Remember a resolved id. Best-effort and deliberately unawaited by the caller:
 * failing to cache costs one extra lookup next time, and must never cost an
 * alert.
 */
async function rememberId(email: string, id: string): Promise<void> {
  if (!supabaseEnabled()) return;
  const { error } = await supabaseAdmin()
    .from('app_users')
    .update({ slack_user_id: id })
    .eq('email', email.trim().toLowerCase());
  if (error) console.warn(`[slackMentions] cache write: ${error.message}`);
}

/**
 * Whether the person is in the alerts channel.
 *
 * Returns true when `SLACK_ALERT_CHANNEL_ID` is not set, which is the
 * deliberate choice: without a channel to check against, "is this person in it"
 * has no answer, and refusing to mention on an unanswerable question would make
 * a missing config item silently remove the whole feature. Mentioning somebody
 * who is not in the channel is a wasted ping; never mentioning anybody is a
 * feature that looks broken.
 */
async function isInChannel(userId: string): Promise<boolean> {
  const channel = alertChannelId();
  if (!channel) return true;

  // One page is enough for a team channel, and this runs on the alert path --
  // paging through a large channel to confirm one id is not worth the latency.
  const body = await slackGet('conversations.members', { channel, limit: '1000' });
  if (!body) return true; // lookup failed — see the module header
  const members = Array.isArray(body.members) ? (body.members as string[]) : [];
  if (members.length === 0) return true;
  return members.includes(userId);
}

/**
 * The `<@U…>` to put in front of an alert, or null to post it unmentioned.
 *
 * Null is a perfectly good answer and the caller must treat it as one: there is
 * no owner (a legacy monitor), no bot token configured, Slack could not resolve
 * the address, or the person is not in the channel.
 */
export async function mentionFor(owner: string | undefined | null): Promise<string | null> {
  const email = owner?.trim().toLowerCase();
  if (!email) return null;

  // The cache first, and not only to save a request. A cached id keeps working
  // while the token is revoked, the scope is missing or Slack is down -- which
  // are exactly the moments something else is likely to be going wrong too.
  const known = await cachedId(email);
  if (known) return (await isInChannel(known)) ? `<@${known}>` : null;

  if (!slackLookupConfigured()) return null;

  const body = await slackGet('users.lookupByEmail', { email });
  const user = body?.user as { id?: string } | undefined;
  const id = typeof user?.id === 'string' ? user.id : null;
  if (!id) return null;

  void rememberId(email, id);

  return (await isInChannel(id)) ? `<@${id}>` : null;
}
