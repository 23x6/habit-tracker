import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type TestServer } from '../test/server';
import { accountDbName, StillDb } from './db';
import { ALL_DAYS, entryId, type Habit, type JournalEntry } from './model';
import type { Change, PushResult, Remote } from './sync';
import { syncOnce } from './sync';

// Autosave guarantees: every confirmed change is committed locally together with its pending sync operation,
// survives a reload, reaches the server once connectivity returns, and is never lost to an in-flight sync.

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const habit = (id: string, name = 'Lesen'): Habit => ({
  id, name, description: '', icon: 'book', kind: 'binary', unit: '', startDate: '2026-11-02',
  rules: [{ from: '2026-11-02', days: ALL_DAYS, target: 1 }], pauses: [], reminder: null, order: 0, createdAt: 1,
});
const journal = (id: string, notes: string, t = 1): JournalEntry => ({ id, date: '2026-11-09', title: '', notes, learned: '', createdAt: 1, updatedAt: t });

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

const serverNotes = async (user: string, id: string) =>
  (await server.as<{ data: JournalEntry | null; deleted: boolean }>(user, 'select data, deleted from public.records where id = $1', [id])).map((r) => (r.deleted ? null : r.data?.notes));

describe('autosave and background sync', () => {
  it('pending operations survive a reload (new connection) and are pushed afterwards', async () => {
    const d = new StillDb(accountDbName(A), true);
    await d.write([{ kind: 'habit', id: 'h', rec: habit('h') }, { kind: 'entry', id: entryId('h', '2026-11-09'), rec: { id: entryId('h', '2026-11-09'), habitId: 'h', date: '2026-11-09', value: 1, note: '', updatedAt: 1 } }]);
    await d.close(); // app closed / crashed before any sync

    const reopened = new StillDb(accountDbName(A), true);
    expect(await reopened.pendingCount()).toBe(2);
    expect((await reopened.loadAll()).habits).toHaveLength(1);
    await syncOnce(reopened, server.remote(A));
    expect(await reopened.pendingCount()).toBe(0);
    expect(await server.as(A, 'select id from public.records order by id')).toHaveLength(2);
  });

  it('offline edits are kept, failed attempts drop nothing, and the latest version wins after reconnecting', async () => {
    const d = new StillDb(accountDbName(A), true);
    const r = server.remote(A);
    await d.write([{ kind: 'journal', id: 'j', rec: journal('j', 'v1') }]);
    r.failNext(3); // offline: three attempts fail
    for (let i = 0; i < 3; i++) await expect(syncOnce(d, r)).rejects.toThrow();
    await d.write([{ kind: 'journal', id: 'j', rec: journal('j', 'v2', 2) }]); // edited again while offline
    await d.write([{ kind: 'journal', id: 'k', rec: journal('k', 'neu') }]);
    expect(await d.pendingCount()).toBe(2);
    await syncOnce(d, r); // back online
    expect(await d.pendingCount()).toBe(0);
    expect(await serverNotes(A, 'j')).toEqual(['v2']);
    expect(await serverNotes(A, 'k')).toEqual(['neu']);
  });

  it('a lost response followed by a retry does not duplicate or conflict', async () => {
    const d = new StillDb(accountDbName(A), true);
    const r = server.remote(A);
    await d.write([{ kind: 'journal', id: 'j', rec: journal('j', 'einmal') }]);
    r.failNext(1, 'after');
    await expect(syncOnce(d, r)).rejects.toThrow();
    expect(await d.pendingCount()).toBe(1); // client doesn't know it arrived
    const rep = await syncOnce(d, r);
    expect(rep).toMatchObject({ pushed: 1, conflicts: 0 });
    expect(await server.as(A, `select version from public.records where id = 'j'`)).toEqual([{ version: 1 }]);
  });

  it('an edit made while a sync request is in flight is not acknowledged away and is pushed next', async () => {
    const d = new StillDb(accountDbName(A), true);
    const real = server.remote(A);
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let entered!: () => void;
    const inFlight = new Promise<void>((res) => (entered = res));
    const slow: Remote = {
      pull: real.pull,
      async push(changes: Change[]): Promise<PushResult[]> {
        entered();
        await gate; // the request is "on the wire"
        return real.push(changes);
      },
    };
    await d.write([{ kind: 'journal', id: 'j', rec: journal('j', 'alt') }]);
    const syncing = syncOnce(d, slow);
    await inFlight;
    await d.write([{ kind: 'journal', id: 'j', rec: journal('j', 'neu, während der Synchronisierung', 2) }]);
    release();
    await syncing;
    expect(await serverNotes(A, 'j')).toEqual(['alt']); // the older operation arrived …
    expect(await d.pendingCount()).toBe(1); // … but its acknowledgement kept the newer change queued
    expect((await d.loadAll()).journal[0].notes).toBe('neu, während der Synchronisierung');
    await syncOnce(d, real);
    expect(await serverNotes(A, 'j')).toEqual(['neu, während der Synchronisierung']);
    expect(await d.conflicts()).toEqual([]);
  });

  it('a failing local write stores nothing — neither the record nor its sync operation', async () => {
    const d = new StillDb(accountDbName(A), true);
    await d.write([{ kind: 'habit', id: 'ok', rec: habit('ok') }]);
    const before = await d.loadAll();
    const pendingBefore = await d.pendingCount();
    // A function can't be stored in IndexedDB: the transaction aborts as a whole.
    await expect(d.write([{ kind: 'habit', id: 'h2', rec: habit('h2') }, { kind: 'journal', id: 'bad', rec: { ...journal('bad', 'x'), oops: () => 1 } }])).rejects.toBeTruthy();
    expect(await d.loadAll()).toEqual(before);
    expect(await d.pendingCount()).toBe(pendingBefore);
  });
});

describe('drafts', () => {
  it('survive a reload, never count as entries and are never queued for sync', async () => {
    const d = new StillDb(accountDbName(A), true);
    await d.setMeta('draft:journal:new', { date: '2026-11-09', title: '', notes: 'halb fertig', learned: '' });
    await d.setMeta('draft:analysis:new:sub', { title: 'Artikel', url: '', date: '2026-11-09', learnings: '' });
    await d.close();
    const reopened = new StillDb(accountDbName(A), true);
    expect(await reopened.getMeta('draft:journal:new')).toMatchObject({ notes: 'halb fertig' });
    const s = await reopened.loadAll();
    expect(s.journal).toEqual([]);
    expect(s.analyses).toEqual([]);
    expect(await reopened.pendingCount()).toBe(0);
    await reopened.deleteMeta('draft:journal:new');
    expect(await reopened.getMeta('draft:journal:new')).toBeUndefined();
  });

  it('are isolated per account', async () => {
    await new StillDb(accountDbName(A), true).setMeta('draft:journal:new', { notes: 'A' });
    expect(await new StillDb(accountDbName(B), true).getMeta('draft:journal:new')).toBeUndefined();
  });
});
