import { describe, expect, it } from 'vitest';
import { ALL_DAYS, entryId, type Analysis, type Completion, type Entry, type Habit } from './model';
import { computeStreak, dayStateAt, type StreakInput } from './streak';
import { makeCompletion } from './weekly';

// 2025-12-01 is a Monday. Weeks start on Monday unless a test says otherwise.
const habit = (id: string, o: Partial<Habit> = {}): Habit => ({
  id, name: id, description: '', icon: 'circle', kind: 'binary', unit: '', startDate: '2025-12-01',
  rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1 }], pauses: [], reminder: null, order: 0, createdAt: 0, ...o,
});
const read = habit('read');
const water = habit('water', { kind: 'numeric', unit: 'ml', rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 2000 }] });
const weekdays = habit('work', { rules: [{ from: '2025-12-01', days: [1, 2, 3, 4, 5], target: 1 }] });
const sport = habit('sport', { rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 1, perWeek: 3 }] });
const substack = habit('substack', { kind: 'weekly', unit: 'Analysen', rules: [{ from: '2025-12-01', days: ALL_DAYS, target: 2 }] });

const e = (h: Habit, date: string, value = 1, note = ''): Entry => ({ id: entryId(h.id, date), habitId: h.id, date, value, note, updatedAt: 0 });
const a = (date: string, n = 1): Analysis => ({ id: `a${n}`, habitId: 'substack', date, title: 't', url: '', learnings: 'l', createdAt: n, updatedAt: n });
const input = (habits: Habit[], entries: Entry[] = [], completions: Completion[] = [], analyses: Analysis[] = []): StreakInput => ({ habits, entries, completions, analyses });
const states = (r: ReturnType<typeof computeStreak>) => [...r.days.values()].join(' ');

