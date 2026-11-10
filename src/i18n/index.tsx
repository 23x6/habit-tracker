import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setDateLocale } from '../lib/date';
import { de, dictionaries, type Lang, type Messages } from './messages';

export type { Lang, Messages } from './messages';

// UI language: a per-device preference (localStorage), German by default. It never touches stored data,
// date keys, week start or calculations — only how text, dates and numbers are displayed.
export const LANG_KEY = 'still-lang';

export function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'de';
  } catch {
    return 'de';
  }
}

interface I18n {
  lang: Lang;
  t: Messages;
  setLang: (l: Lang) => void;
}

// Default (no provider, e.g. isolated component tests): German.
const Ctx = createContext<I18n>({ lang: 'de', t: de, setLang: () => {} });
export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = readLang();
    setDateLocale(l); // before the first render, so dates are formatted right away
    return l;
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18n>(
    () => ({
      lang,
      t: dictionaries[lang],
      setLang: (l) => {
        try {
          localStorage.setItem(LANG_KEY, l);
        } catch { /* private mode: the choice lasts for this session */ }
        setDateLocale(l); // before re-rendering with the new language
        setLangState(l);
      },
    }),
    [lang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
