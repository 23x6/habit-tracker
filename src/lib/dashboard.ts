import type { DateKey } from './date';
import { isArchived, isComplete, isScheduled, type Analysis, type Completion, type EntryLookup, type Habit } from './model';
import { countSource, weeklyGoals, weekStatus, type WeekStatus } from './weekly';

// Home dashboard ring. Daily and weekly goals are never mixed:
//   Heute: daily habits scheduled for the selected date; each completed habit is one equal share.
//   Woche: weekly goals (analyses and "X-mal pro Woche"); mean of each goal's capped ratio, so a goal with a
//          large target can't dominate. Counts beyond the target stay visible in the cards, not in the ring.
// An empty set has no ratio (null): the ring shows an empty state, never 100 %.

export interface Progress {
  ratio: number | null;
  done: number;
  total: number;
}

export function dayProgress(habits: Habit[], get: EntryLookup, date: DateKey): Progress {
  const due = habits.filter((h) => !isArchived(h) && isScheduled(h, date));
  const done = due.filter((h) => isComplete(h, get(h.id, date), date)).length;
  return { ratio: due.length ? done / due.length : null, done, total: due.length };
}

export function weekProgress(habits: Habit[], analyses: Analysis[], completions: Completion[], ws: DateKey): Progress & { goals: { habit: Habit; status: WeekStatus }[] } {
  const goals = weeklyGoals(habits, ws).map((habit) => ({ habit, status: weekStatus(habit, countSource(habit, analyses, completions), ws) }));
  const ratio = goals.length ? goals.reduce((s, g) => s + Math.min(1, g.status.count / g.status.target), 0) / goals.length : null;
  return { ratio, done: goals.filter((g) => g.status.achieved).length, total: goals.length, goals };
}

/**
 * Celebrate (glow pulse) only when progress newly reaches 100 % for a given ring (mode + period), and not again
 * for the same ring within `quietMs` — rapid undo/redo around 100 % doesn't repeat the effect.
 */
export function shouldCelebrate(prev: number | null, next: number | null, key: string, last: { key: string; at: number } | null, now: number, quietMs = 4000): boolean {
  if (next == null || next < 1 || (prev != null && prev >= 1)) return false;
  return !(last && last.key === key && now - last.at < quietMs);
}

export const percent = (r: number | null) => (r == null ? null : Math.round(r * 100));
