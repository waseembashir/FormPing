/**
 * Why a check produced no answer, in words a non-developer can act on. FR-86.
 *
 * The Certificates panel used to read `fetch failed` in amber underneath a
 * certificate that had resolved perfectly well. That string is Node's — it is
 * literally what `err.message` says when a network-level fetch fails — and it
 * had travelled untouched from `checks.ts` to the dashboard, to the monitor
 * card, and into Slack.
 *
 * Two things were wrong with it. It is developer vocabulary in a product whose
 * users are agency staff and their clients. And it collapses two situations
 * that call for opposite responses:
 *
 *   TEMPORARY — we could not reach the registry just now. Nothing is wrong with
 *               the domain; the answer will come back on its own.
 *   PERMANENT — this registry does not publish an expiry date at all. True of
 *               many ccTLDs, and it will never change however long we wait.
 *
 * Told apart, they also drive the retry: there is no point asking a registry
 * every thirty minutes for a field it does not publish, and no sense waiting
 * twelve hours to retry a one-second network blip.
 *
 * A failure is therefore carried as a KIND from the moment it happens. The raw
 * message stays on the result for the server log, and nothing renders it — the
 * same rule FR-87 applied to database errors.
 */

/** Every way a site check can fail to produce an answer. Closed set. */
export type CheckFailure =
  /** Could not reach the host or the registry at all (network, DNS, timeout). */
  | 'unreachable'
  /** The registry asked us to slow down. */
  | 'rate_limited'
  /** The registry answered, but with an error of its own. */
  | 'registry_error'
  /** The registry does not publish this information. Permanent. */
  | 'not_published'
  /** We got data we could not read. Permanent until someone fixes it upstream. */
  | 'unreadable'
  /** The host served no TLS certificate at all. */
  | 'no_certificate'
  /** The site answered, but refused us (bot challenge, WAF). */
  | 'challenged';

/** What a subject is, for phrasing: "the domain registry" vs "the site". */
export type CheckSubject = 'domain' | 'ssl' | 'uptime';

export interface FailureCopy {
  /** One sentence, plain language, safe to show anyone. */
  text: string;
  /**
   * How loudly to show it.
   *
   * `info` matters: a registry that does not publish expiry dates is not a
   * problem anyone can fix, so painting it amber trains people to ignore amber.
   */
  tone: 'info' | 'warn' | 'danger';
  /** True when waiting will not help — drives the retry interval. */
  permanent: boolean;
}

const DOMAIN: Record<CheckFailure, FailureCopy> = {
  unreachable: {
    text: 'We could not reach the domain registry just now. Nothing is wrong with the domain — we will check again shortly.',
    tone: 'info',
    permanent: false,
  },
  rate_limited: {
    text: 'The domain registry asked us to slow down. We will check again shortly.',
    tone: 'info',
    permanent: false,
  },
  registry_error: {
    text: 'The domain registry is having trouble answering. We will check again shortly.',
    tone: 'info',
    permanent: false,
  },
  not_published: {
    text: 'This domain’s registry does not publish an expiry date, so we cannot track it. Many country domains work this way.',
    tone: 'info',
    permanent: true,
  },
  unreadable: {
    text: 'The domain registry gave us an expiry date we could not read, so we cannot track it.',
    tone: 'info',
    permanent: true,
  },
  no_certificate: { text: 'No certificate was found.', tone: 'warn', permanent: false },
  challenged: {
    text: 'The domain registry refused our request. We will check again shortly.',
    tone: 'info',
    permanent: false,
  },
};

const SSL: Record<CheckFailure, FailureCopy> = {
  unreachable: {
    text: 'We could not reach this site to read its certificate. We will try again at the next check.',
    tone: 'warn',
    permanent: false,
  },
  no_certificate: {
    text: 'This site did not present a security certificate. Visitors may see a browser warning.',
    tone: 'danger',
    permanent: false,
  },
  unreadable: {
    text: 'This site’s security certificate could not be read. It is worth checking by hand.',
    tone: 'warn',
    permanent: false,
  },
  challenged: {
    text: 'The site refused our certificate check. We will try again at the next check.',
    tone: 'info',
    permanent: false,
  },
  rate_limited: { text: 'The certificate check was throttled. We will try again shortly.', tone: 'info', permanent: false },
  registry_error: { text: 'The certificate check did not complete. We will try again shortly.', tone: 'warn', permanent: false },
  not_published: { text: 'No certificate information is available for this site.', tone: 'info', permanent: true },
};

const UPTIME: Record<CheckFailure, FailureCopy> = {
  unreachable: {
    text: 'We could not reach this site — no response from the server.',
    tone: 'danger',
    permanent: false,
  },
  challenged: {
    text: 'The site is up, but its security layer challenged our check rather than answering it.',
    tone: 'info',
    permanent: false,
  },
  rate_limited: { text: 'The site asked us to slow down, so this check was refused.', tone: 'info', permanent: false },
  registry_error: { text: 'The site answered with an error of its own.', tone: 'danger', permanent: false },
  not_published: { text: 'No response information is available.', tone: 'info', permanent: true },
  unreadable: { text: 'The site’s response could not be read.', tone: 'warn', permanent: false },
  no_certificate: { text: 'No certificate was found.', tone: 'warn', permanent: false },
};

const TABLES: Record<CheckSubject, Record<CheckFailure, FailureCopy>> = {
  domain: DOMAIN,
  ssl: SSL,
  uptime: UPTIME,
};

/**
 * What to show for a failure of `kind` on `subject`.
 *
 * `kind` is typed, but rows stored before FR-86 carry no kind at all — those
 * callers pass `undefined` and get a truthful generic line rather than the raw
 * string they used to render.
 */
export function describeFailure(subject: CheckSubject, kind: CheckFailure | undefined): FailureCopy {
  const generic: FailureCopy = {
    text:
      subject === 'domain'
        ? 'This domain’s expiry could not be checked last time. We will check again shortly.'
        : subject === 'ssl'
          ? 'This certificate could not be checked last time. We will try again at the next check.'
          : 'This check did not complete last time.',
    tone: 'info',
    permanent: false,
  };
  if (!kind) return generic;
  // A kind read back from stored JSON is only as trustworthy as the build that
  // wrote it — an older or newer version may name one this table has never
  // heard of. Fall back rather than hand the UI an undefined to dereference.
  return TABLES[subject][kind] ?? generic;
}

/** True when retrying sooner cannot help. Drives the domain recheck interval. */
export function isPermanent(subject: CheckSubject, kind: CheckFailure | undefined): boolean {
  return describeFailure(subject, kind).permanent;
}

/** Map an HTTP status from a registry to the right kind. */
export function failureForStatus(status: number): CheckFailure {
  if (status === 404) return 'not_published';
  if (status === 429) return 'rate_limited';
  if (status === 403 || status === 401) return 'challenged';
  return 'registry_error';
}
