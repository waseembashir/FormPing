-- FR-82 — "Re-run": run a monitored URL immediately without disturbing its schedule.
--
-- A re-run takes the same engine path as a scheduled run but writes ONLY a history
-- row: it never moves nextRunAt, never updates the durable per-URL result, never
-- fires an alert, and never feeds the uptime rollup. This column is what lets the
-- history tell the two apart, so the run log can tag a re-run instead of passing it
-- off as something the schedule did.
--
-- Additive and idempotent. Nullable with no backfill: existing rows read as NULL,
-- which the app treats as 'scheduled' — every row already in these tables was.
--
-- NOTE: the column is `trigger_source`, not `trigger` — TRIGGER is a Postgres
-- keyword and a column of that name needs quoting at every call site.
--
-- Run once per schema: `public` (production) and `dev` (local).

alter table form_watch_runs add column if not exists trigger_source text;
alter table site_watch_runs add column if not exists trigger_source text;
