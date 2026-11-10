import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import { RecoverySheet } from './components/Account';
import { HabitSheet } from './components/HabitSheet';
import { Icon, springs, ToastHost, useReduce } from './components/ui';
import type { UIIcon } from './lib/icons';
import { dueReminders, notify } from './lib/reminders';
import type { Habit } from './lib/model';
import { Detail } from './screens/Detail';
import { Journal } from './screens/Journal';
import { Settings } from './screens/Settings';
import { Stats } from './screens/Stats';
import { Today } from './screens/Today';
import { useStore } from './store';

type Tab = 'today' | 'journal' | 'stats' | 'settings';
const TABS: { id: Tab; label: string; icon: UIIcon }[] = [
  { id: 'today', label: 'Heute', icon: 'today' },
  { id: 'journal', label: 'Journal', icon: 'journal' },
  { id: 'stats', label: 'Statistik', icon: 'chart' },
  { id: 'settings', label: 'Einstellungen', icon: 'settings' },
];

export function App() {
  const store = useStore();
  const { status, error, habits, settings, today, getEntry, showToast } = store;
  const reduce = useReduce();
  const [tab, setTab] = useState<Tab>('today');
  const [date, setDate] = useState(today);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ habit: Habit | null } | null>(null);
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

  // In-app reminders (only while open — see lib/reminders.ts).
  useEffect(() => {
    if (!settings.remindersEnabled || status !== 'ready') return;
    const check = () => notify(dueReminders(habits, getEntry), (m) => showToast(m));
    check();
    const iv = setInterval(check, 30_000);
    return () => clearInterval(iv);
  }, [settings.remindersEnabled, habits, getEntry, status, showToast]);

  const detail = habits.find((h) => h.id === detailId) ?? null;

  if (status === 'loading') return <div className="center-screen" aria-busy="true"><span className="spinner" aria-label="Lädt" /></div>;
  if (status === 'error')
    return (
      <div className="center-screen">
        <div className="empty">
          <h2>Speicher nicht verfügbar</h2>
          <p>Still konnte die lokale Datenbank nicht öffnen{error ? ` (${error})` : ''}. Im privaten Modus oder bei blockierten Website-Daten ist das nicht möglich.</p>
          <button className="btn primary" onClick={() => location.reload()}>Erneut versuchen</button>
        </div>
      </div>
    );

  return (
    <MotionConfig reducedMotion={settings.motion === 'reduce' ? 'always' : settings.motion === 'full' ? 'never' : 'user'}>
      <div className={'app' + (reduce ? ' reduce' : '')}>
        {!online && <div className="offline-badge" role="status">Offline · Daten werden lokal gesichert</div>}
        <main className="main" aria-hidden={!!detail || undefined}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={tab}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.995 }}
              exit={reduce ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: -6, transition: { duration: 0.14, ease: 'easeIn' } }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36, opacity: { duration: 0.2 } }}
            >
              {tab === 'today' && (
                <Today date={date} setDate={setDate} onCreate={() => setSheet({ habit: null })} onEdit={(h) => setSheet({ habit: h })} onOpen={(h) => setDetailId(h.id)} />
              )}
              {tab === 'stats' && <Stats onOpen={(h) => setDetailId(h.id)} />}
              {tab === 'journal' && <Journal />}
              {tab === 'settings' && <Settings />}
            </motion.div>
          </AnimatePresence>
        </main>

        <nav className="tabbar" aria-label="Hauptnavigation">
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)} aria-label={t.label} aria-current={tab === t.id ? 'page' : undefined}>
              {tab === t.id && <motion.span layoutId="tab-pill" className="tab-pill" transition={springs.snappy} />}
              <Icon name={t.icon} size={21} />
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>

        <AnimatePresence>
          {detail && <Detail key={detail.id} habit={detail} onBack={() => setDetailId(null)} onEdit={() => setSheet({ habit: detail })} />}
        </AnimatePresence>

        <HabitSheet open={!!sheet} habit={sheet?.habit ?? null} onClose={() => setSheet(null)} />
        <RecoverySheet />
        <ToastHost />
      </div>
    </MotionConfig>
  );
}
