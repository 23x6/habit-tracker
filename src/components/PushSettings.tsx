import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { currentSubscription, disablePush, enablePush, pushOwner, pushSupport, sendTestPush } from '../lib/push';
import { supabase } from '../lib/remote';
import { useStore } from '../store';

/** Settings: opt-in push reminders for this device, a test notification, and turning it off again. */
export function PushSettings() {
  const { t, lang } = useI18n();
  const p = t.push;
  const { partition } = useStore();
  const userId = partition.sync ? partition.userId : null;
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const denied = 'Notification' in window && Notification.permission === 'denied';

  useEffect(() => {
    let alive = true;
    void currentSubscription().then((s) => alive && setOn(!!s && !!userId && pushOwner() === userId));
    return () => void (alive = false);
  }, [userId]);

  const run = async (fn: () => Promise<string | null>) => {
    if (!navigator.onLine) return setMsg(p.offlineNow);
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(p.failed((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const enable = () =>
    run(async () => {
      const r = await enablePush(supabase!, userId!, lang); // permission prompt comes first, from this tap
      if (r === 'ok') {
        setOn(true);
        return null;
      }
      return r === 'denied' ? p.denied : p.dismissed;
    });
  const test = () =>
    run(async () => {
      const r = await sendTestPush(supabase!);
      if (r === 'sent') return p.testSent;
      if (r === 'expired' || r === 'not-registered') setOn(false);
      return r === 'failed' ? p.failed('push') : p.failed(r === 'expired' ? 'expired' : 'not registered');
    });
  const disable = () =>
    run(async () => {
      await disablePush(supabase);
      setOn(false);
      return null;
    });

  let blocker: string | null = null;
  if (!userId || !supabase) blocker = p.needsAccount;
  else if (support === 'needs-install') blocker = p.needsInstall;
  else if (support === 'unsupported') blocker = p.unsupported;
  else if (support === 'not-configured') blocker = p.notConfigured;
  else if (denied && !on) blocker = p.denied;

  return (
    <section className="card" aria-labelledby="push-title">
      <h2 id="push-title">{p.title}</h2>
      <p className="muted small">{p.intro}</p>
      {blocker ? (
        <p className="form-info" role="status">{blocker}</p>
      ) : (
        <>
          <p className="push-status" role="status">{on ? p.statusOn : p.statusOff}</p>
          <div className="btn-col">
            {!on && <button className="btn primary wide" onClick={enable} disabled={busy || on === null}>{busy ? p.busy : p.enable}</button>}
            {on && <button className="btn wide" onClick={test} disabled={busy}>{busy ? p.busy : p.test}</button>}
            {on && <button className="btn wide" onClick={disable} disabled={busy}>{p.disable}</button>}
          </div>
          {msg && <p className="form-info" role="status" aria-live="polite">{msg}</p>}
          {on && <p className="muted small">{p.testNote}</p>}
        </>
      )}
      <p className="muted small">{p.timing}</p>
      <p className="muted small">{p.offline}</p>
      <p className="muted small">{p.inApp} {p.sharedNote}</p>
    </section>
  );
}
