// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { addDays, startOfWeek, today as todayKey } from '../lib/date';
import { StoreProvider, useStore } from '../store';
import { WeeklyReview, type WeekRange } from './WeeklyReview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.localStorage) {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 },
  });
}

let root: Root;
let host: HTMLDivElement;
let store!: ReturnType<typeof useStore>;
let range: WeekRange;
function Grab() {
  store = useStore();
  return null;
}
const wait = (ms = 40) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const T = todayKey();
const CUR = startOfWeek(T, 1);

function app(partition: string) {
  return (
    <I18nProvider>
      <StoreProvider key={partition} partition={{ name: partition, sync: false, userId: null }}>
        <Grab />
        <WeeklyReview range={range} onRange={(r) => (range = r)} onBack={() => {}} />
      </StoreProvider>
    </I18nProvider>
  );
}
async function open(partition: string) {
  await act(async () => root.render(app(partition)));
  for (let i = 0; i < 50 && store.status !== 'ready'; i++) await wait(20);
  await wait(60);
}
async function reopen(partition: string) {
  await act(async () => root.unmount()); // app closed
  root = createRoot(host);
  await open(partition);
}
const areas = () => [...document.querySelectorAll<HTMLTextAreaElement>('textarea')];
const type = async (el: HTMLTextAreaElement, v: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)!;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('still-lang', 'de');
  range = { start: CUR, end: addDays(CUR, 6) };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('weekly review screen (real store and IndexedDB)', () => {
  it('typed text survives closing the app as a draft; saved text is restored after reopening', async () => {
    await open('rv-1');
    expect(document.body.textContent).toContain('Was lief gut?');
    expect(document.body.textContent).toContain('Was hat mich gebremst?');
    expect(document.body.textContent).toContain('Was ändere ich nächste Woche?');
    await type(areas()[0], 'Jeden Morgen gelesen');
    await wait(900); // autosave pause
    await reopen('rv-1');
    expect(areas()[0].value).toBe('Jeden Morgen gelesen'); // unsaved draft restored
    expect(document.body.textContent).toContain('Entwurf');
    expect(store.reviews).toEqual([]); // a draft is never a stored review

    await act(async () => button('Sichern').click());
    await wait(80);
    expect(store.reviews).toHaveLength(1);
    expect(store.reviews[0]).toMatchObject({ id: `${CUR}_${addDays(CUR, 6)}`, wentWell: 'Jeden Morgen gelesen' });
    await reopen('rv-1');
    expect(areas()[0].value).toBe('Jeden Morgen gelesen');
    expect(document.body.textContent).toContain('Gesichert');
    expect(document.body.textContent).not.toContain('Entwurf wiederhergestellt');
  });

  it('earlier weeks can be opened and edited; the next button stops at the current week', async () => {
    await open('rv-2');
    expect(button('Nächste Woche').hasAttribute('disabled')).toBe(true);
    await act(async () => button('Vorherige Woche').click());
    expect(range.start).toBe(addDays(CUR, -7));
    await open('rv-2');
    await type(areas()[1], 'Zu spät ins Bett');
    await act(async () => button('Sichern').click());
    await wait(80);
    expect(store.reviews.map((r) => [r.weekStart, r.heldBack])).toEqual([[addDays(CUR, -7), 'Zu spät ins Bett']]);
    await type(areas()[1], 'Zu spät ins Bett, zweimal');
    await act(async () => button('Sichern').click());
    await wait(80);
    expect(store.reviews).toHaveLength(1);
    expect(store.reviews[0].heldBack).toBe('Zu spät ins Bett, zweimal');
  });

  it('after switching to Sunday weeks the Monday-week review stays under its dates and is offered', async () => {
    await open('rv-3');
    await type(areas()[0], 'Montagswoche');
    await act(async () => button('Sichern').click());
    await wait(80);
    await act(async () => store.setSettings({ weekStart: 0 }));
    const sun = startOfWeek(T, 0);
    range = { start: sun, end: addDays(sun, 6) };
    await open('rv-3');
    expect(areas()[0].value).toBe(''); // a different week range
    expect(document.body.textContent).toContain('Rückblicke mit anderem Wochenbeginn');
    const openOld = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Rückblick') && b.textContent.includes('öffnen'))!;
    await act(async () => openOld.click());
    expect(range).toEqual({ start: CUR, end: addDays(CUR, 6) });
    await open('rv-3');
    expect(areas()[0].value).toBe('Montagswoche');
  });

  it('account switching shows only that account’s review and drafts', async () => {
    await open('rv-acc-a');
    await type(areas()[0], 'nur Konto A');
    await act(async () => button('Sichern').click());
    await type(areas()[2], 'Entwurf A');
    await wait(900);
    await open('rv-acc-b');
    expect(store.partition.name).toBe('rv-acc-b');
    expect(areas().map((a) => a.value)).toEqual(['', '', '']);
    expect(store.reviews).toEqual([]);
    await open('rv-acc-a');
    expect(areas()[0].value).toBe('nur Konto A');
    expect(areas()[2].value).toBe('Entwurf A');
  });
});
