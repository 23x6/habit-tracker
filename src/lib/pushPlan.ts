import { de, en } from '../i18n/messages.js';
import { startOfWeek, weekday, type DateKey } from './date.js';
import { cleanRecord } from './io.js';
import { defaultSettings, entryId, isActiveOn, isArchived, isComplete, isScheduled, isWeeklyGoalAt, targetAt, type Analysis, type Completion, type Entry, type Habit, type Settings } from './model.js';
import type { Kind } from './db.js';
import { countSource, weekStatus } from './weekly.js';

// Which push reminders are due for one device right now. Pure: used by the server scheduler (api/reminders.ts)
// and tested with fixtures. All dates are the device's local calendar dates in its IANA time zone.
//
// • Daily / weekday habits with a reminder time: due when the habit is scheduled on that local date and its
//   target is still open according to the synced records (3/10 pages → reminder; 10/10 → none).
// • Weekly goals with a reminder day and time: due on that weekday when the week's count is below the target.
// • A reminder is due from its time until WINDOW_MIN minutes later, so a delayed or skipped scheduler run still
//   sends it, while a much later run doesn't send stale reminders. Each reminder has a stable key; the server
//   sends a key at most once per device (push_claim), so duplicate or overlapping runs never alert twice.
// • Daylight saving: local time is read from the time zone at each run. A time that doesn't exist on the
//   spring-forward day (02:30) fires at the first run after the jump; on the fall-back day the repeated hour
//   can't send twice (same key).

export const WINDOW_MIN = 60;

export interface PushInput {
  habits: Habit[];
  entries: Entry[];
  completions: Completion[];
  analyses: Analysis[];
  settings: Settings;
}

export interface PlannedPush {
  key: string;
  habitId: string;
  title: string;
  body: string;
  url: string;
}

/** Local calendar date and minutes after midnight in `timeZone`. Throws RangeError for an unknown zone. */
export function zonedNow(now: Date, timeZone: string): { date: DateKey; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const isDue = (time: string, minutes: number) => minutes >= toMin(time) && minutes < toMin(time) + WINDOW_MIN;

/** Validated records from the server rows ({kind, data}); anything invalid is ignored. */
export function inputFromRecords(rows: { kind: Kind; data: unknown }[]): PushInput {
  const input: PushInput = { habits: [], entries: [], completions: [], analyses: [], settings: defaultSettings };
  for (const r of rows) {
    const d = cleanRecord(r.kind, r.data);
    if (d == null) continue;
    if (r.kind === 'habit') input.habits.push(d as Habit);
    else if (r.kind === 'entry') input.entries.push(d as Entry);
    else if (r.kind === 'completion') input.completions.push(d as Completion);
    else if (r.kind === 'analysis') input.analyses.push(d as Analysis);
    else if (r.kind === 'settings') input.settings = d as Settings;
  }
  return input;
}

export function planReminders(input: PushInput, now: Date, timeZone: string, lang: 'de' | 'en'): PlannedPush[] {
  const m = lang === 'en' ? en.push : de.push;
  const num = (n: number) => n.toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: 2 });
  const { date, minutes } = zonedNow(now, timeZone);
  const entries = new Map(input.entries.map((e) => [e.id, e]));
  const out: PlannedPush[] = [];
  for (const h of input.habits) {
    if (isArchived(h)) continue;
    const url = `./?habit=${encodeURIComponent(h.id)}`;
    if (h.reminder && isScheduled(h, date) && isDue(h.reminder, minutes)) {
      const e = entries.get(entryId(h.id, date));
      if (!isComplete(h, e, date)) {
        const body = h.kind === 'numeric' ? m.openNumeric(num(e?.value ?? 0), num(targetAt(h, date)), h.unit) : m.openToday;
        out.push({ key: `daily|${h.id}|${date}`, habitId: h.id, title: h.name, body, url });
      }
    }
    const wr = h.weeklyReminder;
    if (wr && weekday(date) === wr.day && isDue(wr.time, minutes) && isActiveOn(h, date)) {
      const ws = startOfWeek(date, input.settings.weekStart);
      if (isWeeklyGoalAt(h, ws)) {
        const st = weekStatus(h, [...countSource(h, input.analyses, input.completions)].filter((x) => x.habitId === h.id), ws);
        const left = st.target - st.count;
        if (left > 0) out.push({ key: `weekly|${h.id}|${ws}`, habitId: h.id, title: h.name, body: h.kind === 'weekly' ? m.analysesLeft(left) : m.timesLeft(left), url });
      }
    }
  }
  return out;
}
