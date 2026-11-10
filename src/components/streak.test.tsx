// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthContext, type Auth } from '../auth';
import { I18nProvider } from '../i18n';
import { welcomeOnAuthEvent } from '../lib/auth';
import { addDays, startOfWeek, today as todayKey } from '../lib/date';
import { ALL_DAYS, type Habit } from '../lib/model';
import { streakVerified, welcomeStep } from '../lib/streak';
import type { SyncState } from '../lib/sync';
import { StoreProvider, useStore } from '../store';
import { StreakBadge, StreakWelcome, writeSkipWelcome } from './Streak';

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

const sync = (o: Partial<SyncState>): SyncState => ({ status: 'syncing', pending: 0, conflicts: 0, lastSync: null, error: null, ...o });

describe('streak welcome: when it appears', () => {
  it('only an explicit sign-in shows it — never a restored session, token refresh or focus event', () => {
    expect(welcomeOnAuthEvent('INITIAL_SESSION', false, false)).toBe(false); // restored session on reload
    expect(welcomeOnAuthEvent('TOKEN_REFRESHED', true, false)).toBe(false);
    expect(welcomeOnAuthEvent('USER_UPDATED', true, false)).toBe(false);
    expect(welcomeOnAuthEvent('SIGNED_IN', false, false)).toBe(false); // e.g. supabase-js re-emitting on tab focus
    expect(welcomeOnAuthEvent('SIGNED_IN', true, false)).toBe(true); // first session from an email sign-in link
    expect(welcomeOnAuthEvent('SIGNED_IN', true, true)).toBe(false); // …once
    // (A successful password sign-in sets it directly in AuthProvider.signIn.)
  });

  it('waits for the account data and the first sync, but never blocks on a slow or failing network', () => {
    const base = { welcomeFor: 'u1', userId: 'u1', storeReady: true, waited: false, skip: false };
    expect(welcomeStep({ ...base, welcomeFor: null, sync: null })).toBe('none');
    expect(welcomeStep({ ...base, userId: 'u2', sync: sync({ status: 'synced', lastSync: 1 }) })).toBe('none'); // other account
    expect(welcomeStep({ ...base, storeReady: false, sync: null })).toBe('none');
    expect(welcomeStep({ ...base, sync: sync({}) })).toBe('wait');
    expect(welcomeStep({ ...base, sync: sync({ status: 'synced', lastSync: 1 }) })).toBe('show');
    expect(welcomeStep({ ...base, sync: sync({ status: 'offline' }) })).toBe('show');
    expect(welcomeStep({ ...base, sync: sync({ status: 'error', error: 'x' }) })).toBe('show');
    expect(welcomeStep({ ...base, sync: sync({}), waited: true })).toBe('show');
    expect(welcomeStep({ ...base, sync: sync({}), skip: true })).toBe('skip');
  });

  it('calls the number verified only after a complete sync', () => {
    expect(streakVerified(null)).toBe(false);
    expect(streakVerified(sync({ status: 'synced', lastSync: 1 }))).toBe(true);
    expect(streakVerified(sync({ status: 'pending', pending: 2, lastSync: 1 }))).toBe(false);
    expect(streakVerified(sync({ status: 'offline', lastSync: 1 }))).toBe(false);
  });
});

// ---------- Components (real store and IndexedDB) ----------

let root: Root;
let host: HTMLDivElement;
let store!: ReturnType<typeof useStore>;
function Grab() {
  store = useStore();
  return null;
}
const wait = (ms = 40) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const T = todayKey();
const START = addDays(startOfWeek(T, 1), -14);
const read: Habit = {
  id: 'read', name: 'Lesen', description: '', icon: 'book', kind: 'binary', unit: '', startDate: START,
  rules: [{ from: START, days: ALL_DAYS, target: 1 }], pauses: [], reminder: null, order: 0, createdAt: 0,
};

let consumed = 0;
const auth = (welcomeFor: string | null): Auth => ({
  state: welcomeFor ? { status: 'signedIn', user: { id: welcomeFor, email: 'a@b.c' }, recovery: false } : { status: 'disabled' },
  signIn: async () => ({ ok: true }), signUp: async () => ({ ok: true }), signOut: async () => ({ ok: true }),
  sendReset: async () => ({ ok: true }), updatePassword: async () => ({ ok: true }), resendConfirmation: async () => ({ ok: true }),
  welcomeFor,
  consumeWelcome: () => void consumed++,
});

