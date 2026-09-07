-- FR-67 — carry every tool's run detail through to the per-URL dashboard.
--
-- 0012 did this for the manual Form Tester (form_tester_runs.detail). The
-- scheduled monitors compute the same richness and then drop it: their durable
-- per-URL rows keep only a status, a reason code and a timestamp, so adding a
-- monitor to a URL made its dashboard POORER than a one-off test of the same
-- page. These two columns close that.
--
-- Both are jsonb and nullable, so existing rows stay valid and the writers fall
-- back to the thin row when the column isn't there yet.
--
-- Idempotent + additive + forward-only. Run once per schema (public AND dev).

-- The Form Scheduler's last check: which form, its type, fields, multi-step,
-- confidence, bot protection, and the forms found alongside it.
alter table form_watch_results add column if not exists detail jsonb;

-- The Uptime & SSL monitor's last check: the certificate's issuer and expiry
-- date, the domain's registrar and expiry, and the error text when a check
-- fails. All of this is measured on every check and was being discarded.
alter table site_watch_results add column if not exists detail jsonb;
