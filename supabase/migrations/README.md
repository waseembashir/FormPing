# FormPing migrations

Plain SQL, applied **by hand** in the Supabase SQL Editor (no migration
framework). Files run in numeric order; each is idempotent (`if not exists` /
`or replace`), so re-running one is safe.

## One project, two schemas

FormPing uses a single Supabase project split by Postgres **schema**:

| Schema   | Environment              | Set on            |
| -------- | ------------------------ | ----------------- |
| `public` | **production** (Railway) | Railway env       |
| `dev`    | **local development**    | `.env.local` → `SUPABASE_SCHEMA=dev` |

This keeps development writes (including destructive smoke tests) off the same
tables production uses. See working-agreement **rule 6, "Production data is
sacred."**

## Every migration is schema-agnostic

Migrations use **unqualified** table names (no `public.` / `dev.` prefix) and
bind to whichever schema is first on the `search_path`. That is what stops `dev`
drifting from `public`: **the same file applies to both**, with no hand-editing.

## How to apply a migration (do BOTH schemas)

For each new migration file, run it twice — once per schema. In the SQL Editor:

```sql
-- 1) PRODUCTION
set search_path to public;
-- …paste the migration body here, run it…

-- 2) LOCAL DEV
set search_path to dev;
-- …paste the same migration body here, run it…
```

Run `public` first (production is the source of truth), then `dev`. Because the
files are idempotent, re-applying a migration that a schema already has is a
no-op.

> New to the project / rebuilding `dev` from scratch? Run `0001` → `0004` in
> order under `set search_path to dev;` first (create the schema with
> `create schema if not exists dev;`), then grant it to `service_role` and add
> `dev` to the Data API's exposed schemas.

## Writing a new migration (rules)

- **Additive + forward-only.** Never `drop table`, `truncate`, or a destructive
  `alter` on `public`. New feature ⇒ new column / new table, `if not exists`.
- **Unqualified names only.** No `public.` / `dev.` prefix — let `search_path`
  choose the schema. (A qualified name silently ties the migration to one schema
  and reintroduces drift.)
- **Never change how a row is keyed** (`url_key`, ids) without a backfill in the
  same migration — rows needn't be deleted to disappear from the app.
- **Enable RLS** on every new table (`alter table <t> enable row level
  security;`), no policies — the server's service-role key bypasses RLS.
- Keep it idempotent so re-running in either schema is safe.

## Files

| File                             | Adds                                                           |
| -------------------------------- | ------------------------------------------------------------- |
| `0001_phase1_core.sql`           | projects, form/site watch schedules, dismissed_urls, form_tester_runs |
| `0002_phase2_history_reports.sql`| form/site watch run history, change_reports                   |
| `0003_fr17_lifecycle.sql`        | form/site watch per-URL durable results                       |
| `0004_fr20_daily_rollup.sql`     | site_watch_daily (rollup for 7d/30d/all-time charts)          |
