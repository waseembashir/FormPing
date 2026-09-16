/**
 * What a site check actually found, for a notification. FR-91.
 *
 * Site Watch already crammed its findings into one summary string —
 * "Up · 120 ms · SSL … · Domain …". That read acceptably, but it meant the
 * channel could not decide how much to show, and it put the same weight on a
 * response time as on an expiring certificate.
 *
 * These are the same facts as discrete phrases, in the order a reader cares
 * about them, so every alert in the app is assembled the same way: facts for
 * what we found, scope for what we looked at, action for what a person must
 * still do. Failure wording comes from `failures.ts`, so a notification and a
 * dashboard cannot disagree about what went wrong (FR-86).
 */

import type { SiteCheckRecord } from './types';
import { describeFailure } from './failures';

const MAX_FACTS = 5;

function sslFact(record: SiteCheckRecord): string | null {
  const ssl = record.ssl;
  if (!ssl) return null; // not HTTPS — saying "no certificate" would be wrong
  if (!ssl.ok || ssl.daysRemaining == null) return describeFailure('ssl', ssl.failure).text;
  if (ssl.daysRemaining <= 0) return 'Certificate EXPIRED';
  return `Certificate valid, ${ssl.daysRemaining} day${ssl.daysRemaining === 1 ? '' : 's'} left`;
}

function domainFact(record: SiteCheckRecord): string | null {
  const d = record.domain;
  if (!d) return null;
  if (!d.ok || d.daysRemaining == null) return describeFailure('domain', d.failure).text;
  const stale = d.stale ? ' (not refreshed this check)' : '';
  if (d.daysRemaining <= 0) return `Domain registration EXPIRED${stale}`;
  return `Domain renews in ${d.daysRemaining} day${d.daysRemaining === 1 ? '' : 's'}${stale}`;
}

/** What this check observed, most consequential first. */
export function siteCheckFacts(record: SiteCheckRecord): string[] {
  const facts: string[] = [];
  const uptime = record.uptime;

  // 1. Reachability, with the number that explains it.
  if (uptime?.classification === 'up') {
    facts.push(`HTTP ${uptime.statusCode ?? 200} · ${uptime.responseMs} ms`);
  } else if (uptime?.classification === 'blocked') {
    facts.push(`Reachable but challenged (HTTP ${uptime.statusCode ?? '—'})`);
  } else if (uptime) {
    facts.push(describeFailure('uptime', uptime.failure).text);
  }

  // 2. Then the two clocks that can take a site off the internet without warning.
  const ssl = sslFact(record);
  if (ssl) facts.push(ssl);
  const domain = domainFact(record);
  if (domain) facts.push(domain);

  return facts.slice(0, MAX_FACTS);
}

/**
 * What this check covered — stated because what it does NOT cover matters.
 *
 * An uptime monitor answers "did the homepage respond", not "is the site
 * healthy". A reader who takes a green uptime alert as proof that forms,
 * content and checkout all work has been misled by omission.
 */
export function siteCheckScope(record: SiteCheckRecord): string {
  const parts = ['availability'];
  if (record.ssl) parts.push('certificate');
  if (record.domain) parts.push('domain expiry');
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Checked ${list} for this URL only — not the pages, forms or content behind it.`;
}

/** What a person must do by hand, and why we could not. Null when nothing is owed. */
export function siteManualActionFor(record: SiteCheckRecord): string | null {
  if (record.uptime?.classification === 'blocked') {
    return 'We could not confirm this page loads for a visitor: the site answered our check with a bot challenge rather than the page. That usually means a firewall rule, not an outage — open the URL yourself to be sure.';
  }
  const ssl = record.ssl;
  if (ssl && !ssl.ok && ssl.failure === 'no_certificate') {
    return 'We could not read a certificate because the site served none. Visitors may see a browser security warning — check the host’s TLS setup.';
  }
  return null;
}
