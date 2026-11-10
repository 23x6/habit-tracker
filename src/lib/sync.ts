import type { Conflict, Kind, PendingChange, RemoteRow, StillDb } from './db';
import { keyOf } from './db';
import { cleanRecord } from './io';

// Offline-first sync between one account cache (IndexedDB) and the backend (supabase/migrations).
//
// Push: every pending change carries the server version it is based on and a stable operation id.
//   ok        → remember the new version.
//   retry     → the server recognizes the operation id and answers ok (idempotent).
//   conflict  → the record changed elsewhere since our base version:
//               journal / analysis: both versions are kept for the user to resolve (text is never dropped);
//               everything else: the server version wins and replaces the local change (explicit, documented).
// Pull: incremental by server sequence; rows for records with pending local changes are skipped.

export interface Change {
  kind: Kind;
  id: string;
  data: unknown | null;
  deleted: boolean;
  base: number;
  op: string;
}

export type PushResult =
  | { kind: Kind; id: string; status: 'ok'; version: number; seq: number }
  | { kind: Kind; id: string; status: 'conflict'; current: RemoteRow };

export interface Remote {
  push(changes: Change[]): Promise<PushResult[]>;
  /** Rows with seq > since, ordered by seq. */
  pull(since: number, limit: number): Promise<RemoteRow[]>;
}

/** Text the user wrote: conflicting versions are preserved, never silently overwritten. */
const PRESERVE: Kind[] = ['journal', 'analysis'];
const PUSH_BATCH = 100;
const PULL_LIMIT = 500;
/** Rows younger than this are fetched again next time, so a slower concurrent commit with a lower seq isn't missed. */
const SETTLE_MS = 10_000;

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  serverWins: number;
}

// Compare record contents without bookkeeping timestamps. Keys are sorted: Postgres jsonb reorders them.
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => k !== 'updatedAt').sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
const content = (x: unknown) => (x == null ? null : JSON.stringify(canonical(x)));

export async function syncOnce(db: StillDb, remote: Remote): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, serverWins: 0 };

  // ---- push ----
  const pending = await db.pending();
  for (let i = 0; i < pending.length; i += PUSH_BATCH) {
    const batch = pending.slice(i, i + PUSH_BATCH);
    const changes: Change[] = batch.map((p) => {
      const deleted = p.op === 'delete' || p.rec == null;
      return { kind: p.kind, id: p.id, data: deleted ? null : p.rec, deleted, base: p.base, op: p.opId };
    });
    const results = await remote.push(changes); // network errors propagate: nothing is lost, the outbox stays
    const byKey = new Map(batch.map((p) => [keyOf(p.kind, p.id), p]));
    for (const r of results) {
      const p = byKey.get(keyOf(r.kind, r.id));
      if (!p) continue;
      if (r.status === 'ok') {
        await db.ack(p.key, p.opId, r.version);
        report.pushed++;
      } else {
        await resolveConflict(db, p, r.current, report);
      }
    }
  }

  // ---- pull ----
  let cursor = (await db.getMeta<number>('syncCursor')) ?? 0;
  for (;;) {
    const rows = await remote.pull(cursor, PULL_LIMIT);
    if (!rows.length) break;
    const valid: RemoteRow[] = [];
    for (const row of rows) {
      if (row.deleted) valid.push(row);
      else {
        const data = cleanRecord(row.kind, row.data);
        if (data != null) valid.push({ ...row, data });
        // Invalid server data is skipped instead of corrupting the local cache.
      }
    }
    report.pulled += await db.applyRemote(valid);
    const newest = Math.max(...rows.map((r) => (r.updated_at ? Date.parse(r.updated_at) : 0)));
    const settled = rows.filter((r) => !r.updated_at || Date.parse(r.updated_at) <= newest - SETTLE_MS);
    const next = settled.length ? Math.max(...settled.map((r) => r.seq)) : cursor;
    if (rows.length < PULL_LIMIT || next === cursor) {
      if (next !== cursor) await db.setMeta('syncCursor', next);
      break;
    }
    cursor = next;
    await db.setMeta('syncCursor', cursor);
  }
  return report;
}

