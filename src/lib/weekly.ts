import { addDays, isValidKey, startOfWeek, type DateKey } from './date.js';
import { de, type Messages } from '../i18n/messages.js';
import { completionId, isActiveOn, isArchived, isFrequencyAt, isWeeklyGoalAt, ruleAt, uid, type Analysis, type Completion, type Habit, type JournalEntry } from './model.js';

// Weekly count goals. Two sources count toward a week:
//   • kind 'weekly'  → saved analyses (title + learnings), "2 Analysen pro Woche";
//   • binary habits with an "X-mal pro Woche" rule → completions on any day of the week.
// Weeks follow the configured week start and local dates. A week is only "missed" after it has ended.

export const weekEnd = (ws: DateKey) => addDays(ws, 6);

/** Anything counted toward a week. */
export interface Dated {
  id: string;
  habitId: string;
  date: DateKey;
  createdAt: number;
}

/** Goal for the week starting at `ws`: the rule in force at the week's start, so later edits never rewrite past weeks. */
export function weekTarget(h: Habit, ws: DateKey): number {
  const r = ruleAt(h, ws);
  return h.kind === 'weekly' ? r.target : r.perWeek ?? r.target;
}

export function inWeek(a: { date: DateKey }, ws: DateKey): boolean {
  return a.date >= ws && a.date <= weekEnd(ws);
}

/** Items of one habit in one week, newest first. */
export function itemsInWeek<T extends Dated>(all: Iterable<T>, habitId: string, ws: DateKey): T[] {
  return [...all].filter((a) => a.habitId === habitId && inWeek(a, ws)).sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}
export const analysesInWeek = itemsInWeek<Analysis>;

export interface WeekStatus {
  start: DateKey;
  count: number;
  target: number;
  achieved: boolean;
}

export function weekStatus(h: Habit, all: Iterable<Dated>, ws: DateKey): WeekStatus {
  const count = itemsInWeek(all, h.id, ws).length;
  const target = weekTarget(h, ws);
  return { start: ws, count, target, achieved: count >= target };
}

/** "0 von 2 Analysen" / "2 von 4"; extra progress stays visible ("3 von 2 Analysen"). */
export function weekLabel(s: WeekStatus, kind: Habit['kind'] = 'weekly', m: Messages = de): string {
  return kind === 'weekly' ? m.week.labelAnalyses(s.count, s.target) : m.week.label(s.count, s.target);
}

/** The items that count for a habit: analyses for analysis goals, completions for frequency habits. */
export const countSource = (h: Habit, analyses: Iterable<Analysis>, completions: Iterable<Completion>): Iterable<Dated> => (h.kind === 'weekly' ? analyses : completions);

/** The habit existed on some day of the week and was not archived for all of it. */
export function activeInWeek(h: Habit, ws: DateKey): boolean {
  for (let d = ws; d <= weekEnd(ws); d = addDays(d, 1)) if (isActiveOn(h, d)) return true;
  return false;
}

/** Weeks in which the habit was a weekly goal and active, oldest first, up to the current week. */
export function relevantWeeks(h: Habit, today: DateKey, weekStart: 0 | 1): DateKey[] {
  const out: DateKey[] = [];
  const last = startOfWeek(today, weekStart);
  for (let ws = startOfWeek(h.startDate, weekStart); ws <= last; ws = addDays(ws, 7)) {
    if (isWeeklyGoalAt(h, ws) && activeInWeek(h, ws)) out.push(ws);
  }
  return out;
}

/**
 * Weekly streaks: consecutive achieved weeks. The running week only breaks the streak once it is over.
 * Rate: achieved / relevant weeks; the running week counts only once achieved.
 */
export function weeklyStats(h: Habit, all: Iterable<Dated>, today: DateKey, weekStart: 0 | 1) {
  const list = [...all].filter((a) => a.habitId === h.id);
  const cur = startOfWeek(today, weekStart);
  const weeks = relevantWeeks(h, today, weekStart).map((ws) => weekStatus(h, list, ws));
  let longest = 0;
  let run = 0;
  for (const w of weeks) {
    if (w.achieved) longest = Math.max(longest, ++run);
    else if (w.start !== cur) run = 0;
  }
  let current = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].achieved) current++;
    else if (weeks[i].start !== cur) break;
  }
  const counted = weeks.filter((w) => w.start !== cur || w.achieved);
  return { current, longest, achieved: counted.filter((w) => w.achieved).length, weeks: counted.length, total: list.length };
}

