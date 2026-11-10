import type { Op, Snapshot } from './db';
import { completionId, entryId, type Habit } from './model';

// Explicit, previewed import of this device's local-only data into the signed-in account.
// Duplicate protection:
//   • records whose id already exists in the account are skipped (stable ids; re-running adds nothing);
//   • a local habit with the same name and type as an account habit is merged into it — its history is
//     attached to the account habit, and days already recorded there are kept, not doubled.
// The local database itself is never changed.

export interface ImportPlan {
  ops: Op[];
  habits: number;
  merged: string[];
  entries: number;
  completions: number;
  analyses: number;
  journal: number;
  skipped: number;
}

const norm = (s: string) => s.trim().toLocaleLowerCase('de');

export function planImport(local: Snapshot, account: Snapshot): ImportPlan {
  const plan: ImportPlan = { ops: [], habits: 0, merged: [], entries: 0, completions: 0, analyses: 0, journal: 0, skipped: 0 };
  const accHabits = new Map(account.habits.map((h) => [h.id, h]));
  const accByName = new Map(account.habits.map((h) => [`${h.kind}|${norm(h.name)}`, h]));
  const has = (list: { id: string }[]) => new Set(list.map((x) => x.id));
  const accEntries = has(account.entries);
  const accCompletions = has(account.completions);
  const accAnalyses = has(account.analyses);
  const accJournal = has(account.journal);

  // local habit id → account habit id
  const map = new Map<string, string>();
  let order = account.habits.length ? Math.max(...account.habits.map((h) => h.order)) + 1 : 0;
  for (const h of [...local.habits].sort((a, b) => a.order - b.order)) {
    if (accHabits.has(h.id)) {
      map.set(h.id, h.id);
      plan.skipped++;
      continue;
    }
    const twin = accByName.get(`${h.kind}|${norm(h.name)}`);
    if (twin) {
      map.set(h.id, twin.id);
      plan.merged.push(h.name);
      continue;
    }
    map.set(h.id, h.id);
    const rec: Habit = { ...h, order: order++ };
    plan.ops.push({ kind: 'habit', id: h.id, rec });
    accByName.set(`${h.kind}|${norm(h.name)}`, rec); // two local habits with the same name merge too
    plan.habits++;
  }

  for (const e of local.entries) {
    const habitId = map.get(e.habitId);
    if (!habitId) continue;
    const id = entryId(habitId, e.date);
    if (accEntries.has(id)) {
      plan.skipped++;
      continue;
    }
    accEntries.add(id);
    plan.ops.push({ kind: 'entry', id, rec: { ...e, id, habitId } });
    plan.entries++;
  }

  for (const c of local.completions) {
    const habitId = map.get(c.habitId);
    if (!habitId) continue;
    const id = c.id.includes('|') ? completionId(habitId, c.date) : c.id; // one-per-day ids follow the habit
    if (accCompletions.has(id)) {
      plan.skipped++;
      continue;
    }
    accCompletions.add(id);
    plan.ops.push({ kind: 'completion', id, rec: { ...c, id, habitId } });
    plan.completions++;
  }

  for (const a of local.analyses) {
    const habitId = map.get(a.habitId);
    if (!habitId) continue;
    if (accAnalyses.has(a.id)) {
      plan.skipped++;
      continue;
    }
    plan.ops.push({ kind: 'analysis', id: a.id, rec: { ...a, habitId } });
    plan.analyses++;
  }

  for (const j of local.journal) {
    if (accJournal.has(j.id)) {
      plan.skipped++;
      continue;
    }
    plan.ops.push({ kind: 'journal', id: j.id, rec: j });
    plan.journal++;
  }
  return plan;
}

export const planIsEmpty = (p: ImportPlan) => p.ops.length === 0;
