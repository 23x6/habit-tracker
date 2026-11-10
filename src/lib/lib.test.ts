import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { addDays, diffDays, fromKey, isValidKey, startOfWeek, toKey, weekday } from './date';
import { ALL_DAYS, defaultSettings, entryId, isComplete, isScheduled, rate, streaks, withRule, type Entry, type Habit } from './model';
import { emptySnapshot, StillDb } from './db';
import type { Entry as E, Habit as H, Settings as S } from './model';

// Thin helpers over the handle-based database API.
const store = new StillDb('still', false);
const putHabits = (hs: H[]) => store.write(hs.map((h) => ({ kind: 'habit' as const, id: h.id, rec: h })));
const putEntry = (e: E) => store.write([{ kind: 'entry', id: e.id, rec: e }]);
const putSettings = (s: S) => store.write([{ kind: 'settings', id: 'settings', rec: s }]);
const deleteHabit = (id: string, entryIds: string[]) => store.write([{ kind: 'habit', id }, ...entryIds.map((e) => ({ kind: 'entry' as const, id: e }))]);
const closeDB = () => store.close();
const loadAll = () => store.loadAll();
const replaceAll = (s: Parameters<StillDb['replaceAll']>[0]) => store.replaceAll(s);
import { toExport, validateImport } from './io';

const habit = (o: Partial<Habit> = {}): Habit => ({
  id: 'h', name: 'Lesen', description: '', icon: 'book', kind: 'binary', unit: '', startDate: '2026-03-02',
  rules: [{ from: '2026-03-02', days: ALL_DAYS, target: 1 }], pauses: [], reminder: null, order: 0, createdAt: 0, ...o,
});
const entry = (date: string, value = 1, habitId = 'h'): Entry => ({ id: entryId(habitId, date), habitId, date, value, note: '', updatedAt: 0 });
const lookup = (es: Entry[]) => {
  const m = new Map(es.map((e) => [e.id, e]));
  return (h: string, d: string) => m.get(entryId(h, d));
};

describe('dates', () => {
  it('round-trips keys and validates', () => {
    expect(toKey(fromKey('2026-02-28'))).toBe('2026-02-28');
    expect(isValidKey('2026-02-30')).toBe(false);
    expect(isValidKey('2024-02-29')).toBe(true);
    expect(isValidKey('2026-1-01')).toBe(false);
  });
  it('steps across DST changes without skipping or repeating days', () => {
    // EU: 2026-03-29 and 2026-10-25; US: 2026-03-08 and 2026-11-01
    for (const d of ['2026-03-28', '2026-10-24', '2026-03-07', '2026-10-31']) {
      expect(diffDays(d, addDays(d, 1))).toBe(1);
      expect(addDays(addDays(d, 1), 1)).toBe(addDays(d, 2));
    }
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-26', -2)).toBe('2026-10-24');
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
  });
  it('handles month/year boundaries and week starts', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekday('2026-11-10')).toBe(2); // Tuesday
    expect(startOfWeek('2026-11-10', 1)).toBe('2026-11-09');
    expect(startOfWeek('2026-11-10', 0)).toBe('2026-11-08');
    expect(startOfWeek('2026-11-08', 1)).toBe('2026-11-02');
  });
});

describe('scheduling', () => {
  it('excludes days before start and unscheduled weekdays', () => {
    const h = habit({ rules: [{ from: '2026-03-02', days: [1, 3, 5], target: 1 }] }); // Mon/Wed/Fri
    expect(isScheduled(h, '2026-03-01')).toBe(false);
    expect(isScheduled(h, '2026-03-02')).toBe(true); // Monday
    expect(isScheduled(h, '2026-03-03')).toBe(false);
  });
  it('excludes archived periods', () => {
    const h = habit({ pauses: [{ from: '2026-03-05', to: '2026-03-08' }] });
    expect(isScheduled(h, '2026-03-04')).toBe(true);
    expect(isScheduled(h, '2026-03-05')).toBe(false);
    expect(isScheduled(h, '2026-03-08')).toBe(true);
  });
});

describe('streaks', () => {
  const T = '2026-03-10';
  it('ignores unscheduled days', () => {
    const h = habit({ rules: [{ from: '2026-03-02', days: [1, 3, 5], target: 1 }] });
    // Mon 2, Wed 4, Fri 6, Mon 9 done; today Tue 10 not scheduled.
    const s = streaks(h, lookup(['2026-03-02', '2026-03-04', '2026-03-06', '2026-03-09'].map((d) => entry(d))), T);
    expect(s).toEqual({ current: 4, longest: 4 });
  });
  it('an unfinished today does not break the streak, a missed yesterday does', () => {
    const h = habit();
    expect(streaks(h, lookup([entry('2026-03-08'), entry('2026-03-09')]), T).current).toBe(2);
    expect(streaks(h, lookup([entry('2026-03-08'), entry('2026-03-09'), entry(T)]), T).current).toBe(3);
    expect(streaks(h, lookup([entry('2026-03-08')]), T).current).toBe(0);
  });
  it('longest streak survives breaks', () => {
    const es = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-06', '2026-03-07'].map((d) => entry(d));
    expect(streaks(habit(), lookup(es), T)).toEqual({ current: 0, longest: 3 });
  });
  it('future start yields zero', () => {
    expect(streaks(habit({ startDate: '2026-04-01' }), lookup([]), T)).toEqual({ current: 0, longest: 0 });
  });
});

