import { addDays, range, weekday, type DateKey } from './date.js';

export const SCHEMA_VERSION = 4;

/** Schedule + target valid from `from` onward. Edits append a new rule, so past days keep the rule they had. */
export interface Rule {
  from: DateKey;
  /** Weekdays (0 = Sunday). All seven = daily. */
  days: number[];
  /** Binary: always 1. Numeric: daily target. Weekly: analyses per week (days unused). */
  target: number;
  /**
   * "X-mal pro Woche" (binary habits only): completions per week, no required weekdays (days unused).
   * Absent = daily / weekday schedule.
   */
  perWeek?: number;
  /** Frequency rule: allow several completions on the same day (default: one per day). */
  multi?: boolean;
}

export interface Pause {
  from: DateKey;
  /** null while archived */
  to: DateKey | null;
}

export interface Habit {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** 'weekly': a count goal per calendar week, fulfilled by saved analyses (not by daily entries). */
  kind: 'binary' | 'numeric' | 'weekly';
  unit: string;
  startDate: DateKey;
  rules: Rule[];
  /** Archive periods; days inside are not scheduled, so they never count against streaks or rates. */
  pauses: Pause[];
  reminder: string | null; // 'HH:MM' — daily / weekday habits
  /**
   * Weekly goals (analyses or "X-mal pro Woche"): optional notification day (0 = Sunday) and time. Only a
   * notification preference: completions still count on any eligible day of the week.
   */
  weeklyReminder?: { day: number; time: string } | null;
  order: number;
  createdAt: number;
}

export interface Entry {
  /** `${habitId}|${date}` — the primary key makes "one entry per habit per day" structural. */
  id: string;
  habitId: string;
  date: DateKey;
  value: number;
  note: string;
  updatedAt: number;
}

/**
 * One completion of an "X-mal pro Woche" habit. With one-per-day the id is `${habitId}|${date}`,
 * so the same day can never be counted twice, even across devices.
 */
export interface Completion {
  id: string;
  habitId: string;
  date: DateKey;
  createdAt: number;
  updatedAt: number;
}

/** One completed analysis for a weekly habit. Several per day are allowed. */
export interface Analysis {
  id: string;
  habitId: string;
  date: DateKey;
  title: string;
  url: string;
  learnings: string;
  createdAt: number;
  updatedAt: number;
}

