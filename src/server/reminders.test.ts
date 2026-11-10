import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import webpush from 'web-push';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type TestServer } from '../test/server';
import { entryId, makeRule, type Habit } from '../lib/model';
import { runReminders, type DueSubscription, type SchedulerDeps, type SendOutcome } from './reminders';

// Scheduler against the real migrations (PGlite, RLS active, roles as on Supabase). The scheduler acts as `anon`
// with the secret, exactly like api/reminders.ts; users act as `authenticated`.

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const SECRET = 'test-secret-' + 'x'.repeat(40);
const ALL = [0, 1, 2, 3, 4, 5, 6];
const WED_1802 = new Date('2026-11-11T17:02:00Z'); // 18:02 in Berlin
const ep = (n: string) => `https://push.example.test/${n}`;
const P256 = 'B' + 'A'.repeat(86); // shape-valid placeholder keys for subscriptions that are never encrypted to
const AUTH = 'A'.repeat(22);

const habit = (o: Partial<Habit> & { id: string }): Habit => ({
  name: o.id, description: '', icon: 'book', kind: 'binary', unit: '', startDate: '2026-01-01',
  rules: [makeRule('2026-01-01', ALL, 1)], pauses: [], reminder: '18:00', order: 0, createdAt: 0, ...o,
});

