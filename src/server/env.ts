import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Vapid } from './webpush.js';

// Server-only configuration (Vercel environment variables). The VAPID private key and the scheduler secret
// never reach the browser bundle: nothing here is imported by src/ client code, and none of these names has
// the VITE_ prefix except the public values the client also uses.

export function config() {
  const e = process.env;
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET'].filter((k) => !e[k]);
  if (missing.length) return { ok: false as const, missing };
  return {
    ok: true as const,
    supabaseUrl: e.VITE_SUPABASE_URL!,
    anonKey: e.VITE_SUPABASE_ANON_KEY!,
    cronSecret: e.CRON_SECRET!,
    vapid: { subject: e.VAPID_SUBJECT!, publicKey: e.VITE_VAPID_PUBLIC_KEY!, privateKey: e.VAPID_PRIVATE_KEY! } satisfies Vapid,
  };
}

/** Constant-time comparison of two secrets of any length. */
export function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

/** A Supabase client acting as anon (scheduler) or, with `accessToken`, as that signed-in user (RLS applies). */
export function supabaseAs(url: string, anonKey: string, accessToken?: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
