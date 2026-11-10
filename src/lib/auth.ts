import { de, type Messages } from '../i18n/messages';
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

/**
 * Whether an auth event is an explicit sign-in that should show the post-login welcome (besides a successful
 * password sign-in, which is handled where it happens). Only the first session from an email sign-in link opened in
 * this page load counts. Restored sessions, token refreshes, user updates and focus-triggered SIGNED_IN events don't.
 */
export function welcomeOnAuthEvent(type: AuthEventType, fromSignInLink: boolean, alreadyHandled: boolean): boolean {
  return fromSignInLink && !alreadyHandled && (type === 'SIGNED_IN' || type === 'INITIAL_SESSION');
}

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

export function credentialErrors(email: string, password: string | null, confirm?: string, m: Messages = de): Partial<Record<'email' | 'password' | 'confirm', string>> {
  const t = m.auth;
  const e: Partial<Record<'email' | 'password' | 'confirm', string>> = {};
  if (!email.trim()) e.email = t.errEmail;
  else if (!isEmail(email)) e.email = t.errEmailInvalid;
  if (password !== null) {
    if (!password) e.password = t.errPassword;
    else if (password.length < MIN_PASSWORD) e.password = t.errPasswordShort(MIN_PASSWORD);
    if (confirm !== undefined && confirm !== password) e.confirm = t.errConfirm;
  }
  return e;
}

export const isUnconfirmedError = (err: { code?: string; message?: string } | null | undefined) =>
  err?.code === 'email_not_confirmed' || /email not confirmed/i.test(err?.message ?? '');

/** Supabase Auth errors in plain language. */
export function authErrorText(err: { code?: string; message?: string; status?: number } | null | undefined, m: Messages = de): string {
  const t = m.auth;
  const code = err?.code ?? '';
  const msg = err?.message ?? '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return t.errInvalid;
  if (isUnconfirmedError(err)) return t.errUnconfirmed;
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return t.errExists;
  if (code === 'weak_password' || /password should/i.test(msg)) return t.errWeak(MIN_PASSWORD);
  if (code.startsWith('over_') || err?.status === 429) return t.errRate;
  if (code === 'same_password') return t.errSame;
  if (/fetch|network|load failed/i.test(msg)) return t.errNetwork;
  return t.errGeneric(msg);
}
