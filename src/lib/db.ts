import { today as todayKey } from './date';
import { missingExamples } from './examples';
import { defaultSettings, uid, type Analysis, type Completion, type Entry, type Habit, type JournalEntry, type Settings } from './model';

// Versioned IndexedDB schema. Each upgrade step only adds; existing records are never rewritten.
//   v1: habits, entries, meta(settings)
//   v2: + analyses, journal
//   v3: + completions ("X-mal pro Woche"), + outbox / versions / conflicts (sync bookkeeping)
//
// Each database is a separate partition: `still` holds local-only data, `still-account-<userId>` caches one
// account. Every handle is bound to its database, so a write that finishes after an account switch can never
// land in another account's cache.
export const DB_VERSION = 3;
/** Error message code for an upgrade blocked by another open tab (translated by the UI). */
export const DB_BLOCKED = 'db-blocked';
export const LOCAL_DB = 'still';
export const accountDbName = (userId: string) => `still-account-${userId}`;

export interface Snapshot {
  habits: Habit[];
  entries: Entry[];
  settings: Settings;
  analyses: Analysis[];
  journal: JournalEntry[];
  completions: Completion[];
}

export const emptySnapshot = (): Snapshot => ({ habits: [], entries: [], settings: defaultSettings, analyses: [], journal: [], completions: [] });

export type Kind = 'habit' | 'entry' | 'completion' | 'analysis' | 'journal' | 'settings';
export const KINDS: Kind[] = ['habit', 'entry', 'completion', 'analysis', 'journal', 'settings'];
const DATA_STORES = ['habits', 'entries', 'completions', 'analyses', 'journal', 'meta'] as const;
const ALL_STORES = [...DATA_STORES, 'outbox', 'versions', 'conflicts'] as const;
type Store = (typeof ALL_STORES)[number];
const STORE_OF: Record<Kind, Store> = { habit: 'habits', entry: 'entries', completion: 'completions', analysis: 'analyses', journal: 'journal', settings: 'meta' };
const SNAP_OF: Record<Exclude<Kind, 'settings'>, keyof Snapshot> = { habit: 'habits', entry: 'entries', completion: 'completions', analysis: 'analyses', journal: 'journal' };

export const keyOf = (kind: Kind, id: string) => `${kind}|${id}`;

/** One write: `rec` undefined means delete. */
export interface Op {
  kind: Kind;
  id: string;
  rec?: unknown;
}

/** A record with unsynchronized local changes. `opId` changes on every local edit; retries reuse it. */
export interface OutboxItem {
  key: string;
  kind: Kind;
  id: string;
  op: 'upsert' | 'delete';
  opId: string;
}

/** A pending change ready to push: the current local record and the server version it is based on. */
export interface PendingChange extends OutboxItem {
  rec: unknown | null;
  base: number;
}

/** Server state as stored by the backend (see supabase/migrations). */
export interface RemoteRow {
  kind: Kind;
  id: string;
  data: unknown | null;
  deleted: boolean;
  version: number;
  seq: number;
  updated_at?: string;
}

/** Text content edited on two devices: both versions are kept until the user decides. */
export interface Conflict {
  key: string;
  kind: Kind;
  id: string;
  local: unknown | null; // null: deleted on this device
  server: unknown | null; // null: deleted on the other device
  at: number;
}

const req = <T>(r: IDBRequest) =>
  new Promise<T>((res, rej) => {
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  });

export class StillDb {
  private dbp: Promise<IDBDatabase> | null = null;
  /** Called after every committed local write (the sync engine schedules a push). */
  onWrite: (() => void) | null = null;

  constructor(readonly name: string, readonly sync: boolean) {}

  private upgrade(db: IDBDatabase, oldVersion: number) {
    if (oldVersion < 1) {
      db.createObjectStore('habits', { keyPath: 'id' });
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('habitId', 'habitId');
      // Fresh local installation: examples are added once by `initialize`. Upgrades and account caches never get this flag.
      const meta = db.createObjectStore('meta');
      if (!this.sync) meta.put(true, 'seedExamples');
    }
    if (oldVersion < 2) {
      db.createObjectStore('analyses', { keyPath: 'id' }).createIndex('habitId', 'habitId');
      db.createObjectStore('journal', { keyPath: 'id' }).createIndex('date', 'date');
    }
    if (oldVersion < 3) {
      db.createObjectStore('completions', { keyPath: 'id' }).createIndex('habitId', 'habitId');
      db.createObjectStore('outbox', { keyPath: 'key' });
      db.createObjectStore('versions');
      db.createObjectStore('conflicts', { keyPath: 'key' });
    }
  }

