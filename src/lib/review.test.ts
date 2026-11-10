import { describe, expect, it } from 'vitest';
import { de, en } from '../i18n/messages';
import { formatRange, setDateLocale } from './date';
import { toExport, validateImport, reviewErrors, cleanRecord } from './io';
import { entryId, makeRule, type Analysis, type Entry, type Habit, type JournalEntry, type Review } from './model';
import { dailyStats, draftOf, goalStats, notesIn, overlappingReviews, reviewDue, reviewId, spanRange, toReview } from './review';
import { computeStreak } from './streak';
import { emptySnapshot } from './db';
import { toAnalysis, weekLabel } from './weekly';

// Concrete examples, checked against the underlying records.

const habit = (o: Partial<Habit> & { id: string }): Habit => ({
  name: o.id, description: '', icon: 'book', kind: 'binary', unit: '', startDate: '2026-10-01',
  rules: [makeRule('2026-10-01', [0, 1, 2, 3, 4, 5, 6], 1)], pauses: [], reminder: null, order: 0, createdAt: 0, ...o,
});
const entry = (habitId: string, date: string, value = 1): Entry => ({ id: entryId(habitId, date), habitId, date, value, note: '', updatedAt: 0 });
const lookup = (es: Entry[]) => {
  const m = new Map(es.map((e) => [e.id, e]));
  return (h: string, d: string) => m.get(entryId(h, d));
};
const analysis = (id: string, habitId: string, date: string, createdAt = 0): Analysis => ({ id, habitId, date, title: id, url: '', learnings: `Erkenntnis ${id}`, createdAt, updatedAt: createdAt });

describe('progress overview: daily habits', () => {
  it('a weekday-only habit counts only Mon/Wed/Fri; today is reported as open, not missed', () => {
    // 2026-11-11 is a Wednesday. Last 7 days: Thu 5 … Wed 11 → scheduled Fri 6, Mon 9, Wed 11 (today).
    const h = habit({ id: 'gym', rules: [makeRule('2026-10-01', [1, 3, 5], 1)] });
    const get = lookup([entry('gym', '2026-11-06'), entry('gym', '2026-11-07') /* Saturday: not scheduled */]);
    const { from, to } = spanRange(7, '2026-11-11');
    expect([from, to]).toEqual(['2026-11-05', '2026-11-11']);
    const [r] = dailyStats([h], get, from, to, '2026-11-11');
    expect(r).toMatchObject({ done: 1, scheduled: 2, open: { value: 0, target: 1 } }); // Fri done, Mon missed, today open

    // 30 days (Tue Oct 13 – Wed Nov 11), before today: Oct 14 16 19 21 23 26 28 30, Nov 2 4 6 9 = 12; only Nov 6 done.
    const r30 = dailyStats([h], get, ...(Object.values(spanRange(30, '2026-11-11')) as [string, string]), '2026-11-11')[0];
    expect(r30).toMatchObject({ done: 1, scheduled: 12 });
    // Once today is completed it counts as done and scheduled.
    const done = dailyStats([h], lookup([entry('gym', '2026-11-06'), entry('gym', '2026-11-11')]), from, to, '2026-11-11')[0];
    expect(done).toMatchObject({ done: 2, scheduled: 3, open: null });
  });

  it('a numeric target changed mid-period is applied per day; 3 of 10 pages earn an activity day but stay 3/10', () => {
    const h = habit({ id: 'read', kind: 'numeric', unit: 'Seiten', rules: [makeRule('2026-10-01', [0, 1, 2, 3, 4, 5, 6], 10), makeRule('2026-11-08', [0, 1, 2, 3, 4, 5, 6], 20)] });
    // 15 pages: enough before Nov 8 (target 10), not after (target 20).
    const es = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'].map((d) => entry('read', d, 15));
    es.push(entry('read', '2026-11-11', 3));
    const [r] = dailyStats([h], lookup(es), '2026-11-05', '2026-11-11', '2026-11-11');
    expect(r).toMatchObject({ done: 3, scheduled: 6, open: { value: 3, target: 20 } });
    const streak = computeStreak({ habits: [h], entries: es, completions: [], analyses: [] }, '2026-11-11', 1);
    expect(streak.current).toBe(7); // every day with any recorded value is an activity day
  });

  it('archived periods and days before the start are not scheduled', () => {
    const h = habit({ id: 'x', startDate: '2026-11-07', pauses: [{ from: '2026-11-09', to: '2026-11-11' }] });
    const [r] = dailyStats([h], lookup([entry('x', '2026-11-07')]), '2026-11-01', '2026-11-11', '2026-11-11');
    expect(r).toMatchObject({ done: 1, scheduled: 2, open: { value: 0, target: 1 } }); // Nov 7, 8 (+ today open)
  });

  it('an empty week has no rows at all', () => {
    const later = habit({ id: 'later', startDate: '2026-11-20' });
    const weekly = habit({ id: 'sub', kind: 'weekly', startDate: '2026-11-20', rules: [makeRule('2026-11-20', [0, 1, 2, 3, 4, 5, 6], 2)] });
    expect(dailyStats([later, weekly], lookup([]), '2026-11-02', '2026-11-08', '2026-11-11')).toEqual([]);
    expect(goalStats([later, weekly], [], [], '2026-11-02', '2026-11-08', '2026-11-11', 1)).toEqual([]);
  });
});

