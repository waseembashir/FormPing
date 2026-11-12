/**
 * Where an uptime check ended up, and whether that is still the same site.
 *
 * A check follows redirects, so a site that answers 200 can be answering from
 * somewhere else entirely. Most redirects are housekeeping — http to https,
 * adding or dropping `www`, a trailing slash, a move to `shop.` — and stay
 * within the site's main domain. A redirect that LEAVES the main domain is
 * different: it is what a lapsed or hijacked domain, a compromised site, or a
 * botched migration looks like from the outside, while uptime still reads
 * green.
 *
 * Pure functions only, so every rule here is tested without a network.
 */

/**
 * Second-level labels that sit under a country code as part of the public
 * suffix: `example.co.uk` and `example.com.au` are main domains in their own
 * right, not subdomains of `co.uk` / `com.au`.
 */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc', 'gen', 'nic']);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The registrable main domain of a hostname: `shop.example.co.uk` → `example.co.uk`. */
export function mainDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (IPV4.test(host) || host.includes(':')) return host; // IP addresses compare as-is
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export type RedirectKind = 'same-site' | 'off-site';

export interface RedirectVerdict {
  kind: RedirectKind;
  /** Where the check landed. */
  finalUrl: string;
  /** The main domain it landed on, for wording ("sends visitors to other-site.com"). */
  finalDomain: string;
}

/**
 * Compare the monitored URL with where the check landed. Null when the check
 * did not redirect, or either address cannot be read.
 */
export function redirectVerdict(requestedUrl: string, finalUrl: string | undefined | null): RedirectVerdict | null {
  if (!finalUrl) return null;
  let from: URL;
  let to: URL;
  try {
    from = new URL(requestedUrl);
    to = new URL(finalUrl);
  } catch {
    return null;
  }
  if (from.href === to.href) return null;
  const finalDomain = mainDomain(to.hostname);
  const kind: RedirectKind = mainDomain(from.hostname) === finalDomain ? 'same-site' : 'off-site';
  return { kind, finalUrl: to.href, finalDomain };
}

/**
 * Whether an off-site redirect needs announcing, read from the alert log rather
 * than a stored flag. `lastOffsiteAt` / `lastReturnedAt` are when the two alerts
 * were last sent for this host (null if never).
 *
 *   'started'  — off-site now, and not announced since it last came back
 *   'returned' — back on its own domain after an announced off-site redirect
 *   null       — nothing new to say
 */
export function redirectAlertDecision(
  offsiteNow: boolean,
  lastOffsiteAt: string | null,
  lastReturnedAt: string | null,
): 'started' | 'returned' | null {
  const offsite = lastOffsiteAt ? Date.parse(lastOffsiteAt) : null;
  const returned = lastReturnedAt ? Date.parse(lastReturnedAt) : null;
  const announcedAndOpen = offsite != null && (returned == null || offsite > returned);
  if (offsiteNow) return announcedAndOpen ? null : 'started';
  return announcedAndOpen ? 'returned' : null;
}
