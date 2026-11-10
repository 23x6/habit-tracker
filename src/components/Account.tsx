import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useI18n, useT, type Lang } from '../i18n';
import { planImport, type ImportPlan } from '../lib/accountImport';
import { credentialErrors, MIN_PASSWORD } from '../lib/auth';
import { accountDbName, LOCAL_DB, StillDb, type Conflict } from '../lib/db';
import { formatRange } from '../lib/date';
import type { Analysis, JournalEntry, Review } from '../lib/model';
import { useStore } from '../store';
import { Confirm, Icon, Segmented, Sheet } from './ui';

type AuthMode = null | 'login' | 'register' | 'forgot';

// ---------- save / sync status ----------

/**
 * Honest save status: "saving" only while the local transaction runs; afterwards "saved locally" until the
 * server has confirmed (account mode), then "synced". A failed local write shows an error with retry.
 */
export function SaveStatus() {
  const t = useT();
  const { sync, conflicts, saving, saveError } = useStore();
  let text: string;
  let tone = 'ok';
  if (saveError) {
    text = t.save.saveFailed;
    tone = 'warn';
  } else if (saving) text = t.save.saving;
  else if (!sync) text = t.save.savedLocal;
  else if (conflicts.length) {
    text = t.save.conflicts(conflicts.length);
    tone = 'warn';
  } else
    text = {
      synced: t.save.synced,
      syncing: t.save.syncing,
      pending: t.save.pending,
      offline: t.save.pendingOffline,
      error: t.save.syncError,
    }[sync.status];
  const state = saveError ? 'error' : saving ? 'saving' : !sync ? 'local' : sync.status;
  return (
    <span className="save-status">
      <span className={`sync-badge ${tone === 'warn' ? 'warn' : state}`} role="status" aria-live="polite" title={saveError?.message ?? sync?.error ?? undefined}>
        <span className="sync-dot" aria-hidden="true" />
        {text}
      </span>
      {saveError && (
        <button className="btn small" onClick={saveError.retry}>
          {t.save.retrySave}
        </button>
      )}
    </span>
  );
}

// ---------- header utilities (≥ 768 px) ----------

export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <Segmented<Lang>
      label={t.lang.name}
      value={lang}
      onChange={setLang}
      options={compact ? [{ value: 'de', label: 'DE' }, { value: 'en', label: 'EN' }] : [{ value: 'de', label: t.lang.de }, { value: 'en', label: t.lang.en }]}
    />
  );
}

/** Log in / Log out beside the language switch; reuses the same sheets as Settings. */
export function HeaderAccountButton() {
  const t = useT();
  const { state } = useAuth();
  const store = useStore();
  const [auth, setAuth] = useState<AuthMode>(null);
  const [logout, setLogout] = useState(false);
  if (state.status === 'disabled') return null;
  if (state.status === 'loading')
    return (
      <button className="btn small hdr-account" disabled aria-busy="true" aria-label={t.account.authLoading}>
        <span className="spinner tiny" aria-hidden="true" />
      </button>
    );
  return (
    <>
      {state.status === 'signedIn' ? (
        <button className="btn small hdr-account" onClick={() => setLogout(true)}>{t.account.logout}</button>
      ) : (
        <button className="btn small hdr-account" onClick={() => setAuth('login')}>{t.account.login}</button>
      )}
      <AuthSheet mode={auth} onMode={setAuth} />
      {state.status === 'signedIn' && <LogoutSheet open={logout} onClose={() => setLogout(false)} userId={state.user.id} pending={store.sync?.pending ?? 0} />}
    </>
  );
}

// ---------- account section (Settings) ----------

export function AccountSection() {
  const t = useT();
  const { state } = useAuth();
  const store = useStore();
  const [auth, setAuth] = useState<AuthMode>(null);
  const [logout, setLogout] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const plan = useLocalImportPlan(state.status === 'signedIn' ? state.user.id : null);

  if (state.status === 'disabled')
    return (
      <section className="card" aria-labelledby="acc-h">
        <h2 id="acc-h">{t.account.title}</h2>
        <p className="muted small">{t.account.disabled}</p>
      </section>
    );

  if (state.status !== 'signedIn')
    return (
      <section className="card" aria-labelledby="acc-h">
        <h2 id="acc-h">{t.account.title}</h2>
        <p className="mode-line"><Icon name="info" size={16} /> {t.account.localMode}</p>
        <p className="muted small">{t.account.localInfo}</p>
        <div className="btn-row">
          <button className="btn primary" onClick={() => setAuth('login')}>{t.account.login}</button>
          <button className="btn" onClick={() => setAuth('register')}>{t.account.register}</button>
        </div>
        <AuthSheet mode={auth} onMode={setAuth} />
      </section>
    );

  return (
    <section className="card" aria-labelledby="acc-h">
      <h2 id="acc-h">{t.account.title}</h2>
      <p className="mode-line"><Icon name="check" size={16} /> {t.account.signedInAs} <strong className="email">{state.user.email}</strong></p>
      <div className="sync-row">
        <SaveStatus />
        <button className="btn small" onClick={store.syncNow} disabled={store.sync?.status === 'syncing'}>{t.account.syncNow}</button>
      </div>
      <p className="muted small">{t.account.syncNowHint}</p>
      {!!store.sync?.pending && <p className="muted small">{t.account.waiting(store.sync.pending)}</p>}
      {store.sync?.status === 'error' && <p className="muted small">{t.account.serverDown}</p>}
      {store.conflicts.length > 0 && (
        <button className="btn wide" onClick={() => setConflictsOpen(true)}>
          <Icon name="info" size={18} /> {t.account.resolveConflicts(store.conflicts.length)}
        </button>
      )}
      {plan && plan.ops.length > 0 && (
        <button className="btn wide" onClick={() => setImportOpen(true)}>
          <Icon name="restore" size={18} /> {t.account.importLocal}
        </button>
      )}
      <button className="btn wide" onClick={() => setLogout(true)}>{t.account.logout}</button>
      <ConflictSheet open={conflictsOpen} onClose={() => setConflictsOpen(false)} />
      {plan && <LocalImportSheet open={importOpen} plan={plan} userId={state.user.id} onClose={() => setImportOpen(false)} />}
      <LogoutSheet open={logout} onClose={() => setLogout(false)} userId={state.user.id} pending={store.sync?.pending ?? 0} />
    </section>
  );
}

