import { addDays, startOfWeek, type DateKey } from './date';
import { isComplete, isScheduled, isWeeklyGoalAt, rate, targetAt, type Analysis, type Completion, type EntryLookup, type Habit, type JournalEntry, type Review } from './model';
import { activeInWeek, countSource, weekEnd, weekStatus } from './weekly';

// Progress overview (Statistics, 7 / 30 days) and the weekly review. Pure functions over stored records:
//   • daily habits: completed / scheduled days, using the rule, start date and pauses in force on each day;
//     today counts only once completed, otherwise it is reported as still open (with its progress);
//   • weekly goals: per calendar week (configured week start), the rule in force at the week's start; only
//     finished weeks are results, the running week is reported separately with its actual progress.

export type Span = 7 | 30;

/** The last `span` local calendar days, today included. */
export const spanRange = (span: Span, today: DateKey) => ({ from: addDays(today, -(span - 1)), to: today });

export interface DailyStat {
  habit: Habit;
  done: number;
  scheduled: number;
  /** Today is scheduled in the range and not yet complete: its current value and target (numeric: 3 / 10). */
  open: { value: number; target: number } | null;
}

/** Daily and weekday habits with at least one scheduled day in [from, to] (clipped to today). */
export function dailyStats(habits: Habit[], get: EntryLookup, from: DateKey, to: DateKey, today: DateKey): DailyStat[] {
  const out: DailyStat[] = [];
  for (const h of habits) {
    if (h.kind === 'weekly') continue;
    const r = rate(h, get, from < h.startDate ? h.startDate : from, to, today);
    const todayIn = today >= from && today <= to && isScheduled(h, today);
    const e = get(h.id, today);
    const open = todayIn && !isComplete(h, e, today) ? { value: e?.value ?? 0, target: targetAt(h, today) } : null;
    if (r.scheduled || open) out.push({ habit: h, done: r.done, scheduled: r.scheduled, open });
  }
  return out;
}

export interface GoalWeek {
  start: DateKey;
  end: DateKey;
  count: number;
  target: number;
  achieved: boolean;
  /** The calendar week reaches outside the selected range (its count still covers the whole week). */
  partial: boolean;
}

export interface GoalStat {
  habit: Habit;
  /** Finished weeks overlapping the range, oldest first. */
  weeks: GoalWeek[];
  /** The running week, if it overlaps the range: actual progress, not a result yet. */
  current: GoalWeek | null;
}

export function goalStats(habits: Habit[], analyses: Analysis[], completions: Completion[], from: DateKey, to: DateKey, today: DateKey, weekStart: 0 | 1): GoalStat[] {
  const cur = startOfWeek(today, weekStart);
  const out: GoalStat[] = [];
  for (const h of habits) {
    const src = [...countSource(h, analyses, completions)].filter((x) => x.habitId === h.id);
    const weeks: GoalWeek[] = [];
    let current: GoalWeek | null = null;
    for (let ws = startOfWeek(from, weekStart); ws <= to && ws <= cur; ws = addDays(ws, 7)) {
      if (!isWeeklyGoalAt(h, ws) || !activeInWeek(h, ws)) continue;
      const st = weekStatus(h, src, ws);
      const w: GoalWeek = { start: ws, end: weekEnd(ws), count: st.count, target: st.target, achieved: st.achieved, partial: ws < from || weekEnd(ws) > to };
      if (ws === cur) current = w;
      else weeks.push(w);
    }
    if (weeks.length || current) out.push({ habit: h, weeks, current });
  }
  return out;
}

/** Journal notes and saved analysis learnings dated inside [from, to], oldest first. */
export function notesIn(journal: JournalEntry[], analyses: Analysis[], from: DateKey, to: DateKey) {
  const inRange = (d: DateKey) => d >= from && d <= to;
  const byDate = <T extends { date: DateKey; createdAt: number }>(a: T, b: T) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1);
  return {
    journal: journal.filter((j) => inRange(j.date)).sort(byDate),
    learnings: analyses.filter((a) => inRange(a.date)).sort(byDate),
  };
}

// ---------- reviews ----------

export const reviewId = (start: DateKey, end: DateKey) => `${start}_${end}`;

export interface ReviewDraft {
  wentWell: string;
  heldBack: string;
  nextWeek: string;
}
export const emptyReview: ReviewDraft = { wentWell: '', heldBack: '', nextWeek: '' };
export const draftOf = (r: Review | undefined): ReviewDraft => (r ? { wentWell: r.wentWell, heldBack: r.heldBack, nextWeek: r.nextWeek } : emptyReview);

/** The stored record, or null when every prompt is empty (nothing worth keeping: the review is removed). */
export function toReview(start: DateKey, end: DateKey, d: ReviewDraft, prev: Review | undefined, now: number): Review | null {
  const t = { wentWell: d.wentWell.trim(), heldBack: d.heldBack.trim(), nextWeek: d.nextWeek.trim() };
  if (!t.wentWell && !t.heldBack && !t.nextWeek) return null;
  return { id: reviewId(start, end), weekStart: start, weekEnd: end, ...t, createdAt: prev?.createdAt ?? now, updatedAt: now };
}

/** Reviews written for other week ranges that share days with [start, end] (e.g. before the week start changed). */
export const overlappingReviews = (reviews: Review[], start: DateKey, end: DateKey) =>
  reviews.filter((r) => r.id !== reviewId(start, end) && r.weekStart <= end && r.weekEnd >= start).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));

/** The dashboard offers the review on the last two days of the week. */
export const reviewDue = (today: DateKey, weekStart: 0 | 1) => today >= addDays(startOfWeek(today, weekStart), 5);
