-- FormPing — FR-17: per-URL durable "last result" for scheduled monitors.
--
-- SCHEMA-AGNOSTIC (see 0001's header): unqualified names, apply per-schema with
-- `set search_path to public;` (prod) or `set search_path to dev;` (dev) first.
-- Additive + forward-only + idempotent.
--
-- Rule: stopping/deleting a monitor must NOT erase the result shown against the
-- project URL — only deleting the project does. Today Form/Site Watch results
-- live on the schedule row, so stopping the monitor loses them. These two
-- url-keyed tables hold the latest result per URL, written on every scheduled
-- run and surviving monitor stop/delete (mirrors form_tester_runs). They are
-- cleared only when the project is deleted (or the URL re-tested).
--
-- RLS enabled, no policies (anon key does nothing; server secret key bypasses).
-- url_key = normalizeUrl(url).toLowerCase() — same key Projects uses to match
-- URLs to monitors.

-- ── form_watch_results (Form Watch — last scheduled result per URL) ───────────
create table if not exists form_watch_results (
  url_key     text primary key,
  input_url   text not null,
  status      text not null,
  reason_code text,
  form_found  boolean not null default false,
  mode        text,
  ran_at      timestamptz not null default now()
);

-- ── site_watch_results (Site Watch — last check result per URL) ───────────────
create table if not exists site_watch_results (
  url_key               text primary key,
  input_url             text not null,
  classification        text,
  status_code           int,
  response_ms           int,
  ssl_days_remaining    int,
  ssl_valid             boolean,
  domain_days_remaining int,
  checked_at            timestamptz not null default now()
);

alter table form_watch_results enable row level security;
alter table site_watch_results enable row level security;
