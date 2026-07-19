-- FormPing — FR-20: Site Watch daily rollup.
--
-- Charts over 7d / 30d / all-time can't come from the capped raw history
-- (site_watch_runs is capped at 200 rows — a 5-min monitor fills that in ~17h).
-- This table keeps ONE summarised row per URL per day, written by the Site Watch
-- ticker on every check, so the day-window aggregates + charts are truthful.
-- (Raw site_watch_runs stays for the fine-grained recent view.)
--
-- Idempotent. RLS enabled, no policies (anon key does nothing; server secret
-- key bypasses). url_key = normalizeUrl(url).toLowerCase() — same key everywhere.

create table if not exists public.site_watch_daily (
  url_key   text not null,
  day       date not null,               -- UTC calendar day
  checks    int  not null default 0,     -- total probes that counted (up+down)
  up        int  not null default 0,
  down      int  not null default 0,
  blocked   int  not null default 0,     -- couldn't check (bot protection etc.) — not an outage
  resp_sum  bigint not null default 0,   -- sum of 'up' response times (ms)
  resp_n    int  not null default 0,     -- count for the average
  ssl_min   int,                         -- lowest SSL days-remaining seen that day
  primary key (url_key, day)
);
create index if not exists site_watch_daily_url_day_idx on public.site_watch_daily (url_key, day desc);

alter table public.site_watch_daily enable row level security;
