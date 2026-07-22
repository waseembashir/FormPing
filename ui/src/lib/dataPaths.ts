import path from 'path';

/**
 * Resolve a path under the app's persisted-FILE directory.
 *
 * As of the Supabase cutover, all STRUCTURED data (projects, schedules, run
 * history, change reports, dismissals, on-demand runs, daily rollups) lives in
 * Postgres — NOT on disk. Only two things remain file-based, because neither
 * belongs in a relational table:
 *   • Change Monitor SNAPSHOTS — raw HTML captured each check to diff against
 *     next time (large blobs; an object-storage move is a separate future task).
 *   • activeWatches — the PIDs of running watch processes (machine-local runtime
 *     state; meaningless in a shared DB).
 *
 * Those two still live under `data/snapshots/…`, which by DEFAULT resolves to
 * `<repo>/data/snapshots/…` — one level up from `ui/`. On Railway the persistent
 * volume is mounted there, so the default is correct in production and the
 * override below is left unset.
 *
 * Set `FORMPING_DATA_DIR` to an ABSOLUTE path to relocate these files. Its use
 * is LOCAL DEV: the repo lives inside OneDrive, and OneDrive re-syncs / reverts
 * frequently-written files (snapshots are rewritten on every check) — pointing
 * this at a non-synced folder (e.g. `%LOCALAPPDATA%\FormPing\data`) avoids that.
 *
 * When set, it REPLACES the `data/snapshots` segment; the rest of the relative
 * path is joined onto it, so the on-disk sub-layout is unchanged.
 *
 * @param rel a repo-relative path beginning with `data/snapshots/…`
 */
export function dataPath(rel: string): string {
  const override = process.env.FORMPING_DATA_DIR?.trim();
  if (override) {
    const sub = rel.replace(/^data[\\/]snapshots[\\/]?/, '');
    return sub ? path.join(override, sub) : override;
  }
  // Default — byte-identical to the previous inline `path.join(process.cwd(), '..', rel)`.
  return path.join(process.cwd(), '..', rel);
}
