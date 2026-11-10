import { describe, expect, it } from 'vitest';
import { startOfWeek } from './date';
import { dayProgress, shouldCelebrate, weekProgress } from './dashboard';
import { ALL_DAYS, completionId, entryId, isScheduled, latestRule, rate, streaks, withRule, type Analysis, type Completion, type Entry, type Habit } from './model';
import { completionError, makeCompletion, weekLabel, weeklyStats, weekStatus } from './weekly';

// "Sport machen", 4-mal pro Woche, one completion per day, since Monday 2025-12-01.
const sport = (o: Partial<Habit> = {}): Habit => ({
  id: 's', name: 'Sport machen', description: '', icon: 'dumbbell', kind: 'binary', unit: '', startDate: '2025-12-01',
  rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1, perWeek: 4 }], pauses: [], reminder: null, order: 0, createdAt: 0, ...o,
});
const done = (date: string, h = sport(), n = 0): Completion => ({ ...makeCompletion(h, date, n), createdAt: n });
const daily = (id: string, o: Partial<Habit> = {}): Habit => ({ ...sport({ id, name: id }), rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1 }], ...o });

describe('X-mal pro Woche', () => {
  it('counts completions on any day of the week and labels "2 von 4"', () => {
    const list = [done('2025-12-02'), done('2025-12-06')];
    const s = weekStatus(sport(), list, '2025-12-01');
    expect(s).toMatchObject({ count: 2, target: 4, achieved: false });
    expect(weekLabel(s, 'binary')).toBe('2 von 4');
  });

  it('is never a daily obligation: no daily streak break, no daily rate', () => {
    const h = sport();
    expect(isScheduled(h, '2025-12-03')).toBe(false);
    expect(streaks(h, () => undefined, '2025-12-10')).toEqual({ current: 0, longest: 0 });
    expect(rate(h, () => undefined, '2025-12-01', '2025-12-10', '2025-12-10').scheduled).toBe(0);
  });

  it('one per day by default; "Mehrere pro Tag" allows several sessions', () => {
    const h = sport();
    const first = done('2025-12-02');
    expect(first.id).toBe(completionId('s', '2025-12-02'));
    expect(completionError(h, '2025-12-02', '2025-12-05', [first])).toMatch(/bereits/);
    expect(completionError(h, '2025-12-02', '2025-12-05', [first], first.id)).toBeNull(); // editing itself
    const multi = sport({ rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1, perWeek: 4, multi: true }] });
    const a = makeCompletion(multi, '2025-12-02', 1);
    const b = makeCompletion(multi, '2025-12-02', 2);
    expect(a.id).not.toBe(b.id);
    expect(completionError(multi, '2025-12-02', '2025-12-05', [a])).toBeNull();
    expect(weekStatus(multi, [a, b], '2025-12-01').count).toBe(2);
  });

  it('rejects future dates, dates before the start and days before the weekly rule applied', () => {
    const h = sport({ rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1 }, { from: '2025-12-08', days: ALL_DAYS, target: 1, perWeek: 3 }] });
    expect(completionError(h, '2025-12-12', '2025-12-10', [])).toMatch(/Zukunft/);
    expect(completionError(h, '2025-11-30', '2025-12-10', [])).toMatch(/Beginn/);
    expect(completionError(h, '2025-12-03', '2025-12-10', [])).toMatch(/kein Wochenziel/); // still daily then
    expect(completionError(h, '2025-12-09', '2025-12-10', [])).toBeNull();
    // the daily week keeps daily semantics; the next week is a weekly goal
    expect(isScheduled(h, '2025-12-03')).toBe(true);
    expect(isScheduled(h, '2025-12-09')).toBe(false);
  });

  it('week boundaries follow the week start and cross the year', () => {
    // Mon 2025-12-29 … Sun 2026-01-04
    const list = [done('2025-12-30'), done('2026-01-01'), done('2026-01-04')];
    expect(weekStatus(sport(), list, startOfWeek('2026-01-02', 1)).count).toBe(3);
    // Sunday weeks: Sun 2025-12-28 … Sat 2026-01-03 → 01-04 belongs to the next week
    expect(weekStatus(sport(), list, startOfWeek('2026-01-02', 0)).count).toBe(2);
    expect(weekStatus(sport(), list, '2026-01-04').count).toBe(1);
  });

  it('target changes from next week keep the running and past weeks stable; a week is only missed after it ends', () => {
    const h = sport();
    const edited = { ...h, rules: withRule(h, ALL_DAYS, 1, '2025-12-08', { perWeek: 2 }) };
    expect(latestRule(edited)).toMatchObject({ from: '2025-12-08', perWeek: 2 });
    const list = [done('2025-12-02'), done('2025-12-03'), done('2025-12-09'), done('2025-12-10')];
    expect(weekStatus(edited, list, '2025-12-01')).toMatchObject({ target: 4, achieved: false });
    expect(weekStatus(edited, list, '2025-12-08')).toMatchObject({ target: 2, achieved: true });
    // Wednesday of week 1: nothing missed yet. After the week ended without 4: missed.
    expect(weeklyStats(edited, list, '2025-12-03', 1)).toMatchObject({ weeks: 0, achieved: 0 });
    expect(weeklyStats(edited, list, '2025-12-10', 1)).toMatchObject({ weeks: 2, achieved: 1, current: 1 });
    // Editing back before it takes effect drops the pending change.
    expect(withRule(edited, ALL_DAYS, 1, '2025-12-08', { perWeek: 4 })).toEqual(h.rules);
  });

  it('switching a daily habit to weekly keeps its daily history', () => {
    const h = daily('lesen');
    const switched = { ...h, rules: withRule(h, ALL_DAYS, 1, '2025-12-08', { perWeek: 3 }) };
    const e: Entry = { id: entryId('lesen', '2025-12-02'), habitId: 'lesen', date: '2025-12-02', value: 1, note: '', updatedAt: 0 };
    const get = (_: string, d: string) => (d === e.date ? e : undefined);
    expect(rate(switched, get, '2025-12-01', '2025-12-07', '2025-12-10')).toEqual({ done: 1, scheduled: 7 });
    expect(rate(switched, get, '2025-12-08', '2025-12-10', '2025-12-10').scheduled).toBe(0);
  });
});

