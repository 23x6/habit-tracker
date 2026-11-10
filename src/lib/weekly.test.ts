import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { startOfWeek } from './date';
import { emptySnapshot, StillDb } from './db';

let store = new StillDb('still', false);
const initialize = () => store.initialize();
const loadAll = () => store.loadAll();
const closeDB = () => store.close();
const putAnalysis = (a: Analysis) => store.write([{ kind: 'analysis', id: a.id, rec: a }]);
const deleteAnalysis = (id: string) => store.write([{ kind: 'analysis', id }]);
const putJournal = (j: ReturnType<typeof toJournal>) => store.write([{ kind: 'journal', id: j.id, rec: j }]);
const replaceAll = (s: Parameters<StillDb['replaceAll']>[0]) => store.replaceAll(s);
import { missingExamples } from './examples';
import { toExport, validateImport } from './io';
import { ALL_DAYS, defaultSettings, entryId, rate, streaks, withRule, type Analysis, type Habit } from './model';
import { analysesInWeek, groupByDate, toAnalysis, toJournal, validateAnalysis, validateJournal, weekLabel, weeklyStats, weekStatus } from './weekly';

const weekly = (o: Partial<Habit> = {}): Habit => ({
  id: 's', name: 'Substack analysieren', description: '', icon: 'pen', kind: 'weekly', unit: 'Analysen', startDate: '2026-01-05',
  rules: [{ from: '2026-01-05', days: ALL_DAYS, target: 2 }], pauses: [], reminder: null, order: 0, createdAt: 0, ...o,
});
let n = 0;
const an = (date: string, o: Partial<Analysis> = {}): Analysis => ({
  id: 'a' + ++n, habitId: 's', date, title: 'T', url: '', learnings: 'L', createdAt: n, updatedAt: n, ...o,
});

describe('week boundaries', () => {
  it('respects the configured week start', () => {
    // 2026-11-08 is a Sunday
    expect(startOfWeek('2026-11-08', 1)).toBe('2026-11-02');
    expect(startOfWeek('2026-11-08', 0)).toBe('2026-11-08');
    const list = [an('2026-11-08')];
    expect(analysesInWeek(list, 's', '2026-11-02')).toHaveLength(1); // Monday weeks: Sunday belongs to the week before
    expect(analysesInWeek(list, 's', '2026-11-09')).toHaveLength(0);
    expect(analysesInWeek(list, 's', '2026-11-08')).toHaveLength(1); // Sunday weeks
  });
  it('handles year transitions', () => {
    // Mon 2025-12-29 … Sun 2026-01-04 is one week
    expect(startOfWeek('2026-01-01', 1)).toBe('2025-12-29');
    const list = [an('2025-12-30'), an('2026-01-03')];
    expect(analysesInWeek(list, 's', '2025-12-29')).toHaveLength(2);
  });
});

describe('weekly goal', () => {
  const h = weekly();
  it('counts two analyses on the same day and labels progress', () => {
    const list = [an('2026-01-06'), an('2026-01-06')];
    const s = weekStatus(h, list, '2026-01-05');
    expect(s).toMatchObject({ count: 2, target: 2, achieved: true });
    expect(weekLabel(weekStatus(h, [], '2026-01-05'))).toBe('0 von 2 Analysen');
    expect(weekLabel(weekStatus(h, list.slice(0, 1), '2026-01-05'))).toBe('1 von 2 Analysen');
    expect(weekLabel(weekStatus(h, [...list, an('2026-01-07')], '2026-01-05'))).toBe('3 von 2 Analysen');
  });
  it('moving an analysis to another week updates both weeks; deleting lowers the count', () => {
    const a = an('2026-01-06');
    const b = an('2026-01-07');
    let list = [a, b];
    expect(weekStatus(h, list, '2026-01-05').achieved).toBe(true);
    list = [{ ...a, date: '2026-01-13' }, b]; // edited date → next week
    expect(weekStatus(h, list, '2026-01-05').count).toBe(1);
    expect(weekStatus(h, list, '2026-01-12').count).toBe(1);
    list = list.filter((x) => x.id !== b.id); // deleted
    expect(weekStatus(h, list, '2026-01-05').count).toBe(0);
  });
  it('target changes do not rewrite past weeks', () => {
    const edited = { ...h, rules: withRule(h, ALL_DAYS, 3, '2026-01-19') };
    const list = [an('2026-01-06'), an('2026-01-07')];
    expect(weekStatus(edited, list, '2026-01-05')).toMatchObject({ target: 2, achieved: true });
    expect(weekStatus(edited, [], '2026-01-19').target).toBe(3);
  });
  it('weekly streak: the running week only breaks once it is over; daily stats ignore weekly habits', () => {
    const list = [an('2026-01-05'), an('2026-01-06'), an('2026-01-12'), an('2026-01-13')];
    // today = Wed 2026-01-21, running week has 0
    expect(weeklyStats(h, list, '2026-01-21', 1)).toMatchObject({ current: 2, longest: 2, achieved: 2, weeks: 2 });
    // after the week ended without analyses
    expect(weeklyStats(h, list, '2026-01-26', 1)).toMatchObject({ current: 0, longest: 2, achieved: 2, weeks: 3 });
    const get = () => undefined;
    expect(streaks(h, get, '2026-01-21')).toEqual({ current: 0, longest: 0 });
    expect(rate(h, get, '2026-01-05', '2026-01-21', '2026-01-21').scheduled).toBe(0);
  });
});

