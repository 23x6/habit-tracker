import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type TestServer } from '../test/server';
import { accountDbName, StillDb } from './db';
import { ALL_DAYS, entryId, type Habit, type JournalEntry } from './model';
import { syncOnce } from './sync';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

const habit = (id: string, name = 'Lesen'): Habit => ({
  id, name, description: '', icon: 'book', kind: 'binary', unit: '', startDate: '2026-11-02',
  rules: [{ from: '2026-11-02', days: ALL_DAYS, target: 1 }], pauses: [], reminder: null, order: 0, createdAt: 1,
});
const journal = (id: string, notes: string, t = 1): JournalEntry => ({ id, date: '2026-11-09', title: '', notes, learned: '', createdAt: 1, updatedAt: t });
const entry = (habitId: string, date: string) => ({ id: entryId(habitId, date), habitId, date, value: 1, note: '', updatedAt: Date.now() });

let server: TestServer;
beforeAll(async () => {
  server = await createServer();
  await server.addUser(A);
  await server.addUser(B);
}, 60_000);

beforeEach(async () => {
  await server.pg.exec('delete from public.records');
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

// Two devices of the same account = two independent IndexedDB caches.
const device = (user: string, n: number) => new StillDb(`${accountDbName(user)}-device${n}`, true);

describe('server: row level security', () => {
  it('a user cannot read, change, delete or forge another user\'s rows', async () => {
    const ra = server.remote(A);
    await ra.push([{ kind: 'journal', id: 'j1', data: journal('j1', 'A privat'), deleted: false, base: 0, op: crypto.randomUUID() }]);

    expect(await server.as(B, 'select * from public.records')).toEqual([]);
    expect(await server.as(B, `update public.records set data = '{"x":1}' where user_id = $1 returning id`, [A])).toEqual([]);
    expect(await server.as(B, 'delete from public.records where user_id = $1 returning id', [A])).toEqual([]);
    await expect(
      server.as(B, `insert into public.records (user_id, kind, id, data) values ($1, 'journal', 'evil', '{}')`, [A]),
    ).rejects.toThrow(/row-level security/);
    // Changing ownership of an own row to someone else is rejected too.
    await server.remote(B).push([{ kind: 'journal', id: 'mine', data: journal('mine', 'B'), deleted: false, base: 0, op: crypto.randomUUID() }]);
    await expect(server.as(B, `update public.records set user_id = $1 where id = 'mine'`, [A])).rejects.toThrow(/row-level security/);

    // push_changes with the same id creates B's own row and never touches A's.
    const [res] = await server.remote(B).push([{ kind: 'journal', id: 'j1', data: journal('j1', 'B'), deleted: false, base: 0, op: crypto.randomUUID() }]);
    expect(res.status).toBe('ok');
    const aRows = await server.as<{ data: JournalEntry }>(A, `select data from public.records where id = 'j1'`);
    expect(aRows.map((r) => r.data.notes)).toEqual(['A privat']);

    // Anonymous and unauthenticated access is refused.
    await expect(server.as(null, 'select * from public.records')).rejects.toThrow(/permission denied/);
    await expect(server.as(null, `select public.push_changes('[]'::jsonb)`)).rejects.toThrow(/permission denied/);
    // Role authenticated but no user in the token: the function refuses.
    await server.pg.exec('set role authenticated');
    await expect(server.pg.query(`select public.push_changes('[]'::jsonb)`)).rejects.toThrow(/not authenticated/);
    await server.pg.exec('reset role');
  });

  it('a pull only ever returns the caller\'s rows', async () => {
    await server.remote(A).push([{ kind: 'habit', id: 'h', data: habit('h'), deleted: false, base: 0, op: crypto.randomUUID() }]);
    expect(await server.remote(B).pull(0, 100)).toEqual([]);
    expect((await server.remote(A).pull(0, 100)).map((r) => r.id)).toEqual(['h']);
  });
});

describe('sync engine', () => {
  it('offline changes stay queued, retry safely, and reach the second device', async () => {
    const d1 = device(A, 1);
    const d2 = device(A, 2);
    const r1 = server.remote(A);
    await d1.write([{ kind: 'habit', id: 'h', rec: habit('h') }, { kind: 'entry', id: entryId('h', '2026-11-09'), rec: entry('h', '2026-11-09') }]);
    r1.failNext(1);
    await expect(syncOnce(d1, r1)).rejects.toThrow(/fetch/);
    expect(await d1.pendingCount()).toBe(2);
    await syncOnce(d1, r1);
    expect(await d1.pendingCount()).toBe(0);
    await syncOnce(d2, server.remote(A));
    const s2 = await d2.loadAll();
    expect(s2.habits.map((h) => h.id)).toEqual(['h']);
    expect(s2.entries).toHaveLength(1);
  });

  it('a lost response is retried idempotently (no duplicate, no false conflict)', async () => {
    const d1 = device(A, 1);
    const r1 = server.remote(A);
    await d1.write([{ kind: 'journal', id: 'j', rec: journal('j', 'Text') }]);
    r1.failNext(1, 'after'); // server stored it, client never heard back
    await expect(syncOnce(d1, r1)).rejects.toThrow();
    const r = await syncOnce(d1, r1);
    expect(r).toMatchObject({ conflicts: 0, pushed: 1 });
    const rows = await server.as<{ version: string }>(A, `select version from public.records where id = 'j'`);
    expect(rows.map((x) => Number(x.version))).toEqual([1]);
    expect(await d1.conflicts()).toEqual([]);
  });

  it('deletions propagate to other devices', async () => {
    const d1 = device(A, 1);
    const d2 = device(A, 2);
    await d1.write([{ kind: 'journal', id: 'j', rec: journal('j', 'weg damit') }]);
    await syncOnce(d1, server.remote(A));
    await syncOnce(d2, server.remote(A));
    expect((await d2.loadAll()).journal).toHaveLength(1);
    await d1.write([{ kind: 'journal', id: 'j' }]);
    await syncOnce(d1, server.remote(A));
    await syncOnce(d2, server.remote(A));
    expect((await d2.loadAll()).journal).toEqual([]);
  });

  it('conflicting journal edits keep both texts until the user decides', async () => {
    const d1 = device(A, 1);
    const d2 = device(A, 2);
    await d1.write([{ kind: 'journal', id: 'j', rec: journal('j', 'Original') }]);
    await syncOnce(d1, server.remote(A));
    await syncOnce(d2, server.remote(A));
    // Both edit offline from the same version.
    await d1.write([{ kind: 'journal', id: 'j', rec: journal('j', 'Version Laptop', 2) }]);
    await d2.write([{ kind: 'journal', id: 'j', rec: journal('j', 'Version Handy', 3) }]);
    await syncOnce(d1, server.remote(A));
    const r = await syncOnce(d2, server.remote(A));
    expect(r.conflicts).toBe(1);
    const [c] = await d2.conflicts();
    expect((c.local as JournalEntry).notes).toBe('Version Handy');
    expect((c.server as JournalEntry).notes).toBe('Version Laptop');
    expect((await d2.loadAll()).journal[0].notes).toBe('Version Laptop'); // nothing overwritten silently
    // The user keeps the phone version: it wins everywhere.
    await d2.resolveConflict(c, 'local');
    await syncOnce(d2, server.remote(A));
    await syncOnce(d1, server.remote(A));
    expect((await d1.loadAll()).journal[0].notes).toBe('Version Handy');
    expect(await d2.conflicts()).toEqual([]);
  });

  it('edit on one device vs delete on another preserves the edited text', async () => {
    const d1 = device(A, 1);
    const d2 = device(A, 2);
    await d1.write([{ kind: 'journal', id: 'j', rec: journal('j', 'Original') }]);
    await syncOnce(d1, server.remote(A));
    await syncOnce(d2, server.remote(A));
    await d1.write([{ kind: 'journal', id: 'j' }]);
    await d2.write([{ kind: 'journal', id: 'j', rec: journal('j', 'Ergänzt', 2) }]);
    await syncOnce(d1, server.remote(A));
    await syncOnce(d2, server.remote(A));
    const [c] = await d2.conflicts();
    expect(c.server).toBeNull();
    expect((c.local as JournalEntry).notes).toBe('Ergänzt');
    expect((await d2.loadAll()).journal).toEqual([]); // deletion applied, text kept in the conflict
  });

  it('structured records: identical changes merge silently, different ones let the server win explicitly', async () => {
    const d1 = device(A, 1);
    const d2 = device(A, 2);
    await d1.write([{ kind: 'habit', id: 'h', rec: habit('h') }]);
    await syncOnce(d1, server.remote(A));
    await syncOnce(d2, server.remote(A));
    // Same day completed on both devices: deterministic id, same content → no conflict, no duplicate.
    await d1.write([{ kind: 'entry', id: entryId('h', '2026-11-09'), rec: entry('h', '2026-11-09') }]);
    await d2.write([{ kind: 'entry', id: entryId('h', '2026-11-09'), rec: entry('h', '2026-11-09') }]);
    await syncOnce(d1, server.remote(A));
    const r = await syncOnce(d2, server.remote(A));
    expect(r).toMatchObject({ conflicts: 0, serverWins: 0 });
    expect(await server.as(A, `select id from public.records where kind = 'entry'`)).toHaveLength(1);
    // Renamed differently on both: server (first writer) wins, reported, no conflict entry.
    await d1.write([{ kind: 'habit', id: 'h', rec: habit('h', 'Lesen (Laptop)') }]);
    await d2.write([{ kind: 'habit', id: 'h', rec: habit('h', 'Lesen (Handy)') }]);
    await syncOnce(d1, server.remote(A));
    const r2 = await syncOnce(d2, server.remote(A));
    expect(r2.serverWins).toBe(1);
    expect((await d2.loadAll()).habits[0].name).toBe('Lesen (Laptop)');
    expect(await d2.pendingCount()).toBe(0);
  });

  it('invalid server data is never stored locally', async () => {
    await server.as(A, `insert into public.records (user_id, kind, id, data) values ($1, 'journal', 'bad', '{"id":"bad","notes":""}')`, [A]);
    const d = device(A, 1);
    await syncOnce(d, server.remote(A));
    expect((await d.loadAll()).journal).toEqual([]);
  });

  it('two accounts on one device stay separated', async () => {
    const da = new StillDb(accountDbName(A), true);
    const db = new StillDb(accountDbName(B), true);
    await da.write([{ kind: 'journal', id: 'ja', rec: journal('ja', 'nur A') }]);
    await syncOnce(da, server.remote(A));
    await syncOnce(db, server.remote(B));
    expect((await db.loadAll()).journal).toEqual([]);
    expect((await da.loadAll()).journal.map((j) => j.id)).toEqual(['ja']);
  });
});
