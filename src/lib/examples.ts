import type { DateKey } from './date';
import { ALL_DAYS, type Habit } from './model';

// Editable example habits. Stable ids make "add examples" idempotent; no entries are ever created for them.
const DEFS: Pick<Habit, 'id' | 'name' | 'description' | 'icon' | 'kind' | 'unit'>[] = [
  { id: 'example-reading', name: '10 Seiten lesen', description: '10 Seiten', icon: 'book', kind: 'binary', unit: '' },
  { id: 'example-trade-journal', name: 'Trade-Journal führen', description: '', icon: 'trend', kind: 'binary', unit: '' },
  { id: 'example-sport', name: 'Sport machen', description: '', icon: 'dumbbell', kind: 'binary', unit: '' },
  { id: 'example-skincare', name: 'Skincare', description: '', icon: 'drop', kind: 'binary', unit: '' },
  { id: 'example-substack', name: 'Substack analysieren', description: 'Zwei Analysen pro Woche', icon: 'pen', kind: 'weekly', unit: 'Analysen' },
];

const norm = (s: string) => s.trim().toLocaleLowerCase('de');

/** Examples not yet present (by id, or by an existing habit with the same name). Order continues after `habits`. */
export function missingExamples(habits: Habit[], today: DateKey, now = Date.now()): Habit[] {
  const ids = new Set(habits.map((h) => h.id));
  const names = new Set(habits.map((h) => norm(h.name)));
  let order = habits.length ? Math.max(...habits.map((h) => h.order)) + 1 : 0;
  return DEFS.filter((d) => !ids.has(d.id) && !names.has(norm(d.name))).map((d) => ({
    ...d,
    startDate: today,
    rules: [{ from: today, days: ALL_DAYS, target: d.kind === 'weekly' ? 2 : 1 }],
    pauses: [],
    reminder: null,
    order: order++,
    createdAt: now,
  }));
}
