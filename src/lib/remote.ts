import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RemoteRow } from './db';
import type { Change, PushResult, Remote } from './sync';

// Only the public project URL and the publishable (anon) key belong in the client. Never a service-role key:
// all access goes through Row Level Security as the signed-in user.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const backendConfigured = !!(url && key);

export const supabase: SupabaseClient | null = backendConfigured
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export function supabaseRemote(client: SupabaseClient, userId: string): Remote {
  return {
    async push(changes: Change[]): Promise<PushResult[]> {
      const { data, error } = await client.rpc('push_changes', { changes });
      if (error) throw new Error(error.message);
      return data as PushResult[];
    },
    async pull(since: number, limit: number): Promise<RemoteRow[]> {
      const { data, error } = await client
        .from('records')
        .select('kind,id,data,deleted,version,seq,updated_at')
        .eq('user_id', userId) // RLS already restricts rows; the filter lets Postgres use the (user_id, seq) index
        .gt('seq', since)
        .order('seq', { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ ...r, version: Number(r.version), seq: Number(r.seq) })) as RemoteRow[];
    },
  };
}