/** General journal note; independent of all habits. */
export interface JournalEntry {
  id: string;
  date: DateKey;
  title: string;
  notes: string;
  learned: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Weekly review: three optional reflections for one explicit week range. The id is `${weekStart}_${weekEnd}`, so
 * a review stays under its original dates when the preferred week start changes, and two devices writing the same
 * week edit one record (text conflicts are preserved like journal text).
 */
export interface Review {
  id: string;
  weekStart: DateKey;
  weekEnd: DateKey;
  wentWell: string;
  heldBack: string;
  nextWeek: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  weekStart: 0 | 1;
  motion: 'system' | 'reduce' | 'full';
  remindersEnabled: boolean;
}

export const defaultSettings: Settings = { weekStart: 1, motion: 'system', remindersEnabled: false };

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const entryId = (habitId: string, date: DateKey) => `${habitId}|${date}`;

export const isArchived = (h: Habit) => h.pauses.some((p) => p.to === null);

export function ruleAt(h: Habit, date: DateKey): Rule {
  let r = h.rules[0];
  for (const x of h.rules) if (x.from <= date) r = x;
  return r;
}

/** Habit exists and is not archived on that day (independent of weekdays). */
export function isActiveOn(h: Habit, date: DateKey): boolean {
  return date >= h.startDate && !h.pauses.some((p) => date >= p.from && (p.to === null || date < p.to));
}

/** Daily obligation. Weekly goals are never scheduled per day, so they stay out of all daily statistics. */
export function isScheduled(h: Habit, date: DateKey): boolean {
  if (h.kind === 'weekly' || !isActiveOn(h, date)) return false;
  if (ruleAt(h, date).perWeek != null) return false; // frequency weeks: no daily obligation
  return ruleAt(h, date).days.includes(weekday(date));
}

export function targetAt(h: Habit, date: DateKey): number {
  return h.kind === 'binary' ? 1 : ruleAt(h, date).target;
}

export function isComplete(h: Habit, e: Entry | undefined, date: DateKey): boolean {
  return !!e && e.value >= targetAt(h, date);
}

/**
 * Applies a schedule/target edit: rules before `effective` stay untouched and a new rule starts at `effective`
 * (today, or the start date if the habit hasn't started), so history keeps its original semantics.
 */
export function makeRule(from: DateKey, days: number[], target: number, freq: { perWeek?: number; multi?: boolean } = {}): Rule {
  const r: Rule = { from, days: [...days].sort((a, b) => a - b), target };
  if (freq.perWeek != null) {
    r.perWeek = freq.perWeek;
    if (freq.multi) r.multi = true;
  }
  return r;
}

export function withRule(h: Habit, days: number[], target: number, effective: DateKey, freq: { perWeek?: number; multi?: boolean } = {}): Rule[] {
  const next = makeRule(effective, days, target, freq);
  if (sameRule(ruleAt(h, effective), next)) {
    // Unchanged from the rule in force: drop any pending future change, otherwise keep the rules as they are.
    const upTo = h.rules.filter((r) => r.from <= effective);
    return upTo.length === h.rules.length ? h.rules : upTo;
  }
  const kept = h.rules.filter((r) => r.from < effective);
  // Editing back to the rule already in force just drops a pending future change.
  if (kept.length && sameRule(kept[kept.length - 1], next)) return kept;
  return [...kept, next];
}

const sameRule = (a: Rule, b: Rule) =>
  a.days.join() === b.days.join() && a.target === b.target && (a.perWeek ?? null) === (b.perWeek ?? null) && !!a.multi === !!b.multi;

export type EntryLookup = (habitId: string, date: DateKey) => Entry | undefined;

/**
 * Consecutive completed scheduled days. Unscheduled and paused days are skipped,
 * and an unfinished `today` never breaks the streak before the day ends.
 */
export function streaks(h: Habit, get: EntryLookup, today: DateKey): { current: number; longest: number } {
  if (h.startDate > today) return { current: 0, longest: 0 };
  let longest = 0;
  let run = 0;
  for (const d of range(h.startDate, today)) {
    if (!isScheduled(h, d)) continue;
    if (isComplete(h, get(h.id, d), d)) longest = Math.max(longest, ++run);
    else if (d !== today) run = 0;
  }
  let current = 0;
  for (let d = today; d >= h.startDate; d = addDays(d, -1)) {
    if (!isScheduled(h, d)) continue;
    if (isComplete(h, get(h.id, d), d)) current++;
    else if (d !== today) break;
  }
  return { current, longest };
}

export interface Rate {
  done: number;
  scheduled: number;
}

/** Completed / scheduled days in [from, to], clipped to today. Today only counts once it is completed. */
export function rate(h: Habit, get: EntryLookup, from: DateKey, to: DateKey, today: DateKey): Rate {
  let done = 0;
  let scheduled = 0;
  const end = to < today ? to : today;
  if (from > end) return { done, scheduled };
  for (const d of range(from, end)) {
    if (!isScheduled(h, d)) continue;
    const c = isComplete(h, get(h.id, d), d);
    if (d === today && !c) continue;
    scheduled++;
    if (c) done++;
  }
  return { done, scheduled };
}

export function sumRates(rs: Rate[]): Rate {
  return rs.reduce((a, r) => ({ done: a.done + r.done, scheduled: a.scheduled + r.scheduled }), { done: 0, scheduled: 0 });
}

export const pct = (r: Rate): number | null => (r.scheduled ? Math.round((r.done / r.scheduled) * 100) : null);

export function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Frequency rule ("X-mal pro Woche") in force on `date`. */
export const isFrequencyAt = (h: Habit, date: DateKey) => h.kind === 'binary' && ruleAt(h, date).perWeek != null;

/** Any weekly goal (analyses or frequency) in force on `date`. */
export const isWeeklyGoalAt = (h: Habit, date: DateKey) => h.kind === 'weekly' || isFrequencyAt(h, date);

/** Latest rule, including one that only starts in the future (shown and edited in the form). */
export const latestRule = (h: Habit): Rule => h.rules[h.rules.length - 1];

export const completionId = (habitId: string, date: DateKey) => `${habitId}|${date}`;
