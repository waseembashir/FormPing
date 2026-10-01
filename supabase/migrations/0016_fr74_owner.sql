-- FR-74 — per-user isolation of the tool tabs: the column that records whose work a row is.
--
-- Today every user shares one global workspace: any run, schedule, log or
-- in-flight test on the tool tabs is visible to everyone. This column is the
-- foundation for making the four tool tabs private, while Projects stays shared
-- so the team can still see what is already covered.
--
-- NOTHING READS OR WRITES THIS COLUMN YET. Applying this migration changes no
-- behaviour whatsoever — it is deliberately inert so the schema can be in place,
-- on both environments, before any code depends on it. Writing comes next;
-- filtering comes after that, behind a flag that defaults to off.
--
-- NULL means "legacy / shared", and that is a real state rather than a gap:
-- every row that exists today was created in the shared workspace, and no
-- backfill can honestly say who made it. Those rows stay visible to everyone
-- until they are re-run or claimed. A placeholder owner would have invented an
-- attribution that nobody can verify, and hidden other people's work from them.
--
-- Additive, idempotent, and no backfill, so there is nothing to undo: a nullable
-- column with no default does not rewrite the table and does not touch a single
-- existing row.
--
-- Run once per schema: `dev` first (verify), then `public`.
--
-- The SQL editor runs against `public` unless told otherwise, so applying this
-- to `dev` means prefixing the run with `set search_path to dev;` in the same
-- query. Without it both runs land on `public` and the second is a no-op, which
-- looks like success — and `dev` is the schema local development writes to, so
-- the gap only surfaces when code starts using the column.

-- ── The four tool tabs' own data ────────────────────────────────────────────

-- Form Tester: on-demand runs.
alter table form_tester_runs add column if not exists owner text;

-- Form Scheduler: the schedule, its run history, and its durable per-URL result.
alter table form_watch_schedules add column if not exists owner text;
alter table form_watch_runs add column if not exists owner text;
alter table form_watch_results add column if not exists owner text;

-- Uptime & SSL: the same three shapes.
alter table site_watch_schedules add column if not exists owner text;
alter table site_watch_runs add column if not exists owner text;
alter table site_watch_results add column if not exists owner text;

-- Content Changes: reports and the per-change events behind them.
alter table change_reports add column if not exists owner text;
alter table change_events add column if not exists owner text;

-- The uptime rollup behind the 7-day / 30-day / all-time figures.
--
-- Included deliberately, though it is the one table where ownership is arguably
-- redundant: a URL belongs to exactly one project, so a day's rollup already has
-- one owner implicitly. It is here because the per-URL dashboard reads it, that
-- dashboard becomes owner-scoped, and adding the column now costs nothing while
-- adding it later would mean a second migration against a bigger table.
alter table site_watch_daily add column if not exists owner text;

-- ── Indexes ─────────────────────────────────────────────────────────────────
--
-- Only the two schedule tables are indexed, because only they are read by owner
-- ALONE — "list my monitors" is a scan of every schedule. Runs, results and
-- rollups are always reached through a schedule id or a url key first, which is
-- already indexed and already selective; a second index there would cost write
-- time on every check to save nothing on read.
--
-- Created before anything filters on the column, so there is no window where a
-- query is slow and then quietly gets faster.
create index if not exists form_watch_schedules_owner_idx on form_watch_schedules (owner);
create index if not exists site_watch_schedules_owner_idx on site_watch_schedules (owner);
