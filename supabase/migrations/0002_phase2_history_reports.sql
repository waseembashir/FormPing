-- FormPing — Supabase Phase 2 schema (run history + change reports)
-- Completes the migration: the last read/write JSON stores move to Postgres.
-- Table names mirror the app's tools (consistent with Phase 1):
--   form_watch_runs   — Forms → Scheduled monitors: per-run history (Form Watch)
--   site_watch_runs   — Site → Uptime & SSL: per-check history (Site Watch)
--   change_reports    — Change Monitor: persisted per-site change reports
--
-- Idempotent (IF NOT EXISTS). RLS is ENABLED with NO policies → the
-- anon/publishable key can do nothing; the app's SECRET (service-role) key
-- bypasses RLS. History tables cascade-delete with their parent schedule
-- (deleting a monitor clears its history — no orphan rows, unlike the old
-- JSON files which lingered on disk).

-- ── form_watch_runs (Form Watch — one row per scheduled run) ──────────────────
create table if not exists public.form_watch_runs (
  id                uuid primary key default gen_random_uuid(),
  schedule_id       uuid not null references public.form_watch_schedules (id) on delete cascade,
  url               text not null,
  site              text not null,
  mode              text not null,
  ran_at            timestamptz not null,
  status            text not null,
  reason_code       text,
  submission_result text,
  duration_ms       int not null default 0,
  fingerprint       jsonb,
  notes             text[] not null default '{}',
  errors            text[] not null default '{}',
  created_at        timestamptz not null default now()
);
-- Lookup + newest-first ordering per schedule; also the prune sort key.
create index if not exists form_watch_runs_schedule_ran_idx
  on public.form_watch_runs (schedule_id, ran_at desc);

-- ── site_watch_runs (Site Watch — one row per check) ─────────────────────────
create table if not exists public.site_watch_runs (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.site_watch_schedules (id) on delete cascade,
  url         text not null,
  host        text not null,
  checked_at  timestamptz not null,
  uptime      jsonb not null,
  ssl         jsonb,
  domain      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists site_watch_runs_schedule_checked_idx
  on public.site_watch_runs (schedule_id, checked_at desc);

-- ── change_reports (Change Monitor — persisted per-site reports) ─────────────
-- `report_ts` is the report's own checkedAt ISO string (was the JSON filename);
-- kept as text so ordering + the returned key match the old behavior exactly.
create table if not exists public.change_reports (
  id         uuid primary key default gen_random_uuid(),
  site       text not null,
  report_ts  text not null,
  report     jsonb not null,
  created_at timestamptz not null default now(),
  unique (site, report_ts)
);
create index if not exists change_reports_site_ts_idx
  on public.change_reports (site, report_ts desc);

-- ── Lock everything down (service-role key bypasses RLS; public gets nothing) ─
alter table public.form_watch_runs enable row level security;
alter table public.site_watch_runs enable row level security;
alter table public.change_reports  enable row level security;
