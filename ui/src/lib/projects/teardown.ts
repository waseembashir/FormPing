/**
 * What deleting a URL, or a whole project, has to take with it.
 *
 * Deleting a client is the one irreversible cascade in the app: schedules,
 * run history, durable results, rollups, share links, change reports, event
 * streams, alert logs and snapshot files, across however many URLs and hosts.
 * Miss one and it resurfaces — a stopped monitor's result reappears in
 * Unassigned, or a watch restarts after a redeploy and rebuilds what was
 * deleted.
 *
 * It lives here, apart from the routes, for one reason: it had no test and
 * could not easily have one. A route handler drags in the whole Next request
 * stack, so the only thing exercising this cascade was somebody deleting a
 * real project and looking. With the I/O passed in, the ORDER and the SET of
 * operations can be asserted directly — which is the part that is easy to get
 * wrong and impossible to see.
 *
 * The functions below decide what happens and in what order. They do not know
 * what a database is.
 */

/** Every destructive call the cascade can make, injected so it can be observed. */
export interface TeardownIO {
  /**
   * The removers return whatever their store returns — some answer whether a
   * row existed. The cascade only ever awaits them, so the type says `unknown`
   * rather than forcing every store to agree on a shape it has no reason to.
   */
  removeFormSchedule(id: string): unknown;
  removeSiteSchedule(id: string): unknown;
  removeRun(url: string): unknown;
  removeFormResult(url: string): unknown;
  removeSiteResult(url: string): unknown;
  removeDaily(url: string): unknown;
  /** Kills the running watch subprocess. Synchronous; returns whether one died. */
  stopWatch(host: string): boolean;
  removeActiveWatch(host: string): unknown;
  removeReports(host: string): unknown;
  removeChangeEvents(host: string): unknown;
  removeAlertsForSite(host: string): unknown;
  removeSnapshotsForHost(host: string): unknown;
}

/** The schedules on a URL, already looked up. */
export interface UrlSchedules {
  formId?: string;
  siteId?: string;
}

/**
 * Tear down everything belonging to these URLs, and report how many live
 * monitors that removed.
 *
 * Every URL at once, and within a URL everything at once, because none of it
 * is ordered — the schedules, the manual run, the two durable results and the
 * rollups describe different tables and never read each other.
 *
 * It used to run one await at a time. Seven round trips per URL, in sequence,
 * meant a three-URL project took tens of seconds to delete; nothing required
 * it, the operations had simply been written in a `for` loop.
 */
export async function teardownUrls(
  urls: string[],
  schedulesFor: (url: string) => UrlSchedules,
  io: TeardownIO,
): Promise<number> {
  const removed = await Promise.all(
    urls.map(async (url) => {
      const { formId, siteId } = schedulesFor(url);
      await Promise.all([
        formId ? io.removeFormSchedule(formId) : undefined,
        siteId ? io.removeSiteSchedule(siteId) : undefined,
        // Every persisted result, so nothing reappears later as Unassigned.
        io.removeRun(url),
        io.removeFormResult(url),
        io.removeSiteResult(url),
        io.removeDaily(url),
      ]);
      return (formId ? 1 : 0) + (siteId ? 1 : 0);
    }),
  );
  return removed.reduce((a: number, b: number) => a + b, 0);
}

/**
 * Tear down each host's change tracking, and report how many running watches
 * that killed.
 *
 * Hosts run concurrently. Within a host they do NOT: the watch is stopped
 * first, and only then is anything deleted. That order is the whole reason
 * this function exists rather than one flat `Promise.all` — a watch left
 * running writes new events and reports in the gap and resurrects exactly what
 * is being removed. It is the one piece of sequencing in the cascade, and the
 * easiest to lose while making the rest faster.
 */
export async function teardownHosts(hosts: Iterable<string>, io: TeardownIO): Promise<number> {
  const killed = await Promise.all(
    [...hosts].map(async (host) => {
      const stopped: number = io.stopWatch(host) ? 1 : 0;
      await io.removeActiveWatch(host); // so a redeploy cannot resume it either

      // Only now that nothing can write for this host is the rest safe.
      await Promise.all([
        io.removeReports(host),
        io.removeChangeEvents(host),
        io.removeAlertsForSite(host),
        io.removeSnapshotsForHost(host),
      ]);
      return stopped;
    }),
  );
  return killed.reduce((a: number, b: number) => a + b, 0);
}

/**
 * The hosts a delete may purge: those this deletion touches, minus any still
 * spoken for.
 *
 * Change tracking is per hostname, so a host another project still watches —
 * or one this project still has another URL on — must survive. Wiping it would
 * take a sibling's history with it, and the sibling would have no idea why.
 *
 * `unknown` is what the key helper returns for a URL it cannot parse. It is not
 * a host and must never be purged, or one malformed URL would delete the change
 * history of everything else that failed to parse.
 */
export function purgeableHosts(hosts: Iterable<string>, stillInUse: ReadonlySet<string>): string[] {
  return [...new Set(hosts)].filter((h) => h && h !== 'unknown' && !stillInUse.has(h));
}
