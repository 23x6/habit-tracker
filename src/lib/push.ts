import type { SupabaseClient } from '@supabase/supabase-js';

// Web Push on this device (opt-in). The browser subscription is registered for the signed-in user via
// push_register (supabase/migrations/20261112000000_push.sql); the server scheduler sends reminders to it.
// Only the public VAPID key is in the client; the private key stays on the server (api/, Vercel env).
//
// Ownership: `still-push-owner` remembers which user turned push on in this browser. When another user signs in
// on the same device, or a user signs out, push is turned off here, so a shared device never receives the
// previous user's reminders.

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const OWNER_KEY = 'still-push-owner';

export type PushSupport = 'ok' | 'needs-install' | 'unsupported' | 'not-configured';

export function pushSupport(): PushSupport {
  if (!VAPID) return 'not-configured';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return 'needs-install'; // iOS: Web Push only in the Home Screen app
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

export const pushOwner = (): string | null => {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
};
const setOwner = (userId: string | null) => {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* the server registration still decides who gets reminders */ }
};

/** Push is on in this browser for `userId` (used to skip the in-app reminders, so nothing alerts twice). */
export const pushActiveFor = (userId: string | null) => !!userId && pushOwner() === userId && 'Notification' in window && Notification.permission === 'granted';

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
  if (!reg) throw new Error('Service Worker nicht aktiv');
  return reg;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  try {
    return await (await registration()).pushManager.getSubscription();
  } catch {
    return null;
  }
}

function keyBytes(b64url: string): Uint8Array {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function register(client: SupabaseClient, sub: PushSubscription, lang: 'de' | 'en') {
  const keys = sub.toJSON().keys ?? {};
  const { error } = await client.rpc('push_register', {
    p_endpoint: sub.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
    p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', p_lang: lang,
  });
  if (error) throw new Error(error.message);
}

export type EnableResult = 'ok' | 'denied' | 'dismissed';

/** Call directly from the tap handler: iOS only shows the permission prompt for a user action. */
export async function enablePush(client: SupabaseClient, userId: string, lang: 'de' | 'en'): Promise<EnableResult> {
  const perm = await Notification.requestPermission();
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'dismissed';
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID!) as BufferSource }));
  await register(client, sub, lang);
  setOwner(userId);
  return 'ok';
}

/**
 * Turns push off in this browser: the server forgets the device (works without a session) and the browser
 * subscription is removed. Offline, the server learns it from the push service (410) at the next send.
 */
export async function disablePush(client: SupabaseClient | null) {
  const sub = await currentSubscription();
  setOwner(null);
  if (!sub) return;
  if (client) await Promise.race([client.rpc('push_unregister', { p_endpoint: sub.endpoint }), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * On start and after sign-in: refreshes this device's registration (time zone, language, rotated keys), or turns
 * push off if it belongs to another user. Returns whether push is on for `userId`.
 */
export async function refreshPush(client: SupabaseClient, userId: string, lang: 'de' | 'en'): Promise<boolean> {
  const sub = await currentSubscription();
  const owner = pushOwner();
  if (!sub) {
    if (owner) setOwner(null);
    return false;
  }
  if (owner !== userId || Notification.permission !== 'granted') {
    await disablePush(client);
    return false;
  }
  await register(client, sub, lang);
  return true;
}

export type TestResult = 'sent' | 'expired' | 'not-registered' | 'failed';

/** Asks the server to send a test notification to this device (proves the push path, not the schedule). */
export async function sendTestPush(client: SupabaseClient): Promise<TestResult> {
  const sub = await currentSubscription();
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!sub || !token) return 'not-registered';
  const r = await fetch('./api/push-test', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
  if (r.status === 200) return 'sent';
  if (r.status === 410) {
    await disablePush(client);
    return 'expired';
  }
  return r.status === 404 ? 'not-registered' : 'failed';
}
