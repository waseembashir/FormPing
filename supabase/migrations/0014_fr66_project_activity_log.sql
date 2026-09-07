-- FR-66 — a real record of who did what to a project, and when.
--
-- Attribution today is two columns on `projects` (created_by / updated_by), and
-- they cannot answer the question people actually ask. They hold ONE name each,
-- so every edit overwrites the last, nothing records WHAT changed, and an
-- unidentified write silently erases the previous name entirely.
--
-- This table records each action as its own row, so history accumulates instead
-- of overwriting. The columns on `projects` stay as the at-a-glance summary.
--
-- Idempotent + additive + forward-only. Run once per schema (public AND dev).

create table if not exists project_events (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  -- Display name of whoever acted, or NULL when nobody was signed in (local
  -- open-gate writes). Stored as text, not a user id: it must survive a person
  -- being removed from the team — a log that loses its names is not a log.
  actor       text,
  -- created | renamed | url_added | url_removed | notes_changed |
  -- contact_changed | share_enabled | share_disabled | viewed
  action      text not null,
  -- What it happened to: the URL added/removed, the new name, etc.
  target      text,
  created_at  timestamptz not null default now()
);

-- The log is read newest-first for one project, which is the only access path.
create index if not exists project_events_project_idx
  on project_events (project_id, created_at desc);

-- `on delete cascade` above means deleting a project takes its log with it —
-- the events describe that project and are meaningless without it.

-- Lock the table down, as every table here is. RLS ON with NO policies means the
-- anon/publishable key can do nothing with it, while the app's secret
-- (service-role) key bypasses RLS and has full access. Without this the log —
-- which names who on the team opened and edited a client's project — would be
-- readable through PostgREST by anyone holding the public key.
alter table project_events enable row level security;
