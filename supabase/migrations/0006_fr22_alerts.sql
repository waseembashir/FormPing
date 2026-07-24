-- FormPing — FR-22: the alert delivery log.
--
-- SCHEMA-AGNOSTIC (see 0001's header): unqualified names, apply per-schema with
-- `set search_path to public;` (prod) or `set search_path to dev;` (dev) first.
-- Additive + forward-only + idempotent.
--
-- WHY
-- Alerts were fire-and-forget: Change Monitor, Form Watch and Site Watch each
-- POSTed straight to the Slack webhook with their own fetch(), with no shared
-- dispatcher, no rate limiting, no dedupe and no retry. Slack's incoming webhooks
-- allow roughly one message per second and can be disabled if abused, so three
-- tickers firing at once was a real risk of getting the webhook blocked.
--
-- This table is PLUMBING for the dispatcher, not a feature — nothing in the UI
-- reads it. It does exactly two jobs:
--
--   1. DEDUPE THAT SURVIVES A RESTART. `dedupe_key` is unique and identifies one
--      alert OCCURRENCE (it includes the event's own timestamp). In-memory dedupe
--      would be lost on redeploy — and watch processes RESUME after a redeploy,
--      which is precisely when a duplicate ping would happen.
--   2. A DELIVERY LOG. `delivery` records what each channel did, so "why didn't I
--      get an alert for X?" is answerable: sent / rejected / rate-limited /
--      breaker open / channel not configured.
--
-- Deliberately NOT stored here: the alert's full detail. That already lives in
-- `change_reports`, `site_watch_runs` and `form_watch_runs`, and the Slack message
-- links to the dashboard that renders it. Copying it here would duplicate data and
-- grow this table for no reader.
--
-- INTERNAL-ONLY: alerts describe technical findings and go to the team, never to
-- a client.
--
-- RLS enabled, no policies (anon key does nothing; server secret key bypasses).

create table if not exists alerts (
  id          uuid primary key default gen_random_uuid(),
  -- Which tool raised it: 'change' | 'form' | 'site'
  kind        text not null,
  -- What happened: 'changes_detected' | 'down' | 'recovered' | 'ssl_expiring' | ...
  event       text not null,
  -- 'info' | 'warning' | 'critical'
  severity    text not null default 'info',
  -- The headline we sent, so the log is readable without cross-referencing.
  title       text not null,
  site        text,                       -- hostname, when applicable
  url         text,                       -- the monitored URL, when applicable
  -- Stable per occurrence; unique, so a retry or a resumed watch cannot re-send.
  dedupe_key  text not null,
  -- Per-channel outcome: { slack: { ok, note, at } }
  delivery    jsonb,
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Idempotency: one row per alert occurrence. This is the dedupe mechanism.
create unique index if not exists alerts_dedupe_key_idx on alerts (dedupe_key);
-- Newest-first reads for debugging, and the prune sort key.
create index if not exists alerts_created_idx on alerts (created_at desc);

alter table alerts enable row level security;
