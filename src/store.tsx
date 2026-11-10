import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from './i18n';
import { addDays, startOfWeek, today as todayKey, type DateKey } from './lib/date';
import { emptySnapshot, StillDb, type Conflict, type Kind, type Op, type Snapshot } from './lib/db';
import { missingExamples } from './lib/examples';
import {
  ALL_DAYS, completionId, entryId, isArchived, makeRule, ruleAt, uid, withRule,
  type Analysis, type Completion, type Entry, type Habit, type JournalEntry, type Settings,
} from './lib/model';
import { supabase, supabaseRemote } from './lib/remote';
import { SyncManager, type SyncState } from './lib/sync';
import { makeCompletion, toAnalysis, toJournal, type AnalysisDraft, type JournalDraft } from './lib/weekly';

export type ScheduleType = 'daily' | 'days' | 'weekly';

export interface Draft {
  name: string;
  description: string;
  icon: string;
  kind: Habit['kind'];
  unit: string;
  schedule: ScheduleType;
  days: number[];
  target: number;
  /** "X-mal pro Woche" */
  perWeek: number;
  multi: boolean;
  startDate: DateKey;
  reminder: string | null;
}

export interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

export interface Partition {
  name: string;
  sync: boolean;
  userId: string | null;
}

interface Store {
  partition: Partition;
  /** Everything currently loaded for this partition. */
  snapshot: Snapshot;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  habits: Habit[];
  settings: Settings;
  today: DateKey;
  toast: Toast | null;
  analyses: Analysis[];
  journal: JournalEntry[];
  completions: Completion[];
  /** null in local-only mode. */
  sync: SyncState | null;
  conflicts: Conflict[];
  getEntry: (habitId: string, date: DateKey) => Entry | undefined;
  entriesOf: (habitId: string) => Entry[];
  createHabit: (d: Draft) => Promise<void>;
  updateHabit: (id: string, d: Draft) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  setEntry: (habit: Habit, date: DateKey, value: number, note?: string, message?: string) => Promise<void>;
  /** Binary quick action: flips the stored state at the time of writing (not of the tap), with undo. */
  toggleEntry: (habit: Habit, date: DateKey) => Promise<void>;
  /** Numeric quick action: adds `delta` to the stored value at the time of writing, so rapid taps all count. */
  stepEntry: (habit: Habit, date: DateKey, delta: number) => Promise<void>;
  setSettings: (s: Partial<Settings>) => Promise<void>;
  saveAnalysis: (id: string, habitId: string, d: AnalysisDraft) => Promise<void>;
  deleteAnalysis: (id: string) => Promise<void>;
  saveJournal: (id: string, d: JournalDraft) => Promise<void>;
  deleteJournal: (id: string) => Promise<void>;
  /** Adds (or, one-per-day, toggles off) a completion on `date`, with undo. */
  toggleCompletion: (habit: Habit, date: DateKey) => Promise<void>;
  /** Creates or edits a completion (`prev`) on `date`. */
  saveCompletion: (habit: Habit, date: DateKey, prev?: Completion) => Promise<void>;
  deleteCompletion: (id: string) => Promise<void>;
  addExamples: () => Promise<void>;
  replaceAll: (s: Snapshot) => Promise<void>;
  /** Raw atomic write (account import). */
  applyOps: (ops: Op[], message?: string) => Promise<void>;
  resolveConflict: (c: Conflict, keep: 'local' | 'server') => Promise<void>;
  syncNow: () => void;
  /** Local writes in flight (IndexedDB transaction not yet committed). */
  saving: boolean;
  /** Last local write that failed; nothing of it was stored. `retry` writes the same change again. */
  saveError: { message: string; retry: () => void } | null;
  /** Unsent form text (journal / analysis drafts), stored in this partition's local database only. */
  drafts: {
    load: <T>(key: string) => Promise<T | undefined>;
    save: (key: string, value: unknown) => Promise<void>;
    clear: (key: string) => Promise<void>;
  };
  showToast: (message: string, undo?: () => void) => void;
  dismissToast: () => void;
}

const Ctx = createContext<Store | null>(null);

export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
};

const LIST: Record<Exclude<Kind, 'settings'>, keyof Snapshot> = { habit: 'habits', entry: 'entries', completion: 'completions', analysis: 'analyses', journal: 'journal' };

