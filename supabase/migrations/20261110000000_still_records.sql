-- Still: per-user synchronized records.
--
-- One row per synced object (habit, daily entry, weekly completion, analysis, journal entry, settings).
-- `data` holds the client's JSON record; the client validates it on every pull.
-- Ownership is enforced by Row Level Security for every operation; the client never sees other users' rows.

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

alter table public.records enable row level security;
alter table public.records force row level security;

drop policy if exists records_select_own on public.records;
drop policy if exists records_insert_own on public.records;
drop policy if exists records_update_own on public.records;
drop policy if exists records_delete_own on public.records;

create policy records_select_own on public.records
  for select to authenticated using (user_id = auth.uid());
create policy records_insert_own on public.records
  for insert to authenticated with check (user_id = auth.uid());
create policy records_update_own on public.records
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy records_delete_own on public.records
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.records from anon, public;
grant select, insert, update, delete on public.records to authenticated;
grant usage, select on sequence public.records_seq to authenticated;

-- Applies a batch of client changes. Runs with the caller's rights (SECURITY INVOKER), so RLS applies.
-- Each change: {kind, id, data (json or null), deleted (bool), base (bigint), op (uuid)}.
-- Result per change: {kind, id, status: 'ok', version, seq} or {kind, id, status: 'conflict', current: row}.
create or replace function public.push_changes(changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
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

revoke all on function public.push_changes(jsonb) from public, anon;
grant execute on function public.push_changes(jsonb) to authenticated;
