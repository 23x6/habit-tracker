import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, migrations, type TestServer } from '../test/server';
import { accountDbName, StillDb } from './db';
import type { Review } from './model';
import { toReview } from './review';
import { syncOnce } from './sync';

// Weekly reviews on the real migrations (PGlite, RLS active): migration order, offline edits, reloads,
// reconnection, concurrent edits on two devices and account separation.

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const review = (start: string, end: string, wentWell: string, t = 1) => toReview(start, end, { wentWell, heldBack: '', nextWeek: '' }, undefined, t)!;
const op = (r: Review) => ({ kind: 'review' as const, id: r.id, rec: r });
const serverText = async (s: TestServer, user: string, id: string) =>
  (await s.as<{ data: Review | null }>(user, `select data from public.records where kind = 'review' and id = $1`, [id])).map((r) => r.data?.wentWell);

describe('migration 20261111000000_reviews', () => {
  it('an existing project rejects reviews until the migration runs; afterwards they sync and old rows are untouched', async () => {
    const s = await createServer('none', 1); // project as deployed before this release
    await s.addUser(A);
    const r = s.remote(A);
    await r.push([{ kind: 'journal', id: 'j', data: { id: 'j' }, deleted: false, base: 0, op: crypto.randomUUID() }]);
    const rv = review('2026-11-02', '2026-11-08', 'gut');
    await expect(r.push([{ kind: 'review', id: rv.id, data: rv, deleted: false, base: 0, op: crypto.randomUUID() }])).rejects.toThrow(/records_kind_check/);

    await s.pg.exec(migrations[1]);
    await s.pg.exec(migrations[1]); // safe to re-run
    await s.pg.exec(migrations[0]); // and the first migration stays safe to re-run after it
    const [res] = await r.push([{ kind: 'review', id: rv.id, data: rv, deleted: false, base: 0, op: crypto.randomUUID() }]);
    expect(res).toMatchObject({ status: 'ok', version: 1 });
    expect(await s.as(A, `select kind, id from public.records order by kind`)).toEqual([{ kind: 'journal', id: 'j' }, { kind: 'review', id: rv.id }]);
    await expect(r.push([{ kind: 'bogus' as never, id: 'x', data: {}, deleted: false, base: 0, op: crypto.randomUUID() }])).rejects.toThrow();
  }, 60_000);
});

describe('weekly review sync', () => {
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

  it('offline edits survive a reload and reach the other device after reconnecting; editing an earlier review updates it', async () => {
    const phone = new StillDb(accountDbName(A), true);
    const r = server.remote(A);
    const v1 = review('2026-11-02', '2026-11-08', 'Morgenroutine hielt');
    await phone.write([op(v1)]);
    r.failNext(2); // offline
    await expect(syncOnce(phone, r)).rejects.toThrow();
    await phone.close(); // app closed while offline

    const reopened = new StillDb(accountDbName(A), true);
    expect((await reopened.loadAll()).reviews).toEqual([v1]); // text restored after reopening
    expect(await reopened.pendingCount()).toBe(1);
    await expect(syncOnce(reopened, r)).rejects.toThrow(); // still offline
    await syncOnce(reopened, r); // reconnected
    expect(await reopened.pendingCount()).toBe(0);
    expect(await serverText(server, A, v1.id)).toEqual(['Morgenroutine hielt']);

    // Editing the earlier week later (a newer week exists too) updates the same record.
    await reopened.write([op(review('2026-11-09', '2026-11-15', 'neue Woche', 2))]);
    await reopened.write([op(toReview(v1.weekStart, v1.weekEnd, { wentWell: 'Morgenroutine hielt – fast', heldBack: 'Reisen', nextWeek: '' }, v1, 3)!)]);
    await syncOnce(reopened, r);
    expect(await server.as(A, `select id, version from public.records where kind = 'review' order by id`)).toEqual([
      { id: '2026-11-02_2026-11-08', version: 2 },
      { id: '2026-11-09_2026-11-15', version: 1 },
    ]);

    const laptop = new StillDb(accountDbName(A) + '-laptop', true);
    await syncOnce(laptop, r);
    const got = (await laptop.loadAll()).reviews.find((x) => x.id === v1.id)!;
    expect(got).toMatchObject({ wentWell: 'Morgenroutine hielt – fast', heldBack: 'Reisen' });
  });

  it('concurrent edits of the same week on two devices keep both texts until the user chooses', async () => {
    const r = server.remote(A);
    const phone = new StillDb(accountDbName(A), true);
    const laptop = new StillDb(accountDbName(A) + '-laptop', true);
    const base = review('2026-11-09', '2026-11-15', 'Start');
    await phone.write([op(base)]);
    await syncOnce(phone, r);
    await syncOnce(laptop, r);

    await phone.write([op(toReview(base.weekStart, base.weekEnd, { wentWell: 'Handy-Text', heldBack: '', nextWeek: '' }, base, 2)!)]);
    await laptop.write([op(toReview(base.weekStart, base.weekEnd, { wentWell: 'Laptop-Text', heldBack: '', nextWeek: '' }, base, 3)!)]);
    await syncOnce(phone, r);
    const rep = await syncOnce(laptop, r);
    expect(rep.conflicts).toBe(1);
    const [c] = await laptop.conflicts();
    expect(c).toMatchObject({ kind: 'review', id: base.id });
    expect((c.local as Review).wentWell).toBe('Laptop-Text');
    expect((c.server as Review).wentWell).toBe('Handy-Text');
    expect((await laptop.loadAll()).reviews[0].wentWell).toBe('Handy-Text'); // server text shown meanwhile, nothing lost

    await laptop.resolveConflict(c, 'local'); // keep the laptop's text
    await syncOnce(laptop, r);
    await syncOnce(phone, r);
    expect((await phone.loadAll()).reviews[0].wentWell).toBe('Laptop-Text');
    expect(await laptop.conflicts()).toEqual([]);
  });

  it('accounts stay separate: other users can neither read nor overwrite a review, and each cache holds its own', async () => {
    const a = new StillDb(accountDbName(A), true);
    const b = new StillDb(accountDbName(B), true);
    const ra = review('2026-11-09', '2026-11-15', 'privat A');
    await a.write([op(ra)]);
    await syncOnce(a, server.remote(A));
    await b.write([op(review('2026-11-09', '2026-11-15', 'B schreibt'))]); // same week range, other account
    await syncOnce(b, server.remote(B));

    expect(await serverText(server, A, ra.id)).toEqual(['privat A']);
    expect(await serverText(server, B, ra.id)).toEqual(['B schreibt']);
    expect((await b.loadAll()).reviews.map((x) => x.wentWell)).toEqual(['B schreibt']);
    expect((await a.loadAll()).reviews.map((x) => x.wentWell)).toEqual(['privat A']);
    await expect(server.as(B, `update public.records set data = '{}' where user_id = $1`, [A])).resolves.toEqual([]);
    expect(await serverText(server, A, ra.id)).toEqual(['privat A']);
  });
});
