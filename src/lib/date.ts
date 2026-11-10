// Local calendar dates as 'YYYY-MM-DD' keys. All arithmetic goes through local Date components,
// so daylight-saving shifts never move a day (no millisecond math on local times).

export type DateKey = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(k: DateKey): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon: safely away from DST transitions around midnight
}

export function isValidKey(k: unknown): k is DateKey {
  if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  return toKey(fromKey(k)) === k;
}

export function today(now = new Date()): DateKey {
  return toKey(now);
}

export function addDays(k: DateKey, n: number): DateKey {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function addMonths(k: DateKey, n: number): DateKey {
  const d = fromKey(k);
  return toKey(new Date(d.getFullYear(), d.getMonth() + n, 1, 12));
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(k: DateKey): number {
  return fromKey(k).getDay();
}

/** Whole calendar days from a to b (b - a). */
export function diffDays(a: DateKey, b: DateKey): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function startOfWeek(k: DateKey, weekStart: 0 | 1): DateKey {
  return addDays(k, -((weekday(k) - weekStart + 7) % 7));
}

export function startOfMonth(k: DateKey): DateKey {
  return k.slice(0, 8) + '01';
}

export function endOfMonth(k: DateKey): DateKey {
  return addDays(addMonths(k, 1), -1);
}

export function range(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export function weekdayOrder(weekStart: 0 | 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7);
}

// Display formatting follows the UI language (set by the i18n provider). Date keys and calculations never do.
let LOCALE = 'de-DE';
export const setDateLocale = (lang: 'de' | 'en') => void (LOCALE = lang === 'en' ? 'en-GB' : 'de-DE');
export const locale = () => LOCALE;

const cache = new Map<string, Intl.DateTimeFormat>();
const fmt = (name: string, o: Intl.DateTimeFormatOptions) => {
  const k = LOCALE + name;
  let f = cache.get(k);
  if (!f) cache.set(k, (f = new Intl.DateTimeFormat(LOCALE, o)));
  return f;
};

export const formatLong = (k: DateKey) => fmt('long', { weekday: 'long', day: 'numeric', month: 'long' }).format(fromKey(k));
export const formatShort = (k: DateKey) => fmt('short', { day: 'numeric', month: 'short' }).format(fromKey(k));
export const formatDayMonth = (k: DateKey) => fmt('dayMonth', { day: 'numeric', month: 'long' }).format(fromKey(k));
export const formatMonth = (k: DateKey) => fmt('month', { month: 'long', year: 'numeric' }).format(fromKey(k));
export const formatTime = (ms: number) => fmt('time', { hour: '2-digit', minute: '2-digit' }).format(ms);
export const formatDateTime = (ms: number) => fmt('dateTime', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
export const formatNumber = (n: number) => n.toLocaleString(LOCALE, { maximumFractionDigits: 2 });
// 2024-01-07 is a Sunday, so +wd gives that weekday.
export const weekdayShort = (wd: number) => fmt('wdShort', { weekday: 'short' }).format(new Date(2024, 0, 7 + wd, 12)).replace('.', '');
export const weekdayLong = (wd: number) => fmt('wdLong', { weekday: 'long' }).format(new Date(2024, 0, 7 + wd, 12));
