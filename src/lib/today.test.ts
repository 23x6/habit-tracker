import { describe, expect, it } from 'vitest';
import { dayProgress, weekProgress } from './dashboard';
import { ALL_DAYS, entryId, type Analysis, type Completion, type Entry, type Habit } from './model';
import { parseAmount, quickStep, todayItems } from './today';
import { makeCompletion } from './weekly';

// Week of Monday 2025-12-01; the selected date is Wednesday 2025-12-03.
const base = (id: string, order: number, o: Partial<Habit> = {}): Habit => ({
  id, name: id, description: '', icon: 'circle', kind: 'binary', unit: '', startDate: '2025-12-01',
  rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1 }], pauses: [], reminder: null, order, createdAt: 0, ...o,
});
const entry = (h: Habit, date: string, value: number): Entry => ({ id: entryId(h.id, date), habitId: h.id, date, value, note: '', updatedAt: 0 });
const lookup = (es: Entry[]) => (id: string, d: string) => es.find((e) => e.id === entryId(id, d));
const analysis = (habitId: string, date: string, n: number): Analysis => ({ id: `a${n}`, habitId, date, title: 't', url: '', learnings: 'l', createdAt: n, updatedAt: n });

const read = base('read', 0);
const run = base('run', 1);
const mondays = base('mondays', 2, { rules: [{ from: '2025-12-01', days: [1], target: 1 }] }); // not scheduled on Wednesday
const sport = base('sport', 3, { rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1, perWeek: 2 }] });
const substack = base('substack', 4, { kind: 'weekly', unit: 'Analysen', rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1 }] });
const archived = base('archived', 5, { pauses: [{ from: '2025-12-02', to: null }] });
const later = base('later', 6, { startDate: '2025-12-10', rules: [{ from: '2025-12-10', days: ALL_DAYS, target: 1 }] });
const habits = [later, archived, substack, sport, mondays, run, read]; // stored out of order on purpose

describe('Today list grouping', () => {
  it('lists open daily habits first, then open weekly goals, then everything done, keeping manual order', () => {
    const entries = [entry(read, '2025-12-03', 1)];
    const completions: Completion[] = [makeCompletion(sport, '2025-12-01', 0)];
    const items = todayItems(habits, lookup(entries), [], completions, '2025-12-03', 1);
    expect(items.map((i) => `${i.group}:${i.habit.id}`)).toEqual(['daily:run', 'weekly:sport', 'weekly:substack', 'done:read']);
    expect(items.find((i) => i.habit.id === 'sport')!.week).toMatchObject({ count: 1, target: 2 });
  });

  it('never lists unscheduled, archived or not-yet-started habits as open', () => {
    const ids = todayItems(habits, lookup([]), [], [], '2025-12-03', 1).map((i) => i.habit.id);
    expect(ids).not.toContain('mondays');
    expect(ids).not.toContain('archived');
    expect(ids).not.toContain('later');
    // On Monday the weekday habit is due. A habit archived now stays in the archive list, as before.
    const monday = todayItems(habits, lookup([]), [], [], '2025-12-01', 1).map((i) => i.habit.id);
    expect(monday).toEqual(['read', 'run', 'mondays', 'sport', 'substack']);
  });

  it('follows the selected date: a reached weekly goal and a done day move to "done" only in their week/day', () => {
    const completions = [makeCompletion(sport, '2025-12-01', 0), makeCompletion(sport, '2025-12-02', 0)];
    const analyses = [analysis('substack', '2025-12-02', 1)];
    const entries = [entry(run, '2025-12-02', 1)];
    const wed = todayItems(habits, lookup(entries), analyses, completions, '2025-12-03', 1);
    expect(wed.filter((i) => i.group === 'done').map((i) => i.habit.id)).toEqual(['sport', 'substack']);
    const tue = todayItems(habits, lookup(entries), analyses, completions, '2025-12-02', 1);
    expect(tue.filter((i) => i.group === 'done').map((i) => i.habit.id)).toEqual(['run', 'sport', 'substack']);
    // Next week starts over.
    const nextWeek = todayItems(habits, lookup(entries), analyses, completions, '2025-12-08', 1);
    expect(nextWeek.filter((i) => i.week).map((i) => i.group)).toEqual(['weekly', 'weekly']);
  });

  it('leaves the dashboard calculations untouched', () => {
    const entries = [entry(read, '2025-12-03', 1)];
    expect(dayProgress(habits, lookup(entries), '2025-12-03')).toEqual({ ratio: 0.5, done: 1, total: 2 });
    expect(weekProgress(habits, [], [], '2025-12-01')).toMatchObject({ ratio: 0, done: 0, total: 2 });
  });
});

describe('numeric quick controls', () => {
  it('steps by a sensible amount for the target', () => {
    expect([quickStep(1), quickStep(8), quickStep(10), quickStep(30), quickStep(100), quickStep(250), quickStep(2000), quickStep(10000)]).toEqual([1, 1, 1, 1, 10, 10, 100, 1000]);
    expect(quickStep(2.5)).toBe(0.1);
    expect(quickStep(0)).toBe(1);
  });

  it('parses typed amounts in German and English notation and rejects the rest', () => {
    expect(parseAmount('12')).toBe(12);
    expect(parseAmount(' 2,5 ')).toBe(2.5);
    expect(parseAmount('3.75')).toBe(3.75);
    expect(parseAmount('1.234,5')).toBeNull(); // thousands separators are ambiguous: not guessed
    expect(parseAmount('-3')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});
