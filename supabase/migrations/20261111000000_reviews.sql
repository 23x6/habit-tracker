-- RYVO: allow weekly reviews as a synchronized record kind.
--
-- Adds 'review' to the kinds accepted by public.records. Nothing else changes: the same RLS policies,
-- privileges and push_changes() apply to reviews exactly as to journal entries (one row per user, kind and id;
-- the id is the review's explicit week range, e.g. '2026-11-09_2026-11-15').
--
-- Must be applied BEFORE an app version that writes reviews is deployed: until then the server rejects the
-- kind and a push that contains a review fails (nothing is lost; the change waits in the device outbox).
--
-- Safe to run more than once, and before or after 20261110000000_still_records.sql has been re-run.

alter table public.records drop constraint if exists records_kind_check;
alter table public.records add constraint records_kind_check
  check (kind in ('habit', 'entry', 'completion', 'analysis', 'journal', 'settings', 'review'));
