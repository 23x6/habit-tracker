import { isValidKey } from './date';
import { completionId, defaultSettings, entryId, SCHEMA_VERSION, type Analysis, type Completion, type Entry, type Habit, type JournalEntry, type Settings } from './model';
import type { Kind, Snapshot } from './db';
import { ICON_NAMES } from './icons';
import { isHttpUrl } from './weekly';
import { de, type Messages } from '../i18n/messages';

// Validators return fault keys; validateImport turns them into localized messages.
type IoFault = keyof Messages['io']['f'];

export interface ExportFile extends Snapshot {
  app: 'still';
  version: number;
  exportedAt: string;
}

export function toExport(s: Snapshot): ExportFile {
  return { app: 'still', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), ...s };
}

export type ImportResult = { ok: true; data: Snapshot; fromVersion: number } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is string => isStr(v, 200) && v.length > 0;
const isDays = (v: unknown) =>
  Array.isArray(v) && v.length > 0 && v.length <= 7 && new Set(v).size === v.length && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);

// ---------- per-record validation (shared by import and sync pulls) ----------

export function habitErrors(h: unknown, version = SCHEMA_VERSION): string[] {
  const e: string[] = [];
  if (!isObj(h)) return ['invalid'];
  if (!isStr(h.id, 100) || !h.id) e.push('idMissing');
  if (!isStr(h.name, 80) || !h.name.trim()) e.push('nameMissing');
  if (!isStr(h.description)) e.push('descriptionInvalid');
  if (!isStr(h.icon) || !ICON_NAMES.includes(h.icon)) e.push('iconUnknown');
  if (!(h.kind === 'binary' || h.kind === 'numeric' || (h.kind === 'weekly' && version >= 2))) e.push('typeInvalid');
  if (!isStr(h.unit, 30)) e.push('unitInvalid');
  if (!isValidKey(h.startDate)) e.push('startInvalid');
  if (!(h.reminder === null || (isStr(h.reminder) && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.reminder)))) e.push('reminderInvalid');
  if (!isNum(h.order) || !isNum(h.createdAt)) e.push('metaInvalid');
  if (!Array.isArray(h.rules) || !h.rules.length) e.push('scheduleMissing');
  else
    h.rules.forEach((r: unknown, j: number) => {
      const freqOk =
        !isObj(r) || r.perWeek === undefined || (version >= 3 && h.kind === 'binary' && Number.isInteger(r.perWeek) && (r.perWeek as number) >= 1 && (r.perWeek as number) <= 50);
      if (!isObj(r) || !isValidKey(r.from) || !isDays(r.days) || !isNum(r.target) || r.target < 1 || r.target > 100000 || !freqOk || (r.multi !== undefined && typeof r.multi !== 'boolean'))
        e.push('scheduleInvalid');
      else if (j > 0 && (h.rules as { from: string }[])[j - 1].from >= r.from) e.push('scheduleUnsorted');
    });
  if (!Array.isArray(h.pauses) || !h.pauses.every((x) => isObj(x) && isValidKey(x.from) && (x.to === null || isValidKey(x.to)))) e.push('pausesInvalid');
  return e;
}

export function entryErrors(x: unknown, kindOf?: (habitId: string) => Habit['kind'] | undefined): string[] {
  if (!isObj(x)) return ['invalid'];
  if (!isId(x.habitId) || (kindOf && !kindOf(x.habitId))) return ['noHabit'];
  if (kindOf?.(x.habitId) === 'weekly') return ['weeklyNoEntries'];
  if (!isValidKey(x.date)) return ['dateInvalid'];
  const e: string[] = [];
  if (x.id !== entryId(x.habitId, x.date)) e.push('idMismatch');
  if (!isNum(x.value) || x.value < 0 || (kindOf?.(x.habitId) === 'binary' && x.value > 1)) e.push('valueInvalid');
  if (!isStr(x.note, 2000)) e.push('noteInvalid');
  if (!isNum(x.updatedAt)) e.push('timestampInvalid');
  return e;
}