let server: TestServer;
beforeAll(async () => {
  server = await createServer();
  await server.addUser(A);
  await server.addUser(B);
  await server.pg.query(`insert into private.push_config (secret_hash) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [SECRET]);
}, 60_000);
beforeEach(async () => {
  await server.pg.exec('delete from public.records; delete from public.push_subscriptions;');
});

const register = (user: string, endpoint: string, tz = 'Europe/Berlin', lang = 'de') =>
  server.as(user, 'select public.push_register($1, $2, $3, $4, $5) as id', [endpoint, P256, AUTH, tz, lang]);
const put = (user: string, kind: string, id: string, data: unknown) =>
  server.remote(user).push([{ kind: kind as never, id, data, deleted: false, base: 0, op: crypto.randomUUID() }]);

/** Scheduler deps on the test database; `send` records deliveries and answers with the queued outcomes. */
function deps(outcomes: SendOutcome[] = []) {
  const sent: { endpoint: string; payload: { title: string; body: string; url: string; tag: string } }[] = [];
  const call = async <T,>(sql: string, params: unknown[]) => (await server.as<{ r: T }>(null, sql, params))[0].r;
  const d: SchedulerDeps = {
    dueData: (since) => call<DueSubscription[]>('select public.push_due_data($1, $2) as r', [SECRET, since]),
    claim: (id, key) => call<boolean>('select public.push_claim($1, $2, $3) as r', [SECRET, id, key]),
    result: async (id, key, outcome) => void (await server.as(null, 'select public.push_result($1, $2, $3, $4)', [SECRET, id, key, outcome])),
    send: async (sub, payload) => {
      const o = outcomes.shift() ?? 'ok';
      if (o === 'ok') sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return o;
    },
  };
  return { d, sent };
}

describe('push scheduler on the real migrations', () => {
  it('sends only open, scheduled, non-archived reminders, from the latest synced records; deleted habits never', async () => {
    await register(A, ep('a-phone'));
    await put(A, 'habit', 'read', habit({ id: 'read', name: 'Lesen', kind: 'numeric', unit: 'Seiten', rules: [makeRule('2026-01-01', ALL, 10)] }));
    await put(A, 'entry', entryId('read', '2026-11-11'), { id: entryId('read', '2026-11-11'), habitId: 'read', date: '2026-11-11', value: 3, note: '', updatedAt: 1 });
    await put(A, 'habit', 'gym', habit({ id: 'gym' }));
    await put(A, 'entry', entryId('gym', '2026-11-11'), { id: entryId('gym', '2026-11-11'), habitId: 'gym', date: '2026-11-11', value: 1, note: '', updatedAt: 1 });
    await put(A, 'habit', 'old', habit({ id: 'old', pauses: [{ from: '2026-11-01', to: null }] }));
    await put(A, 'habit', 'sub', habit({ id: 'sub', kind: 'weekly', reminder: null, rules: [makeRule('2026-01-01', ALL, 1)], weeklyReminder: { day: 3, time: '18:00' } }));
    await put(A, 'analysis', 'a1', { id: 'a1', habitId: 'sub', date: '2026-11-10', title: 'T', url: '', learnings: 'L', createdAt: 1, updatedAt: 1 });
    await server.remote(A).push([{ kind: 'habit', id: 'gone', data: null, deleted: true, base: 0, op: crypto.randomUUID() }]);

    const { d, sent } = deps();
    const rep = await runReminders(d, WED_1802);
    expect(sent.map((s) => [s.endpoint, s.payload.title, s.payload.body, s.payload.url])).toEqual([[ep('a-phone'), 'Lesen', 'Noch offen: 3/10 Seiten', './?habit=read']]);
    expect(rep).toMatchObject({ devices: 1, due: 1, sent: 1 });

    // The completion syncs → the next reminder of the day is suppressed. (Offline completions only count once synced.)
    await server.remote(A).push([{ kind: 'entry', id: entryId('read', '2026-11-12'), data: { id: entryId('read', '2026-11-12'), habitId: 'read', date: '2026-11-12', value: 10, note: '', updatedAt: 2 }, deleted: false, base: 0, op: crypto.randomUUID() }]);
    const next = deps();
    await runReminders(next.d, new Date('2026-11-12T17:02:00Z'));
    expect(next.sent.map((s) => s.payload.title)).toEqual(['gym']); // Lesen 10/10 synced: no reminder; gym is open again
  });

  it('duplicate and overlapping scheduler runs send each reminder once per device; every device gets its own', async () => {
    await register(A, ep('a-phone'));
    await register(A, ep('a-laptop'), 'Europe/Berlin', 'en');
    await put(A, 'habit', 'gym', habit({ id: 'gym', name: 'Gym' }));
    const { d, sent } = deps();
    const reps = await Promise.all([runReminders(d, WED_1802), runReminders(d, WED_1802), runReminders(d, new Date(WED_1802.getTime() + 5 * 60000))]);
    expect(sent.map((s) => `${s.endpoint} ${s.payload.body}`).sort()).toEqual([`${ep('a-laptop')} Still open today`, `${ep('a-phone')} Heute noch offen`]);
    expect(reps.reduce((n, r) => n + r.duplicate, 0)).toBe(4);
  });

  it('a failed send is retried by a later run within the hour, and dropped after it; expired devices are removed', async () => {
    await register(A, ep('a-phone'));
    await put(A, 'habit', 'gym', habit({ id: 'gym' }));
    const flaky = deps(['retry', 'retry']);
    await runReminders(flaky.d, WED_1802);
    await runReminders(flaky.d, new Date('2026-11-11T17:07:00Z'));
    expect(flaky.sent).toEqual([]);
    await runReminders(flaky.d, new Date('2026-11-11T17:12:00Z'));
    expect(flaky.sent).toHaveLength(1);
    expect((await server.pg.query<{ failures: number }>('select failures from public.push_subscriptions')).rows[0].failures).toBe(0);

    await put(A, 'habit', 'late', habit({ id: 'late', reminder: '18:30' }));
    const offline = deps(['retry']);
    await runReminders(offline.d, new Date('2026-11-11T17:31:00Z')); // fails
    await runReminders(offline.d, new Date('2026-11-11T18:31:00Z')); // 19:31: window over, not sent late
    expect(offline.sent).toEqual([]);

    await put(A, 'habit', 'eve', habit({ id: 'eve', reminder: '20:00' }));
    const expired = deps(['gone']);
    const rep = await runReminders(expired.d, new Date('2026-11-11T19:01:00Z'));
    expect(rep.gone).toBe(1);
    expect((await server.pg.query('select * from public.push_subscriptions')).rows).toEqual([]);
  });

  it('accounts are isolated: each device gets only its owner’s reminders; users can’t read others or the scheduler data', async () => {
    await register(A, ep('a-phone'));
    await register(B, ep('b-phone'), 'America/New_York', 'en');
    await put(A, 'habit', 'a-habit', habit({ id: 'a-habit', name: 'A habit', reminder: '18:00' }));
    await put(B, 'habit', 'b-habit', habit({ id: 'b-habit', name: 'B habit', reminder: '12:00' }));
    const { d, sent } = deps();
    await runReminders(d, WED_1802); // 18:02 Berlin = 12:02 New York
    expect(sent.map((s) => `${s.endpoint} ${s.payload.title}`).sort()).toEqual([`${ep('a-phone')} A habit`, `${ep('b-phone')} B habit`]);

    expect(await server.as(A, 'select endpoint from public.push_subscriptions')).toEqual([{ endpoint: ep('a-phone') }]);
    expect(await server.as(B, 'delete from public.push_subscriptions where endpoint = $1 returning endpoint', [ep('a-phone')])).toEqual([]);
    await expect(server.as(A, 'select public.push_due_data($1, $2)', [SECRET, '2026-01-01'])).rejects.toThrow(/permission denied/);
    await expect(server.as(null, 'select public.push_due_data($1, $2)', ['wrong', '2026-01-01'])).rejects.toThrow(/forbidden/);
    await expect(server.as(null, 'select * from public.push_subscriptions')).rejects.toThrow(/permission denied/);
    await expect(server.as(A, 'select * from public.push_deliveries')).rejects.toThrow(/permission denied/);
    await expect(server.as(A, 'select * from private.push_config')).rejects.toThrow(/permission denied/);
    await expect(server.as(null, `select public.push_register($1, $2, $3, 'UTC', 'de')`, [ep('x'), P256, AUTH])).rejects.toThrow();
  });

  it('logout and account switch on a shared device: the device stops getting the previous user’s reminders', async () => {
    await register(A, ep('shared'));
    await put(A, 'habit', 'a-habit', habit({ id: 'a-habit', name: 'A habit' }));
    await put(B, 'habit', 'b-habit', habit({ id: 'b-habit', name: 'B habit' }));

    // Logout: the app unregisters the endpoint (works without a session, too).
    await server.as(null, 'select public.push_unregister($1)', [ep('shared')]);
    const afterLogout = deps();
    await runReminders(afterLogout.d, WED_1802);
    expect(afterLogout.sent).toEqual([]);

    // A turns push on again, then B signs in on the same browser and turns it on: the endpoint moves to B.
    await register(A, ep('shared'));
    await register(B, ep('shared'));
    expect((await server.pg.query<{ user_id: string }>('select user_id from public.push_subscriptions')).rows).toEqual([{ user_id: B }]);
    const switched = deps();
    await runReminders(switched.d, WED_1802);
    expect(switched.sent.map((s) => s.payload.title)).toEqual(['B habit']);
  });
});

describe('web push message', () => {
  it('is encrypted for the subscription (RFC 8291) and signed with VAPID; the device decrypts the payload', async () => {
    const device = createECDH('prime256v1');
    device.generateKeys();
    const auth = randomBytes(16);
    const vapid = webpush.generateVAPIDKeys();
    const payload = JSON.stringify({ kind: 'reminder', title: 'Lesen', body: 'Noch offen: 3/10 Seiten', url: './?habit=read', tag: 'daily|read|2026-11-11' });
    const req = webpush.generateRequestDetails(
      { endpoint: 'https://push.example.test/x', keys: { p256dh: device.getPublicKey('base64url'), auth: auth.toString('base64url') } },
      payload,
      { vapidDetails: { subject: 'https://still-ashy-seven.vercel.app/', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 3600 },
    );
    expect(req.headers['Content-Encoding']).toBe('aes128gcm');
    expect(String(req.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    expect(req.headers.TTL).toBe(3600);
    const ece = createRequire(import.meta.url)('http_ece') as { decrypt: (b: Buffer, p: object) => Buffer };
    const plain = ece.decrypt(req.body as Buffer, { version: 'aes128gcm', privateKey: device, authSecret: auth.toString('base64url') });
    expect(JSON.parse(plain.toString())).toMatchObject({ title: 'Lesen', url: './?habit=read' });
  });
});