describe('forms', () => {
  const T = '2026-01-10';
  it('analysis requires title and learnings, validates URL, rejects future dates', () => {
    expect(Object.keys(validateAnalysis({ title: '', url: '', date: T, learnings: ' ' }, T, '2026-01-01')).sort()).toEqual(['learnings', 'title']);
    expect(validateAnalysis({ title: 'x', url: 'javascript:alert(1)', date: T, learnings: 'y' }, T, '2026-01-01').url).toBeTruthy();
    expect(validateAnalysis({ title: 'x', url: 'https://a.substack.com/p/x', date: T, learnings: 'y' }, T, '2026-01-01')).toEqual({});
    expect(validateAnalysis({ title: 'x', url: '', date: '2026-01-11', learnings: 'y' }, T, '2026-01-01').date).toBeTruthy();
    expect(validateAnalysis({ title: 'x', url: '', date: '2025-12-31', learnings: 'y' }, T, '2026-01-01').date).toBeTruthy(); // before start
  });
  it('editing keeps createdAt and updates updatedAt', () => {
    const a = toAnalysis('id1', 's', { title: ' A ', url: '', date: T, learnings: 'L' }, undefined, 100);
    expect(a).toMatchObject({ title: 'A', createdAt: 100, updatedAt: 100 });
    const b = toAnalysis('id1', 's', { title: 'B', url: '', date: T, learnings: 'L' }, a, 200);
    expect(b).toMatchObject({ id: 'id1', title: 'B', createdAt: 100, updatedAt: 200 });
    const j = toJournal('j', { date: T, title: '', notes: 'n', learned: '' }, undefined, 5);
    expect(toJournal('j', { date: T, title: 't', notes: 'n', learned: '' }, j, 9)).toMatchObject({ createdAt: 5, updatedAt: 9, title: 't' });
  });
  it('journal needs notes or learnings; timeline groups by date, newest first', () => {
    expect(validateJournal({ date: T, title: 'nur Titel', notes: '', learned: ' ' }, T).content).toBeTruthy();
    expect(validateJournal({ date: T, title: '', notes: '', learned: 'x' }, T)).toEqual({});
    const g = groupByDate([
      toJournal('1', { date: '2026-01-08', title: '', notes: 'a', learned: '' }, undefined, 1),
      toJournal('2', { date: '2026-01-09', title: '', notes: 'b', learned: '' }, undefined, 2),
      toJournal('3', { date: '2026-01-09', title: '', notes: 'c', learned: '' }, undefined, 3),
    ]);
    expect(g.map((x) => [x.date, x.entries.map((e) => e.id)])).toEqual([['2026-01-09', ['3', '2']], ['2026-01-08', ['1']]]);
  });
});

describe('examples', () => {
  it('adds the five examples once, never duplicates, and creates no entries', () => {
    const first = missingExamples([], '2026-01-10');
    expect(first.map((h) => h.name)).toEqual(['10 Seiten lesen', 'Trade-Journal führen', 'Sport machen', 'Skincare', 'Substack analysieren']);
    expect(first.find((h) => h.kind === 'weekly')?.rules[0].target).toBe(2);
    expect(missingExamples(first, '2026-01-11')).toEqual([]);
    // a user-made habit with the same name also blocks the example
    const own = { ...weekly({ id: 'mine', name: '  sport MACHEN ', kind: 'binary' }) };
    expect(missingExamples([own], '2026-01-10').map((h) => h.name)).not.toContain('Sport machen');
  });
});

// ---------- IndexedDB: migration, seeding, persistence, import ----------

const freshDB = async () => {
  await closeDB();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store = new StillDb('still', false);
};

