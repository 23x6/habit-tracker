import { startOfWeek, type DateKey } from './date';
import { isActiveOn, isArchived, isComplete, isScheduled, isWeeklyGoalAt, type Analysis, type Completion, type EntryLookup, type Habit } from './model';
import { countSource, weekStatus, type WeekStatus } from './weekly';

// Today list: what is still actionable on the selected date comes first.
//   'daily'  — daily habits scheduled on the date and not yet complete;
//   'weekly' — weekly goals (analyses, "X-mal pro Woche") of the date's week that are not yet reached;
//   'done'   — completed daily habits and reached weekly goals.
// Unscheduled, archived or not-yet-started habits are not listed. Within a group the manual order is kept.
// Display only: the dashboard ring keeps its own, separate daily and weekly calculations (lib/dashboard.ts).

export type TodayGroup = 'daily' | 'weekly' | 'done';

export interface TodayItem {
  habit: Habit;
  group: TodayGroup;
  /** Weekly goals: status of the selected date's week. */
  week?: WeekStatus;
}

export function todayItems(habits: Habit[], get: EntryLookup, analyses: Analysis[], completions: Completion[], date: DateKey, weekStart: 0 | 1): TodayItem[] {
  const ws = startOfWeek(date, weekStart);
  const items: TodayItem[] = [];
  for (const h of [...habits].sort((a, b) => a.order - b.order)) {
    if (isArchived(h) || !isActiveOn(h, date)) continue;
    if (isWeeklyGoalAt(h, date)) {
      const week = weekStatus(h, countSource(h, analyses, completions), ws);
      items.push({ habit: h, group: week.achieved ? 'done' : 'weekly', week });
    } else if (isScheduled(h, date)) {
      items.push({ habit: h, group: isComplete(h, get(h.id, date), date) ? 'done' : 'daily' });
    }
  }
  const rank: Record<TodayGroup, number> = { daily: 0, weekly: 1, done: 2 };
  return items.sort((a, b) => rank[a.group] - rank[b.group]); // stable: manual order within each group
}

/**
 * Step for the numeric quick controls. Habits have no configured step, so it follows the target's magnitude:
 * targets below 100 count in ones (tenths for fractional targets), larger ones in tenths of their order of
 * magnitude (250 → 10, 10 000 → 1000).
 */
export function quickStep(target: number): number {
  if (!(target > 0)) return 1;
  const base = target >= 100 ? 10 ** (Math.floor(Math.log10(target)) - 1) : 1;
  return Number.isInteger(target) ? base : base / 10;
}

/** Parses typed numbers ("2,5", "3.75"); null for anything that isn't a finite, non-negative number. */
export function parseAmount(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n <= 1e7 ? Math.round(n * 100) / 100 : null;
}