function tree(partition: string, userId: string | null, welcomeFor: string | null, child: React.ReactNode) {
  return (
    <I18nProvider>
      <AuthContext.Provider value={auth(welcomeFor)}>
        {/* sync: false — tests must never reach the real backend (Vitest loads .env.local). Without a SyncManager
            the first sync never settles, which is exactly the slow-network case. */}
        <StoreProvider key={partition} partition={{ name: partition, sync: false, userId }}>
          <Grab />
          {child}
        </StoreProvider>
      </AuthContext.Provider>
    </I18nProvider>
  );
}

/** Habit "read" with check-offs on the given days (relative to today), replacing the seeded examples. */
async function seed(daysAgo: number[]) {
  for (let i = 0; i < 50 && (store.status !== 'ready' || !store.snapshot.habits.length); i++) await wait(20);
  const examples = store.snapshot.habits.map((h) => ({ kind: 'habit' as const, id: h.id }));
  await act(async () => store.applyOps([...examples, { kind: 'habit', id: read.id, rec: read }]));
  for (const d of daysAgo) await act(async () => store.setEntry(read, addDays(T, -d), 1));
  await wait(60);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('still-lang', 'de');
  consumed = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const badge = () => document.querySelector('.streak-badge')?.getAttribute('aria-label');

describe('streak welcome and dashboard badge', () => {
  it('after an explicit sign-in: shows the real streak once, marked as device data, Continue focused; dismissal sticks', async () => {
    await act(async () => root.render(tree('still-streak-w1', 'u1', 'u1', <StreakWelcome />)));
    await seed([2, 1]); // two days in a row, today still open
    expect(document.querySelector('.sheet')).toBeNull(); // waiting for the first sync…
    await wait(5200); // …which never settles here: shown after 5 s instead of blocking
    const sheet = document.querySelector('.sheet')!;
    expect(sheet.querySelector('h2')!.textContent).toBe('Deine Aktiv-Serie');
    expect(sheet.textContent).toContain('2 Tage in Folge aktiv'); // nothing added for signing in
    expect(sheet.querySelector('.flame-num')!.textContent).toBe('2');
    expect(sheet.textContent).toContain('Stand dieses Geräts');
    await wait(60);
    expect(document.activeElement?.textContent).toBe('Weiter');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await wait(400);
    expect(consumed).toBe(1);
  }, 10000);

  it('no welcome without an explicit sign-in (restored session, token refresh), or when skipped in settings', async () => {
    await act(async () => root.render(tree('still-streak-w2', 'u1', null, <StreakWelcome />)));
    await seed([0]);
    await wait(5200);
    expect(document.querySelector('.sheet')).toBeNull();
    writeSkipWelcome(true);
    await act(async () => root.render(tree('still-streak-w2', 'u1', 'u1', <StreakWelcome />)));
    await wait(100);
    expect(document.querySelector('.sheet')).toBeNull();
    expect(consumed).toBe(1); // skipped: the pending welcome is cleared, not kept for later
  }, 15000);

  it('account switching: each account shows its own streak', async () => {
    await act(async () => root.render(tree('still-streak-a', 'a', null, <StreakBadge />)));
    await seed([1, 0]);
    expect(badge()).toBe('Aktiv-Serie: 2 Tage. Verlauf und Regeln öffnen');
    await act(async () => root.render(tree('still-streak-b', 'b', null, <StreakBadge />)));
    await seed([]);
    expect(badge()).toBe('Aktiv-Serie: 0 Tage. Verlauf und Regeln öffnen');
    await act(async () => root.render(tree('still-streak-a', 'a', null, <StreakBadge />)));
    for (let i = 0; i < 50 && store.status !== 'ready'; i++) await wait(20);
    await wait(60);
    expect(badge()).toBe('Aktiv-Serie: 2 Tage. Verlauf und Regeln öffnen');
  });

  it('celebrates only a day newly earned by a saved action, not the initial render; undo recomputes', async () => {
    await act(async () => root.render(tree('still-streak-c', null, null, <StreakBadge />)));
    await seed([1]);
    // Reopen: loading stored history (as after a reload or a sync) never celebrates.
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(tree('still-streak-c', null, null, <StreakBadge />)));
    for (let i = 0; i < 50 && store.status !== 'ready'; i++) await wait(20);
    await wait(60);
    expect(badge()).toContain('1 Tag.');
    expect(document.querySelector('.flame-flare')).toBeNull();
    await act(async () => store.toggleEntry(read, T));
    await wait(60);
    expect(badge()).toContain('2 Tage');
    expect(document.querySelector('.flame-flare')).not.toBeNull();
    await act(async () => store.toast!.undo!());
    await wait(60);
    expect(badge()).toContain('1 Tag.');
  });
});
