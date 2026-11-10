import type { AuthError, Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { authErrorText, authReducer, type AuthEventType, type AuthState } from './lib/auth';
import { supabase } from './lib/remote';

type Result = { ok: true; message?: string } | { ok: false; error: string };

interface Auth {
  state: AuthState;
  signIn(email: string, password: string): Promise<Result>;
  signUp(email: string, password: string): Promise<Result>;
  signOut(): Promise<Result>;
  sendReset(email: string): Promise<Result>;
  updatePassword(password: string): Promise<Result>;
  resendConfirmation(email: string): Promise<Result>;
}

const Ctx = createContext<Auth | null>(null);
export const useAuth = () => {
  const a = useContext(Ctx);
  if (!a) throw new Error('AuthProvider missing');
  return a;
};

const userOf = (s: Session | null) => (s?.user ? { id: s.user.id, email: s.user.email ?? '' } : null);
const fail = (e: AuthError | Error | null): Result => ({ ok: false, error: authErrorText(e as AuthError) });
// Links in confirmation and reset emails lead back to this app (same origin and path).
const redirectTo = () => location.origin + location.pathname;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, supabase ? { status: 'loading' } : { status: 'disabled' });

  useEffect(() => {
    if (!supabase) return;
    // INITIAL_SESSION arrives first (restored session, or a confirmation / recovery link in the URL).
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      dispatch({ type: event as AuthEventType, user: userOf(session) });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const api = useMemo<Auth>(() => {
    const call = async (fn: () => Promise<{ error: AuthError | null }>, message?: string): Promise<Result> => {
      if (!supabase) return { ok: false, error: 'Konten sind in dieser Installation nicht eingerichtet.' };
      try {
        const { error } = await fn();
        return error ? fail(error) : { ok: true, message };
      } catch (e) {
        return fail(e as Error);
      }
    };
    return {
      state,
      signIn: (email, password) => call(() => supabase!.auth.signInWithPassword({ email: email.trim(), password })),
      async signUp(email, password) {
        if (!supabase) return { ok: false, error: 'Konten sind in dieser Installation nicht eingerichtet.' };
        try {
          const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo() } });
          if (error) return fail(error);
          // With email confirmation enabled there is no session yet: the user must click the link first.
          return { ok: true, message: data.session ? undefined : 'Fast geschafft: Wir haben dir eine E-Mail geschickt. Bestätige deine Adresse über den Link und melde dich dann an.' };
        } catch (e) {
          return fail(e as Error);
        }
      },
      // scope 'local': signs out this device only; other devices stay signed in.
      signOut: () => call(() => supabase!.auth.signOut({ scope: 'local' })),
      sendReset: (email) =>
        call(() => supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() }), 'Falls ein Konto existiert, ist ein Link zum Zurücksetzen unterwegs. Prüfe dein Postfach.'),
      updatePassword: (password) => call(() => supabase!.auth.updateUser({ password }), 'Neues Passwort gespeichert.'),
      resendConfirmation: (email) =>
        call(() => supabase!.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectTo() } }), 'Bestätigungs-E-Mail erneut gesendet.'),
    };
  }, [state]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