/** Applies ops to an in-memory snapshot (mirrors StillDb.write). */
export function applyOps(s: Snapshot, ops: Op[]): Snapshot {
  const next = { ...s };
  for (const op of ops) {
    if (op.kind === 'settings') {
      if (op.rec) next.settings = op.rec as Settings;
      continue;
    }
    const k = LIST[op.kind];
    const list = (next[k] as { id: string }[]).filter((r) => r.id !== op.id);
    if (op.rec !== undefined) list.push(op.rec as { id: string });
    (next as Record<string, unknown>)[k] = list;
  }
  return next;
}

/** Entry write for `habit` on `date`: `next` maps the stored value to the new one; the note is kept. */
function entryOp(s: Snapshot, habit: Habit, date: DateKey, next: (current: number) => number, note?: string): Op {
  const id = entryId(habit.id, date);
  const prev = s.entries.find((e) => e.id === id);
  const raw = next(prev?.value ?? 0);
  const v = Math.max(0, habit.kind === 'binary' ? Math.min(1, raw) : Math.round(raw * 100) / 100);
  const n = note ?? prev?.note ?? '';
  const rec: Entry | undefined = v === 0 && !n ? undefined : { id, habitId: habit.id, date, value: v, note: n, updatedAt: Date.now() };
  return { kind: 'entry', id, rec };
}

/** Ops that restore the records touched by `ops` to their state in `s` (undo). */
function inverse(s: Snapshot, ops: Op[]): Op[] {
  return ops.map((op) => {
    if (op.kind === 'settings') return { kind: 'settings', id: 'settings', rec: s.settings };
    const prev = (s[LIST[op.kind]] as { id: string }[]).find((r) => r.id === op.id);
    return { kind: op.kind, id: op.id, rec: prev };
  });
}