describe('progress overview: weekly goals', () => {
  const sub = habit({ id: 'sub', name: 'Substack', kind: 'weekly', rules: [makeRule('2026-10-01', [0, 1, 2, 3, 4, 5, 6], 2)] });

  it('finished weeks are results, the running week is separate with its actual progress; edge weeks are marked partial', () => {
    const as = [analysis('a1', 'sub', '2026-11-03'), analysis('a2', 'sub', '2026-11-05'), analysis('a3', 'sub', '2026-11-10')];
    const [g] = goalStats([sub], as, [], '2026-11-05', '2026-11-11', '2026-11-11', 1); // 7 days, Monday weeks
    expect(g.weeks).toEqual([{ start: '2026-11-02', end: '2026-11-08', count: 2, target: 2, achieved: true, partial: true }]);
    expect(g.current).toMatchObject({ start: '2026-11-09', count: 1, target: 2, achieved: false });
    expect(weekLabel({ start: g.current!.start, count: 1, target: 2, achieved: false }, 'weekly', de)).toBe('1 von 2 Analysen');
    // 30 days: Oct 13 – Nov 11 → Oct 13 week (full), Oct 20, Oct 27, Nov 2 finished; none partial at the start.
    const [g30] = goalStats([sub], as, [], '2026-10-13', '2026-11-11', '2026-11-11', 1);
    expect(g30.weeks.map((w) => [w.start, w.count, w.partial])).toEqual([
      ['2026-10-12', 0, true], ['2026-10-19', 0, false], ['2026-10-26', 0, false], ['2026-11-02', 2, false],
    ]);
  });

  it('a week crossing New Year counts analyses from both years (Monday and Sunday week start)', () => {
    const as = [analysis('d', 'sub', '2025-12-30'), analysis('j', 'sub', '2026-01-02')];
    const s = habit({ ...sub, startDate: '2025-12-01', rules: [makeRule('2025-12-01', [0, 1, 2, 3, 4, 5, 6], 2)] });
    const [mon] = goalStats([s], as, [], '2025-12-29', '2026-01-04', '2026-01-10', 1);
    expect(mon.weeks).toEqual([{ start: '2025-12-29', end: '2026-01-04', count: 2, target: 2, achieved: true, partial: false }]);
    const [sun] = goalStats([s], as, [], '2025-12-28', '2026-01-03', '2026-01-10', 0);
    expect(sun.weeks[0]).toMatchObject({ start: '2025-12-28', end: '2026-01-03', count: 2 });
    setDateLocale('de');
    expect(formatRange('2025-12-29', '2026-01-04')).toMatch(/2025.*2026/);
    expect(notesIn([], as, '2025-12-29', '2026-01-04').learnings.map((a) => a.id)).toEqual(['d', 'j']);
  });

  it('a Substack analysis moved to another week leaves the first week and counts in the second', () => {
    const a = analysis('a', 'sub', '2026-11-03');
    const moved = toAnalysis('a', 'sub', { title: a.title, url: '', date: '2026-10-28', learnings: a.learnings }, a, 5);
    const count = (list: Analysis[]) => goalStats([sub], list, [], '2026-10-26', '2026-11-08', '2026-11-11', 1)[0].weeks.map((w) => w.count);
    expect(count([a])).toEqual([0, 1]);
    expect(count([moved])).toEqual([1, 0]);
    expect(moved.createdAt).toBe(0); // same record, new date
  });

  it('frequency goals ("2× pro Woche") count completions per calendar week', () => {
    const f = habit({ id: 'run', rules: [makeRule('2026-10-01', [], 1, { perWeek: 2 })] });
    const cs = ['2026-11-03', '2026-11-04', '2026-11-10'].map((d) => ({ id: `run|${d}`, habitId: 'run', date: d, createdAt: 0, updatedAt: 0 }));
    const [g] = goalStats([f], [], cs, '2026-11-02', '2026-11-11', '2026-11-11', 1);
    expect(g.weeks[0]).toMatchObject({ count: 2, achieved: true });
    expect(g.current).toMatchObject({ count: 1, target: 2 });
    expect(dailyStats([f], lookup([]), '2026-11-02', '2026-11-11', '2026-11-11')).toEqual([]); // no daily obligation
  });
});