/** Weekly goals shown for the week starting `ws` (same list for the Today screen and the dashboard ring). */
export function weeklyGoals(habits: Habit[], ws: DateKey): Habit[] {
  return habits.filter((h) => !isArchived(h) && isWeeklyGoalAt(h, ws) && activeInWeek(h, ws));
}

// ---------- Completions ("X-mal pro Woche") ----------

/** Why a completion can't be recorded on `date` (null = fine). `ignoreId`: the completion being edited. */
export function completionError(h: Habit, date: DateKey, today: DateKey, completions: Iterable<Completion>, ignoreId?: string, m: Messages = de): string | null {
  const t = m.completion;
  if (!isValidKey(date)) return t.errDate;
  if (date > today) return t.errFuture;
  if (date < h.startDate) return t.errBeforeStart(h.startDate);
  if (!isActiveOn(h, date)) return t.errArchived;
  if (!isFrequencyAt(h, date)) return t.errNoGoal;
  if (!ruleAt(h, date).multi) {
    for (const c of completions) if (c.habitId === h.id && c.date === date && c.id !== ignoreId) return t.errTwice;
  }
  return null;
}

/** One-per-day completions get a deterministic id, so the same day can't be stored twice on any device. */
export function makeCompletion(h: Habit, date: DateKey, now: number, prev?: Completion): Completion {
  const id = ruleAt(h, date).multi ? prev?.id ?? uid() : completionId(h.id, date);
  return { id, habitId: h.id, date, createdAt: prev?.createdAt ?? now, updatedAt: now };
}

// ---------- Drafts (form input) ----------

export interface AnalysisDraft {
  title: string;
  url: string;
  date: DateKey;
  learnings: string;
}

/** `startDate`: the habit's start; earlier analyses would fall outside every counted week. */
export function validateAnalysis(d: AnalysisDraft, today: DateKey, startDate: DateKey, m: Messages = de): Partial<Record<keyof AnalysisDraft, string>> {
  const t = m.analysis;
  const e: Partial<Record<keyof AnalysisDraft, string>> = {};
  if (!d.title.trim()) e.title = t.errTitle;
  else if (d.title.length > 300) e.title = t.errTitleLong;
  if (d.url.trim() && !isHttpUrl(d.url.trim())) e.url = t.errUrl;
  if (!isValidKey(d.date)) e.date = t.errDate;
  else if (d.date > today) e.date = t.errFuture;
  else if (d.date < startDate) e.date = t.errBeforeStart(startDate);
  if (!d.learnings.trim()) e.learnings = t.errLearnings;
  return e;
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && s.length <= 2000;
  } catch {
    return false;
  }
}

/** Builds the stored record. The id is fixed when the form opens, so retries and double clicks overwrite instead of duplicating. */
export function toAnalysis(id: string, habitId: string, d: AnalysisDraft, prev: Analysis | undefined, now: number): Analysis {
  return {
    id, habitId, date: d.date, title: d.title.trim(), url: d.url.trim(), learnings: d.learnings.trim(),
    createdAt: prev?.createdAt ?? now, updatedAt: now,
  };
}

export interface JournalDraft {
  date: DateKey;
  title: string;
  notes: string;
  learned: string;
}

export function validateJournal(d: JournalDraft, today: DateKey, m: Messages = de): Partial<Record<keyof JournalDraft | 'content', string>> {
  const t = m.journal;
  const e: Partial<Record<keyof JournalDraft | 'content', string>> = {};
  if (!isValidKey(d.date)) e.date = t.errDate;
  else if (d.date > today) e.date = t.errFuture;
  if (!d.notes.trim() && !d.learned.trim()) e.content = t.errContent;
  if (d.title.length > 200) e.title = t.errTitle;
  return e;
}

export function toJournal(id: string, d: JournalDraft, prev: JournalEntry | undefined, now: number): JournalEntry {
  return { id, date: d.date, title: d.title.trim(), notes: d.notes.trim(), learned: d.learned.trim(), createdAt: prev?.createdAt ?? now, updatedAt: now };
}

/** Timeline: grouped by date, newest date first; within a day newest first. */
export function groupByDate(entries: Iterable<JournalEntry>): { date: DateKey; entries: JournalEntry[] }[] {
  const m = new Map<DateKey, JournalEntry[]>();
  for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, es]) => ({ date, entries: es.sort((a, b) => b.createdAt - a.createdAt) }));
}