  open(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(this.name, DB_VERSION);
        r.onupgradeneeded = (e) => this.upgrade(r.result, e.oldVersion);
        r.onsuccess = () => {
          const db = r.result;
          // Another tab with a newer version wants to upgrade (or the account cache is being removed): let it.
          db.onversionchange = () => {
            db.close();
            this.dbp = null;
          };
          resolve(db);
        };
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error(DB_BLOCKED));
      });
      this.dbp.catch(() => (this.dbp = null));
    }
    return this.dbp;
  }

  async close() {
    const p = this.dbp;
    this.dbp = null;
    if (p) (await p.catch(() => null))?.close();
  }

  /** Removes this database from the device (e.g. a signed-out account's cache). */
  async destroy() {
    await this.close();
    await new Promise<void>((res, rej) => {
      const r = indexedDB.deleteDatabase(this.name);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
      r.onblocked = () => res(); // completes once other tabs close their connection
    });
  }

  private async tx<T>(stores: readonly Store[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result: T;
      try {
        result = fn(t);
      } catch (e) {
        t.abort();
        reject(e);
        return;
      }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('Transaktion abgebrochen'));
    });
  }

  /** Runs once per load: adds the example habits on a fresh local installation, exactly once, atomically. */
  initialize(now = Date.now()) {
    return this.tx(['habits', 'meta'], 'readwrite', (t) => {
      const meta = t.objectStore('meta');
      const hs = t.objectStore('habits');
      meta.get('seedExamples').onsuccess = (e) => {
        if (!(e.target as IDBRequest).result) return;
        meta.delete('seedExamples');
        hs.getAll().onsuccess = (ev) => {
          missingExamples((ev.target as IDBRequest<Habit[]>).result, todayKey(), now).forEach((h) => hs.put(h));
        };
      };
    });
  }

  async loadAll(): Promise<Snapshot> {
    const db = await this.open();
    const t = db.transaction(DATA_STORES, 'readonly');
    const [habits, entries, settings, analyses, journal, completions] = await Promise.all([
      req<Habit[]>(t.objectStore('habits').getAll()),
      req<Entry[]>(t.objectStore('entries').getAll()),
      req<Settings | undefined>(t.objectStore('meta').get('settings')),
      req<Analysis[]>(t.objectStore('analyses').getAll()),
      req<JournalEntry[]>(t.objectStore('journal').getAll()),
      req<Completion[]>(t.objectStore('completions').getAll()),
    ]);
    return { habits, entries, settings: { ...defaultSettings, ...settings }, analyses, journal, completions };
  }

  // ---------- writes ----------

  private static apply(t: IDBTransaction, op: Op) {
    const s = t.objectStore(STORE_OF[op.kind]);
    if (op.kind === 'settings') {
      if (op.rec === undefined) s.delete('settings');
      else s.put(op.rec, 'settings');
    } else if (op.rec === undefined) s.delete(op.id);
    else s.put(op.rec);
  }

  private static mark(t: IDBTransaction, op: Op) {
    const item: OutboxItem = { key: keyOf(op.kind, op.id), kind: op.kind, id: op.id, op: op.rec === undefined ? 'delete' : 'upsert', opId: uid() };
    t.objectStore('outbox').put(item);
  }

  /** Applies several writes atomically. With sync enabled, each changed record is queued for upload. */
  async write(ops: Op[]) {
    if (!ops.length) return;
    const stores: Store[] = [...new Set(ops.map((o) => STORE_OF[o.kind]))];
    if (this.sync) stores.push('outbox');
    await this.tx(stores, 'readwrite', (t) =>
      ops.forEach((op) => {
        StillDb.apply(t, op);
        if (this.sync) StillDb.mark(t, op);
      }),
    );
    this.onWrite?.();
  }

  /** Atomically replaces all data (import / clear). With sync, removed records are queued as deletions. */
  async replaceAll(s: Snapshot) {
    const cur = await this.loadAll();
    const ops: Op[] = [];
    for (const kind of KINDS) {
      if (kind === 'settings') continue;
      const next = new Map((s[SNAP_OF[kind]] as { id: string }[]).map((r) => [r.id, r]));
      for (const r of cur[SNAP_OF[kind]] as { id: string }[]) if (!next.has(r.id)) ops.push({ kind, id: r.id });
      for (const r of next.values()) ops.push({ kind, id: r.id, rec: r });
    }
    ops.push({ kind: 'settings', id: 'settings', rec: s.settings });
    await this.write(ops);
  }

  // ---------- local metadata ----------

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.tx(['meta'], 'readonly', (t) => req<T | undefined>(t.objectStore('meta').get(key))).then((p) => p);
  }

  setMeta(key: string, value: unknown) {
    return this.tx(['meta'], 'readwrite', (t) => void t.objectStore('meta').put(value, key));
  }

  deleteMeta(key: string) {
    return this.tx(['meta'], 'readwrite', (t) => void t.objectStore('meta').delete(key));
  }

  // ---------- sync bookkeeping ----------

  async pendingCount(): Promise<number> {
    return this.tx(['outbox'], 'readonly', (t) => req<number>(t.objectStore('outbox').count())).then((p) => p);
  }

  /** Outbox items with the current local record and the server version each change is based on. */
  pending(): Promise<PendingChange[]> {
    // Plain request callbacks (no awaits) keep everything inside one transaction.
    return this.tx(ALL_STORES, 'readonly', (t) => {
      const out: PendingChange[] = [];
      t.objectStore('outbox').getAll().onsuccess = (e) => {
        for (const it of (e.target as IDBRequest<OutboxItem[]>).result) {
          const pc: PendingChange = { ...it, base: 0, rec: null };
          out.push(pc);
          t.objectStore('versions').get(it.key).onsuccess = (ev) => (pc.base = (ev.target as IDBRequest<number | undefined>).result ?? 0);
          if (it.op === 'upsert')
            t.objectStore(STORE_OF[it.kind]).get(it.kind === 'settings' ? 'settings' : it.id).onsuccess = (ev) => (pc.rec = (ev.target as IDBRequest).result ?? null);
        }
      };
      return out;
    });
  }

  /** Server accepted a change: remember its version; clear the outbox entry unless it was edited again meanwhile. */
  ack(key: string, opId: string, version: number) {
    return this.tx(['outbox', 'versions'], 'readwrite', (t) => {
      t.objectStore('versions').put(version, key);
      const o = t.objectStore('outbox');
      o.get(key).onsuccess = (e) => {
        const cur = (e.target as IDBRequest<OutboxItem | undefined>).result;
        if (cur && cur.opId === opId) o.delete(key);
      };
    });
  }

  /**
   * Applies server rows. Rows for records with pending local changes are skipped (the next push detects the
   * conflict), and rows not newer than the known version are ignored, so re-applying a batch is harmless.
   * `force` applies a row even if a change is pending and removes that change (conflict resolved for the server).
   */
  async applyRemote(rows: RemoteRow[], force?: { key: string; opId: string }): Promise<number> {
    let applied = 0;
    await this.tx([...DATA_STORES, 'outbox', 'versions'], 'readwrite', (t) => {
      for (const row of rows) {
        const key = keyOf(row.kind, row.id);
        const forced = force?.key === key;
        t.objectStore('outbox').get(key).onsuccess = (e) => {
          const pending = (e.target as IDBRequest<OutboxItem | undefined>).result;
          if (pending && !forced) return;
          if (pending && forced && pending.opId !== force!.opId) return; // edited again since the conflicting push
          t.objectStore('versions').get(key).onsuccess = (ev) => {
            const known = ((ev.target as IDBRequest<number | undefined>).result) ?? 0;
            if (!forced && known >= row.version) return;
            StillDb.apply(t, { kind: row.kind, id: row.id, rec: row.deleted ? undefined : row.data });
            t.objectStore('versions').put(row.version, key);
            if (forced) t.objectStore('outbox').delete(key);
            applied++;
          };
        };
      }
    });
    return applied;
  }

  saveConflict(c: Conflict) {
    return this.tx(['conflicts'], 'readwrite', (t) => void t.objectStore('conflicts').put(c));
  }

  conflicts(): Promise<Conflict[]> {
    return this.tx(['conflicts'], 'readonly', (t) => req<Conflict[]>(t.objectStore('conflicts').getAll())).then((p) => p);
  }

  /** Resolves a conflict. 'local' re-applies this device's version on top of the server's (queued for upload). */
  async resolveConflict(c: Conflict, keep: 'local' | 'server') {
    await this.tx([STORE_OF[c.kind], 'outbox', 'conflicts'], 'readwrite', (t) => {
      t.objectStore('conflicts').delete(c.key);
      if (keep === 'local') {
        const op: Op = { kind: c.kind, id: c.id, rec: c.local ?? undefined };
        StillDb.apply(t, op);
        StillDb.mark(t, op);
      }
    });
    if (keep === 'local') this.onWrite?.();
  }
}