describe('activity streak', () => {
  it('zero-day state: missed days without a streak use no freeze', () => {
    const r = computeStreak(input([read]), '2025-12-03', 1);
    expect(r.current).toBe(0);
    expect(states(r)).toBe('missed missed pending');
    expect(r.freezeUsedThisWeek).toBe(false);
    expect(computeStreak(input([]), '2025-12-03', 1).current).toBe(0); // no habits at all
  });

  it('first successful day, and several actions on one day count once', () => {
    const one = computeStreak(input([read, water], [e(read, '2025-12-01')]), '2025-12-01', 1);
    expect(one.current).toBe(1);
    const many = computeStreak(
      input([read, water, sport], [e(read, '2025-12-01'), e(water, '2025-12-01', 250)], [makeCompletion(sport, '2025-12-01', 0)]),
      '2025-12-01',
      1,
    );
    expect(many.current).toBe(1);
    expect(many.days.get('2025-12-01')).toBe('done');
  });

  it('positive numeric progress counts; zero values and note-only entries do not', () => {
    expect(computeStreak(input([water], [e(water, '2025-12-01', 100)]), '2025-12-01', 1).current).toBe(1); // far below the target
    expect(computeStreak(input([water, read], [e(water, '2025-12-01', 0, 'nur Notiz'), e(read, '2025-12-01', 0, 'Notiz')]), '2025-12-01', 1).current).toBe(0);
  });

  it('an unfinished today stays pending and never breaks the streak', () => {
    const r = computeStreak(input([read], [e(read, '2025-12-01'), e(read, '2025-12-02')]), '2025-12-03', 1);
    expect(r.current).toBe(2);
    expect(r.days.get('2025-12-03')).toBe('pending');
  });

  it('unscheduled days are neutral: the weekend between Friday and Monday neither adds nor breaks', () => {
    const r = computeStreak(input([weekdays], [e(weekdays, '2025-12-05'), e(weekdays, '2025-12-08')]), '2025-12-08', 1);
    expect(r.days.get('2025-12-06')).toBe('none');
    expect(r.days.get('2025-12-07')).toBe('none');
    // Mon–Thu of week 1 were missed without a streak, then Fri and Mon count.
    expect(r.current).toBe(2);
    // An action on a day where nothing is due (and no weekly goal is in force) is neutral too.
    const sat = computeStreak(input([weekdays], [e(weekdays, '2025-12-05'), e(weekdays, '2025-12-06')]), '2025-12-06', 1);
    expect(sat.days.get('2025-12-06')).toBe('none');
    expect(sat.current).toBe(1);
  });

  it('weekly goals: activity earns a day, a day without it is neutral (not missed, not a failed goal)', () => {
    const r = computeStreak(input([sport, substack], [], [makeCompletion(sport, '2025-12-01', 0)], [a('2025-12-03')]), '2025-12-04', 1);
    expect(states(r)).toBe('done none done pending');
    expect(r.current).toBe(2);
  });

  it('freeze: the first missed day of a week keeps the streak without adding to it', () => {
    const r = computeStreak(input([read], [e(read, '2025-12-01'), e(read, '2025-12-02'), e(read, '2025-12-04')]), '2025-12-05', 1);
    expect(states(r)).toBe('done done frozen done pending');
    expect(r.current).toBe(3); // Mon, Tue, Thu — the frozen Wednesday adds nothing
    expect(r.freezeUsedThisWeek).toBe(true);
  });

  it('a protected streak is shown as frozen until today is earned', () => {
    const before = computeStreak(input([read], [e(read, '2025-12-01'), e(read, '2025-12-02')]), '2025-12-04', 1);
    expect(before.days.get('2025-12-03')).toBe('frozen');
    expect(before.protectedByFreeze).toBe(true);
    const after = computeStreak(input([read], [e(read, '2025-12-01'), e(read, '2025-12-02'), e(read, '2025-12-04')]), '2025-12-04', 1);
    expect(after.protectedByFreeze).toBe(false);
  });

  it('a second missed day in the same week breaks the streak', () => {
    const r = computeStreak(input([read], [e(read, '2025-12-01'), e(read, '2025-12-02'), e(read, '2025-12-05')]), '2025-12-05', 1);
    expect(states(r)).toBe('done done frozen missed done');
    expect(r.current).toBe(1);
    expect(r.longest).toBe(2);
  });

  it('week boundaries follow the configured week start', () => {
    // Done Thu–Sat, missed Sun 12-07 and Mon 12-08, done Tue 12-09.
    const entries = ['2025-12-04', '2025-12-05', '2025-12-06', '2025-12-09'].map((d) => e(read, d));
    const monday = computeStreak(input([read], entries), '2025-12-09', 1);
    // Monday start: Sunday and Monday are in different weeks — one freeze each.
    expect([monday.days.get('2025-12-07'), monday.days.get('2025-12-08')]).toEqual(['frozen', 'frozen']);
    expect(monday.current).toBe(4);
    const sunday = computeStreak(input([read], entries), '2025-12-09', 0);
    // Sunday start: both days are in the same week — the second one breaks the streak.
    expect([sunday.days.get('2025-12-07'), sunday.days.get('2025-12-08')]).toEqual(['frozen', 'missed']);
    expect(sunday.current).toBe(1);
  });

  it('undo, deletion and backdating recompute the result', () => {
    const base = [e(read, '2025-12-01'), e(read, '2025-12-03')];
    expect(computeStreak(input([read], base), '2025-12-03', 1).current).toBe(2); // Tue frozen
    // Backdating Tuesday turns the frozen day into a real one and frees the freeze.
    const back = computeStreak(input([read], [...base, e(read, '2025-12-02')]), '2025-12-03', 1);
    expect(back.current).toBe(3);
    expect(back.freezeUsedThisWeek).toBe(false);
    // Undoing Monday: Monday missed without a streak, Tuesday missed, only Wednesday counts.
    const undone = computeStreak(input([read], [e(read, '2025-12-03')]), '2025-12-03', 1);
    expect(states(undone)).toBe('missed missed done');
    expect(undone.current).toBe(1);
  });

  it('archived periods are neutral and actions of an archived habit after archiving do not count', () => {
    const paused = habit('read', { pauses: [{ from: '2025-12-02', to: '2025-12-04' }] });
    const r = computeStreak(input([paused], [e(paused, '2025-12-01'), e(paused, '2025-12-03'), e(paused, '2025-12-04')]), '2025-12-04', 1);
    expect(states(r)).toBe('done none none done');
    expect(r.current).toBe(2);
  });

  it('future days show whether they can be earned', () => {
    const r = computeStreak(input([weekdays]), '2025-12-03', 1);
    expect(dayStateAt(r, [weekdays], '2025-12-05', '2025-12-03')).toBe('pending');
    expect(dayStateAt(r, [weekdays], '2025-12-06', '2025-12-03')).toBe('none');
  });
});
