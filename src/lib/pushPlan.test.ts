import { describe, expect, it } from 'vitest';
import { defaultSettings, entryId, makeRule, type Analysis, type Completion, type Entry, type Habit } from './model';
import { planReminders, WINDOW_MIN, zonedNow, type PushInput } from './pushPlan';

const ALL = [0, 1, 2, 3, 4, 5, 6];
const habit = (o: Partial<Habit> & { id: string }): Habit => ({
  name: o.id, description: '', icon: 'book', kind: 'binary', unit: '', startDate: '2026-01-01',
  rules: [makeRule('2026-01-01', ALL, 1)], pauses: [], reminder: null, order: 0, createdAt: 0, ...o,
});
const entry = (habitId: string, date: string, value: number): Entry => ({ id: entryId(habitId, date), habitId, date, value, note: '', updatedAt: 0 });
const input = (o: Partial<PushInput>): PushInput => ({ habits: [], entries: [], completions: [], analyses: [], settings: defaultSettings, ...o });
const keys = (i: PushInput, iso: string, tz = 'Europe/Berlin', lang: 'de' | 'en' = 'de') => planReminders(i, new Date(iso), tz, lang).map((r) => `${r.key} ${r.body}`);

// 2026-11-11 is a Wednesday. 17:02 UTC = 18:02 in Berlin (CET).
const WED_1802 = '2026-11-11T17:02:00Z';

