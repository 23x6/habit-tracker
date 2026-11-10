import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const DEBOUNCE_MS = 700;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Autosaves unfinished form text as a draft in this partition's local database (never synced, never counted).
 *   • `key` null = form closed. On open, a stored draft that differs from `base` is restored via `restore`.
 *   • Saves after a short typing pause, immediately on `flush()` (field blur) and when the form closes.
 *   • `committed()` after an explicit save removes the draft; `discard()` drops it and restores `base`.
 */
export function useDraft<T>(key: string | null, value: T, base: T, restore: (v: T) => void) {
  const { drafts } = useStore();
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const ready = useRef(false); // no saving before the stored draft was read (it would overwrite it)
  const latest = useRef({ value, base });
  latest.current = { value, base };
  const done = useRef(false); // explicitly saved or discarded: don't recreate the draft on close

  const write = useCallback(async () => {
    if (!key || !ready.current || done.current) return;
    const { value: v, base: b } = latest.current;
    if (same(v, b)) await drafts.clear(key);
    else {
      await drafts.save(key, v);
      setSavedAt(Date.now());
    }
  }, [key, drafts]);

  // Open: load. Close (key → null) or switch: flush whatever is pending.
  useEffect(() => {
    if (!key) return;
    ready.current = false;
    done.current = false;
    setRestored(false);
    setSavedAt(null);
    let alive = true;
    void drafts.load<T>(key).then((d) => {
      if (!alive) return;
      if (d !== undefined && !same(d, latest.current.base)) {
        restore(d);
        setRestored(true);
      }
      ready.current = true;
    });
    return () => {
      alive = false;
      void write();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save while typing.
  useEffect(() => {
    if (!key || !ready.current) return;
    const id = setTimeout(() => void write(), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [key, value, write]);

  return {
    restored,
    savedAt,
    flush: () => void write(),
    committed: () => {
      done.current = true;
      if (key) void drafts.clear(key);
    },
    discard: () => {
      if (key) void drafts.clear(key);
      restore(latest.current.base);
      setRestored(false);
    },
  };
}
