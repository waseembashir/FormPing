-- FormPing — FR-21: Change Tracking event stream.
--
-- SCHEMA-AGNOSTIC (see 0001's header): unqualified names, apply per-schema with
-- `set search_path to public;` (prod) or `set search_path to dev;` (dev) first.
-- Additive + forward-only + idempotent.
--
-- WHY
-- Change tracking left almost no trace: a `snapshot` run persisted NOTHING to the
-- DB (only a file on disk), and `change_reports` was pruned to the newest ONE row
-- per site — so "on this date, N things changed" history was being deleted on
-- every run. Projects therefore showed no sign that a URL was being tracked.
--
-- This table records ONE SLIM ROW PER RUN, for all three modes (snapshot,
-- compare, watch). It is deliberately separate from `change_reports`:
--
--   change_events   — small, cheap, kept long  → powers the timeline + Projects
--   change_reports  — heavy `details` jsonb, pruned to the recent few → drill-in
--
-- Watch mode runs hourly (~24 runs/site/day), so keeping the full details payload
-- forever would bloat the database. Slim events stay affordable for a long window
-- while the heavy payloads age out.
--
-- KEYING: `site` is the HOST key (same value as `change_reports.site`, i.e.
-- siteKey() = hostname minus `www.`). The crawler snapshots a whole SITE from its
-- homepage, so change tracking is site-level, not per-URL — the UI labels it that
-- way. Two project URLs on the same domain share one change-tracking history.
--
-- RLS enabled, no policies (anon key does nothing; server secret key bypasses).

create table if not exists change_events (
  id            uuid primary key default gen_random_uuid(),
  site          text not null,                 -- host key (matches change_reports.site)
  root_url      text,                          -- the URL that was crawled, for display
  mode          text not null,                 -- 'snapshot' | 'compare' | 'watch'
  checked_at    timestamptz not null,          -- when the run happened
  pages_scanned int not null default 0,
  pages_changed int not null default 0,
  changes_found int not null default 0,
  severity      text,                          -- highest across pages: low|medium|high; null for snapshot / no changes
  summary       text,                          -- short human summary (null for snapshot)
  created_at    timestamptz not null default now()
);

-- Timeline read pattern: newest-first per site, and the prune sort key.
create index if not exists change_events_site_checked_idx
  on change_events (site, checked_at desc);

alter table change_events enable row level security;
