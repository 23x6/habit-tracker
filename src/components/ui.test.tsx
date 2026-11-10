// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth';
import { I18nProvider, LANG_KEY, useI18n, type Lang } from '../i18n';
import { formatLong, startOfWeek } from '../lib/date';
import { StoreProvider, useStore } from '../store';
import { AuthSheet, SaveStatus } from './Account';
import { HabitSheet } from './HabitSheet';

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
beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const wait = (ms = 40) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const byText = (sel: string, text: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((x) => x.textContent?.trim() === text)!;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
};
async function type(el: HTMLInputElement, text: string) {
  act(() => el.focus());
  for (const ch of text) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, el.value + ch);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await wait();
}

let setLangFromTest: (l: Lang) => void = () => {};
function LangProbe() {
  const { t, setLang } = useI18n();
  setLangFromTest = setLang;
  return (
    <p id="probe">
      {t.nav.today}|{formatLong('2026-11-10')}|{startOfWeek('2026-11-10', 1)}
    </p>
  );
}

const partition = () => ({ name: `still-ui-test-${++n}`, sync: false, userId: null });
const app = (children: React.ReactNode) => (
  <I18nProvider>
    <StoreProvider partition={partition()}>
      <AuthProvider>
        {children}
        <LangProbe />
      </AuthProvider>
    </StoreProvider>
  </I18nProvider>
);

describe('language switch', () => {
  it('defaults to German, switches immediately, persists across a reload, and never changes dates or keys', async () => {
    await act(async () => root.render(app(null)));
    expect(q('#probe').textContent).toBe('Heute|Dienstag, 10. November|2026-11-09');
    expect(document.documentElement.lang).toBe('de');

    await act(async () => setLangFromTest('en'));
    expect(q('#probe').textContent).toBe('Today|Tuesday 10 November|2026-11-09');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LANG_KEY)).toBe('en');

    // "Reload": unmount everything and mount again.
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(app(null)));
    expect(q('#probe').textContent).toBe('Today|Tuesday 10 November|2026-11-09');
  });

  it('switching language keeps typed form values and focus', async () => {
    function Harness() {
      const [mode, setMode] = useState<null | 'login' | 'register' | 'forgot'>('register');
      return <AuthSheet mode={mode} onMode={setMode} />;
    }
    await act(async () => root.render(app(<Harness />)));
    await wait();
    const email = q<HTMLInputElement>('.sheet input[type=email]');
    await type(email, 'max@example.com');
    expect(byText('.sheet .field > span', 'E-Mail-Adresse')).toBeTruthy();

    await act(async () => setLangFromTest('en'));
    await wait();
    expect(document.activeElement).toBe(email);
    expect(q<HTMLInputElement>('.sheet input[type=email]')).toBe(email); // same node, not remounted
    expect(email.value).toBe('max@example.com');
    expect(byText('.sheet .field > span', 'Email address')).toBeTruthy();
    expect(q('.sheet h2').textContent).toBe('Sign up');
  });
});