// ---------- sign in / register / forgot ----------

export function AuthSheet({ mode, onMode }: { mode: AuthMode; onMode: (m: AuthMode) => void }) {
  const t = useT();
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

  const errs = credentialErrors(email, mode === 'forgot' ? null : password, mode === 'register' ? confirm : undefined, t);
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
      setUnconfirmed(!!r.unconfirmed);
    } else if (r.message) setInfo(r.message);
    else onMode(null); // signed in: the app switches to the account
  };

  const title = mode === 'register' ? t.account.register : mode === 'forgot' ? t.auth.forgot : t.account.login;
  const action = mode === 'register' ? t.auth.createAccount : mode === 'forgot' ? t.auth.sendLink : t.account.login;
  const fieldErr = (k: 'email' | 'password' | 'confirm') => touched && errs[k] && <p className="field-error" role="alert">{errs[k]}</p>;

  return (
    <Sheet
      open={!!mode}
      onClose={() => onMode(null)}
      title={title}
      footer={
        <>
          <button className="btn" onClick={() => onMode(null)}>{t.common.cancel}</button>
          <button className="btn primary" onClick={submit} disabled={busy} aria-busy={busy}>{busy ? t.common.pleaseWait : action}</button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())} noValidate>
        <label className="field">
          <span>{t.auth.email}</span>
          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={touched && !!errs.email} />
          {fieldErr('email')}
        </label>
        {mode !== 'forgot' && (
          <label className="field">
            <span>{t.auth.password}</span>
            <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={touched && !!errs.password} />
            {mode === 'register' && <p className="muted small">{t.auth.minChars(MIN_PASSWORD)}</p>}
            {fieldErr('password')}
          </label>
        )}
        {mode === 'register' && (
          <label className="field">
            <span>{t.auth.repeat}</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={touched && !!errs.confirm} />
            {fieldErr('confirm')}
          </label>
        )}
        {mode === 'forgot' && <p className="muted small">{t.auth.forgotInfo}</p>}
        {mode === 'register' && <p className="muted small">{t.auth.registerInfo}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {info && <p className="form-info" role="status">{info}</p>}
        {unconfirmed && (
          <button type="button" className="link-btn left" onClick={async () => { const r = await auth.resendConfirmation(email); r.ok ? setInfo(r.message ?? null) : setError(r.error); }}>
            {t.auth.resend}
          </button>
        )}
        <div className="auth-links">
          {mode === 'login' && <button type="button" className="link-btn left" onClick={() => onMode('forgot')}>{t.auth.forgotQ}</button>}
          {mode === 'login' && <button type="button" className="link-btn left" onClick={() => onMode('register')}>{t.auth.noAccount}</button>}
          {mode !== 'login' && <button type="button" className="link-btn left" onClick={() => onMode('login')}>{t.auth.toLogin}</button>}
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** Shown after following a password-reset link (Supabase PASSWORD_RECOVERY). */
export function RecoverySheet() {
  const t = useT();
  const auth = useAuth();
  const open = auth.state.status === 'signedIn' && auth.state.recovery;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errs = credentialErrors('x@x.de', password, confirm, t);
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
      title={t.auth.newPassword}
      footer={<button className="btn primary" onClick={submit} disabled={busy}>{busy ? t.common.pleaseWait : t.auth.savePassword}</button>}
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())} noValidate>
        <label className="field">
          <span>{t.auth.newPasswordField}</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={touched && !!errs.password} />
          {touched && errs.password && <p className="field-error" role="alert">{errs.password}</p>}
        </label>
        <label className="field">
          <span>{t.auth.repeat}</span>
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

