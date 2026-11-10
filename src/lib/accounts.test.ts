import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { planImport } from './accountImport';
import { authErrorText, authReducer, credentialErrors, partitionFor, type AuthState } from './auth';
import { accountDbName, emptySnapshot, LOCAL_DB, StillDb, type Snapshot } from './db';
import { missingExamples } from './examples';
import { ALL_DAYS, completionId, entryId, type Habit } from './model';

const ua = { id: 'user-a', email: 'a@example.com' };
const ub = { id: 'user-b', email: 'b@example.com' };

describe('auth state and account partitions', () => {
  it('maps sign-in, refresh, sign-out and account switch to the right IndexedDB partition', () => {
    let s: AuthState = { status: 'loading' };
    s = authReducer(s, { type: 'INITIAL_SESSION', user: null });
    expect(partitionFor(s)).toEqual({ name: LOCAL_DB, sync: false, userId: null });
    s = authReducer(s, { type: 'SIGNED_IN', user: ua });
    expect(partitionFor(s)).toEqual({ name: accountDbName('user-a'), sync: true, userId: 'user-a' });
    const before = s;
    s = authReducer(s, { type: 'TOKEN_REFRESHED', user: ua });
    expect(s).toBe(before); // same object: no re-render, no remount of the data layer
    s = authReducer(s, { type: 'SIGNED_OUT', user: null });
    expect(partitionFor(s).name).toBe(LOCAL_DB);
    s = authReducer(s, { type: 'SIGNED_IN', user: ub });
    expect(partitionFor(s).name).toBe(accountDbName('user-b'));
  });

  it('password recovery lasts until the password is updated and is never inherited by another user', () => {
    let s: AuthState = authReducer({ status: 'signedOut' }, { type: 'PASSWORD_RECOVERY', user: ua });
    expect(s).toMatchObject({ status: 'signedIn', recovery: true });
    s = authReducer(s, { type: 'TOKEN_REFRESHED', user: ua });
    expect(s).toMatchObject({ recovery: true });
    expect(authReducer(s, { type: 'SIGNED_IN', user: ub })).toMatchObject({ recovery: false, user: ub });
    expect(authReducer(s, { type: 'USER_UPDATED', user: ua })).toMatchObject({ recovery: false });
  });

  it('stays local-only when no backend is configured', () => {
    expect(authReducer({ status: 'disabled' }, { type: 'SIGNED_IN', user: ua })).toEqual({ status: 'disabled' });
  });

  it('validates credentials and explains errors in German', () => {
    expect(credentialErrors('', '')).toMatchObject({ email: expect.any(String), password: expect.any(String) });
    expect(credentialErrors('a@b', '12345678').email).toBeTruthy();
    expect(credentialErrors('a@b.de', 'kurz').password).toMatch(/8/);
    expect(credentialErrors('a@b.de', '12345678', '12345679').confirm).toBeTruthy();
    expect(credentialErrors('a@b.de', null)).toEqual({});
    expect(authErrorText({ code: 'invalid_credentials' })).toBe('E-Mail oder Passwort ist falsch.');
    expect(authErrorText({ code: 'email_not_confirmed' })).toMatch(/bestätige/);
    expect(authErrorText({ message: 'Failed to fetch' })).toMatch(/Keine Verbindung/);
  });

  it('data written in one partition never appears in another', async () => {
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    const local = new StillDb(LOCAL_DB, false);
    const a = new StillDb(accountDbName('user-a'), true);
    const b = new StillDb(accountDbName('user-b'), true);
    await local.initialize();
    await a.write([{ kind: 'journal', id: 'ja', rec: { id: 'ja', date: '2026-11-09', title: '', notes: 'A', learned: '', createdAt: 1, updatedAt: 1 } }]);
    expect((await b.loadAll()).journal).toEqual([]);
    expect((await local.loadAll()).journal).toEqual([]);
    expect((await a.loadAll()).journal).toHaveLength(1);
    // Account caches don't seed examples; local does. Only account caches queue changes for upload.
    expect((await a.loadAll()).habits).toEqual([]);
    expect((await local.loadAll()).habits).toHaveLength(5);
    expect(await a.pendingCount()).toBe(1);
    expect(await local.pendingCount()).toBe(0);
    // Removing a signed-out account's cache leaves everything else intact.
    await a.destroy();
    expect((await new StillDb(accountDbName('user-a'), true).loadAll()).journal).toEqual([]);
    expect((await local.loadAll()).habits).toHaveLength(5);
  });
});