describe('habit form mode switching', () => {
  it('keeps typed values across modes, restores the numeric target, and settles on one set of fields after rapid switching', async () => {
    await act(async () => root.render(app(<HabitSheet open habit={null} onClose={() => {}} />)));
    await wait(100);
    const name = q<HTMLInputElement>('.sheet input[enterKeyHint=done]');
    await type(name, 'Laufen');

    await click(byText('.sheet .segmented button', 'Zahlenwert'));
    await wait(400);
    const target = q<HTMLInputElement>('.sheet input[type=number]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, '5');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('.sheet .segmented button', 'Analysen'));
    await wait(400);
    await click(byText('.sheet .segmented button', 'Zahlenwert'));
    await wait(600);
    const numbers = document.querySelectorAll<HTMLInputElement>('.sheet input[type=number]');
    expect([...numbers].map((x) => x.value)).toEqual(['5']); // restored, not reset; only one field after the swap
    expect(name.value).toBe('Laufen');
    expect(q<HTMLInputElement>('.sheet input[enterKeyHint=done]')).toBe(name); // name field never remounted

    // Rapid switching without waiting: ends in a consistent state with exactly the selected mode's fields.
    for (const label of ['Erledigt', 'Analysen', 'Zahlenwert', 'Erledigt', 'Analysen', 'Erledigt']) await click(byText('.sheet .segmented button', label));
    await wait(900);
    expect(byText('.sheet .segmented button', 'Erledigt').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelectorAll('.sheet input[type=number]').length).toBe(0); // no leftover numeric/analyses fields
    expect(byText('.sheet .segmented button', 'X-mal pro Woche')).toBeTruthy(); // binary schedule options
    expect(name.value).toBe('Laufen');
  });
});

describe('schedule selector', () => {
  const L = {
    de: { daily: 'Täglich', days: 'Wochentage', week: 'X-mal pro Woche', friday: 'Freitag', create: 'Erstellen' },
    en: { daily: 'Daily', days: 'Weekdays', week: 'Times per week', friday: 'Friday', create: 'Create' },
  };
  for (const lang of ['de', 'en'] as const) {
    it(`rapid switching ends on the latest mode at once, keeps typed values, and saves what is shown (${lang})`, async () => {
      localStorage.setItem(LANG_KEY, lang);
      const l = L[lang];
      let store!: ReturnType<typeof useStore>;
      function Grab() {
        store = useStore();
        return null;
      }
      await act(async () => root.render(app(<><HabitSheet open habit={null} onClose={() => {}} /><Grab /></>)));
      await wait(100);
      const seg = () => [...document.querySelectorAll<HTMLElement>('.sheet .segmented')].find((s) => s.textContent!.includes(l.days))!;
      const opt = (label: string) => [...seg().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === label)!;
      // The schedule's own SwitchContent is the one inside the fieldset.
      const area = () => q('.sheet fieldset .switch-content');
      const perWeek = () => document.querySelector<HTMLInputElement>('.sheet input.num-small');
      const setValue = async (el: HTMLInputElement, v: string) =>
        act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });

      await type(q<HTMLInputElement>('.sheet input[enterKeyHint=done]'), 'Laufen');
      await click(opt(l.week));
      await setValue(perWeek()!, '4');
      await click(opt(l.days));
      await click(document.querySelector<HTMLElement>(`.sheet .day-pick[aria-label="${l.friday}"]`)!); // Mon–Thu remain

      // 12 rapid rounds through all three modes, no waiting in between.
      for (let i = 0; i < 12; i++) for (const m of [l.daily, l.days, l.week]) await click(opt(m));
      // Immediately: latest selection, exactly one content block, its fields — no queued or stale content.
      expect(opt(l.week).getAttribute('aria-checked')).toBe('true');
      expect(area().children.length).toBe(1);
      expect(perWeek()!.value).toBe('4');
      expect(document.querySelectorAll('.sheet input.num-small').length).toBe(1); // no outgoing copies
      expect(document.querySelectorAll('.sheet .day-pick').length).toBe(0); // no stale weekday buttons

      await click(opt(l.days));
      expect(area().children.length).toBe(1);
      // Mon–Thu still selected (week starts Monday by default), Fri–Sun not.
      expect([...document.querySelectorAll('.sheet .day-pick')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true', 'true', 'false', 'false', 'false']);

      // A mode change that removes the focused field moves focus to the selected segment (tap without focus, as on iOS).
      await click(opt(l.week));
      act(() => perWeek()!.focus());
      await act(async () => opt(l.daily).click()); // .click() does not move focus
      expect(perWeek()).toBeNull();
      expect(document.activeElement).toBe(opt(l.daily));

      // Ordinary re-renders don't move focus: typing in the name field stays put.
      const name = q<HTMLInputElement>('.sheet input[enterKeyHint=done]');
      await type(name, ' 2');
      expect(document.activeElement).toBe(name);

      // Save in "times per week": the stored rule matches what is shown.
      await click(opt(l.week));
      await click(byText('.sheet .sheet-foot button', l.create));
      await wait(100);
      const h = store.snapshot.habits.find((x) => x.name === 'Laufen 2')!;
      expect(h.rules).toHaveLength(1);
      expect(h.rules[0]).toMatchObject({ perWeek: 4, days: [0, 1, 2, 3, 4, 5, 6] });
      expect(h.rules[0].multi).toBeUndefined();
    });
  }
});

describe('save status', () => {
  it('shows a recoverable error when a local write fails, and stores nothing', async () => {
    let store!: ReturnType<typeof useStore>;
    function Grab() {
      store = useStore();
      return null;
    }
    await act(async () => root.render(app(<><SaveStatus /><Grab /></>)));
    await wait(100);
    expect(q('.save-status').textContent).toBe('Lokal gespeichert');
    const before = store.snapshot.journal.length;
    await act(async () => {
      // A function can't be stored in IndexedDB: the transaction fails.
      await store.applyOps([{ kind: 'journal', id: 'x', rec: { id: 'x', fn: () => 1 } }]).catch(() => {});
    });
    await wait();
    expect(q('.save-status').textContent).toContain('Speichern fehlgeschlagen');
    expect(byText('.save-status button', 'Erneut speichern')).toBeTruthy();
    expect(store.snapshot.journal.length).toBe(before); // nothing shown as saved
  });
});
