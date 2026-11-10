// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanHabit, habitErrors } from './io';
import { makeRule, type Habit } from './model';

// Device side of push: who owns the subscription in this browser, what happens on sign-out and account switch.
// The browser push APIs are replaced by a small fake; the server functions by a recording client.

const m = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 },
});

let subscription: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null;
const unsubscribed: string[] = [];
const makeSub = (endpoint: string) => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: async () => (unsubscribed.push(endpoint), (subscription = null), true),
});
const pushManager = { getSubscription: async () => subscription, subscribe: async () => (subscription = makeSub('https://push.test/new')) };
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
(window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
let permission: NotificationPermission = 'granted';
(window as unknown as { Notification: unknown }).Notification = { get permission() { return permission; }, requestPermission: async () => permission };

const calls: [string, Record<string, unknown>][] = [];
const client = { rpc: async (fn: string, args: Record<string, unknown>) => (calls.push([fn, args]), { error: null }) } as never;

async function load() {
  vi.resetModules();
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BElzMHDu0wD0qZfQ6Nc3EJx4F2nC9k8kJ8ZsQe3x2c1d');
  return import('./push');
}

beforeEach(() => {
  m.clear();
  calls.length = 0;
  unsubscribed.length = 0;
  subscription = null;
  permission = 'granted';
});

describe('push on this device', () => {
  it('enabling asks for permission first, subscribes, registers for the user and records the owner', async () => {
    const p = await load();
    expect(p.pushSupport()).toBe('ok');
    expect(await p.enablePush(client, 'user-a', 'de')).toBe('ok');
    expect(calls[0]).toEqual(['push_register', expect.objectContaining({ p_endpoint: 'https://push.test/new', p_p256dh: 'p', p_auth: 'a', p_lang: 'de' })]);
    expect(p.pushOwner()).toBe('user-a');
    expect(p.pushActiveFor('user-a')).toBe(true); // in-app reminders are skipped on this device
    expect(p.pushActiveFor('user-b')).toBe(false);
    permission = 'denied';
    subscription = null;
    expect(await p.enablePush(client, 'user-a', 'de')).toBe('denied');
  });

  it('another user on the same browser: the previous user’s subscription is removed, not taken over', async () => {
    const p = await load();
    await p.enablePush(client, 'user-a', 'de');
    calls.length = 0;
    expect(await p.refreshPush(client, 'user-b', 'en')).toBe(false);
    expect(calls).toEqual([['push_unregister', { p_endpoint: 'https://push.test/new' }]]);
    expect(unsubscribed).toEqual(['https://push.test/new']);
    expect(p.pushOwner()).toBeNull();
  });

  it('the owner’s start refreshes the registration (time zone, language); signing out turns push off', async () => {
    const p = await load();
    await p.enablePush(client, 'user-a', 'de');
    calls.length = 0;
    expect(await p.refreshPush(client, 'user-a', 'en')).toBe(true);
    expect(calls[0][0]).toBe('push_register');
    expect(calls[0][1].p_lang).toBe('en');
    calls.length = 0;
    await p.disablePush(client); // logout
    expect(calls).toEqual([['push_unregister', { p_endpoint: 'https://push.test/new' }]]);
    expect(unsubscribed).toHaveLength(1);
    expect(p.pushActiveFor('user-a')).toBe(false);
  });

  it('iPhone in Safari (not installed): push needs the Home Screen app', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)');
    const p = await load();
    expect(p.pushSupport()).toBe('needs-install');
    ua.mockRestore();
  });
});

describe('weekly reminder setting on habits', () => {
  const h = (o: Partial<Habit>): Habit => ({
    id: 'sub', name: 'Substack', description: '', icon: 'book', kind: 'weekly', unit: '', startDate: '2026-01-01',
    rules: [makeRule('2026-01-01', [0, 1, 2, 3, 4, 5, 6], 2)], pauses: [], reminder: null, order: 0, createdAt: 0, ...o,
  });
  it('is optional, validated and kept by sanitizing (sync pulls and imports)', () => {
    expect(habitErrors(h({}))).toEqual([]);
    expect(habitErrors(h({ weeklyReminder: null }))).toEqual([]);
    expect(habitErrors(h({ weeklyReminder: { day: 3, time: '18:00' } }))).toEqual([]);
    expect(habitErrors(h({ weeklyReminder: { day: 7, time: '18:00' } }))).toEqual(['reminderInvalid']);
    expect(habitErrors(h({ weeklyReminder: { day: 1, time: '24:00' } }))).toEqual(['reminderInvalid']);
    expect(cleanHabit(h({ weeklyReminder: { day: 3, time: '18:00' } })).weeklyReminder).toEqual({ day: 3, time: '18:00' });
    expect('weeklyReminder' in cleanHabit(h({}))).toBe(false);
  });
});
