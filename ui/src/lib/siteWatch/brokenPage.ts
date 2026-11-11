/**
 * A page that answers 200 is not necessarily a page that works.
 *
 * The most common ways a client's WordPress site goes down do not change the
 * HTTP status: the database connection drops, a plugin update throws a fatal
 * error, the host suspends the account, or the domain lapses onto a parking
 * page. Each still answers 200, so an uptime check that reads only the status
 * reported all of them as up.
 *
 * Each marker below is the fixed text those failure pages print. A marker only
 * counts on a SHORT page: real error pages are a few kilobytes, while a working
 * homepage that merely mentions one of these phrases (a blog post about fixing
 * the database error, say) is far larger. That keeps a healthy site from being
 * reported as down for quoting the wrong sentence.
 */

/** Longest body still treated as a possible error page. */
export const MAX_ERROR_PAGE_CHARS = 30_000;

const MARKERS: RegExp[] = [
  /error establishing a database connection/i, // WordPress, database unreachable
  /there has been a critical error on this website/i, // WordPress, fatal error screen
  /<b>(?:fatal|parse) error<\/b>:/i, // PHP printing a fatal error to the page
  /this account has been suspended/i, // cPanel host suspension
  /this domain is parked/i, // registrar parking page
  /this domain may be for sale/i, // registrar parking page
];

/** True when a 2xx/3xx body is really one of the known failure pages. */
export function isBrokenPage(body: string): boolean {
  if (!body || body.length > MAX_ERROR_PAGE_CHARS) return false;
  return MARKERS.some((m) => m.test(body));
}
