import { today as todayKey } from './date';
import { isArchived, isComplete, isScheduled, type EntryLookup, type Habit } from './model';

// Honest scope: a PWA without a push server cannot schedule notifications for when it is closed.
// These checks only run while the app is open (foreground or recently backgrounded and not suspended).

export type PermissionState = NotificationPermission | 'unsupported';

export const permission = (): PermissionState => ('Notification' in window ? Notification.permission : 'unsupported');

export async function requestPermission(): Promise<PermissionState> {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

const firedKey = (id: string, date: string) => `still-reminded-${id}-${date}`;
const fired = (k: string) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};
const markFired = (k: string) => {
  try {
    localStorage.setItem(k, '1');
  } catch { /* convenience only */ }
};

/** Returns habits whose reminder time has passed today, are still open, and weren't reminded yet. */
export function dueReminders(habits: Habit[], get: EntryLookup, now = new Date()): Habit[] {
  const d = todayKey(now);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return habits.filter(
    (h) => h.reminder && !isArchived(h) && h.reminder <= hhmm && isScheduled(h, d) && !isComplete(h, get(h.id, d), d) && !fired(firedKey(h.id, d)),
  );
}

export async function notify(habits: Habit[], fallback: (msg: string) => void, body: (name: string) => string) {
  const d = todayKey();
  for (const h of habits) {
    markFired(firedKey(h.id, d));
    const text = body(h.name);
    if (permission() === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.showNotification('RYVO', { body: text, tag: h.id, icon: './icon-192.png' });
        else new Notification('RYVO', { body: text, tag: h.id });
        continue;
      } catch { /* fall through to in-app */ }
    }
    fallback(text);
  }
}
