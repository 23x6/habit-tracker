import { isValidKey } from './date';
import { completionId, defaultSettings, entryId, SCHEMA_VERSION, type Analysis, type Completion, type Entry, type Habit, type JournalEntry, type Settings } from './model';
import type { Kind, Snapshot } from './db';
import { ICON_NAMES } from './icons';
import { isHttpUrl } from './weekly';

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
  if (!isObj(h)) return ['ungültig'];
  if (!isStr(h.id, 100) || !h.id) e.push('ID fehlt');
  if (!isStr(h.name, 80) || !h.name.trim()) e.push('Name fehlt');
  if (!isStr(h.description)) e.push('Beschreibung ungültig');
  if (!isStr(h.icon) || !ICON_NAMES.includes(h.icon)) e.push('Symbol unbekannt');
  if (!(h.kind === 'binary' || h.kind === 'numeric' || (h.kind === 'weekly' && version >= 2))) e.push('Typ ungültig');
  if (!isStr(h.unit, 30)) e.push('Einheit ungültig');
  if (!isValidKey(h.startDate)) e.push('Startdatum ungültig');
  if (!(h.reminder === null || (isStr(h.reminder) && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.reminder)))) e.push('Erinnerung ungültig');
  if (!isNum(h.order) || !isNum(h.createdAt)) e.push('Metadaten ungültig');
  if (!Array.isArray(h.rules) || !h.rules.length) e.push('Zeitplan fehlt');
  else
    h.rules.forEach((r: unknown, j: number) => {
      const freqOk =
        !isObj(r) || r.perWeek === undefined || (version >= 3 && h.kind === 'binary' && Number.isInteger(r.perWeek) && (r.perWeek as number) >= 1 && (r.perWeek as number) <= 50);
      if (!isObj(r) || !isValidKey(r.from) || !isDays(r.days) || !isNum(r.target) || r.target < 1 || r.target > 100000 || !freqOk || (r.multi !== undefined && typeof r.multi !== 'boolean'))
        e.push(`Zeitplan ${j + 1} ungültig`);
      else if (j > 0 && (h.rules as { from: string }[])[j - 1].from >= r.from) e.push('Zeitplan nicht sortiert');
    });
  if (!Array.isArray(h.pauses) || !h.pauses.every((x) => isObj(x) && isValidKey(x.from) && (x.to === null || isValidKey(x.to)))) e.push('Archivzeiträume ungültig');
  return e;
}

export function entryErrors(x: unknown, kindOf?: (habitId: string) => Habit['kind'] | undefined): string[] {
  if (!isObj(x)) return ['ungültig'];
  if (!isId(x.habitId) || (kindOf && !kindOf(x.habitId))) return ['gehört zu keiner Gewohnheit'];
  if (kindOf?.(x.habitId) === 'weekly') return ['Wochenziele haben keine Tageseinträge'];
  if (!isValidKey(x.date)) return ['Datum ungültig'];
  const e: string[] = [];
  if (x.id !== entryId(x.habitId, x.date)) e.push('ID passt nicht zu Gewohnheit und Datum');
  if (!isNum(x.value) || x.value < 0 || (kindOf?.(x.habitId) === 'binary' && x.value > 1)) e.push('Wert ungültig');
  if (!isStr(x.note, 2000)) e.push('Notiz ungültig');
  if (!isNum(x.updatedAt)) e.push('Zeitstempel ungültig');
  return e;
}

export function completionErrors(x: unknown, kindOf?: (habitId: string) => Habit['kind'] | undefined): string[] {
  if (!isObj(x)) return ['ungültig'];
  if (!isId(x.id)) return ['ID fehlt'];
  if (!isId(x.habitId) || (kindOf && kindOf(x.habitId) !== 'binary')) return ['gehört zu keiner Gewohnheit mit Wochenziel'];
  const e: string[] = [];
  if (!isValidKey(x.date)) e.push('Datum ungültig');
  // One-per-day ids are `${habitId}|${date}`; multi-per-day ids are free-form (uuid).
  else if (x.id.includes('|') && x.id !== completionId(x.habitId, x.date)) e.push('ID passt nicht zum Datum');
  if (!isNum(x.createdAt) || !isNum(x.updatedAt)) e.push('Zeitstempel ungültig');
  return e;
}