describe('weekly review records', () => {
  it('one record per explicit week range; empty prompts remove it', () => {
    const r = toReview('2026-11-09', '2026-11-15', { wentWell: ' Lesen ', heldBack: '', nextWeek: 'früher schlafen' }, undefined, 7)!;
    expect(r).toEqual({ id: '2026-11-09_2026-11-15', weekStart: '2026-11-09', weekEnd: '2026-11-15', wentWell: 'Lesen', heldBack: '', nextWeek: 'früher schlafen', createdAt: 7, updatedAt: 7 });
    expect(toReview('2026-11-09', '2026-11-15', { wentWell: ' ', heldBack: '', nextWeek: '' }, r, 8)).toBeNull();
    expect(toReview('2026-11-09', '2026-11-15', draftOf(r), r, 9)).toMatchObject({ createdAt: 7, updatedAt: 9 });
    expect(reviewErrors(r)).toEqual([]);
    expect(reviewErrors({ ...r, id: '2026-11-08_2026-11-14' })).toEqual(['rangeMismatch']);
    expect(reviewErrors({ ...r, weekEnd: '2026-11-16', id: '2026-11-09_2026-11-16' })).toEqual(['dateInvalid']);
    expect(cleanRecord('review', { ...r, extra: 1 })).toEqual(r);
    expect(cleanRecord('review', { ...r, wentWell: '', nextWeek: '' })).toBeNull();
  });

  it('after switching the week start, earlier reviews stay under their original dates and are found by overlap', () => {
    const mon = toReview('2026-11-02', '2026-11-08', { wentWell: 'gut', heldBack: '', nextWeek: '' }, undefined, 1)!;
    // Now Sunday weeks: Nov 1–7 and Nov 8–14 both overlap the Monday review.
    expect(overlappingReviews([mon], '2026-11-01', '2026-11-07').map((r) => r.id)).toEqual(['2026-11-02_2026-11-08']);
    expect(overlappingReviews([mon], '2026-11-08', '2026-11-14')).toHaveLength(1);
    expect(overlappingReviews([mon], '2026-11-02', '2026-11-08')).toEqual([]); // that is the review itself
    expect(overlappingReviews([mon], '2026-11-09', '2026-11-15')).toEqual([]);
    expect(reviewId(mon.weekStart, mon.weekEnd)).toBe(mon.id);
  });

  it('export includes reviews; older exports without reviews stay readable; invalid reviews are rejected before storage', () => {
    const r: Review = toReview('2026-11-02', '2026-11-08', { wentWell: 'a', heldBack: 'b', nextWeek: 'c' }, undefined, 1)!;
    const file = JSON.parse(JSON.stringify(toExport({ ...emptySnapshot(), reviews: [r] })));
    expect(file.version).toBe(4);
    const ok = validateImport(file, de);
    expect(ok.ok && ok.data.reviews).toEqual([r]);
    const v3 = { ...file, version: 3 };
    delete v3.reviews;
    const old = validateImport(v3, de);
    expect(old.ok && old.data.reviews).toEqual([]);
    const bad = validateImport({ ...file, reviews: [{ ...r, id: 'x' }] }, en);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors[0]).toContain('Review 1');
  });

  it('the dashboard offers the review on the last two days of the week', () => {
    expect(reviewDue('2026-11-13', 1)).toBe(false); // Friday, Monday weeks
    expect(reviewDue('2026-11-14', 1)).toBe(true); // Saturday
    expect(reviewDue('2026-11-15', 1)).toBe(true); // Sunday
    expect(reviewDue('2026-11-13', 0)).toBe(true); // Friday, Sunday weeks
    expect(reviewDue('2026-11-15', 0)).toBe(false);
  });

  it('journal notes and analysis learnings of the week, oldest first', () => {
    const j = (id: string, date: string): JournalEntry => ({ id, date, title: '', notes: id, learned: '', createdAt: 0, updatedAt: 0 });
    const n = notesIn([j('late', '2026-11-08'), j('out', '2026-11-09'), j('early', '2026-11-02')], [analysis('a', 'sub', '2026-11-04')], '2026-11-02', '2026-11-08');
    expect(n.journal.map((x) => x.id)).toEqual(['early', 'late']);
    expect(n.learnings.map((x) => x.id)).toEqual(['a']);
  });
});
