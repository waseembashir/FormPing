import path from 'path';

/**
 * Resolve a path under the app's persisted-data directory.
 *
 * All FormPing persistence (projects, form/site schedules, run history, change
 * reports, dismissals, on-demand runs) lives under `data/snapshots/…`. By
 * DEFAULT that resolves to `<repo>/data/snapshots/…` — one level up from the
 * `ui/` working directory, exactly as before. On Railway the persistent volume
 * is mounted there, so the default is correct in production and this override is
 * left unset.
 *
 * Set the `FORMPING_DATA_DIR` env var to an ABSOLUTE path to relocate ALL of
 * this data. Its main use is LOCAL DEV: the repo lives inside OneDrive, and
 * OneDrive continually re-syncs / reverts these tiny, frequently-written JSON
 * files — silently wiping schedules and projects. Pointing this at a non-synced
 * folder (e.g. `%LOCALAPPDATA%\FormPing\data`) stops that data loss.
 *
 * When the override is set, it REPLACES the `data/snapshots` segment: the rest
 * of the relative path (e.g. `.formping-projects.json`, `.formping-form-runs/…`)
 * is joined onto it, so every store keeps its same sub-layout.
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