export function completionErrors(x: unknown, kindOf?: (habitId: string) => Habit['kind'] | undefined): string[] {
  if (!isObj(x)) return ['invalid'];
  if (!isId(x.id)) return ['idMissing'];
  if (!isId(x.habitId) || (kindOf && kindOf(x.habitId) !== 'binary')) return ['noFrequencyHabit'];
  const e: string[] = [];
  if (!isValidKey(x.date)) e.push('dateInvalid');
  // One-per-day ids are `${habitId}|${date}`; multi-per-day ids are free-form (uuid).
  else if (x.id.includes('|') && x.id !== completionId(x.habitId, x.date)) e.push('idDateMismatch');
  if (!isNum(x.createdAt) || !isNum(x.updatedAt)) e.push('timestampInvalid');
  return e;
}

export function analysisErrors(a: unknown, kindOf?: (habitId: string) => Habit['kind'] | undefined): string[] {
  if (!isObj(a)) return ['invalid'];
  const e: string[] = [];
  if (!isStr(a.id, 100) || !a.id) e.push('idMissing');
  if (!isId(a.habitId) || (kindOf && kindOf(a.habitId) !== 'weekly')) e.push('noWeeklyGoal');
  if (!isValidKey(a.date)) e.push('dateInvalid');
  if (!isStr(a.title, 300) || !a.title.trim()) e.push('titleMissing');
  if (!isStr(a.url, 2000) || (a.url && !isHttpUrl(a.url))) e.push('urlInvalid');
  if (!isStr(a.learnings, 20000) || !a.learnings.trim()) e.push('learningsMissing');
  if (!isNum(a.createdAt) || !isNum(a.updatedAt)) e.push('timestampInvalid');
  return e;
}

export function journalErrors(j: unknown): string[] {
  if (!isObj(j)) return ['invalid'];
  const e: string[] = [];
  if (!isStr(j.id, 100) || !j.id) e.push('idMissing');
  if (!isValidKey(j.date)) e.push('dateInvalid');
  if (!isStr(j.title, 200) || !isStr(j.notes, 20000) || !isStr(j.learned, 20000)) e.push('textInvalid');
  else if (!j.notes.trim() && !j.learned.trim()) e.push('noContent');
  if (!isNum(j.createdAt) || !isNum(j.updatedAt)) e.push('timestampInvalid');
  return e;
}

export function settingsOk(s: unknown): s is Settings {
  return isObj(s) && (s.weekStart === 0 || s.weekStart === 1) && ['system', 'reduce', 'full'].includes(s.motion as string) && typeof s.remindersEnabled === 'boolean';
}

// ---------- sanitizing: only known fields reach storage ----------

export const cleanHabit = (h: Habit): Habit => ({
  id: h.id, name: h.name.trim(), description: h.description, icon: h.icon, kind: h.kind, unit: h.unit, startDate: h.startDate,
  rules: h.rules.map((r) => ({
    from: r.from, days: [...r.days].sort((a, b) => a - b), target: h.kind === 'binary' ? 1 : r.target,
    ...(r.perWeek !== undefined ? { perWeek: r.perWeek } : {}), ...(r.multi ? { multi: true } : {}),
  })),
  pauses: h.pauses.map((x) => ({ from: x.from, to: x.to })), reminder: h.reminder, order: h.order, createdAt: h.createdAt,
});
const cleanEntry = (e: Entry): Entry => ({ id: e.id, habitId: e.habitId, date: e.date, value: e.value, note: e.note, updatedAt: e.updatedAt });
const cleanCompletion = (c: Completion): Completion => ({ id: c.id, habitId: c.habitId, date: c.date, createdAt: c.createdAt, updatedAt: c.updatedAt });
const cleanAnalysis = (a: Analysis): Analysis => ({
  id: a.id, habitId: a.habitId, date: a.date, title: a.title.trim(), url: a.url.trim(), learnings: a.learnings, createdAt: a.createdAt, updatedAt: a.updatedAt,
});
const cleanJournal = (j: JournalEntry): JournalEntry => ({ id: j.id, date: j.date, title: j.title, notes: j.notes, learned: j.learned, createdAt: j.createdAt, updatedAt: j.updatedAt });
const cleanSettings = (s: Settings): Settings => ({ weekStart: s.weekStart, motion: s.motion, remindersEnabled: s.remindersEnabled });

