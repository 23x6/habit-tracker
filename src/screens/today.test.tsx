// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth';
import { I18nProvider } from '../i18n';
import { addDays, startOfWeek, today as todayKey } from '../lib/date';
import { ALL_DAYS, entryId, type Habit } from '../lib/model';
import { StoreProvider, useStore } from '../store';
import { Today } from './Today';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Node's own (disabled) `localStorage` global shadows jsdom's in this environment: provide a working one.
if (!globalThis.localStorage) {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

let root: Root;
let host: HTMLDivElement;
let n = 0;
let store!: ReturnType<typeof useStore>;
function Grab() {
  store = useStore();
  return null;
}

const T = todayKey();
const START = addDays(startOfWeek(T, 1), -7); // all habits started last week
const habit = (id: string, order: number, o: Partial<Habit> = {}): Habit => ({
  id, name: id, description: '', icon: 'circle', kind: 'binary', unit: '', startDate: START,
  rules: [{ from: START, days: ALL_DAYS, target: 1 }], pauses: [], reminder: null, order, createdAt: 0, ...o,
});
const read = habit('Lesen', 0);
const water = habit('Wasser', 1, { kind: 'numeric', unit: 'ml', rules: [{ from: START, days: ALL_DAYS, target: 2000 }] });
const sport = habit('Sport', 2, { rules: [{ from: START, days: ALL_DAYS, target: 1, perWeek: 3 }] });
const gym = habit('Gym', 3, { rules: [{ from: START, days: ALL_DAYS, target: 1, perWeek: 5, multi: true }] });
const substack = habit('Substack', 4, { kind: 'weekly', unit: 'Analysen', rules: [{ from: START, days: ALL_DAYS, target: 2 }] });

async function mount(date = T) {
  await act(async () =>
    root.render(
      <I18nProvider>
        <StoreProvider partition={{ name: `still-today-test-${++n}`, sync: false, userId: null }}>
          <AuthProvider>
            <Grab />
            <Today date={date} setDate={() => {}} onCreate={() => {}} onEdit={() => {}} onOpen={() => {}} />
          </AuthProvider>
        </StoreProvider>
      </I18nProvider>,
    ),
  );
  for (let i = 0; i < 50 && (store.status !== 'ready' || !store.snapshot.habits.length); i++) await wait(20); // examples seeded
  // Replace the example habits a new database starts with by this test's habits.
  const examples = store.snapshot.habits.map((h) => ({ kind: 'habit' as const, id: h.id }));
  await act(async () => store.applyOps([...examples, ...[read, water, sport, gym, substack].map((h) => ({ kind: 'habit' as const, id: h.id, rec: h }))]));
  await wait(400); // removed example rows finish their exit animation
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('still-lang', 'de');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const wait = (ms = 40) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const btn = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
/** Row names in display order, with group headings. */
const listed = () => [...document.querySelectorAll('.rows > *')].map((e) => e.querySelector('.row-name')?.textContent ?? e.textContent!.trim());
const entryValue = (id: string, date = T) => store.snapshot.entries.find((e) => e.id === entryId(id, date))?.value ?? 0;
const completionsOf = (id: string) => store.snapshot.completions.filter((c) => c.habitId === id);

describe('Today: grouping and quick actions', () => {
  it('shows what remains first, weekly goals with what is left, and done items in a collapsible section', async () => {
    await mount();
    expect(listed()).toEqual(['Lesen', 'Wasser', 'Wochenziele', 'Sport', 'Gym', 'Substack']);
    expect(document.body.textContent).toContain('noch 3× diese Woche');
    expect(document.body.textContent).toContain('noch 2 Analysen diese Woche');

    await act(async () => btn('Lesen abhaken').click());
    await wait(30);
    expect(entryValue('Lesen')).toBe(1);
    expect(listed()[0]).toBe('Lesen'); // held in place while the list is being used…
    await act(async () => document.querySelector('.rows')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await wait(1400);
    expect(listed()).toEqual(['Wasser', 'Wochenziele', 'Sport', 'Gym', 'Substack', 'Erledigt · 1']); // …then moves, collapsed
    const toggle = [...document.querySelectorAll<HTMLButtonElement>('.group-head.toggle')][0];
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => toggle.click());
    await wait(30);
    expect(listed().slice(-2)).toEqual(['Erledigt · 1', 'Lesen']);
  });

  it('binary: one tap completes, undo reverses exactly that tap and nothing else', async () => {
    await mount();
    await act(async () => store.setEntry(water, T, 500));
    await act(async () => btn('Lesen abhaken').click());
    await wait(30);
    expect(entryValue('Lesen')).toBe(1);
    expect(store.toast?.message).toContain('erledigt');
    await act(async () => store.toast!.undo!());
    await wait(30);
    expect(entryValue('Lesen')).toBe(0);
    expect(entryValue('Wasser')).toBe(500); // unrelated entry untouched
  });

  it('numeric: rapid + taps all count (no lost update), crossing the target offers undo of that step only', async () => {
    await mount();
    // Direct entry: typed value saved on Enter; invalid input restores the stored value.
    const input = document.querySelector<HTMLInputElement>('input.amount')!;
    const type = async (v: string) => {
      await act(async () => input.focus());
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      await act(async () => input.blur());
      await wait(40);
    };
    await type('750,5');
    expect(entryValue('Wasser')).toBe(750.5);
    await type('zwölf');
    expect(entryValue('Wasser')).toBe(750.5);
    expect(input.value).toBe('750,5');
    await type('0');
    expect(entryValue('Wasser')).toBe(0);

    const plus = btn('Wasser um 100 erhöhen');
    for (let i = 0; i < 19; i++) await act(async () => plus.click()); // no waiting between taps
    await wait(60);
    expect(entryValue('Wasser')).toBe(1900);
    await act(async () => plus.click());
    await wait(60);
    expect(entryValue('Wasser')).toBe(2000);
    expect(store.toast?.message).toContain('erreicht');
    const undo = store.toast!.undo!;
    await act(async () => plus.click()); // a later step stays when the earlier one is undone
    await wait(60);
    await act(async () => undo());
    await wait(60);
    expect(entryValue('Wasser')).toBe(2000); // 2100 − 100

  });

  it('weekly frequency: one per day by default (no duplicate on a double tap), several per day only when allowed', async () => {
    await mount();
    const add = btn('Erledigung hinzufügen: Sport');
    await act(async () => {
      add.click();
      add.click(); // second tap while the first is still being written
    });
    await wait(60);
    expect(completionsOf('Sport')).toHaveLength(1);
    expect(document.body.textContent).toContain('noch 2× diese Woche');

    const more = btn('Erledigung hinzufügen: Gym');
    await act(async () => more.click());
    await wait(60);
    await act(async () => more.click()); // accidental double tap (< 350 ms)
    await wait(400);
    await act(async () => more.click()); // a deliberate second session
    await wait(60);
    expect(completionsOf('Gym')).toHaveLength(2);
    const [first] = completionsOf('Gym');
    await act(async () => store.toast!.undo!()); // undo removes only the latest session
    await wait(60);
    expect(completionsOf('Gym').map((c) => c.id)).toEqual([first.id]);
    expect(completionsOf('Sport')).toHaveLength(1);
  });

  it('analysis goals offer "add analysis" only, never a completion shortcut', async () => {
    await mount();
    expect(btn('Analyse hinzufügen: Substack')).toBeTruthy();
    const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.row-name')?.textContent === 'Substack')!;
    expect(row.querySelector('.check, .stepper, input')).toBeNull();
    await act(async () => store.toggleCompletion(substack, T).catch(() => {}));
    await act(async () => store.stepEntry(substack, T, 1));
    await act(async () => store.toggleEntry(substack, T));
    await wait(40);
    expect(store.snapshot.entries.filter((e) => e.habitId === 'Substack')).toHaveLength(0);
    expect(store.snapshot.analyses).toHaveLength(0);
  });

  it('quick actions write to the selected date, not to today', async () => {
    const yesterday = addDays(T, -1);
    await mount(yesterday);
    await act(async () => btn('Lesen abhaken').click());
    await act(async () => btn('Wasser um 100 erhöhen').click());
    await wait(60);
    expect(entryValue('Lesen', yesterday)).toBe(1);
    expect(entryValue('Wasser', yesterday)).toBe(100);
    expect(entryValue('Lesen')).toBe(0);
  });
});
