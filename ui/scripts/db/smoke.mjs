/**
 * Guarded CRUD smoke test — proves the Supabase backend works end-to-end on the
 * `dev` schema, then cleans up after itself. It goes through guard.devClient(),
 * so it ABORTS before doing anything if SUPABASE_SCHEMA is not 'dev' — a smoke
 * test can never run against production.
 *
 * Run:  node ui/scripts/db/smoke.mjs      (from the repo root)
 *       node scripts/db/smoke.mjs         (from ui/)
 */
import { devClient } from './guard.mjs';

const { db, schema } = devClient();
console.log(`smoke: running against schema='${schema}' (guard passed)\n`);

// A sentinel name so we can always find/clean our own test rows and never a real one.
const SENTINEL = '__formping_smoke__ (safe to delete)';
let failures = 0;
const ok = (label, cond) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

// Clean any leftovers from a previous aborted run first.
await db.from('projects').delete().eq('name', SENTINEL);

try {
  // CREATE
  const { data: created, error: cErr } = await db
    .from('projects')
    .insert({ name: SENTINEL, urls: ['https://smoke.example.com'] })
    .select('id, name, urls')
    .single();
  ok('insert returns a row', !cErr && !!created?.id);
  const id = created?.id;

  // READ
  const { data: read } = await db.from('projects').select('id, name, urls').eq('id', id).single();
  ok('read-back matches', read?.name === SENTINEL && read?.urls?.[0] === 'https://smoke.example.com');

  // UPDATE (also exercises the updated_at trigger)
  const { data: updated } = await db
    .from('projects')
    .update({ notes: 'touched by smoke' })
    .eq('id', id)
    .select('notes, created_at, updated_at')
    .single();
  ok('update persists', updated?.notes === 'touched by smoke');
  ok('updated_at trigger advanced past created_at', new Date(updated?.updated_at) >= new Date(updated?.created_at));

  // DELETE
  const { data: deleted } = await db.from('projects').delete().eq('id', id).select('id');
  ok('delete removes the row', deleted?.length === 1);

  const { count } = await db.from('projects').select('*', { count: 'exact', head: true }).eq('id', id);
  ok('row is gone afterwards', count === 0);
} finally {
  // Belt-and-braces: make sure no sentinel row survives even if an assertion threw.
  await db.from('projects').delete().eq('name', SENTINEL);
}

console.log(`\nsmoke: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} on '${schema}'.`);
process.exit(failures === 0 ? 0 : 1);