/** Validates and sanitizes one record received from the server. Returns null if it must not be stored. */
export function cleanRecord(kind: Kind, data: unknown): unknown | null {
  switch (kind) {
    case 'habit':
      return habitErrors(data).length ? null : cleanHabit(data as Habit);
    case 'entry':
      return entryErrors(data).length ? null : cleanEntry(data as Entry);
    case 'completion':
      return completionErrors(data).length ? null : cleanCompletion(data as Completion);
    case 'analysis':
      return analysisErrors(data).length ? null : cleanAnalysis(data as Analysis);
    case 'journal':
      return journalErrors(data).length ? null : cleanJournal(data as JournalEntry);
    case 'settings':
      return settingsOk(data) ? cleanSettings(data) : null;
  }
}

/**
 * Validates an import completely before anything touches storage and returns all problems found (capped).
 * Accepts versions 1–3 and migrates older files to the current shape.
 */
export function validateImport(raw: unknown, m: Messages = de): ImportResult {
  const t = m.io;
  const errors: string[] = [];
  const err = (where: string, es: string[]) => es.forEach((k) => errors.length < 20 && errors.push(t.item(where, t.f[k as IoFault] ?? k)));

  if (!isObj(raw) || raw.app !== 'still') return { ok: false, errors: [t.notStill] };
  const version = raw.version;
  if (version !== 1 && version !== 2 && version !== 3) return { ok: false, errors: [t.version(String(version))] };
  if (!Array.isArray(raw.habits) || !Array.isArray(raw.entries)) return { ok: false, errors: [t.missingCore] };
  const rawAnalyses = version === 1 ? [] : raw.analyses;
  const rawJournal = version === 1 ? [] : raw.journal;
  const rawCompletions = version < 3 ? [] : raw.completions;
  if (!Array.isArray(rawAnalyses) || !Array.isArray(rawJournal) || !Array.isArray(rawCompletions)) return { ok: false, errors: [t.missingExtra] };

  const kinds = new Map<string, Habit['kind']>();
  raw.habits.forEach((h: unknown, i: number) => {
    const es = habitErrors(h, version);
    const id = isObj(h) ? (h.id as string) : '';
    if (!es.length && kinds.has(id)) es.push('duplicateId');
    if (!es.length) kinds.set(id, (h as Habit).kind);
    err(t.habit(i + 1), es);
  });
  const kindOf = (id: string) => kinds.get(id);

  const unique = (list: unknown[], label: (i: number) => string, dupFault: IoFault, check: (x: unknown) => string[]) => {
    const ids = new Set<string>();
    list.forEach((x, i) => {
      const es = check(x);
      const id = isObj(x) ? String(x.id) : '';
      if (!es.length && ids.has(id)) es.push(dupFault);
      ids.add(id);
      err(label(i + 1), es);
    });
  };
  unique(raw.entries, t.entry, 'duplicateDay', (x) => entryErrors(x, kindOf));
  unique(rawCompletions, t.completion, 'duplicateId', (x) => completionErrors(x, kindOf));
  unique(rawAnalyses, t.analysis, 'duplicateId', (x) => analysisErrors(x, kindOf));
  unique(rawJournal, t.journal, 'duplicateId', journalErrors);

  let settings: Settings = defaultSettings;
  if (raw.settings !== undefined) {
    if (!settingsOk(raw.settings)) errors.push(t.settingsInvalid);
    else settings = cleanSettings(raw.settings);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    fromVersion: version,
    data: {
      habits: (raw.habits as Habit[]).map(cleanHabit),
      entries: (raw.entries as Entry[]).map(cleanEntry),
      completions: (rawCompletions as Completion[]).map(cleanCompletion),
      analyses: (rawAnalyses as Analysis[]).map(cleanAnalysis),
      journal: (rawJournal as JournalEntry[]).map(cleanJournal),
      settings,
    },
  };
}
