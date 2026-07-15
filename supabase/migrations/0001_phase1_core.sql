-- FormPing — Supabase Phase 1 schema (core stores)
-- Table names mirror the app's tools so the DB is self-explanatory:
--   projects              — Projects
--   form_tester_runs      — Forms → Test a form (on-demand manual runs)
--   form_watch_schedules  — Forms → Scheduled monitors (Form Watch)
--   site_watch_schedules  — Site → Uptime & SSL (Site Watch)
--   dismissed_urls        — Projects "Don't track" list
-- (Phase 2 adds form/site run history + change_reports.)
--
-- Idempotent (IF NOT EXISTS / OR REPLACE). RLS is ENABLED with NO policies →
-- the anon/publishable key can do nothing; the app's SECRET (service-role) key
-- bypasses RLS, so the DB is locked down while server code has full access.

-- ── Shared: auto-maintain updated_at on UPDATE ──────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── projects ─────────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  urls         text[] not null default '{}',
  notes        text,
  contact      text,
  share_token  text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists projects_share_token_idx on public.projects (share_token);
drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ── form_watch_schedules (Form Watch — one per URL) ──────────────────────────
create table if not exists public.form_watch_schedules (
  id               uuid primary key default gen_random_uuid(),
  url              text not null unique,
  site             text not null,
  interval_ms      bigint not null,
  mode             text not null default 'live',
  landing_page     boolean not null default false,
  created_at       timestamptz not null default now(),
  last_run_at      timestamptz,
  next_run_at      timestamptz not null,
  paused           boolean not null default false,
  last_status      text,
  last_reason_code text,
  last_form_found  boolean
);
create index if not exists form_watch_schedules_next_run_idx on public.form_watch_schedules (next_run_at);

-- ── site_watch_schedules (Site Watch — one per URL) ──────────────────────────
create table if not exists public.site_watch_schedules (
  id                            uuid primary key default gen_random_uuid(),
  url                           text not null unique,
  host                          text not null,
  interval_ms                   bigint not null,
  created_at                    timestamptz not null default now(),
  last_checked_at               timestamptz,
  next_check_at                 timestamptz not null,
  paused                        boolean not null default false,
  consecutive_down              int not null default 0,
  alerted_down                  boolean not null default false,
  last_ssl_threshold_alerted    int,
  last_domain_threshold_alerted int,
  last_classification           text,
  last_status_code              int,
  last_response_ms              int,
  last_ssl_days_remaining       int,
  last_ssl_valid                boolean,
  last_domain_days_remaining    int,
  last_domain_valid             boolean,
  last_domain_expiry            text,
  last_domain_checked_at        timestamptz,
  last_domain_registrar         text
);
create index if not exists site_watch_schedules_next_check_idx on public.site_watch_schedules (next_check_at);

-- ── dismissed_urls (Projects "Don't track" list, by normalized key) ──────────
create table if not exists public.dismissed_urls (
  url_key    text primary key,
  created_at timestamptz not null default now()
);

-- ── form_tester_runs (Form Tester — last manual run per URL) ─────────────────
create table if not exists public.form_tester_runs (
  url_key      text primary key,
  input_url    text not null,
  final_status text not null,
  reason_code  text,
  mode         text,
  form_found   boolean not null default false,
  duration_ms  int not null default 0,
  ran_at       timestamptz not null default now()
);

-- ── Lock everything down (service-role key bypasses RLS; public gets nothing) ─
alter table public.projects             enable row level security;
alter table public.form_watch_schedules enable row level security;
alter table public.site_watch_schedules enable row level security;
alter table public.dismissed_urls       enable row level security;
alter table public.form_tester_runs     enable row level security;
