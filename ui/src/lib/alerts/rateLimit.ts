/**
 * Outbound safety for alert channels.
 *
 * Before this, four senders each POSTed straight to the Slack webhook with no
 * coordination. Slack's incoming webhooks are throttled at roughly one message
 * per second, and sustained abuse can get a webhook disabled — so four
 * simultaneous monitor tickers were a real risk of getting us blocked.
 *
 * Three protections, deliberately simple (module-level state, single process —
 * the app runs as one Node server):
 *
 *   1. SERIALISE + SPACE OUT — one send at a time per channel, with a minimum
 *      gap between them, so bursts become a queue instead of a flood.
 *   2. RESPECT BACKPRESSURE — on 429 (or 5xx) honour `Retry-After`, retry a
 *      couple of times with exponential backoff, then give up and log. Never
 *      retry in a tight loop.
 *   3. CIRCUIT BREAKER — after repeated failures, stop calling the channel for a
 *      cool-off period. A broken webhook then costs one failed request every few
 *      minutes instead of one per alert.
 *
 * Everything here is best-effort: no path throws, so a channel problem can never
 * break the monitor run that raised the alert.
 */

const MIN_GAP_MS = 1100; // ~1 msg/sec, just under Slack's documented limit
const MAX_ATTEMPTS = 3;
const BREAKER_THRESHOLD = 5; // consecutive failures before opening
const BREAKER_COOLOFF_MS = 5 * 60_000;

interface ChannelState {
  /** Tail of the send queue — each send awaits the previous one. */
  chain: Promise<unknown>;
  lastSentAt: number;
  consecutiveFailures: number;
  openedAt: number | null;
}

const channels = new Map<string, ChannelState>();

function stateFor(channel: string): ChannelState {
  let s = channels.get(channel);
  if (!s) {
    s = { chain: Promise.resolve(), lastSentAt: 0, consecutiveFailures: 0, openedAt: null };
    channels.set(channel, s);
  }
  return s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** True while the breaker is open (channel is being given a rest). */
function breakerOpen(s: ChannelState): boolean {
  if (s.openedAt == null) return false;
  if (Date.now() - s.openedAt >= BREAKER_COOLOFF_MS) {
    // Cool-off elapsed — half-open: allow one attempt through.
    s.openedAt = null;
    s.consecutiveFailures = 0;
    return false;
  }
  return true;
}

export interface SendResult {
  ok: boolean;
  note?: string;
}

/**
 * Run `send` for a channel: queued behind that channel's other sends, spaced out,
 * retried on backpressure, and skipped entirely while the breaker is open.
 *
 * `send` should return the HTTP Response (so we can read status/Retry-After), or
 * throw on a network error.
 */
export async function sendGuarded(channel: string, send: () => Promise<Response>): Promise<SendResult> {
  const s = stateFor(channel);

  if (breakerOpen(s)) {
    return { ok: false, note: `skipped — ${channel} circuit breaker open after repeated failures` };
  }

  // Queue behind this channel's previous send, so concurrent tickers can't burst.
  const run = s.chain.then(async (): Promise<SendResult> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Space sends out.
      const wait = MIN_GAP_MS - (Date.now() - s.lastSentAt);
      if (wait > 0) await sleep(wait);

      try {
        const res = await send();
        s.lastSentAt = Date.now();

        if (res.ok) {
          s.consecutiveFailures = 0;
          return { ok: true };
        }

        // Backpressure: honour Retry-After when present.
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === MAX_ATTEMPTS) {
          s.consecutiveFailures++;
          if (s.consecutiveFailures >= BREAKER_THRESHOLD) s.openedAt = Date.now();
          return { ok: false, note: `${channel} responded ${res.status}` };
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : MIN_GAP_MS * 2 ** attempt;
        await sleep(backoff);
      } catch (err) {
        s.lastSentAt = Date.now();
        if (attempt === MAX_ATTEMPTS) {
          s.consecutiveFailures++;
          if (s.consecutiveFailures >= BREAKER_THRESHOLD) s.openedAt = Date.now();
          return { ok: false, note: `${channel} request failed: ${err}` };
        }
        await sleep(MIN_GAP_MS * 2 ** attempt);
      }
    }
    return { ok: false, note: `${channel} gave up after ${MAX_ATTEMPTS} attempts` };
  });

  // Keep the chain alive regardless of outcome so one failure can't stall the queue.
  s.chain = run.catch(() => undefined);
  return run;
}

/** Test seam — reset all channel state. */
export function __resetGuards(): void {
  channels.clear();
}