export function LogoutSheet({ open, onClose, userId, pending }: { open: boolean; onClose: () => void; userId: string; pending: number }) {
  const t = useT();
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
      title={t.account.logout}
      footer={<><button className="btn" onClick={onClose}>{t.common.cancel}</button><button className="btn primary" onClick={go} disabled={busy}>{busy ? t.common.pleaseWait : t.account.logout}</button></>}
    >
      <p className="muted">{t.auth.logoutInfo}</p>
      <label className="switch-row">
        <span>{t.auth.removeCopy}</span>
        <input type="checkbox" role="switch" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
      </label>
      <p className="muted small">{t.auth.removeCopyInfo}</p>
      {pending > 0 && remove && <p className="form-error" role="alert">{t.auth.pendingLost(pending)}</p>}
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
  const t = useT();
  const { applyOps } = useStore();
  const [busy, setBusy] = useState(false);
  const rows: [string, number][] = [
    [t.importLocal.rows.habits, plan.habits],
    [t.importLocal.rows.entries, plan.entries],
    [t.importLocal.rows.completions, plan.completions],
    [t.importLocal.rows.analyses, plan.analyses],
    [t.importLocal.rows.journal, plan.journal],
    [t.importLocal.rows.reviews, plan.reviews],
  ];
  const go = async () => {
    setBusy(true);
    try {
      await applyOps(plan.ops, t.toast.localImported);
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
      title={t.importLocal.title}
      footer={<><button className="btn" onClick={onClose}>{t.importLocal.notNow}</button><button className="btn primary" onClick={go} disabled={busy || !plan.ops.length}>{busy ? t.common.pleaseWait : t.importLocal.accept}</button></>}
    >
      <p className="muted">{t.importLocal.intro}</p>
      <ul className="preview-list">
        {rows.map(([label, n]) => <li key={label}><span>{label}</span><strong>{n}</strong></li>)}
      </ul>
      {plan.merged.length > 0 && <p className="muted small">{t.importLocal.merged(plan.merged.join(', '))}</p>}
      {plan.skipped > 0 && <p className="muted small">{t.importLocal.skipped(plan.skipped)}</p>}
      <p className="muted small">{t.importLocal.keepsLocal}</p>
    </Sheet>
  );
}

// ---------- conflicts ----------

function ConflictSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { conflicts, resolveConflict } = useStore();
  const [confirm, setConfirm] = useState<{ c: Conflict; keep: 'local' | 'server' } | null>(null);
  useEffect(() => {
    if (open && !conflicts.length) onClose();
  }, [open, conflicts.length, onClose]);
  const textOf = (kind: Conflict['kind'], rec: unknown | null): { title: string; body: string } | null => {
    if (!rec) return null;
    if (kind === 'journal') {
      const j = rec as JournalEntry;
      return { title: j.title || j.date, body: [j.notes, j.learned && t.conflict.learned(j.learned)].filter(Boolean).join('\n\n') };
    }
    if (kind === 'review') {
      const r = rec as Review;
      const p = t.review.prompts;
      return { title: formatRange(r.weekStart, r.weekEnd), body: ([['wentWell', r.wentWell], ['heldBack', r.heldBack], ['nextWeek', r.nextWeek]] as const).filter(([, v]) => v).map(([k, v]) => `${p[k]}\n${v}`).join('\n\n') };
    }
    const a = rec as Analysis;
    return { title: a.title, body: a.learnings };
  };
  const Version = ({ label, kind, rec }: { label: string; kind: Conflict['kind']; rec: unknown | null }) => {
    const v = textOf(kind, rec);
    return (
      <div className="conflict-version">
        <span className="muted small">{label}</span>
        {v ? <><strong>{v.title}</strong><p className="entry-text">{v.body}</p></> : <p className="muted">{t.common.deleted}</p>}
      </div>
    );
  };
  return (
    <>
      <Sheet open={open} onClose={onClose} title={t.conflict.title}>
        <p className="muted small">{t.conflict.intro}</p>
        <ul className="plain-list conflict-list">
          {conflicts.map((c) => (
            <li key={c.key} className="card">
              <span className="muted small">{c.kind === 'journal' ? t.conflict.journal : c.kind === 'review' ? t.conflict.review : t.conflict.analysis}</span>
              <Version label={t.conflict.here} kind={c.kind} rec={c.local} />
              <Version label={t.conflict.other} kind={c.kind} rec={c.server} />
              <div className="btn-row">
                <button className="btn" onClick={() => setConfirm({ c, keep: 'server' })}>{t.conflict.keepOther}</button>
                <button className="btn primary" onClick={() => setConfirm({ c, keep: 'local' })}>{t.conflict.keepThis}</button>
              </div>
            </li>
          ))}
        </ul>
      </Sheet>
      <Confirm
        open={!!confirm}
        title={t.conflict.confirmTitle}
        text={confirm?.keep === 'local' ? t.conflict.confirmLocal : t.conflict.confirmServer}
        action={t.conflict.accept}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void resolveConflict(confirm.c, confirm.keep)}
      />
    </>
  );
}