describe('numeric completion and historical edits', () => {
  const h = habit({ kind: 'numeric', unit: 'Seiten', rules: [{ from: '2026-03-02', days: ALL_DAYS, target: 10 }] });
  it('is complete only when the target is reached', () => {
    expect(isComplete(h, entry('2026-03-03', 9), '2026-03-03')).toBe(false);
    expect(isComplete(h, entry('2026-03-03', 10), '2026-03-03')).toBe(true);
    expect(isComplete(h, undefined, '2026-03-03')).toBe(false);
  });
  it('raising the target later keeps past days complete', () => {
    const edited = { ...h, rules: withRule(h, ALL_DAYS, 20, '2026-03-08') };
    expect(edited.rules).toHaveLength(2);
    expect(isComplete(edited, entry('2026-03-05', 10), '2026-03-05')).toBe(true);
    expect(isComplete(edited, entry('2026-03-09', 10), '2026-03-09')).toBe(false);
  });
  it('changing the schedule does not change past scheduled days', () => {
    const edited = { ...h, rules: withRule(h, [1], 10, '2026-03-08') }; // Mondays only from Mar 8
    expect(isScheduled(edited, '2026-03-04')).toBe(true); // Wednesday, before change
    expect(isScheduled(edited, '2026-03-11')).toBe(false); // Wednesday, after change
    const r = rate(edited, lookup([]), '2026-03-02', '2026-03-16', '2026-03-16');
    expect(r.scheduled).toBe(7); // Mar 2–7 daily (6), then Mon 9; Mon 16 is today and unfinished, so excluded
  });
  it('same-day edits replace instead of stacking rules; unchanged edits are no-ops', () => {
    const a = withRule(h, ALL_DAYS, 20, '2026-03-08');
    const b = withRule({ ...h, rules: a }, ALL_DAYS, 30, '2026-03-08');
    expect(b).toEqual([h.rules[0], { from: '2026-03-08', days: ALL_DAYS, target: 30 }]);
    expect(withRule(h, ALL_DAYS, 10, '2026-03-08')).toBe(h.rules);
  });
});

describe('rates', () => {
  it('counts only scheduled past days and today once completed', () => {
    const h = habit();
    const es = [entry('2026-03-02'), entry('2026-03-04')];
    expect(rate(h, lookup(es), '2026-03-01', '2026-03-31', '2026-03-05')).toEqual({ done: 2, scheduled: 3 });
    expect(rate(h, lookup([...es, entry('2026-03-05')]), '2026-03-01', '2026-03-31', '2026-03-05')).toEqual({ done: 3, scheduled: 4 });
  });
});

describe('import validation', () => {
  const good = () => JSON.parse(JSON.stringify(toExport({ ...emptySnapshot(), habits: [habit()], entries: [entry('2026-03-03')] })));
  it('accepts a valid export', () => {
    const r = validateImport(good());
    expect(r.ok).toBe(true);
  });
  it('rejects foreign files, wrong versions and broken records', () => {
    expect(validateImport({ foo: 1 }).ok).toBe(false);
    expect(validateImport({ ...good(), version: 99 }).ok).toBe(false);
    const orphan = good(); orphan.entries[0].habitId = 'x';
    expect(validateImport(orphan).ok).toBe(false);
    const dup = good(); dup.entries.push({ ...dup.entries[0] });
    expect(validateImport(dup).ok).toBe(false);
    const badDate = good(); badDate.habits[0].startDate = '2026-02-31';
    expect(validateImport(badDate).ok).toBe(false);
    const badVal = good(); badVal.entries[0].value = 5; // binary
    expect(validateImport(badVal).ok).toBe(false);
    const badIcon = good(); badIcon.habits[0].icon = '<script>';
    expect(validateImport(badIcon).ok).toBe(false);
  });
  it('strips unknown fields', () => {
    const g = good(); g.habits[0].evil = 1;
    const r = validateImport(g);
    expect(r.ok && 'evil' in r.data.habits[0]).toBe(false);
  });
});

describe('persistence (IndexedDB)', () => {
  beforeEach(async () => {
    await replaceAll(emptySnapshot());
  });
  it('stores and reloads habits, entries and settings across connections', async () => {
    await putHabits([habit()]);
    await putEntry(entry('2026-03-03'));
    await putEntry({ ...entry('2026-03-03'), value: 0, note: 'neu' }); // same key overwrites, no duplicate
    await putSettings({ ...defaultSettings, weekStart: 0 });
    await closeDB();
    const s = await loadAll();
    expect(s.habits).toHaveLength(1);
    expect(s.entries).toEqual([{ ...entry('2026-03-03'), value: 0, note: 'neu' }]);
    expect(s.settings.weekStart).toBe(0);
  });
  it('deletes a habit together with its entries', async () => {
    await putHabits([habit(), habit({ id: 'k' })]);
    await putEntry(entry('2026-03-03'));
    await putEntry(entry('2026-03-03', 1, 'k'));
    await deleteHabit('h', [entryId('h', '2026-03-03')]);
    const s = await loadAll();
    expect(s.habits.map((h) => h.id)).toEqual(['k']);
    expect(s.entries.map((e) => e.habitId)).toEqual(['k']);
  });
});
