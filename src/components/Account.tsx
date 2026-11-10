import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { planImport, type ImportPlan } from '../lib/accountImport';
import { credentialErrors, MIN_PASSWORD } from '../lib/auth';
import { accountDbName, LOCAL_DB, StillDb, type Conflict } from '../lib/db';
import type { Analysis, JournalEntry } from '../lib/model';
import type { SyncState } from '../lib/sync';
import { useStore } from '../store';
import { Confirm, Icon, Sheet } from './ui';

// ---------- sync status ----------

const SYNC_TEXT: Record<SyncState['status'], string> = {
  synced: 'Synchronisiert',
  syncing: 'Synchronisiere …',
  pending: 'Synchronisierung ausstehend',
  offline: 'Offline',
  error: 'Synchronisierung ausstehend',
};

/** Discreet sync state; nothing in local-only mode. */
export function SyncBadge() {
  const { sync, conflicts } = useStore();
  if (!sync) return null;
  const text = conflicts.length ? `${conflicts.length} Konflikt${conflicts.length === 1 ? '' : 'e'}` : SYNC_TEXT[sync.status];
  return (
    <span className={'sync-badge ' + (conflicts.length ? 'warn' : sync.status)} role="status" aria-live="polite" title={sync.error ?? undefined}>
      <span className="sync-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

// ---------- account section (Settings) ----------

export function AccountSection() {
  const { state } = useAuth();
  const store = useStore();
  const [auth, setAuth] = useState<null | 'login' | 'register' | 'forgot'>(null);
  const [logout, setLogout] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const plan = useLocalImportPlan(state.status === 'signedIn' ? state.user.id : null);

  if (state.status === 'disabled')
    return (
      <section className="card" aria-labelledby="acc-h">
        <h2 id="acc-h">Konto</h2>
        <p className="muted small">Lokaler Modus. Konten und Synchronisierung sind in dieser Installation nicht eingerichtet; deine Daten bleiben auf diesem Gerät.</p>
      </section>
    );

  if (state.status !== 'signedIn')
    return (
      <section className="card" aria-labelledby="acc-h">
        <h2 id="acc-h">Konto</h2>
        <p className="mode-line"><Icon name="info" size={16} /> Lokaler Modus · Daten nur auf diesem Gerät</p>
        <p className="muted small">Mit einem Konto siehst du deinen Fortschritt auf allen Geräten. Deine lokalen Daten bleiben erhalten; du entscheidest nach der Anmeldung, ob du sie übernimmst.</p>
        <div className="btn-row">
          <button className="btn primary" onClick={() => setAuth('login')}>Anmelden</button>
          <button className="btn" onClick={() => setAuth('register')}>Registrieren</button>
        </div>
        <AuthSheet mode={auth} onMode={setAuth} />
      </section>
    );

  return (
    <section className="card" aria-labelledby="acc-h">
      <h2 id="acc-h">Konto</h2>
      <p className="mode-line"><Icon name="check" size={16} /> Angemeldet als <strong className="email">{state.user.email}</strong></p>
      <div className="sync-row">
        <SyncBadge />
        <button className="btn small" onClick={store.syncNow} disabled={store.sync?.status === 'syncing'}>Jetzt synchronisieren</button>
      </div>
      {!!store.sync?.pending && <p className="muted small">{store.sync.pending} Änderung{store.sync.pending === 1 ? '' : 'en'} warten auf Übertragung.</p>}
      {store.sync?.status === 'error' && <p className="muted small">Server nicht erreichbar. Änderungen bleiben gespeichert und werden automatisch erneut gesendet.</p>}
      {store.conflicts.length > 0 && (
        <button className="btn wide" onClick={() => setConflictsOpen(true)}>
          <Icon name="info" size={18} /> {store.conflicts.length} Konflikt{store.conflicts.length === 1 ? '' : 'e'} lösen …
        </button>
      )}
      {plan && plan.ops.length > 0 && (
        <button className="btn wide" onClick={() => setImportOpen(true)}>
          <Icon name="restore" size={18} /> Lokale Daten in dieses Konto übernehmen …
        </button>
      )}
      <button className="btn wide" onClick={() => setLogout(true)}>Abmelden</button>
      <ConflictSheet open={conflictsOpen} onClose={() => setConflictsOpen(false)} />
      {plan && <LocalImportSheet open={importOpen} plan={plan} userId={state.user.id} onClose={() => setImportOpen(false)} />}
      <LogoutSheet open={logout} onClose={() => setLogout(false)} userId={state.user.id} pending={store.sync?.pending ?? 0} />
    </section>
  );
}

// ---------- sign in / register / forgot ----------

function AuthSheet({ mode, onMode }: { mode: null | 'login' | 'register' | 'forgot'; onMode: (m: null | 'login' | 'register' | 'forgot') => void }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  useEffect(() => {
    setTouched(false);
    setError(null);
    setInfo(null);
    setUnconfirmed(false);
    setPassword('');
    setConfirm('');
  }, [mode]);

  const errs = credentialErrors(email, mode === 'forgot' ? null : password, mode === 'register' ? confirm : undefined);
  const submit = async () => {
    setTouched(true);
    if (Object.keys(errs).length || busy || !mode) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const r = mode === 'login' ? await auth.signIn(email, password) : mode === 'register' ? await auth.signUp(email, password) : await auth.sendReset(email);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setUnconfirmed(/bestätige/i.test(r.error));
    } else if (r.message) setInfo(r.message);
    else onMode(null); // signed in: the app switches to the account
  };

  const title = mode === 'register' ? 'Registrieren' : mode === 'forgot' ? 'Passwort vergessen' : 'Anmelden';
  const action = mode === 'register' ? 'Konto erstellen' : mode === 'forgot' ? 'Link senden' : 'Anmelden';
  const fieldErr = (k: 'email' | 'password' | 'confirm') => touched && errs[k] && <p className="field-error" role="alert">{errs[k]}</p>;

  return (
    <Sheet
      open={!!mode}
      onClose={() => onMode(null)}
      title={title}
      footer={
        <>
          <button className="btn" onClick={() => onMode(null)}>Abbrechen</button>
          <button className="btn primary" onClick={submit} disabled={busy} aria-busy={busy}>{busy ? 'Bitte warten …' : action}</button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())} noValidate>
        <label className="field">
          <span>E-Mail-Adresse</span>
          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={touched && !!errs.email} />
          {fieldErr('email')}
        </label>
        {mode !== 'forgot' && (
          <label className="field">
            <span>Passwort</span>
            <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={touched && !!errs.password} />
            {mode === 'register' && <p className="muted small">Mindestens {MIN_PASSWORD} Zeichen.</p>}
            {fieldErr('password')}
          </label>
        )}
        {mode === 'register' && (
          <label className="field">
            <span>Passwort wiederholen</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={touched && !!errs.confirm} />
            {fieldErr('confirm')}
          </label>
        )}
        {mode === 'forgot' && <p className="muted small">Du bekommst einen Link, mit dem du ein neues Passwort festlegst.</p>}
        {mode === 'register' && <p className="muted small">Nach der Registrierung bestätigst du deine E-Mail-Adresse über einen Link. Lokale Daten werden nicht automatisch hochgeladen.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {info && <p className="form-info" role="status">{info}</p>}
        {unconfirmed && (
          <button type="button" className="link-btn left" onClick={async () => { const r = await auth.resendConfirmation(email); r.ok ? setInfo(r.message ?? null) : setError(r.error); }}>
            Bestätigungs-E-Mail erneut senden
          </button>
        )}
        <div className="auth-links">
          {mode === 'login' && <button type="button" className="link-btn left" onClick={() => onMode('forgot')}>Passwort vergessen?</button>}
          {mode === 'login' && <button type="button" className="link-btn left" onClick={() => onMode('register')}>Noch kein Konto? Registrieren</button>}
          {mode !== 'login' && <button type="button" className="link-btn left" onClick={() => onMode('login')}>Zur Anmeldung</button>}
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** Shown after following a password-reset link (Supabase PASSWORD_RECOVERY). */
export function RecoverySheet() {
  const auth = useAuth();
  const open = auth.state.status === 'signedIn' && auth.state.recovery;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errs = credentialErrors('x@x.de', password, confirm);
  const submit = async () => {
    setTouched(true);
    if (Object.keys(errs).length || busy) return;
    setBusy(true);
    const r = await auth.updatePassword(password);
    setBusy(false);
    if (!r.ok) setError(r.error);
  };
  return (
    <Sheet
      open={open}
      onClose={() => {}}
      title="Neues Passwort festlegen"
      footer={<button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Bitte warten …' : 'Passwort speichern'}</button>}
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())} noValidate>
        <label className="field">
          <span>Neues Passwort</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={touched && !!errs.password} />
          {touched && errs.password && <p className="field-error" role="alert">{errs.password}</p>}
        </label>
        <label className="field">
          <span>Passwort wiederholen</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={touched && !!errs.confirm} />
          {touched && errs.confirm && <p className="field-error" role="alert">{errs.confirm}</p>}
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

// ---------- logout ----------

function LogoutSheet({ open, onClose, userId, pending }: { open: boolean; onClose: () => void; userId: string; pending: number }) {
  const auth = useAuth();
  const [remove, setRemove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setRemove(pending === 0); // never suggest dropping unsent changes
      setError(null);
    }
  }, [open, pending]);
  const go = async () => {
    setBusy(true);
    const r = await auth.signOut();
    setBusy(false);
    if (!r.ok) return setError(r.error);
    // The account's provider unmounts on sign-out; its connection closes and the cache can be removed.
    if (remove) void new StillDb(accountDbName(userId), true).destroy().catch(() => {});
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Abmelden"
      footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" onClick={go} disabled={busy}>{busy ? 'Bitte warten …' : 'Abmelden'}</button></>}
    >
      <p className="muted">Nach dem Abmelden siehst du wieder deine lokalen Daten. Die Daten deines Kontos bleiben im Konto erhalten.</p>
      <label className="switch-row">
        <span>Kopie dieses Kontos von diesem Gerät entfernen</span>
        <input type="checkbox" role="switch" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
      </label>
      <p className="muted small">Empfohlen auf geteilten Geräten. Ohne Kopie ist das Konto hier erst nach erneuter Anmeldung und Synchronisierung wieder verfügbar.</p>
      {pending > 0 && remove && <p className="form-error" role="alert">{pending} Änderung{pending === 1 ? '' : 'en'} sind noch nicht übertragen und gingen verloren.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Sheet>
  );
}

// ---------- local data → account ----------

/** Plans importing this device's local-only data into the account; null while loading or when not applicable. */
function useLocalImportPlan(userId: string | null): ImportPlan | null {
  const { snapshot, partition } = useStore();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  useEffect(() => {
    if (!userId || !partition.sync) return setPlan(null);
    let alive = true;
    const local = new StillDb(LOCAL_DB, false);
    (async () => {
      const done = await local.getMeta<Record<string, number>>('importedTo');
      const p = planImport(await local.loadAll(), snapshot);
      if (alive) setPlan(done?.[userId] && !p.ops.length ? null : p);
    })()
      .catch(() => alive && setPlan(null))
      .finally(() => void local.close());
    return () => {
      alive = false;
    };
  }, [userId, partition.sync, snapshot]);
  return plan;
}

function LocalImportSheet({ open, plan, userId, onClose }: { open: boolean; plan: ImportPlan; userId: string; onClose: () => void }) {
  const { applyOps } = useStore();
  const [busy, setBusy] = useState(false);
  const rows: [string, number][] = [
    ['Gewohnheiten', plan.habits],
    ['Tageseinträge', plan.entries],
    ['Wöchentliche Erledigungen', plan.completions],
    ['Substack-Analysen', plan.analyses],
    ['Journal-Einträge', plan.journal],
  ];
  const go = async () => {
    setBusy(true);
    try {
      await applyOps(plan.ops, 'Lokale Daten übernommen');
      const local = new StillDb(LOCAL_DB, false);
      const done = (await local.getMeta<Record<string, number>>('importedTo')) ?? {};
      await local.setMeta('importedTo', { ...done, [userId]: Date.now() });
      await local.close();
      onClose();
    } catch {
      /* toast shown by the store */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Lokale Daten übernehmen"
      footer={<><button className="btn" onClick={onClose}>Nicht jetzt</button><button className="btn primary" onClick={go} disabled={busy || !plan.ops.length}>{busy ? 'Bitte warten …' : 'Übernehmen'}</button></>}
    >
      <p className="muted">Diese Daten von diesem Gerät werden einmalig in dein Konto kopiert und danach synchronisiert:</p>
      <ul className="preview-list">
        {rows.map(([label, n]) => <li key={label}><span>{label}</span><strong>{n}</strong></li>)}
      </ul>
      {plan.merged.length > 0 && <p className="muted small">Zusammengeführt mit gleichnamigen Gewohnheiten im Konto: {plan.merged.join(', ')}. Bereits erfasste Tage im Konto bleiben unverändert.</p>}
      {plan.skipped > 0 && <p className="muted small">{plan.skipped} Einträge sind bereits im Konto und werden übersprungen.</p>}
      <p className="muted small">Die lokalen Daten auf diesem Gerät bleiben unverändert erhalten. Einstellungen werden nicht übernommen.</p>
    </Sheet>
  );
}

// ---------- conflicts ----------

function textOf(kind: Conflict['kind'], rec: unknown | null): { title: string; body: string } | null {
  if (!rec) return null;
  if (kind === 'journal') {
    const j = rec as JournalEntry;
    return { title: j.title || j.date, body: [j.notes, j.learned && `Gelernt: ${j.learned}`].filter(Boolean).join('\n\n') };
  }
  const a = rec as Analysis;
  return { title: a.title, body: a.learnings };
}

function ConflictSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { conflicts, resolveConflict } = useStore();
  const [confirm, setConfirm] = useState<{ c: Conflict; keep: 'local' | 'server' } | null>(null);
  useEffect(() => {
    if (open && !conflicts.length) onClose();
  }, [open, conflicts.length, onClose]);
  const Version = ({ label, kind, rec }: { label: string; kind: Conflict['kind']; rec: unknown | null }) => {
    const t = textOf(kind, rec);
    return (
      <div className="conflict-version">
        <span className="muted small">{label}</span>
        {t ? <><strong>{t.title}</strong><p className="entry-text">{t.body}</p></> : <p className="muted">Gelöscht</p>}
      </div>
    );
  };
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Konflikte lösen">
        <p className="muted small">Dieser Text wurde auf zwei Geräten unterschiedlich geändert. Nichts wurde verworfen – wähle, welche Version gelten soll.</p>
        <ul className="plain-list conflict-list">
          {conflicts.map((c) => (
            <li key={c.key} className="card">
              <span className="muted small">{c.kind === 'journal' ? 'Journal-Eintrag' : 'Substack-Analyse'}</span>
              <Version label="Auf diesem Gerät" kind={c.kind} rec={c.local} />
              <Version label="Vom anderen Gerät (aktuell gespeichert)" kind={c.kind} rec={c.server} />
              <div className="btn-row">
                <button className="btn" onClick={() => setConfirm({ c, keep: 'server' })}>Andere behalten</button>
                <button className="btn primary" onClick={() => setConfirm({ c, keep: 'local' })}>Diese behalten</button>
              </div>
            </li>
          ))}
        </ul>
      </Sheet>
      <Confirm
        open={!!confirm}
        title="Version übernehmen?"
        text={confirm?.keep === 'local' ? 'Die Version dieses Geräts ersetzt die andere auf allen Geräten.' : 'Die Version dieses Geräts wird verworfen.'}
        action="Übernehmen"
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void resolveConflict(confirm.c, confirm.keep)}
      />
    </>
  );
}
