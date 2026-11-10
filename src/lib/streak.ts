import { addDays, startOfWeek, type DateKey } from './date';
import { isActiveOn, isScheduled, isWeeklyGoalAt, type Analysis, type Completion, type Entry, type Habit } from './model';
import type { SyncState } from './sync';

// App-wide activity streak ("Aktiv-Serie"): consecutive days with at least one recorded habit action.
// Separate from the per-habit streaks in model.ts, which stay unchanged.
//
// Action (counts the day once, however many there are):
//   a done/not-done habit checked off · positive numeric progress · an "X-mal pro Woche" completion ·
//   a saved analysis. Journal notes, drafts and signing in never count. The habit must be active that day.
//
// Day states (local calendar days, historical rules via isScheduled / isWeeklyGoalAt):
//   done      – an action on a day with at least one habit due (daily schedule) or a weekly goal in force;
//   missed    – a habit was due by its daily schedule, the day has ended and nothing was recorded;
//   frozen    – a missed day covered by the weekly freeze (see below): keeps the streak, adds nothing;
//   pending   – today (or a later day) that can still be earned;
//   none      – neutral: nothing due. Weekly goals let a day be earned but never make it missed, so a week with a
//               "3× pro Woche" goal doesn't demand activity every day; a missed day is never a failed weekly goal.
//
// Freeze: one per calendar week (configured week start). It covers the first otherwise missed day of that week,
// only once that day has ended and only while there is a streak to protect. Further missed days break the streak.
// Everything is derived from the recorded history, so every device computes the same result (no stored counter
// that two devices could spend twice), and undo, deletion or backdating recompute it.

export type DayState = 'done' | 'frozen' | 'missed' | 'pending' | 'none';

export interface StreakResult {
  /** Current streak in days (frozen days keep it but don't add). */
  current: number;
  longest: number;
  /** State of every day from the first habit's start up to and including today. */
  days: Map<DateKey, DayState>;
  /** Freeze already used in the week containing `today`. */
  freezeUsedThisWeek: boolean;
  /** The last ended day that wasn't neutral was frozen and today isn't earned yet: the streak is on ice. */
  protectedByFreeze: boolean;
}

export interface StreakInput {
  habits: Habit[];
  entries: Entry[];
  completions: Completion[];
  analyses: Analysis[];
}

/** Days with at least one qualifying action. */
export function activityDays({ habits, entries, completions, analyses }: StreakInput): Set<DateKey> {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const days = new Set<DateKey>();
  const active = (habitId: string, date: DateKey, ok: (h: Habit) => boolean) => {
    const h = byId.get(habitId);
    return !!h && ok(h) && isActiveOn(h, date);
  };
  for (const e of entries) if (e.value > 0 && active(e.habitId, e.date, (h) => h.kind !== 'weekly')) days.add(e.date);
  for (const c of completions) if (active(c.habitId, c.date, (h) => h.kind === 'binary')) days.add(c.date);
  for (const a of analyses) if (active(a.habitId, a.date, (h) => h.kind === 'weekly')) days.add(a.date);
  return days;
}

/** A daily schedule makes the day count: missing it can break the streak. */
const due = (habits: Habit[], d: DateKey) => habits.some((h) => isScheduled(h, d));
/** The day can be earned: something is due, or a weekly goal is in force. */
const earnable = (habits: Habit[], d: DateKey) => due(habits, d) || habits.some((h) => isWeeklyGoalAt(h, d) && isActiveOn(h, d));

export function computeStreak(input: StreakInput, today: DateKey, weekStart: 0 | 1): StreakResult {
  const { habits } = input;
  const days = new Map<DateKey, DayState>();
  const acted = activityDays(input);
  let current = 0;
  let longest = 0;
  const freezeWeeks = new Set<DateKey>();
  if (!habits.length) return { current, longest, days, freezeUsedThisWeek: false, protectedByFreeze: false };

  const first = habits.reduce((m, h) => (h.startDate < m ? h.startDate : m), habits[0].startDate);
  let lastEnded: DayState = 'none';
  for (let d = first; d <= today; d = addDays(d, 1)) {
    let s: DayState;
    if (acted.has(d) && earnable(habits, d)) {
      s = 'done';
      longest = Math.max(longest, ++current);
    } else if (d === today) {
      s = earnable(habits, d) ? 'pending' : 'none'; // an unfinished today never breaks the streak
    } else if (!due(habits, d)) {
      s = 'none';
    } else {
      const ws = startOfWeek(d, weekStart);
      if (current > 0 && !freezeWeeks.has(ws)) {
        freezeWeeks.add(ws);
        s = 'frozen';
      } else {
        s = 'missed';
        current = 0;
      }
    }
    days.set(d, s);
    if (d !== today && s !== 'none') lastEnded = s;
  }
  return {
    current,
    longest,
    days,
    freezeUsedThisWeek: freezeWeeks.has(startOfWeek(today, weekStart)),
    protectedByFreeze: lastEnded === 'frozen' && days.get(today) !== 'done' && current > 0,
  };
}

/** State for any day: computed history up to today, beyond it whether the day can still be earned. */
export function dayStateAt(r: StreakResult, habits: Habit[], d: DateKey, today: DateKey): DayState {
  if (d <= today) return r.days.get(d) ?? 'none';
  return earnable(habits, d) ? 'pending' : 'none';
}

// ---------- Post-login welcome ----------

export type WelcomeStep = 'none' | 'wait' | 'show' | 'skip';

/**
 * Streak welcome after an explicit sign-in (see lib/auth.ts welcomeOnAuthEvent): shown once the account's data
 * is loaded and the first synchronisation has settled (synced, offline or failed) — or after a short wait, so a
 * slow network never blocks the app. The panel then says whether the number is verified or this device's data.
 */
export function welcomeStep(o: { welcomeFor: string | null; userId: string | null; storeReady: boolean; sync: SyncState | null; waited: boolean; skip: boolean }): WelcomeStep {
  if (!o.welcomeFor || o.welcomeFor !== o.userId || !o.storeReady) return 'none';
  if (o.skip) return 'skip';
  const settled = !!o.sync && (o.sync.lastSync != null || o.sync.status === 'offline' || o.sync.status === 'error');
  return settled || o.waited ? 'show' : 'wait';
}

/** The number is confirmed by the server only after a successful sync with nothing left to upload. */
export const streakVerified = (sync: SyncState | null) => !!sync && sync.status === 'synced' && sync.pending === 0 && sync.lastSync != null;