const h = (id: string, name: string, o: Partial<Habit> = {}): Habit => ({
  id, name, description: '', icon: 'book', kind: 'binary', unit: '', startDate: '2026-11-01',
  rules: [{ from: '2026-11-01', days: ALL_DAYS, target: 1 }], pauses: [], reminder: null, order: 0, createdAt: 1, ...o,
});
const snap = (p: Partial<Snapshot>): Snapshot => ({ ...emptySnapshot(), ...p });

describe('local data → account import', () => {
  const local = snap({
    habits: [h('l1', 'Lesen'), h('l2', 'Neu'), ...missingExamples([], '2026-11-01').slice(0, 1)],
    entries: [
      { id: entryId('l1', '2026-11-05'), habitId: 'l1', date: '2026-11-05', value: 1, note: 'lokal', updatedAt: 1 },
      { id: entryId('l1', '2026-11-06'), habitId: 'l1', date: '2026-11-06', value: 1, note: '', updatedAt: 1 },
    ],
    completions: [{ id: completionId('l2', '2026-11-05'), habitId: 'l2', date: '2026-11-05', createdAt: 1, updatedAt: 1 }],
    journal: [{ id: 'j1', date: '2026-11-05', title: '', notes: 'lokaler Gedanke', learned: '', createdAt: 1, updatedAt: 1 }],
  });
  const account = snap({
    habits: [h('a1', '  lesen ', { order: 3 }), missingExamples([], '2026-10-01')[0]],
    entries: [{ id: entryId('a1', '2026-11-05'), habitId: 'a1', date: '2026-11-05', value: 1, note: 'konto', updatedAt: 2 }],
  });

  it('merges same-named habits, keeps account days, skips existing ids', () => {
    const p = planImport(local, account);
    expect(p.merged).toEqual(['Lesen']);
    expect(p.habits).toBe(1); // only "Neu"; the example exists by id
    expect(p.entries).toBe(1); // 11-06 attached to a1; 11-05 already recorded in the account
    expect(p.ops.find((o) => o.kind === 'entry')).toMatchObject({ id: entryId('a1', '2026-11-06'), rec: { habitId: 'a1' } });
    expect(p.completions).toBe(1);
    expect(p.journal).toBe(1);
    expect(p.ops.find((o) => o.kind === 'habit')).toMatchObject({ id: 'l2', rec: { order: 4 } });
  });

  it('running the import twice adds nothing the second time, and the local database stays untouched', async () => {
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    const localDb = new StillDb(LOCAL_DB, false);
    await localDb.replaceAll(local);
    const acc = new StillDb(accountDbName('user-a'), true);
    await acc.replaceAll(account);
    await acc.write(planImport(await localDb.loadAll(), await acc.loadAll()).ops);
    const again = planImport(await localDb.loadAll(), await acc.loadAll());
    expect(again.ops).toEqual([]);
    const after = await acc.loadAll();
    expect(after.habits).toHaveLength(3);
    expect(after.entries.find((e) => e.date === '2026-11-05')?.note).toBe('konto');
    expect(after.journal.map((j) => j.notes)).toEqual(['lokaler Gedanke']);
    const stillLocal = await localDb.loadAll();
    expect(stillLocal.habits).toHaveLength(3);
    expect(stillLocal.journal).toHaveLength(1);
  });
});
