/**
 * READ-ONLY audit: row counts for every table in `public` (prod) vs `dev`.
 * Safe to run any time — performs SELECT/count only, never a write.
 *
 * Run:  node ui/scripts/db/compare-schemas.mjs
 * After cutover the expected steady state is public=0 (until real clients) and
 * dev=whatever local testing has produced — a MISMATCH here is normal, not a bug.
 */
import { readOnlyClient } from './guard.mjs';

const TABLES = [
  'projects', 'dismissed_urls', 'form_watch_schedules', 'site_watch_schedules',
  'form_tester_runs', 'form_watch_results', 'site_watch_results',
  'form_watch_runs', 'site_watch_runs', 'change_reports', 'site_watch_daily',
];

const { db: pub } = readOnlyClient('public');
const { db: dev } = readOnlyClient('dev');

console.log('table                     public   dev');
console.log('-------------------------------------------');
let tp = 0, td = 0;
for (const t of TABLES) {
  const [{ count: cp, error: ep }, { count: cd, error: ed }] = await Promise.all([
    pub.from(t).select('*', { count: 'exact', head: true }),
    dev.from(t).select('*', { count: 'exact', head: true }),
  ]);
  if (ep || ed) { console.log(`${t.padEnd(24)} ERROR ${ep?.message || ''} ${ed?.message || ''}`); continue; }
  tp += cp; td += cd;
  console.log(`${t.padEnd(24)} ${String(cp).padStart(5)} ${String(cd).padStart(5)}`);
}
console.log('-------------------------------------------');
console.log(`${'TOTAL'.padEnd(24)} ${String(tp).padStart(5)} ${String(td).padStart(5)}`);