describe('dashboard', () => {
  const D = '2025-12-03';
  const subst: Habit = { ...daily('sub'), kind: 'weekly', rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 2 }] };
  const an = (id: string, date: string): Analysis => ({ id, habitId: 'sub', date, title: 't', url: '', learnings: 'l', createdAt: 0, updatedAt: 0 });

  it('Heute: only daily habits scheduled that day, equal shares; empty set has no ratio', () => {
    const habits = [daily('a'), daily('b'), daily('c'), daily('d'), sport(), subst];
    const e = (id: string): Entry => ({ id: entryId(id, D), habitId: id, date: D, value: 1, note: '', updatedAt: 0 });
    const es = new Map([e('a'), e('b'), e('c')].map((x) => [x.id, x]));
    expect(dayProgress(habits, (h, d) => es.get(entryId(h, d)), D)).toEqual({ ratio: 0.75, done: 3, total: 4 });
    expect(dayProgress([sport(), subst], () => undefined, D)).toEqual({ ratio: null, done: 0, total: 0 });
  });

  it('Woche: mean of capped ratios, so large targets do not dominate; extra progress is capped in the ring', () => {
    const big = sport({ id: 'big', rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1, perWeek: 20 }] });
    const comps = [done('2025-12-01'), done('2025-12-02'), ...['2025-12-01', '2025-12-02'].map((d) => done(d, big))];
    const analyses = [an('x', '2025-12-01'), an('y', '2025-12-02'), an('z', '2025-12-02')]; // 3 von 2
    const w = weekProgress([sport(), big, subst, daily('a')], analyses, comps, '2025-12-01');
    expect(w.total).toBe(3);
    expect(w.ratio).toBeCloseTo((2 / 4 + 2 / 20 + 1) / 3);
    expect(w.goals.find((g) => g.habit.id === 'sub')?.status.count).toBe(3); // the card keeps the real count
    expect(weekProgress([daily('a')], [], [], '2025-12-01')).toMatchObject({ ratio: null, total: 0 });
  });

  it('undo reverses progress; rapid toggles around 100 % celebrate only once', () => {
    const habits = [daily('a')];
    const e: Entry = { id: entryId('a', D), habitId: 'a', date: D, value: 1, note: '', updatedAt: 0 };
    expect(dayProgress(habits, () => e, D).ratio).toBe(1);
    expect(dayProgress(habits, () => undefined, D).ratio).toBe(0); // undo
    const key = 'day|' + D;
    expect(shouldCelebrate(0.75, 1, key, null, 1000)).toBe(true);
    const last = { key, at: 1000 };
    expect(shouldCelebrate(1, 0.75, key, last, 1200)).toBe(false); // undo
    expect(shouldCelebrate(0.75, 1, key, last, 1500)).toBe(false); // redo right away: no repeat
    expect(shouldCelebrate(0.75, 1, key, last, 9000)).toBe(true); // later: celebrate again
    expect(shouldCelebrate(0.75, 1, 'week|x', last, 1500)).toBe(true); // other ring
    expect(shouldCelebrate(null, null, key, null, 0)).toBe(false); // empty set never celebrates
  });
});
