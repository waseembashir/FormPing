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

Run `public` first, then `dev`, and always in that order.

The reason is the editor's default, not any precedence between the two schemas.
The SQL Editor targets `public` unless told otherwise, so the run that depends
on you remembering `set search_path` is the **second** one. Forget it there and
the migration lands on `public` a second time — idempotent, harmless, and `dev`
is simply left behind until local development notices. Reverse the order and the
same slip applies an unverified change to **production**.

Then verify, because a no-op looks exactly like success. Re-applying a migration
a schema already has changes nothing and reports no error, so two runs that both
hit `public` are indistinguishable from one run per schema until something
breaks. Confirm the new column or table exists in both:

```sql
select table_schema, count(*)
  from information_schema.columns
 where column_name = 'your_new_column'
   and table_schema in ('dev','public')
 group by table_schema;
```

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
| `0005_fr21_change_events.sql`    | change_events — the change-tracking event stream               |
| `0006_fr22_alerts.sql`           | alerts — the alert delivery log                                |
| `0007_fr24_app_users.sql`        | app_users — per-user roles                                     |
| `0008_fr26_bug_reports.sql`      | bug_reports — in-app "Report a bug" submissions                |
| `0009_fr27_url_shares.sql`       | url_shares — per-URL public share tokens                       |
| `0010_fr31_bug_report_status.sql`| bug_reports: status, resolved_by, resolved_at (triage)         |
| `0011_fr30_project_attribution.sql`| projects: created_by, updated_by                             |
| `0012_fr67_form_tester_detail.sql`| form_tester_runs: detail (full run detail, not just a verdict)|
| `0013_fr67_scheduler_and_uptime_detail.sql`| form/site watch results: detail — the same for scheduled runs |
| `0014_fr66_project_activity_log.sql`| project_events — who did what to a project, and when        |
| `0015_fr82_manual_rerun.sql`     | form/site watch runs: trigger_source (scheduled vs re-run)     |
| `0016_fr74_owner.sql`            | owner on the ten tool-tab tables, + an index on each schedule table |
