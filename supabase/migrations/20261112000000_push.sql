-- RYVO: Web Push reminders while the app is closed.
--
-- push_subscriptions  one row per device (browser push endpoint) that opted in, owned by one user.
-- push_deliveries     one row per reminder already sent to a device ("daily|<habit>|<date>",
--                     "weekly|<habit>|<weekStart>"): makes overlapping or repeated scheduler runs harmless.
-- private.push_config SHA-256 of the scheduler secret. The scheduler (server function on Vercel) calls the
--                     push_* scheduler functions with the anon key plus this secret; it never needs the
--                     service-role key. Set it once with the setup SQL (supabase/setup/reminders-cron.sql).
--
-- Access:
--   • Users (authenticated) can read and delete their own subscriptions (RLS) and register the current
--     device through push_register(). They can never read deliveries or another user's subscriptions.
--   • push_unregister(endpoint) removes a device by its endpoint (an unguessable URL that only the device
--     knows), also without a session: used on logout and account switch on shared devices.
--   • The scheduler functions are SECURITY DEFINER, check the secret first and expose only what sending
--     needs. Without the configured secret they raise and return nothing.
--
-- Safe to run more than once.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.push_config (
  id          boolean primary key default true check (id),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$')
);
revoke all on table private.push_config from public, anon, authenticated;

create table if not exists public.push_subscriptions (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint      text        not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2000),
  p256dh        text        not null check (char_length(p256dh) between 20 and 200),
  auth          text        not null check (char_length(auth) between 10 and 100),
  time_zone     text        not null check (char_length(time_zone) between 1 and 64),
  lang          text        not null default 'de' check (lang in ('de', 'en')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_sent_at  timestamptz,
  failures      integer     not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

create table if not exists public.push_deliveries (
  subscription_id uuid        not null references public.push_subscriptions (id) on delete cascade,
  reminder_key    text        not null check (char_length(reminder_key) <= 300),
  created_at      timestamptz not null default now(),
  primary key (subscription_id, reminder_key)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
-- push_deliveries: no policies, so no client role can see or change it (functions below only).

revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
revoke all on table public.push_deliveries from public, anon, authenticated, service_role;
grant select, delete on table public.push_subscriptions to authenticated;

-- ---------- client functions ----------

-- Registers (or refreshes) this device for the signed-in user. The endpoint is unique: if it belonged to
-- another user (shared device, account switch), it moves to the caller, with fresh keys and no history.
create or replace function public.push_register(p_endpoint text, p_p256dh text, p_auth text, p_time_zone text, p_lang text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if (select count(*) from public.push_subscriptions s where s.user_id = uid and s.endpoint <> p_endpoint) >= 20 then
    raise exception 'too many devices' using errcode = '54000';
  end if;
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id <> uid;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, time_zone, lang)
    values (uid, p_endpoint, p_p256dh, p_auth, p_time_zone, p_lang)
    on conflict (endpoint) do update
      set p256dh = excluded.p256dh, auth = excluded.auth, time_zone = excluded.time_zone, lang = excluded.lang,
          updated_at = now(), failures = 0
    returning id into sid;
  return sid;
end;
$$;

create or replace function public.push_unregister(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint;
$$;

-- ---------- scheduler functions (secret required) ----------

create or replace function public.push_check_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or not exists (
    select 1 from private.push_config c where c.secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- Every subscribed device with its owner's current records: habits and settings, plus entries, completions
-- and analyses dated on or after p_since ('YYYY-MM-DD'). Deleted records (tombstones) are excluded.
create or replace function public.push_due_data(p_secret text, p_since text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  out jsonb;
begin
  perform public.push_check_secret(p_secret);
  delete from public.push_deliveries d where d.created_at < now() - interval '40 days';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'user_id', s.user_id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
      'time_zone', s.time_zone, 'lang', s.lang,
      'records', (
        select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'data', r.data)), '[]'::jsonb)
        from public.records r
        where r.user_id = s.user_id and not r.deleted
          and (r.kind in ('habit', 'settings') or (r.kind in ('entry', 'completion', 'analysis') and r.data ->> 'date' >= p_since))
      )
    )), '[]'::jsonb)
    into out
    from public.push_subscriptions s;
  return out;
end;
$$;

-- Claims one reminder for one device. Returns false if it was already claimed (sent or being sent).
create or replace function public.push_claim(p_secret text, p_subscription uuid, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform public.push_check_secret(p_secret);
  insert into public.push_deliveries (subscription_id, reminder_key) values (p_subscription, p_key)
    on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- Outcome of one send: 'ok' | 'gone' (endpoint expired: device removed) | 'retry' (claim released so a later
-- run within the reminder window tries again).
create or replace function public.push_result(p_secret text, p_subscription uuid, p_key text, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.push_check_secret(p_secret);
  if p_outcome = 'ok' then
    update public.push_subscriptions s set last_sent_at = now(), failures = 0 where s.id = p_subscription;
  elsif p_outcome = 'gone' then
    delete from public.push_subscriptions s where s.id = p_subscription;
  elsif p_outcome = 'retry' then
    delete from public.push_deliveries d where d.subscription_id = p_subscription and d.reminder_key = p_key;
    update public.push_subscriptions s set failures = s.failures + 1 where s.id = p_subscription;
  else
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
end;
$$;

-- anon (the scheduler, and logout without a session) needs schema usage to call its functions. It still has no
-- privilege on any table: records and push tables are revoked from anon above and in the first migration.
grant usage on schema public to anon;

revoke all on function public.push_register(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.push_unregister(text) from public, anon, authenticated, service_role;
revoke all on function public.push_check_secret(text) from public, anon, authenticated, service_role;
revoke all on function public.push_due_data(text, text) from public, anon, authenticated, service_role;
revoke all on function public.push_claim(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.push_result(text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.push_register(text, text, text, text, text) to authenticated;
grant execute on function public.push_unregister(text) to anon, authenticated;
grant execute on function public.push_due_data(text, text) to anon;
grant execute on function public.push_claim(text, uuid, text) to anon;
grant execute on function public.push_result(text, uuid, text, text) to anon;