describe('push reminders: what is due', () => {
  it('daily habits: only scheduled and still open; 3/10 pages remind, 10/10 does not', () => {
    const read = habit({ id: 'read', name: 'Lesen', kind: 'numeric', unit: 'Seiten', rules: [makeRule('2026-01-01', ALL, 10)], reminder: '18:00' });
    const gym = habit({ id: 'gym', reminder: '18:00' });
    const weekday = habit({ id: 'mo-fr', reminder: '18:00', rules: [makeRule('2026-01-01', [1, 5], 1)] }); // not Wednesday
    const archived = habit({ id: 'old', reminder: '18:00', pauses: [{ from: '2026-11-01', to: null }] });
    const later = habit({ id: 'later', reminder: '19:00' });
    const noTime = habit({ id: 'none' });
    const i = input({ habits: [read, gym, weekday, archived, later, noTime], entries: [entry('read', '2026-11-11', 3), entry('gym', '2026-11-11', 1)] });
    expect(keys(i, WED_1802)).toEqual(['daily|read|2026-11-11 Noch offen: 3/10 Seiten']);
    expect(keys({ ...i, entries: [entry('read', '2026-11-11', 10), entry('gym', '2026-11-11', 1)] }, WED_1802)).toEqual([]);
    expect(keys(i, WED_1802, 'Europe/Berlin', 'en')).toEqual(['daily|read|2026-11-11 Still open: 3/10 Seiten']);
  });

  it('due from the reminder time for one hour; not before, not later', () => {
    const i = input({ habits: [habit({ id: 'gym', reminder: '18:00' })] });
    expect(keys(i, '2026-11-11T16:59:00Z')).toEqual([]); // 17:59
    expect(keys(i, '2026-11-11T17:00:00Z')).toHaveLength(1); // 18:00
    expect(keys(i, '2026-11-11T17:59:00Z')).toHaveLength(1); // 18:59, e.g. after delayed runs
    expect(keys(i, '2026-11-11T18:00:00Z')).toEqual([]); // 19:00: stale, not sent
    expect(WINDOW_MIN).toBe(60);
  });

  it('weekly goals: on the reminder day while the count is below the target, with the remaining count', () => {
    const sub = habit({ id: 'sub', name: 'Substack', kind: 'weekly', rules: [makeRule('2026-01-01', ALL, 2)], weeklyReminder: { day: 3, time: '18:00' } });
    const run = habit({ id: 'run', rules: [makeRule('2026-01-01', [], 1, { perWeek: 3 })], weeklyReminder: { day: 3, time: '18:00' } });
    const a = (id: string, date: string): Analysis => ({ id, habitId: 'sub', date, title: id, url: '', learnings: 'x', createdAt: 0, updatedAt: 0 });
    const c = (date: string): Completion => ({ id: `run|${date}`, habitId: 'run', date, createdAt: 0, updatedAt: 0 });
    const one = input({ habits: [sub, run], analyses: [a('a1', '2026-11-09')], completions: [c('2026-11-10')] });
    expect(keys(one, WED_1802)).toEqual(['weekly|sub|2026-11-09 Noch 1 Analyse diese Woche', 'weekly|run|2026-11-09 Noch 2× diese Woche']);
    expect(keys(one, WED_1802, 'Europe/Berlin', 'en')).toEqual(['weekly|sub|2026-11-09 1 more analysis this week', 'weekly|run|2026-11-09 2 more times this week']);
    // Target already reached (an analysis from last week doesn't count): nothing.
    const reached = input({ habits: [sub], analyses: [a('a1', '2026-11-09'), a('a2', '2026-11-11'), a('old', '2026-11-08')] });
    expect(keys(reached, WED_1802)).toEqual([]);
    expect(keys(one, '2026-11-12T17:02:00Z')).toEqual([]); // Thursday: not the reminder day
    // Sunday week start: the week runs Sun Nov 8 – Sat Nov 14, so the Nov 8 analysis counts too.
    const sunday = input({ habits: [sub], analyses: [a('a1', '2026-11-09'), a('old', '2026-11-08')], settings: { ...defaultSettings, weekStart: 0 } });
    expect(keys(sunday, WED_1802)).toEqual([]);
  });

  it('local time zones: the same instant is another date and time elsewhere', () => {
    const i = input({ habits: [habit({ id: 'gym', reminder: '07:30' })] });
    // 2026-11-11 12:35 UTC: 07:35 in New York (same date), 21:35 in Tokyo.
    expect(zonedNow(new Date('2026-11-11T12:35:00Z'), 'America/New_York')).toEqual({ date: '2026-11-11', minutes: 7 * 60 + 35 });
    expect(keys(i, '2026-11-11T12:35:00Z', 'America/New_York')).toEqual(['daily|gym|2026-11-11 Heute noch offen']);
    expect(keys(i, '2026-11-11T12:35:00Z', 'Asia/Tokyo')).toEqual([]);
    // 23:10 UTC on Nov 11 is already Nov 12 in Tokyo.
    expect(zonedNow(new Date('2026-11-11T23:10:00Z'), 'Asia/Tokyo').date).toBe('2026-11-12');
    expect(() => planReminders(i, new Date(), 'Not/AZone', 'de')).toThrow(RangeError);
  });

  it('daylight saving: a skipped time fires right after the jump; a repeated hour keeps one key', () => {
    const i = input({ habits: [habit({ id: 'gym', reminder: '02:30' })] });
    // 2026-03-29, Berlin: 02:00 CET → 03:00 CEST at 01:00 UTC. 02:30 never exists; the 03:00 run sends it.
    expect(zonedNow(new Date('2026-03-29T01:00:00Z'), 'Europe/Berlin')).toEqual({ date: '2026-03-29', minutes: 180 });
    expect(keys(i, '2026-03-29T00:55:00Z')).toEqual([]); // 01:55 CET
    expect(keys(i, '2026-03-29T01:00:00Z')).toEqual(['daily|gym|2026-03-29 Heute noch offen']);
    // 2026-10-25: 03:00 CEST → 02:00 CET at 01:00 UTC; 02:30 happens twice — same key both times (sent once).
    expect(keys(i, '2026-10-25T00:30:00Z')).toEqual(['daily|gym|2026-10-25 Heute noch offen']);
    expect(keys(i, '2026-10-25T01:30:00Z')).toEqual(['daily|gym|2026-10-25 Heute noch offen']);
  });

  it('target changed from today on: the rule in force on that local date decides', () => {
    const read = habit({ id: 'read', kind: 'numeric', unit: 'Seiten', rules: [makeRule('2026-01-01', ALL, 10), makeRule('2026-11-11', ALL, 20)], reminder: '18:00' });
    expect(keys(input({ habits: [read], entries: [entry('read', '2026-11-11', 15)] }), WED_1802)).toEqual(['daily|read|2026-11-11 Noch offen: 15/20 Seiten']);
    expect(keys(input({ habits: [read], entries: [entry('read', '2026-11-10', 15)] }), '2026-11-10T17:02:00Z')).toEqual([]); // 15 ≥ 10 the day before
  });
});