describe('database', () => {
  beforeEach(freshDB);

  it('fresh install seeds the examples exactly once, even with concurrent initialisation', async () => {
    await Promise.all([initialize(), initialize()]);
    await initialize();
    await closeDB();
    await initialize();
    const s = await loadAll();
    expect(s.habits).toHaveLength(5);
    expect(s.entries).toHaveLength(0);
    expect(s.analyses).toHaveLength(0);
  });

  it('migrates a v1 database to the current version without losing data and without adding examples', async () => {
    const h = weekly({ id: 'old', name: 'Lesen', kind: 'binary', rules: [{ from: '2026-01-05', days: ALL_DAYS, target: 1 }] });
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('still', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('habits', { keyPath: 'id' });
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('habitId', 'habitId');
        db.createObjectStore('meta');
      };
      r.onsuccess = () => {
        const db = r.result;
        const t = db.transaction(['habits', 'entries', 'meta'], 'readwrite');
        t.objectStore('habits').put(h);
        t.objectStore('entries').put({ id: entryId('old', '2026-01-06'), habitId: 'old', date: '2026-01-06', value: 1, note: 'alt', updatedAt: 1 });
        t.objectStore('meta').put({ ...defaultSettings, weekStart: 0 }, 'settings');
        t.oncomplete = () => (db.close(), resolve());
        t.onerror = () => reject(t.error);
      };
      r.onerror = () => reject(r.error);
    });
    await initialize();
    const s = await loadAll();
    expect(s.habits).toEqual([h]);
    expect(s.entries[0]).toMatchObject({ note: 'alt', value: 1 });
    expect(s.settings.weekStart).toBe(0);
    expect(s.analyses).toEqual([]);
    expect(s.journal).toEqual([]);
    expect(s.reviews).toEqual([]); // v4 store added on upgrade
  });

  it('repeated saves of the same analysis (double click / retry) create one record; edit and delete persist', async () => {
    await initialize();
    const a = toAnalysis('fixed', 'example-substack', { title: 'A', url: '', date: '2026-01-06', learnings: 'L' }, undefined, 1);
    await Promise.all([putAnalysis(a), putAnalysis(a)]);
    await putAnalysis(a);
    expect((await loadAll()).analyses).toHaveLength(1);
    await putAnalysis({ ...a, date: '2026-01-13', updatedAt: 2 });
    await closeDB();
    expect((await loadAll()).analyses[0]).toMatchObject({ date: '2026-01-13', createdAt: 1, updatedAt: 2 });
    await deleteAnalysis('fixed');
    expect((await loadAll()).analyses).toHaveLength(0);
  });

  it('journal entries persist across connections, several per day', async () => {
    await putJournal(toJournal('j1', { date: '2026-01-06', title: '', notes: 'a', learned: '' }, undefined, 1));
    await putJournal(toJournal('j2', { date: '2026-01-06', title: 'T', notes: '', learned: 'b' }, undefined, 2));
    await putJournal(toJournal('j1', { date: '2026-01-06', title: '', notes: 'a2', learned: '' }, { createdAt: 1 } as never, 3));
    await closeDB();
    const j = (await loadAll()).journal.sort((x, y) => x.createdAt - y.createdAt);
    expect(j.map((e) => [e.id, e.notes, e.createdAt, e.updatedAt])).toEqual([['j1', 'a2', 1, 3], ['j2', '', 2, 2]]);
  });

  it('export/import round trip keeps habits, entries, analyses and journal; invalid imports change nothing', async () => {
    await initialize();
    await putAnalysis(toAnalysis('x1', 'example-substack', { title: 'A', url: 'https://x.substack.com/p/a', date: '2026-01-06', learnings: 'L' }, undefined, 1));
    await putJournal(toJournal('j1', { date: '2026-01-06', title: '', notes: 'n', learned: '' }, undefined, 1));
    const before = await loadAll();
    const file = JSON.parse(JSON.stringify(toExport(before)));

    const broken = { ...file, analyses: [...file.analyses, { ...file.analyses[0], id: 'x2', learnings: '' }] };
    expect(validateImport(broken).ok).toBe(false);
    expect(await loadAll()).toEqual(before);

    const r = validateImport(file);
    expect(r.ok).toBe(true);
    await replaceAll(emptySnapshot());
    if (r.ok) await replaceAll(r.data);
    const after = await loadAll();
    const sort = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    expect(sort(after.habits)).toEqual(sort(before.habits));
    expect(after.analyses).toEqual(before.analyses);
    expect(after.journal).toEqual(before.journal);
  });

  it('accepts a version 1 export and migrates it', async () => {
    const v1 = {
      app: 'still', version: 1, exportedAt: '2026-01-01T00:00:00Z', settings: defaultSettings,
      habits: [weekly({ id: 'h1', kind: 'binary', rules: [{ from: '2026-01-05', days: ALL_DAYS, target: 1 }] })],
      entries: [{ id: entryId('h1', '2026-01-06'), habitId: 'h1', date: '2026-01-06', value: 1, note: '', updatedAt: 1 }],
    };
    const r = validateImport(JSON.parse(JSON.stringify(v1)));
    expect(r.ok && r.fromVersion).toBe(1);
    expect(r.ok && r.data.analyses).toEqual([]);
    expect(validateImport({ ...v1, habits: [{ ...v1.habits[0], kind: 'weekly' }] }).ok).toBe(false); // weekly didn't exist in v1
  });
});