export function StoreProvider({ partition, children }: { partition: Partition; children: ReactNode }) {
  // One handle per partition (the provider is keyed by partition name, so switching accounts remounts it).
  const db = useMemo(() => new StillDb(partition.name, partition.sync), [partition.name, partition.sync]);
  const [status, setStatus] = useState<Store['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot>(emptySnapshot);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const [today, setToday] = useState(todayKey());
  const [toast, setToast] = useState<Toast | null>(null);
  const [savingCount, setSavingCount] = useState(0);
  const [saveError, setSaveError] = useState<{ message: string; ops: Op[] } | null>(null);
  // Toast texts are produced inside long-lived callbacks: read the current language through a ref.
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [sync, setSync] = useState<SyncState | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const toastSeq = useRef(0);
  const manager = useRef<SyncManager | null>(null);

  const reload = useCallback(async () => {
    const [s, c] = await Promise.all([db.loadAll(), db.conflicts()]);
    setSnap(s);
    setConflicts(c);
  }, [db]);

  useEffect(() => {
    let alive = true;
    db.initialize()
      .then(reload)
      .then(() => alive && setStatus('ready'))
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });
    if (partition.sync && partition.userId && supabase) {
      const m = new SyncManager(db, supabaseRemote(supabase, partition.userId), () => void reload());
      manager.current = m;
      const off = m.subscribe((s) => {
        setSync(s);
        void db.conflicts().then((c) => alive && setConflicts(c));
      });
      m.start();
      return () => {
        alive = false;
        off();
        m.stop();
        manager.current = null;
        void db.close();
      };
    }
    return () => {
      alive = false;
      void db.close();
    };
  }, [db, partition.sync, partition.userId, reload]);

  useEffect(() => {
    // Roll the day over at local midnight (and after the device wakes).
    const tick = () => setToday(todayKey());
    const iv = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const showToast = useCallback((message: string, undo?: () => void) => setToast({ id: ++toastSeq.current, message, undo }), []);

  // Writes run one after another. Ops given as a function are built from the state left by all earlier writes,
  // so rapid taps never compute from a stale value (no lost updates, no accidental duplicates).
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /** Persist first, then update memory, so the UI never shows data that isn't stored. Returns undo ops. */
  const commit = useCallback(
    (input: Op[] | ((s: Snapshot) => Op[])): Promise<Op[]> => {
      setSavingCount((n) => n + 1);
      const run = queue.current.then(async () => {
        const ops = typeof input === 'function' ? input(snapRef.current) : input;
        if (!ops.length) return [];
        const undo = inverse(snapRef.current, ops);
        try {
          // Record and its pending sync operation are written in one IndexedDB transaction (StillDb.write).
          await db.write(ops);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setSaveError({ message, ops });
          showToast(tRef.current.save.saveFailedText(message));
          throw e;
        }
        snapRef.current = applyOps(snapRef.current, ops); // the next queued write sees this one at once
        setSnap(snapRef.current);
        return undo;
      });
      queue.current = run.catch(() => {});
      return run.finally(() => setSavingCount((n) => n - 1));
    },
    [db, showToast],
  );

  const commitWithUndo = useCallback(
    async (input: Op[] | ((s: Snapshot) => Op[]), message: string | (() => string)) => {
      const undo = await commit(input);
      if (!undo.length) return;
      showToast(typeof message === 'function' ? message() : message, () => void commit(undo).catch(() => {}));
    },
    [commit, showToast],
  );

  const habits = useMemo(() => [...snap.habits].sort((a, b) => a.order - b.order), [snap.habits]);
  const entries = useMemo(() => new Map(snap.entries.map((e) => [e.id, e])), [snap.entries]);
  const getEntry = useCallback((habitId: string, date: DateKey) => entries.get(entryId(habitId, date)), [entries]);
  const entriesOf = useCallback((habitId: string) => snap.entries.filter((e) => e.habitId === habitId), [snap.entries]);
  const find = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id);

  const setEntry: Store['setEntry'] = useCallback(
    async (habit, date, value, note, message) => {
      if (date > todayKey()) return showToast(tRef.current.toast.futureDay);
      if (habit.kind === 'weekly') return; // weekly goals only count saved analyses
      const ops = (s: Snapshot) => [entryOp(s, habit, date, () => value, note)];
      if (message) await commitWithUndo(ops, message);
      else await commit(ops);
    },
    [commit, commitWithUndo, showToast],
  );

  const toggleEntry = useCallback(
    async (habit: Habit, date: DateKey) => {
      if (date > todayKey()) return showToast(tRef.current.toast.futureDay);
      if (habit.kind !== 'binary') return;
      let nowDone = false;
      await commitWithUndo(
        (s) => [entryOp(s, habit, date, (cur) => ((nowDone = cur < 1) ? 1 : 0))],
        () => (nowDone ? tRef.current.toast.done(habit.name) : tRef.current.toast.reopened(habit.name)),
      );
    },
    [commitWithUndo, showToast],
  );

  const stepEntry: Store['stepEntry'] = useCallback(
    async (habit, date, delta) => {
      if (date > todayKey()) return showToast(tRef.current.toast.futureDay);
      if (habit.kind !== 'numeric') return;
      let reached = false;
      const target = ruleAt(habit, date).target;
      await commit((s) => [
        entryOp(s, habit, date, (cur) => {
          const next = cur + delta;
          reached = cur < target && next >= target;
          return next;
        }),
      ]);
      // Undo takes back exactly this step (later steps stay), never the whole value.
      if (reached) showToast(tRef.current.toast.reached(habit.name), () => void stepEntry(habit, date, -delta).catch(() => {}));
    },
    [commit, showToast],
  );

  const ruleFromDraft = (d: Draft, kind: Habit['kind']) => {
    const days = d.schedule === 'daily' || d.schedule === 'weekly' || kind === 'weekly' ? ALL_DAYS : [...d.days].sort((a, b) => a - b);
    const target = kind === 'binary' ? 1 : d.target;
    const freq = kind === 'binary' && d.schedule === 'weekly' ? { perWeek: d.perWeek, multi: d.multi } : {};
    return { days, target, freq };
  };

  const createHabit = useCallback(
    async (d: Draft) => {
      const { days, target, freq } = ruleFromDraft(d, d.kind);
      const h: Habit = {
        id: uid(), name: d.name.trim(), description: d.description.trim(), icon: d.icon, kind: d.kind,
        unit: d.kind === 'numeric' ? d.unit.trim() : d.kind === 'weekly' ? 'Analysen' : '', startDate: d.startDate,
        rules: [makeRule(d.startDate, days, target, freq)],
        pauses: [], reminder: d.kind === 'weekly' ? null : d.reminder,
        order: habits.length ? Math.max(...habits.map((x) => x.order)) + 1 : 0, createdAt: Date.now(),
      };
      await commit([{ kind: 'habit', id: h.id, rec: h }]);
      showToast(tRef.current.toast.created(h.name));
    },
    [habits, commit, showToast],
  );

  const updateHabit = useCallback(
    async (id: string, d: Draft) => {
      const h = find(snapRef.current.habits, id);
      if (!h) return;
      const t = todayKey();
      const { days, target, freq } = ruleFromDraft(d, h.kind);
      let rules: Habit['rules'];
      if (d.startDate > t) {
        rules = [makeRule(d.startDate, days, target, freq)]; // not started: nothing historical to keep
      } else {
        // Weekly goals (and switching to or from them) change from next week on, so the running week stays stable.
        // Daily schedule/target changes apply from today. Earlier days and weeks always keep their rule.
        const weeklyNow = h.kind === 'weekly' || ruleAt(h, t).perWeek != null;
        const weeklyNext = h.kind === 'weekly' || freq.perWeek != null;
        const effective = weeklyNow || weeklyNext ? addDays(startOfWeek(t, snapRef.current.settings.weekStart), 7) : t;
        rules = withRule(h, days, target, effective, freq);
      }
      const rec: Habit = {
        ...h, name: d.name.trim(), description: d.description.trim(), icon: d.icon, unit: h.kind === 'numeric' ? d.unit.trim() : h.unit,
        startDate: d.startDate, reminder: h.kind === 'weekly' ? null : d.reminder, rules,
      };
      await commit([{ kind: 'habit', id, rec }]);
      showToast(tRef.current.toast.changesSaved);
    },
    [commit, showToast],
  );

  const setArchived = useCallback(
    async (id: string, archived: boolean) => {
      const h = find(snapRef.current.habits, id);
      if (!h || isArchived(h) === archived) return;
      const t = todayKey();
      const pauses = archived
        ? [...h.pauses, { from: t, to: null }]
        : h.pauses.map((p) => (p.to === null ? { ...p, to: t } : p)).filter((p) => p.to !== p.from); // same-day archive+restore leaves no gap
      await commitWithUndo([{ kind: 'habit', id, rec: { ...h, pauses } }], archived ? tRef.current.toast.archived(h.name) : tRef.current.toast.restored(h.name));
    },
    [commitWithUndo],
  );

  const deleteHabit = useCallback(
    async (id: string) => {
      const s = snapRef.current;
      const ops: Op[] = [
        { kind: 'habit', id },
        ...s.entries.filter((e) => e.habitId === id).map((e) => ({ kind: 'entry' as const, id: e.id })),
        ...s.analyses.filter((a) => a.habitId === id).map((a) => ({ kind: 'analysis' as const, id: a.id })),
        ...s.completions.filter((c) => c.habitId === id).map((c) => ({ kind: 'completion' as const, id: c.id })),
      ];
      await commit(ops).catch(() => {});
      showToast(tRef.current.toast.habitDeleted);
    },
    [commit, showToast],
  );

  const reorder = useCallback(
    async (ids: string[]) => {
      const byId = new Map(snapRef.current.habits.map((h) => [h.id, h]));
      const ops: Op[] = ids.flatMap((id, i) => {
        const h = byId.get(id);
        return h && h.order !== i ? [{ kind: 'habit' as const, id, rec: { ...h, order: i } }] : [];
      });
      if (ops.length) await commit(ops);
    },
    [commit],
  );

  const setSettings = useCallback(
    async (p: Partial<Settings>) => {
      await commit([{ kind: 'settings', id: 'settings', rec: { ...snapRef.current.settings, ...p } }]).catch(() => {});
    },
    [commit],
  );

  const saveAnalysis = useCallback(
    async (id: string, habitId: string, d: AnalysisDraft) => {
      const prev = find(snapRef.current.analyses, id);
      await commit([{ kind: 'analysis', id, rec: toAnalysis(id, habitId, d, prev, Date.now()) }]);
      showToast(prev ? tRef.current.toast.analysisUpdated : tRef.current.toast.analysisSaved);
    },
    [commit, showToast],
  );

  const deleteAnalysis = useCallback((id: string) => commitWithUndo([{ kind: 'analysis', id }], tRef.current.toast.analysisDeleted), [commitWithUndo]);

  const saveJournal = useCallback(
    async (id: string, d: JournalDraft) => {
      const prev = find(snapRef.current.journal, id);
      await commit([{ kind: 'journal', id, rec: toJournal(id, d, prev, Date.now()) }]);
      showToast(prev ? tRef.current.toast.entryUpdated : tRef.current.toast.entrySaved);
    },
    [commit, showToast],
  );

  const deleteJournal = useCallback((id: string) => commitWithUndo([{ kind: 'journal', id }], tRef.current.toast.entryDeleted), [commitWithUndo]);

  const toggleCompletion = useCallback(
    async (habit: Habit, date: DateKey) => {
      if (date > todayKey()) return showToast(tRef.current.toast.futureDay);
      let removed = false;
      await commitWithUndo(
        (s): Op[] => {
          // Decided at write time: a second rapid tap sees the first tap's completion.
          const existing = !ruleAt(habit, date).multi ? find(s.completions, completionId(habit.id, date)) : undefined;
          removed = !!existing;
          if (existing) return [{ kind: 'completion', id: existing.id }];
          const c = makeCompletion(habit, date, Date.now());
          return [{ kind: 'completion', id: c.id, rec: c }];
        },
        () => (removed ? tRef.current.toast.completionRemoved : tRef.current.toast.completionAdded(habit.name)),
      );
    },
    [commitWithUndo, showToast],
  );

  const saveCompletion = useCallback(
    async (habit: Habit, date: DateKey, prev?: Completion) => {
      const c = makeCompletion(habit, date, Date.now(), prev);
      const ops: Op[] = [{ kind: 'completion', id: c.id, rec: c }];
      if (prev && prev.id !== c.id) ops.unshift({ kind: 'completion', id: prev.id }); // one-per-day id follows the date
      await commitWithUndo(ops, prev ? tRef.current.toast.completionChanged : tRef.current.toast.completionAdded(habit.name));
    },
    [commitWithUndo],
  );

  const deleteCompletion = useCallback((id: string) => commitWithUndo([{ kind: 'completion', id }], tRef.current.toast.completionDeleted), [commitWithUndo]);

  const addExamples = useCallback(async () => {
    const add = missingExamples(snapRef.current.habits, todayKey());
    if (!add.length) return showToast(tRef.current.toast.examplesPresent);
    await commit(add.map((h) => ({ kind: 'habit' as const, id: h.id, rec: h })));
    showToast(tRef.current.toast.examplesAdded(add.length));
  }, [commit, showToast]);

  const replaceAll = useCallback(
    async (s: Snapshot) => {
      await db.replaceAll(s);
      await reload();
    },
    [db, reload],
  );

  const applyOpsCb = useCallback(
    async (ops: Op[], message?: string) => {
      await commit(ops);
      if (message) showToast(message);
    },
    [commit, showToast],
  );

  const resolveConflict = useCallback(
    async (c: Conflict, keep: 'local' | 'server') => {
      await db.resolveConflict(c, keep);
      await reload();
      showToast(keep === 'local' ? tRef.current.toast.keptLocal : tRef.current.toast.keptServer);
    },
    [db, reload, showToast],
  );

  const drafts = useMemo<Store['drafts']>(
    () => ({
      load: <T,>(key: string) => db.getMeta<T>('draft:' + key),
      save: (key, value) => db.setMeta('draft:' + key, value),
      clear: (key) => db.deleteMeta('draft:' + key),
    }),
    [db],
  );

  const value = useMemo<Store>(
    () => ({
      partition, snapshot: snap, status, error, habits, settings: snap.settings, today, toast, analyses: snap.analyses, journal: snap.journal,
      completions: snap.completions, sync, conflicts, getEntry, entriesOf, createHabit, updateHabit, setArchived, deleteHabit,
      reorder, setEntry, toggleEntry, stepEntry, setSettings, saveAnalysis, deleteAnalysis, saveJournal, deleteJournal, toggleCompletion, saveCompletion,
      deleteCompletion, addExamples, replaceAll, applyOps: applyOpsCb, resolveConflict, syncNow: () => manager.current?.schedule(0),
      saving: savingCount > 0,
      saveError: saveError && {
        message: saveError.message,
        retry: () => {
          const ops = saveError.ops;
          setSaveError(null);
          void commit(ops).catch(() => {});
        },
      },
      drafts,
      showToast, dismissToast: () => setToast(null),
    }),
    [partition, status, error, habits, snap, today, toast, sync, conflicts, savingCount, saveError, drafts, commit, getEntry, entriesOf, createHabit, updateHabit, setArchived, deleteHabit, reorder, setEntry, toggleEntry, stepEntry, setSettings, saveAnalysis, deleteAnalysis, saveJournal, deleteJournal, toggleCompletion, saveCompletion, deleteCompletion, addExamples, replaceAll, applyOpsCb, resolveConflict, showToast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
