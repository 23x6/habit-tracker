import { PGlite } from '@electric-sql/pglite';
import migration from '../../supabase/migrations/20261110000000_still_records.sql?raw';
import type { RemoteRow } from '../lib/db';
import type { Change, PushResult, Remote } from '../lib/sync';

// Test backend: an in-process Postgres (PGlite) running the real migration from supabase/migrations, with a
// minimal stand-in for Supabase's auth schema (auth.users, auth.uid() from the JWT claim, the roles).
// Queries run as the `authenticated` role with RLS active, exactly as PostgREST would run them.
//
// grants: 'none'       → like a project with "automatically expose new tables" disabled: no default grants and
//                        no schema usage for app roles; the migration must grant everything it needs itself.
//         'permissive' → Supabase-style default privileges hand everything to anon/authenticated/service_role;
//                        the migration must revoke what it doesn't need.

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  revoke all on schema public from public;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

const PERMISSIVE_DEFAULTS = `
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export interface TestServer {
  pg: PGlite;
  addUser(id: string): Promise<void>;
  /** Run SQL as a signed-in user (role authenticated, RLS enforced). */
  as<T = Record<string, unknown>>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  remote(userId: string): Remote & { failNext: (n: number, mode?: 'before' | 'after') => void };
}

export async function createServer(grants: 'none' | 'permissive' = 'none'): Promise<TestServer> {
  const pg = await PGlite.create();
  await pg.exec(AUTH_STUB);
  if (grants === 'permissive') await pg.exec(PERMISSIVE_DEFAULTS);
  await pg.exec(migration);
  await pg.exec(migration); // the migration must be safe to re-run

  // PGlite has one connection: serialize "set role → query → reset" so users never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const as = <T,>(userId: string | null, sql: string, params: unknown[] = []) => {
    const run = chain.then(async () => {
      await pg.exec(`set role ${userId ? 'authenticated' : 'anon'}`);
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
      try {
        return (await pg.query<T>(sql, params)).rows;
      } finally {
        await pg.exec('reset role');
        await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
      }
    });
    chain = run.catch(() => {});
    return run;
  };

  return {
    pg,
    addUser: async (id) => void (await pg.query('insert into auth.users (id) values ($1)', [id])),
    as,
    remote(userId) {
      // failNext(n, 'before'): request never reaches the server (offline).
      // failNext(n, 'after'):  server applies the change but the response is lost.
      let fail = 0;
      let mode: 'before' | 'after' = 'before';
      return {
        failNext: (n, m = 'before') => {
          fail = n;
          mode = m;
        },
        async push(changes: Change[]): Promise<PushResult[]> {
          if (fail > 0 && mode === 'before') {
            fail--;
            throw new Error('Failed to fetch');
          }
          const [row] = await as<{ r: PushResult[] }>(userId, 'select public.push_changes($1::jsonb) as r', [JSON.stringify(changes)]);
          if (fail > 0 && mode === 'after') {
            fail--;
            throw new Error('Failed to fetch');
          }
          return row.r.map((r) => (r.status === 'conflict' ? { ...r, current: { ...r.current, version: Number(r.current.version), seq: Number(r.current.seq) } } : r));
        },
        async pull(since: number, limit: number): Promise<RemoteRow[]> {
          if (fail > 0 && mode === 'before') {
            fail--;
            throw new Error('Failed to fetch');
          }
          const rows = await as<RemoteRow & { updated_at: Date }>(
            userId,
            'select kind, id, data, deleted, version, seq, updated_at from public.records where seq > $1 order by seq limit $2',
            [since, limit],
          );
          return rows.map((r) => ({ ...r, version: Number(r.version), seq: Number(r.seq), updated_at: new Date(r.updated_at).toISOString() }));
        },
      };
    },
  };
}
