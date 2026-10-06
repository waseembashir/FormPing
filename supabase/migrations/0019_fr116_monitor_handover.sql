-- FR-116 — handing a monitor to somebody else.
--
-- A URL is watched by one person, and since per-user isolation only that person
-- can see or manage their monitors. That is right until they go on leave, or
-- leave: a client's form is then checked by somebody unreachable, nobody else
-- can pause it, re-point it or stop it, and its alerts land in an inbox nobody
-- is reading. The only way to take a URL over was to ask the colleague to stop
-- their monitor, which only works while they are still around to ask.
--
-- The alternative considered was letting admins read everyone's tool tabs. It
-- was rejected on 2026-10-05: that makes isolation conditional for everybody,
-- permanently, to solve something that happens occasionally. Reassignment keeps
-- the exception an explicit act somebody chose, on one monitor, at one moment.
--
-- **The handover itself needs no column.** It is an update of `owner`, which
-- already exists, and alert routing follows for free because it reads that same
-- column. These two record the EVENT, not the ownership:
--
--   `assigned_at`  -- when it was handed over
--   `assigned_by`  -- who did the handing
--
-- They exist so the new owner is told. A monitor appearing quietly among a
-- dozen others is not the same as knowing it is now yours, so the card says so
-- for a week and then stops. "Until it has been seen" was considered and
-- dropped: it means writing to the database every time somebody loads a page —
-- a write on a read, racing the polling the tab already does — to replace a
-- window that does the same job with the one write that actually happened.
--
-- Deliberately NOT here: a `change_events` equivalent. Content-change tracking
-- has no schedule row, so ownership is a property of each run rather than of a
-- monitor; there is nothing to hand over, and rewriting past runs would
-- misreport who performed them. See the note on FR-116.
--
-- Nothing is backfilled. NULL means "never handed over", which is true of every
-- monitor that exists today, and reads as no notice to show.
--
-- Additive and idempotent: four nullable columns with no defaults do not
-- rewrite either table and do not touch a single existing row.
--
-- Run once per schema: `public` first, then `dev` -- see the README in this
-- folder for why that order, and verify both afterwards.

alter table form_watch_schedules add column if not exists assigned_at timestamptz;
alter table form_watch_schedules add column if not exists assigned_by text;

alter table site_watch_schedules add column if not exists assigned_at timestamptz;
alter table site_watch_schedules add column if not exists assigned_by text;
