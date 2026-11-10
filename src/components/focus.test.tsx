// @vitest-environment jsdom
// Regression: typing in a sheet must never move focus away from the field (bug: inline `onClose` props re-ran
// the Sheet's focus effect on every keystroke, which focused the panel).
import 'fake-indexeddb/auto';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth';
import { StoreProvider } from '../store';
import { AuthSheet } from './Account';
import { Sheet } from './ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 40))); // lets rAF callbacks and effects run

const valueSetter = (el: HTMLInputElement | HTMLTextAreaElement) =>
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;

/** Types like a keyboard: inserts at the caret (replacing a selection), fires `input`, waits a frame. */
async function typeChar(el: HTMLInputElement, ch: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  await act(async () => {
    valueSetter(el).call(el, el.value.slice(0, start) + ch + el.value.slice(end));
    // type=email has no selection API (per spec); there the caret is always at the end.
    if (el.selectionStart !== null) el.setSelectionRange(start + ch.length, start + ch.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

/** Types several characters and asserts after each one that the same field still has focus. */
async function typeKeepingFocus(el: HTMLInputElement, text: string) {
  act(() => el.focus());
  await settle();
  for (const ch of text) {
    await typeChar(el, ch);
    expect(document.activeElement, `focus after typing "${ch}"`).toBe(el);
  }
}

function AuthHarness({ initial }: { initial: 'login' | 'register' | 'forgot' }) {
  const [mode, setMode] = useState<null | 'login' | 'register' | 'forgot'>(initial);
  return <AuthSheet mode={mode} onMode={setMode} />;
}

async function renderAuth(initial: 'login' | 'register' | 'forgot') {
  await act(async () =>
    root.render(
      <StoreProvider partition={{ name: 'still-focus-test', sync: false, userId: null }}>
        <AuthProvider>
          <AuthHarness initial={initial} />
        </AuthProvider>
      </StoreProvider>,
    ),
  );
  await settle();
  await settle();
}

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const clickButton = async (text: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === text)!;
  await act(async () => b.click());
  await settle();
};

describe('sheet forms keep focus while typing', () => {
  it('registration: email, password and confirmation accept continuous typing', async () => {
    await renderAuth('register');
    const email = q<HTMLInputElement>('.sheet input[type=email]');
    const [pw, confirm] = [...document.querySelectorAll<HTMLInputElement>('.sheet input[type=password]')];
    await typeKeepingFocus(email, 'max@example.com');
    await typeKeepingFocus(pw, 'geheim-123');
    await typeKeepingFocus(confirm, 'geheim-123');
    expect([email.value, pw.value, confirm.value]).toEqual(['max@example.com', 'geheim-123', 'geheim-123']);
  });

  it('editing in the middle, replacing a selection and pasting keep focus and the caret', async () => {
    await renderAuth('register');
    const pw = q<HTMLInputElement>('.sheet input[type=password]');
    await typeKeepingFocus(pw, 'abcdef');
    act(() => pw.setSelectionRange(2, 2)); // caret between "ab" and "cdef"
    await typeChar(pw, 'X');
    expect(pw.value).toBe('abXcdef');
    expect(document.activeElement).toBe(pw);
    expect(pw.selectionStart).toBe(3);
    act(() => pw.setSelectionRange(0, 2)); // select "ab" and replace it
    await typeChar(pw, 'Z');
    expect(pw.value).toBe('ZXcdef');
    expect(document.activeElement).toBe(pw);
    act(() => pw.setSelectionRange(1, 2)); // delete "X" (backspace on a selection)
    await typeChar(pw, '');
    expect(pw.value).toBe('Zcdef');
    act(() => pw.setSelectionRange(5, 5));
    await typeChar(pw, '-eingefügt'); // paste = one input event with several characters
    expect(pw.value).toBe('Zcdef-eingefügt');
    expect(document.activeElement).toBe(pw);
  });

  it('validation messages appearing while typing do not move focus', async () => {
    await renderAuth('register');
    await clickButton('Konto erstellen'); // empty form → errors shown, form is now "touched"
    expect(document.querySelectorAll('[role=alert]').length).toBeGreaterThan(0);
    const [pw, confirm] = [...document.querySelectorAll<HTMLInputElement>('.sheet input[type=password]')];
    await typeKeepingFocus(pw, 'kurz'); // "Mindestens 8 Zeichen." stays visible while typing
    await typeKeepingFocus(pw, '-genug');
    await typeKeepingFocus(confirm, 'kurz-gen'); // mismatch message updates on every key
    expect(confirm.value).toBe('kurz-gen');
  });

  it('login and password-reset forms keep focus too', async () => {
    await renderAuth('login');
    await typeKeepingFocus(q<HTMLInputElement>('.sheet input[type=email]'), 'max@example.com');
    await typeKeepingFocus(q<HTMLInputElement>('.sheet input[type=password]'), 'passwort');
    await clickButton('Passwort vergessen?');
    expect(q('.sheet h2').textContent).toBe('Passwort vergessen');
    await typeKeepingFocus(q<HTMLInputElement>('.sheet input[type=email]'), 'max@example.com');
  });

  it('any sheet with an inline onClose keeps focus while its parent re-renders', async () => {
    function Form() {
      const [v, setV] = useState('');
      return (
        <Sheet open onClose={() => setV('')} title="Test">
          <input aria-label="feld" value={v} onChange={(e) => setV(e.target.value)} />
        </Sheet>
      );
    }
    await act(async () =>
      root.render(
        <StoreProvider partition={{ name: 'still-focus-test', sync: false, userId: null }}>
          <Form />
        </StoreProvider>,
      ),
    );
    await settle();
    await typeKeepingFocus(q<HTMLInputElement>('input[aria-label=feld]'), 'fünf Zeichen');
  });

  it('opening a sheet still moves focus into it, and closing restores focus', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    await renderAuth('login');
    expect(q('.sheet').contains(document.activeElement)).toBe(true);
    await clickButton('Abbrechen');
    await settle();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
