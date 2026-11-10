import { animate, AnimatePresence, motion, Reorder, useDragControls, useMotionValue, type PanInfo } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { AnalysisSheet } from '../components/AnalysisSheet';
import { HabitRow } from '../components/HabitRow';
import { SaveStatus } from '../components/Account';
import { useT } from '../i18n';
import { Dashboard } from '../components/Dashboard';
import { Icon, Sheet, springs, useReduce, useSwipeBlur } from '../components/ui';
import { addDays, formatDayMonth, formatLong, fromKey, startOfWeek, weekday, weekdayLong, weekdayShort, type DateKey } from '../lib/date';
import { isActiveOn, isArchived, isComplete, isScheduled, isWeeklyGoalAt, type Habit } from '../lib/model';
import { useStore } from '../store';

interface Props {
  date: DateKey;
  setDate: (d: DateKey) => void;
  onCreate: () => void;
  onEdit: (h: Habit) => void;
  onOpen: (h: Habit) => void;
}

export function Today({ date, setDate, onCreate, onEdit, onOpen }: Props) {
  const t = useT();
  const { habits, today, getEntry, reorder, addExamples } = useStore();
  const [analysisFor, setAnalysisFor] = useState<Habit | null>(null);
  const reduce = useReduce();
  const [sorting, setSorting] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [dir, setDir] = useState(0);
  const active = habits.filter((h) => !isArchived(h));
  const archived = habits.filter(isArchived);
  const due = active.filter((h) => isScheduled(h, date));
  const doneCount = due.filter((h) => isComplete(h, getEntry(h.id, date), date)).length;
  const allDone = due.length > 0 && doneCount === due.length;
  // Weekly goals are listed with the day's habits but never count toward the daily ring.
  const shown = sorting ? active : active.filter((h) => isScheduled(h, date) || (isWeeklyGoalAt(h, date) && isActiveOn(h, date)));
  const [order, setOrder] = useState(shown.map((h) => h.id));
  useEffect(() => setOrder(shown.map((h) => h.id)), [shown.map((h) => h.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (d: DateKey) => {
    if (d > today || d === date) return;
    setDir(d > date ? 1 : -1);
    setDate(d);
  };

  // Day swipe on the header: finger-following, velocity-blurred, snaps to the neighbouring day.
  const hx = useMotionValue(0);
  const hblur = useSwipeBlur(hx);
  const onHeaderEnd = (_: unknown, i: PanInfo) => {
    const ox = hx.get();
    if ((ox < -60 || i.velocity.x < -500) && date < today) go(addDays(date, 1));
    else if (ox > 60 || i.velocity.x > 500) go(addDays(date, -1));
    animate(hx, 0, springs.snappy);
  };

  const byId = new Map(habits.map((h) => [h.id, h]));
  const move = (id: string, d: -1 | 1) => {
    const i = order.indexOf(id), j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j], n[i]];
    setOrder(n);
    reorder(n);
  };

  return (
    <div className="screen today-screen">
      {active.length > 0 && <Dashboard date={date} />}
      <header className="today-head">
        <div className="head-top">
          <span className="mobile-only"><SaveStatus /></span>
          <div className="head-actions">
            {date !== today && (
              <button className="pill" onClick={() => go(today)}>{t.common.today}</button>
            )}
            {active.length > 1 && (
              <button className={'icon-btn' + (sorting ? ' active' : '')} onClick={() => setSorting((s) => !s)} aria-pressed={sorting} aria-label={sorting ? t.today.sortEnd : t.today.sortStart}>
                <Icon name={sorting ? 'check' : 'sort'} />
              </button>
            )}
            <button className="icon-btn" onClick={onCreate} aria-label={t.today.newHabit}>
              <Icon name="plus" />
            </button>
          </div>
        </div>

        <motion.div
          className="date-swipe"
          ref={hblur.ref}
          style={{ x: hx }}
          drag={reduce ? false : 'x'}
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.6}
          onDragEnd={onHeaderEnd}
        >
          {hblur.filter}
          <div className="date-title">
            <p className="eyebrow">{(date === today ? `${t.common.today} · ` : date === addDays(today, -1) ? `${t.common.yesterday} · ` : '') + weekdayLong(weekday(date))}</p>
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.h1
                key={date}
                custom={dir}
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -28 }}
                transition={springs.snappy}
              >
                {formatDayMonth(date)}
              </motion.h1>
            </AnimatePresence>
          </div>
        </motion.div>

        <WeekStrip date={date} go={go} />
      </header>

      <div className="today-main">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.section
          key={date + (sorting ? 's' : '')}
          className="list"
          aria-label={t.today.habits}
          custom={dir}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 36, filter: dir ? 'blur(6px)' : 'blur(0px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -36, filter: 'blur(6px)' }}
          transition={{ ...springs.snappy, opacity: { duration: 0.18 }, filter: { duration: 0.22, ease: 'easeOut' } }}
        >
          {active.length === 0 ? (
            <Empty onCreate={onCreate} onExamples={addExamples} />
          ) : shown.length === 0 ? (
            <div className="empty small">
              <p>{t.today.nothingPlanned(date === today)}</p>
            </div>
          ) : sorting ? (
            <Reorder.Group axis="y" values={order} onReorder={setOrder} className="rows" as="div">
              {order.map((id) => byId.get(id) && (
                <SortableRow key={id} id={id} habit={byId.get(id)!} date={date} onDrop={() => reorder(order)} onMove={(d) => move(id, d)} />
              ))}
            </Reorder.Group>
          ) : (
            <div className="rows">
              {/* layout: remaining rows glide into place when one is archived or added */}
              <AnimatePresence initial={false}>
                {shown.map((h, i) => (
                  <motion.div
                    key={h.id}
                    layout={reduce ? false : 'position'}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { ...springs.gentle, delay: Math.min(i, 8) * 0.03 } }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
                    transition={springs.gentle}
                  >
                    <HabitRow habit={h} date={date} sorting={false} onOpen={() => onOpen(h)} onEdit={() => onEdit(h)} onAddAnalysis={() => setAnalysisFor(h)} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
          {sorting && <p className="hint">{t.today.sortHint}</p>}

          <AnimatePresence>
            {allDone && !sorting && (
              <motion.div className="all-done" initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ ...springs.gentle, delay: 0.15 }}>
                <span className="done-mark"><Icon name="check" size={16} /></span>
                {t.today.allDone(date === today)}
              </motion.div>
            )}
          </AnimatePresence>

          {archived.length > 0 && (
            <button className="link-btn" onClick={() => setArchiveOpen(true)}>
              <Icon name="archive" size={18} /> {t.today.archive(archived.length)}
            </button>
          )}
        </motion.section>
      </AnimatePresence>
      </div>

      {analysisFor && <AnalysisSheet open habit={analysisFor} analysis={null} onClose={() => setAnalysisFor(null)} />}

      <Sheet open={archiveOpen} onClose={() => setArchiveOpen(false)} title={t.today.archiveTitle}>
        <ArchiveList habits={archived} onOpen={(h) => (setArchiveOpen(false), onOpen(h))} />
      </Sheet>
    </div>
  );
}

