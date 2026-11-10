import { accountDbName, LOCAL_DB } from './db';

// Pure authentication state handling (Supabase Auth events → app state). Kept free of React and network
// code so account switching can be tested directly.

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthState =
  | { status: 'disabled' } // no backend configured: local-only use
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser; recovery: boolean };

export type AuthEventType = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY';

export function authReducer(state: AuthState, event: { type: AuthEventType; user: AuthUser | null }): AuthState {
  if (state.status === 'disabled') return state;
  if (!event.user) return { status: 'signedOut' };
  const same = state.status === 'signedIn' && state.user.id === event.user.id;
  // Recovery (password reset link) lasts until the new password is saved; a different user never inherits it.
  const recovery = event.type === 'PASSWORD_RECOVERY' ? true : event.type === 'USER_UPDATED' ? false : same && state.recovery;
  if (same && state.user.email === event.user.email && state.recovery === recovery) return state; // e.g. token refresh: no re-render, no remount
  return { status: 'signedIn', user: event.user, recovery };
}

/** IndexedDB partition for the current state. Signed out → the local-only database. */
export function partitionFor(state: AuthState): { name: string; sync: boolean; userId: string | null } {
  return state.status === 'signedIn' ? { name: accountDbName(state.user.id), sync: true, userId: state.user.id } : { name: LOCAL_DB, sync: false, userId: null };
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
export const MIN_PASSWORD = 8;

export function credentialErrors(email: string, password: string | null, confirm?: string): Partial<Record<'email' | 'password' | 'confirm', string>> {
  const e: Partial<Record<'email' | 'password' | 'confirm', string>> = {};
  if (!email.trim()) e.email = 'Bitte deine E-Mail-Adresse eingeben.';
  else if (!isEmail(email)) e.email = 'Diese E-Mail-Adresse sieht ungültig aus.';
  if (password !== null) {
    if (!password) e.password = 'Bitte ein Passwort eingeben.';
    else if (password.length < MIN_PASSWORD) e.password = `Mindestens ${MIN_PASSWORD} Zeichen.`;
    if (confirm !== undefined && confirm !== password) e.confirm = 'Die Passwörter stimmen nicht überein.';
  }
  return e;
}

/** Supabase Auth errors in plain German. */
export function authErrorText(err: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = err?.code ?? '';
  const msg = err?.message ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort ist falsch.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Bitte bestätige zuerst deine E-Mail-Adresse über den Link in deinem Postfach.';
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'Für diese E-Mail-Adresse gibt es bereits ein Konto.';
  if (code === 'weak_password' || /password should/i.test(msg)) return `Das Passwort ist zu schwach. Verwende mindestens ${MIN_PASSWORD} Zeichen.`;
  if (code.startsWith('over_') || err?.status === 429) return 'Zu viele Versuche. Bitte warte einen Moment.';
  if (code === 'same_password') return 'Das neue Passwort muss sich vom alten unterscheiden.';
  if (/fetch|network|load failed/i.test(msg)) return 'Keine Verbindung zum Server. Prüfe deine Internetverbindung.';
  return msg ? `Etwas ist schiefgelaufen: ${msg}` : 'Etwas ist schiefgelaufen. Bitte versuche es erneut.';
}