export function analysisErrors(a: unknown, kindOf?: (habitId: string) => Habit['kind'] | undefined): string[] {
  if (!isObj(a)) return ['ungültig'];
  const e: string[] = [];
  if (!isStr(a.id, 100) || !a.id) e.push('ID fehlt');
  if (!isId(a.habitId) || (kindOf && kindOf(a.habitId) !== 'weekly')) e.push('gehört zu keinem Wochenziel');
  if (!isValidKey(a.date)) e.push('Datum ungültig');
  if (!isStr(a.title, 300) || !a.title.trim()) e.push('Titel fehlt');
  if (!isStr(a.url, 2000) || (a.url && !isHttpUrl(a.url))) e.push('Adresse ungültig');
  if (!isStr(a.learnings, 20000) || !a.learnings.trim()) e.push('Erkenntnisse fehlen');
  if (!isNum(a.createdAt) || !isNum(a.updatedAt)) e.push('Zeitstempel ungültig');
  return e;
}

export function journalErrors(j: unknown): string[] {
  if (!isObj(j)) return ['ungültig'];
  const e: string[] = [];
  if (!isStr(j.id, 100) || !j.id) e.push('ID fehlt');
  if (!isValidKey(j.date)) e.push('Datum ungültig');
  if (!isStr(j.title, 200) || !isStr(j.notes, 20000) || !isStr(j.learned, 20000)) e.push('Text ungültig');
  else if (!j.notes.trim() && !j.learned.trim()) e.push('ohne Inhalt');
  if (!isNum(j.createdAt) || !isNum(j.updatedAt)) e.push('Zeitstempel ungültig');
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
export function validateImport(raw: unknown): ImportResult {
  const errors: string[] = [];
  const err = (p: string, es: string[]) => es.forEach((m) => errors.length < 20 && errors.push(`${p}: ${m}.`));

  if (!isObj(raw) || raw.app !== 'still') return { ok: false, errors: ['Keine Still-Exportdatei.'] };
  const version = raw.version;
  if (version !== 1 && version !== 2 && version !== 3) return { ok: false, errors: [`Nicht unterstützte Version: ${String(version)}.`] };
  if (!Array.isArray(raw.habits) || !Array.isArray(raw.entries)) return { ok: false, errors: ['Gewohnheiten oder Einträge fehlen.'] };
  const rawAnalyses = version === 1 ? [] : raw.analyses;
  const rawJournal = version === 1 ? [] : raw.journal;
  const rawCompletions = version < 3 ? [] : raw.completions;
  if (!Array.isArray(rawAnalyses) || !Array.isArray(rawJournal) || !Array.isArray(rawCompletions)) return { ok: false, errors: ['Analysen, Journal oder Erledigungen fehlen.'] };

  const kinds = new Map<string, Habit['kind']>();
  raw.habits.forEach((h: unknown, i: number) => {
    const es = habitErrors(h, version);
    const id = isObj(h) ? (h.id as string) : '';
    if (!es.length && kinds.has(id)) es.push('doppelte ID');
    if (!es.length) kinds.set(id, (h as Habit).kind);
    err(`Gewohnheit ${i + 1}`, es);
  });
  const kindOf = (id: string) => kinds.get(id);

  const unique = (list: unknown[], label: string, check: (x: unknown) => string[]) => {
    const ids = new Set<string>();
    list.forEach((x, i) => {
      const es = check(x);
      const id = isObj(x) ? String(x.id) : '';
      if (!es.length && ids.has(id)) es.push(label === 'Eintrag' ? 'doppelter Eintrag für denselben Tag' : 'doppelte ID');
      ids.add(id);
      err(`${label} ${i + 1}`, es);
    });
  };
  unique(raw.entries, 'Eintrag', (x) => entryErrors(x, kindOf));
  unique(rawCompletions, 'Erledigung', (x) => completionErrors(x, kindOf));
  unique(rawAnalyses, 'Analyse', (x) => analysisErrors(x, kindOf));
  unique(rawJournal, 'Journal', journalErrors);

  let settings: Settings = defaultSettings;
  if (raw.settings !== undefined) {
    if (!settingsOk(raw.settings)) errors.push('Einstellungen ungültig.');
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
