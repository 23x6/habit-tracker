-- Still: per-user synchronized records.
--
-- One row per synced object (habit, daily entry, weekly completion, analysis, journal entry, settings).
-- `data` holds the client's JSON record; the client validates it on every pull.
--
-- Security model (does not rely on Supabase default grants or "auto-expose new tables"):
--   • Every privilege is revoked first, then only what the app needs is granted, to `authenticated` only:
--       table:    SELECT (pull), INSERT + UPDATE (used by push_changes, which runs with the caller's rights)
--       sequence: USAGE (nextval for the change counter)
--       function: EXECUTE on push_changes
--     No DELETE: rows are never deleted by clients; deletions sync as tombstones (deleted = true).
--     `anon` and `service_role` get nothing.
--   • Row Level Security is enabled and every operation (including DELETE, which is not granted anyway)
--     is restricted to rows where user_id = auth.uid().
--
-- Safe to run more than once.

-- ---------- objects ----------

create sequence if not exists public.records_seq;

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('habit', 'entry', 'completion', 'analysis', 'journal', 'settings')),
  id         text        not null check (char_length(id) between 1 and 200),
  data       jsonb,
  deleted    boolean     not null default false,
  -- Optimistic concurrency: a write must name the version it is based on.
  version    bigint      not null default 1,
  -- Id of the client operation that produced this version: makes retried writes idempotent.
  last_op    uuid,
  -- Monotonic change counter for incremental pulls.
  seq        bigint      not null default nextval('public.records_seq'),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id),
  constraint records_tombstone_or_data check (deleted or data is not null),
  constraint records_size check (data is null or pg_column_size(data) < 262144)
);

create index if not exists records_user_seq on public.records (user_id, seq);

-- ---------- row level security ----------

alter table public.records enable row level security;

-- Recreate this table's policies so a re-run always ends in exactly this state.
drop policy if exists records_select_own on public.records;
drop policy if exists records_insert_own on public.records;
drop policy if exists records_update_own on public.records;
drop policy if exists records_delete_own on public.records;

-- `(select auth.uid())` is evaluated once per statement instead of once per row.
create policy records_select_own on public.records
  for select to authenticated using (user_id = (select auth.uid()));
create policy records_insert_own on public.records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy records_update_own on public.records
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy records_delete_own on public.records
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- privileges (explicit; nothing inherited from defaults) ----------

grant usage on schema public to authenticated;

revoke all on table public.records from public, anon, authenticated, service_role;
grant select, insert, update on table public.records to authenticated;

revoke all on sequence public.records_seq from public, anon, authenticated, service_role;
grant usage on sequence public.records_seq to authenticated;

-- ---------- write API ----------

-- Applies a batch of client changes. Runs with the caller's rights (SECURITY INVOKER), so RLS applies.
-- Each change: {kind, id, data (json or null), deleted (bool), base (bigint), op (uuid)}.
-- Result per change: {kind, id, status: 'ok', version, seq} or {kind, id, status: 'conflict', current: row}.
create or replace function public.push_changes(changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c jsonb;
  cur public.records;
  res jsonb := '[]'::jsonb;
  v_kind text;
  v_id text;
  v_deleted boolean;
  v_data jsonb;
  v_base bigint;
  v_op uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 500 then
    raise exception 'changes must be an array of at most 500 items' using errcode = '22023';
  end if;

  for c in select * from jsonb_array_elements(changes) loop
    v_kind := c ->> 'kind';
    v_id := c ->> 'id';
    v_deleted := coalesce((c ->> 'deleted')::boolean, false);
    v_data := case when v_deleted then null else c -> 'data' end;
    v_base := coalesce((c ->> 'base')::bigint, 0);
    v_op := (c ->> 'op')::uuid;

    select * into cur from public.records r
      where r.user_id = uid and r.kind = v_kind and r.id = v_id
      for update;

    if not found then
      insert into public.records (user_id, kind, id, data, deleted, version, last_op)
        values (uid, v_kind, v_id, v_data, v_deleted, 1, v_op)
        on conflict do nothing
        returning * into cur;
      if cur.id is null then
        -- Inserted concurrently by another device: report as conflict.
        select * into cur from public.records r where r.user_id = uid and r.kind = v_kind and r.id = v_id;
        res := res || jsonb_build_object('kind', v_kind, 'id', v_id, 'status', 'conflict', 'current', to_jsonb(cur) - 'user_id' - 'last_op');
      else
        res := res || jsonb_build_object('kind', v_kind, 'id', v_id, 'status', 'ok', 'version', cur.version, 'seq', cur.seq);
      end if;
    elsif cur.last_op is not distinct from v_op and v_op is not null then
      -- Retry of an operation that was already applied (response was lost).
      res := res || jsonb_build_object('kind', v_kind, 'id', v_id, 'status', 'ok', 'version', cur.version, 'seq', cur.seq);
    elsif cur.version <> v_base then
      res := res || jsonb_build_object('kind', v_kind, 'id', v_id, 'status', 'conflict', 'current', to_jsonb(cur) - 'user_id' - 'last_op');
    else
      update public.records r
        set data = v_data, deleted = v_deleted, version = r.version + 1, last_op = v_op,
            seq = nextval('public.records_seq'), updated_at = now()
        where r.user_id = uid and r.kind = v_kind and r.id = v_id
        returning * into cur;
      res := res || jsonb_build_object('kind', v_kind, 'id', v_id, 'status', 'ok', 'version', cur.version, 'seq', cur.seq);
    end if;
  end loop;
  return res;
end;
$$;

revoke all on function public.push_changes(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.push_changes(jsonb) to authenticated;