async function resolveConflict(db: StillDb, p: PendingChange, server: RemoteRow, report: SyncReport) {
  const localData = p.op === 'delete' ? null : p.rec;
  const serverData = server.deleted ? null : server.data;
  const force = { key: p.key, opId: p.opId };
  if (content(localData) === content(serverData)) {
    // Same content on both sides (e.g. the same day completed on two devices): nothing to resolve.
    await db.applyRemote([server], force);
    return;
  }
  if (PRESERVE.includes(p.kind)) {
    const c: Conflict = { key: p.key, kind: p.kind, id: p.id, local: localData, server: serverData, at: Date.now() };
    await db.saveConflict(c);
    report.conflicts++;
  } else {
    report.serverWins++;
  }
  // The server version becomes the record; for text, this device's version waits in the conflict list.
  const data = server.deleted ? null : cleanRecord(server.kind, server.data);
  if (!server.deleted && data == null) {
    await db.ack(p.key, p.opId, server.version); // invalid server data is never stored; adopt its version only
    return;
  }
  await db.applyRemote([{ ...server, data }], force);
}

// ---------- scheduling ----------

export type SyncStatus = 'synced' | 'syncing' | 'pending' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  pending: number;
  conflicts: number;
  lastSync: number | null;
  error: string | null;
}

/**
 * Runs syncOnce on start, after local writes (debounced), when the device comes online or the app becomes
 * visible, and periodically while visible. Failures retry with exponential backoff; nothing is dropped.
 */
export class SyncManager {
  state: SyncState = { status: 'pending', pending: 0, conflicts: 0, lastSync: null, error: null };
  private listeners = new Set<(s: SyncState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private stopped = false;
  private cleanup: (() => void)[] = [];

  constructor(private db: StillDb, private remote: Remote, private onPulled: () => void) {}

  subscribe(fn: (s: SyncState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => void this.listeners.delete(fn);
  }

  private set(p: Partial<SyncState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l(this.state));
  }

  start() {
    const now = () => this.schedule(0);
    const visible = () => document.visibilityState === 'visible' && now();
    const offline = () => this.set({ status: 'offline' });
    window.addEventListener('online', now);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    const iv = setInterval(() => document.visibilityState === 'visible' && this.schedule(0), 30_000);
    this.cleanup.push(() => {
      window.removeEventListener('online', now);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
      clearInterval(iv);
    });
    this.db.onWrite = () => {
      void this.refreshCounts();
      this.schedule(1200);
    };
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.cleanup.forEach((f) => f());
    this.db.onWrite = null;
    this.listeners.clear();
  }

  schedule(delay: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  private async refreshCounts() {
    const [pending, conflicts] = await Promise.all([this.db.pendingCount(), this.db.conflicts().then((c) => c.length)]);
    if (!this.stopped) this.set({ pending, conflicts, status: this.state.status === 'synced' && pending ? 'pending' : this.state.status });
  }

  async run(): Promise<void> {
    if (this.running) {
      this.again = true; // a write arrived during a sync: run once more afterwards
      return this.running;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await this.refreshCounts();
      this.set({ status: 'offline' });
      return;
    }
    this.set({ status: 'syncing' });
    this.running = (async () => {
      try {
        const r = await syncOnce(this.db, this.remote);
        this.failures = 0;
        if (r.pulled || r.conflicts || r.serverWins) this.onPulled();
        await this.refreshCounts();
        this.set({ status: this.state.pending ? 'pending' : 'synced', lastSync: Date.now(), error: null });
      } catch (e) {
        this.failures++;
        await this.refreshCounts().catch(() => {});
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        this.set({ status: offline ? 'offline' : 'error', error: e instanceof Error ? e.message : String(e) });
        this.schedule(Math.min(60_000, 2000 * 2 ** (this.failures - 1)));
      } finally {
        this.running = null;
      }
    })();
    await this.running;
    if (this.again) {
      this.again = false;
      return this.run();
    }
  }
}
