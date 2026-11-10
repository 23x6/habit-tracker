-- RYVO push reminders: scheduler setup (run once in the Supabase SQL Editor, AFTER
-- supabase/migrations/20261112000000_push.sql).
--
-- Replace <CRON_SECRET> with the same random value that is set as CRON_SECRET in the Vercel
-- project (Settings → Environment Variables). Never commit the real value.
--
-- What it does:
--   1. enables pg_cron (scheduler) and pg_net (HTTP from Postgres);
--   2. stores the secret in Supabase Vault (used for the request header) and its SHA-256 in
--      private.push_config (checked by the push_* scheduler functions);
--   3. calls https://still-ashy-seven.vercel.app/api/reminders every 5 minutes.
-- Safe to run again (e.g. to rotate the secret).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  s text := '<CRON_SECRET>';
begin
  if exists (select 1 from vault.secrets where name = 'ryvo_reminders_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'ryvo_reminders_secret'), s);
  else
    perform vault.create_secret(s, 'ryvo_reminders_secret', 'RYVO push scheduler (same as CRON_SECRET on Vercel)');
  end if;
  insert into private.push_config (id, secret_hash) values (true, encode(sha256(convert_to(s, 'UTF8')), 'hex'))
    on conflict (id) do update set secret_hash = excluded.secret_hash;
end $$;

select cron.schedule(
  'ryvo-reminders',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://still-ashy-seven.vercel.app/api/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ryvo_reminders_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);

-- Check (after a few minutes): the latest responses of the scheduler calls.
--   select created, status_code, left(content, 200) from net._http_response order by created desc limit 5;
-- Stop it:
--   select cron.unschedule('ryvo-reminders');