function SortableRow({ id, habit, date, onDrop, onMove }: { id: string; habit: Habit; date: DateKey; onDrop: () => void; onMove: (d: -1 | 1) => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={id} as="div" dragListener={false} dragControls={controls} onDragEnd={onDrop} transition={springs.snappy} whileDrag={{ scale: 1.02, boxShadow: '0 12px 32px rgba(0,0,0,.5)', zIndex: 5 }} style={{ position: 'relative', borderRadius: 16 }}>
      <HabitRow habit={habit} date={date} sorting dragControls={controls} onMove={onMove} onOpen={() => {}} onEdit={() => {}} />
    </Reorder.Item>
  );
}

export function ArchiveList({ habits, onOpen }: { habits: Habit[]; onOpen: (h: Habit) => void }) {
  const t = useT();
  const { setArchived } = useStore();
  if (!habits.length) return <p className="muted">{t.today.noArchived}</p>;
  return (
    <ul className="plain-list">
      {habits.map((h) => (
        <li key={h.id} className="list-item">
          <button className="list-main" onClick={() => onOpen(h)}>
            <span className="row-icon"><Icon habit={h.icon} /></span>
            <span>{h.name}</span>
          </button>
          <button className="btn small" onClick={() => setArchived(h.id, false)}>
            {t.common.restore}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Empty({ onCreate, onExamples }: { onCreate: () => void; onExamples: () => void }) {
  const t = useT();
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true"><Icon habit="circle" size={28} /></div>
      <h2>{t.today.emptyTitle}</h2>
      <p>{t.today.emptyText}</p>
      <button className="btn primary" onClick={onCreate}>{t.today.emptyCreate}</button>
      <button className="link-btn" onClick={onExamples}>{t.today.addExamples}</button>
    </div>
  );
}

function WeekStrip({ date, go }: { date: DateKey; go: (d: DateKey) => void }) {
  const t = useT();
  const { settings, today, habits, getEntry } = useStore();
  const reduce = useReduce();
  const x = useMotionValue(0);
  const blur = useSwipeBlur(x);
  const start = startOfWeek(date, settings.weekStart);
  const isCurrentWeek = start === startOfWeek(today, settings.weekStart);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const [wdir, setWdir] = useState(0);

  const shift = (n: number) => {
    const target = addDays(date, n * 7);
    setWdir(n);
    go(target > today ? today : target);
  };

  const onEnd = (_: unknown, i: PanInfo) => {
    const ox = x.get();
    if ((ox < -50 || i.velocity.x < -450) && !isCurrentWeek) shift(1);
    else if (ox > 50 || i.velocity.x > 450) shift(-1);
    animate(x, 0, reduce ? { duration: 0.12 } : springs.snappy);
  };

  const ratio = (d: DateKey) => {
    const due = habits.filter((h) => isScheduled(h, d));
    return due.length ? due.filter((h) => isComplete(h, getEntry(h.id, d), d)).length / due.length : -1;
  };

  return (
    <div className="week">
      <button className="icon-btn week-nav" onClick={() => shift(-1)} aria-label={t.common.prevWeek}><Icon name="left" size={18} /></button>
      <div className="week-viewport">
        {blur.filter}
        <motion.div
          ref={blur.ref}
          className="week-track"
          style={{ x }}
          drag={reduce ? false : 'x'}
          dragDirectionLock
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={isCurrentWeek ? { left: 0.15, right: 0.7 } : 0.7}
          onDragEnd={onEnd}
        >
          <AnimatePresence mode="popLayout" initial={false} custom={wdir}>
            <motion.div
              key={start}
              className="week-days"
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: wdir * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: wdir * -60 }}
              transition={springs.snappy}
            >
              {days.map((d) => {
                const r = ratio(d);
                const future = d > today;
                return (
                  <button
                    key={d}
                    className={'wd' + (d === date ? ' sel' : '') + (d === today ? ' today' : '')}
                    onClick={() => go(d)}
                    disabled={future}
                    aria-current={d === date ? 'date' : undefined}
                    aria-label={formatLong(d) + (r >= 0 ? `, ${t.today.dayDone(Math.round(r * 100))}` : '')}
                  >
                    <span className="wd-name">{weekdayShort(weekday(d)).slice(0, 2)}</span>
                    <span className="wd-num">{fromKey(d).getDate()}</span>
                    <span className="wd-dot" style={{ opacity: future || r < 0 ? 0 : 0.25 + r * 0.75, transform: `scale(${r === 1 ? 1.3 : 1})` }} />
                  </button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
      <button className="icon-btn week-nav" onClick={() => shift(1)} disabled={isCurrentWeek} aria-label={t.common.nextWeek}><Icon name="right" size={18} /></button>
    </div>
  );
}
