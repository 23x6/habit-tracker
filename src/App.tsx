import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import { HeaderAccountButton, LangSwitch, RecoverySheet, SaveStatus } from './components/Account';
import { useI18n } from './i18n';
import { DB_BLOCKED } from './lib/db';
import { HabitSheet } from './components/HabitSheet';
import { StreakCelebration, StreakWelcome } from './components/Streak';
import { Icon, springs, ToastHost, useReduce } from './components/ui';
import type { UIIcon } from './lib/icons';
import { dueReminders, notify } from './lib/reminders';
import { pushActiveFor, pushSupport, refreshPush } from './lib/push';
import { supabase } from './lib/remote';
import type { Habit } from './lib/model';
import { Detail } from './screens/Detail';
import { Journal } from './screens/Journal';
import { Settings } from './screens/Settings';
import { Stats } from './screens/Stats';
import { WeeklyReview, type WeekRange } from './screens/WeeklyReview';
import { addDays, startOfWeek } from './lib/date';
import { Today } from './screens/Today';
import { useStore } from './store';

type Tab = 'today' | 'journal' | 'stats' | 'settings';
const TABS: { id: Tab; icon: UIIcon }[] = [
  { id: 'today', icon: 'today' },
  { id: 'journal', icon: 'journal' },
  { id: 'stats', icon: 'chart' },
  { id: 'settings', icon: 'settings' },
];

export function App() {
  const { t, lang } = useI18n();
  const store = useStore();
  const { status, error, habits, settings, today, getEntry, showToast } = store;
  const reduce = useReduce();
  const [tab, setTab] = useState<Tab>('today');
  const [date, setDate] = useState(today);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ habit: Habit | null } | null>(null);
  const [review, setReview] = useState<WeekRange | null>(null);
  const openReview = () => {
    const s = startOfWeek(today, settings.weekStart);
    setReview({ start: s, end: addDays(s, 6) });
  };
  const [online, setOnline] = useState(navigator.onLine);

  // Follow the calendar: when midnight passes, a selected "today" moves to the new today.
  const [prevToday, setPrevToday] = useState(today);
  if (prevToday !== today) {
    setPrevToday(today);
    if (date === prevToday) setDate(today);
  }

  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => (window.removeEventListener('online', on), window.removeEventListener('offline', on));
  }, []);

  // Push (opt-in per device): keep this device's registration current, or turn it off if it belongs to another user.
  const userId = store.partition.sync ? store.partition.userId : null;
  useEffect(() => {
    if (!userId || !supabase || pushSupport() !== 'ok' || !('Notification' in window) || Notification.permission !== 'granted') return;
    void refreshPush(supabase, userId, lang).catch(() => {}); // offline: next start
  }, [userId, lang]);

  // A tapped notification opens its habit: `?habit=<id>` on a fresh start, or a message from the service worker.
  useEffect(() => {
    const open = (url: string) => {
      const id = new URL(url, location.href).searchParams.get('habit');
      if (!id) return;
      setTab('today');
      setReview(null);
      setDetailId(id);
    };
    if (new URLSearchParams(location.search).has('habit')) {
      open(location.href);
      history.replaceState(null, '', location.pathname);
    }
    const onMsg = (e: MessageEvent) => e.data?.type === 'open' && typeof e.data.url === 'string' && open(e.data.url);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, []);

  // In-app reminders (only while open — see lib/reminders.ts). Skipped while push is on for this device, so the
  // same reminder never alerts twice.
  useEffect(() => {
    if (!settings.remindersEnabled || status !== 'ready' || pushActiveFor(userId)) return;
    const check = () => notify(dueReminders(habits, getEntry), (m) => showToast(m), t.reminder.body);
    check();
    const iv = setInterval(check, 30_000);
    return () => clearInterval(iv);
  }, [settings.remindersEnabled, habits, getEntry, status, showToast, t, userId]);

  const detail = habits.find((h) => h.id === detailId) ?? null;

  if (status === 'loading') return <div className="center-screen" aria-busy="true"><span className="spinner" aria-label={t.common.loading} /></div>;
  if (status === 'error')
    return (
      <div className="center-screen">
        <div className="empty">
          <h2>{t.app.storageUnavailable}</h2>
          <p>{t.app.storageUnavailableText(error === DB_BLOCKED ? t.app.blocked : error ?? '')}</p>
          <button className="btn primary" onClick={() => location.reload()}>{t.common.retry}</button>
        </div>
      </div>
    );

  return (
    <MotionConfig reducedMotion={settings.motion === 'reduce' ? 'always' : settings.motion === 'full' ? 'never' : 'user'}>
      <div className={'app' + (reduce ? ' reduce' : '')}>
        {!online && <div className="offline-badge" role="status">{t.app.offline}</div>}
        {/* Desktop utility bar (≥ 768 px). Hidden with display:none below that, so nothing in it is focusable. */}
        <header className="app-header" aria-label={t.app.utilities}>
          <SaveStatus />
          <div className="app-header-tools">
            <LangSwitch compact />
            <HeaderAccountButton />
          </div>
        </header>
        <main className="main" aria-hidden={!!detail || !!review || undefined}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={tab}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.995 }}
              exit={reduce ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: -6, transition: { duration: 0.14, ease: 'easeIn' } }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36, opacity: { duration: 0.2 } }}
            >
              {tab === 'today' && (
                <Today date={date} setDate={setDate} onCreate={() => setSheet({ habit: null })} onEdit={(h) => setSheet({ habit: h })} onOpen={(h) => setDetailId(h.id)} onReview={openReview} />
              )}
              {tab === 'stats' && <Stats onOpen={(h) => setDetailId(h.id)} onReview={openReview} />}
              {tab === 'journal' && <Journal />}
              {tab === 'settings' && <Settings />}
            </motion.div>
          </AnimatePresence>
        </main>

        <nav className="tabbar" aria-label={t.nav.main}>
          {TABS.map((x) => (
            <button key={x.id} className={'tab' + (tab === x.id ? ' on' : '')} onClick={() => setTab(x.id)} aria-label={t.nav[x.id]} aria-current={tab === x.id ? 'page' : undefined}>
              {tab === x.id && <motion.span layoutId="tab-pill" className="tab-pill" transition={springs.snappy} />}
              <Icon name={x.icon} size={21} />
              <span className="tab-label">{t.nav[x.id]}</span>
            </button>
          ))}
        </nav>

        <AnimatePresence>
          {review && !detail && <WeeklyReview key="review" range={review} onRange={setReview} onBack={() => setReview(null)} />}
          {detail && <Detail key={detail.id} habit={detail} onBack={() => setDetailId(null)} onEdit={() => setSheet({ habit: detail })} />}
        </AnimatePresence>

        <HabitSheet open={!!sheet} habit={sheet?.habit ?? null} onClose={() => setSheet(null)} />
        <RecoverySheet />
        <StreakWelcome />
        <StreakCelebration />
        <ToastHost />
      </div>
    </MotionConfig>
  );
}
