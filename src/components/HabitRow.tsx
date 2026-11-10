import { animate, motion, useMotionValue, useTransform, type DragControls, type PanInfo } from 'framer-motion';
import { useRef, useState } from 'react';
import { useT } from '../i18n';
import { formatNumber, locale, startOfWeek, type DateKey } from '../lib/date';
import { completionId, isComplete, isFrequencyAt, ruleAt, targetAt, type Habit } from '../lib/model';
import { parseAmount, quickStep } from '../lib/today';
import { countSource, weekLabel, weekStatus } from '../lib/weekly';
import { useStore } from '../store';
import { Icon, springs, useReduce, useSwipeBlur } from './ui';

const ACTIONS_W = 204; // three 68px actions
const COMPLETE_AT = 84;

interface Props {
  habit: Habit;
  date: DateKey;
  sorting: boolean;
  dragControls?: DragControls;
  onMove?: (dir: -1 | 1) => void;
  onOpen: () => void;
  onEdit: () => void;
  /** Weekly goals: primary action opens the analysis form. */
  onAddAnalysis?: () => void;
}

export function HabitRow({ habit, date, sorting, dragControls, onMove, onOpen, onEdit, onAddAnalysis }: Props) {
  const t = useT();
  const { getEntry, setEntry, toggleEntry, stepEntry, setArchived, today, analyses, completions, settings, toggleCompletion } = useStore();
  const weekly = habit.kind === 'weekly'; // analyses
  const frequency = isFrequencyAt(habit, date); // "X-mal pro Woche"
  const multi = frequency && !!ruleAt(habit, date).multi;
  const week = weekly || frequency ? weekStatus(habit, countSource(habit, analyses, completions), startOfWeek(date, settings.weekStart)) : null;
  // One-per-day frequency habits: is the selected day already counted?
  const doneOnDate = frequency && !multi && completions.some((c) => c.id === completionId(habit.id, date));
  const reduce = useReduce();
  const x = useMotionValue(0);
  const blur = useSwipeBlur(x);
  const [open, setOpen] = useState(false);
  const dragged = useRef(false);
  // A tap is ignored while the previous one of this row is still being written, and a second "add" within
  // 350 ms counts as an accidental double tap. Steppers are exempt: every tap is a deliberate step.
  const busy = useRef(false);
  const lastAdd = useRef(0);
  const once = (fn: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    void fn()
      .catch(() => {}) // failures stay visible through the save status and toast
      .finally(() => (busy.current = false));
  };

  const e = getEntry(habit.id, date);
  const target = targetAt(habit, date);
  const value = e?.value ?? 0;
  const done = week ? week.achieved : isComplete(habit, e, date);
  const future = date > today;
  const unit = habit.unit ? ' ' + habit.unit : '';

  const checkScale = useTransform(x, [0, COMPLETE_AT], [0.6, 1]);
  const checkOpacity = useTransform(x, [8, COMPLETE_AT * 0.7], [0, 1]);
  // Underlays only exist while the row is displaced, so they never bleed through the rounded corners at rest.
  const leftVis = useTransform(x, (v) => (v > 0.5 ? 'visible' : 'hidden'));
  const rightVis = useTransform(x, (v) => (v < -0.5 ? 'visible' : 'hidden'));

  const settle = (to: number, velocity = 0) => {
    setOpen(to !== 0);
    animate(x, to, reduce ? { duration: 0.15 } : { ...springs.snappy, velocity });
  };

  const toggle = () => {
    if (future || weekly) return; // a weekly analysis goal is only met by saved analyses
    if (frequency) {
      if (multi) {
        const now = Date.now();
        if (now - lastAdd.current < 350) return;
        lastAdd.current = now;
      }
      return once(() => toggleCompletion(habit, date));
    }
    if (habit.kind === 'binary') return once(() => toggleEntry(habit, date));
    once(() => setEntry(habit, date, done ? 0 : target, undefined, done ? t.toast.reset(habit.name) : t.toast.reached(habit.name)));
  };

  const onDragEnd = (_: unknown, i: PanInfo) => {
    const ox = x.get();
    if (ox > COMPLETE_AT || (i.velocity.x > 700 && ox > 30)) {
      toggle();
      settle(0, i.velocity.x);
    } else if (ox < -ACTIONS_W / 2 || (i.velocity.x < -500 && ox < -20)) settle(-ACTIONS_W, i.velocity.x);
    else settle(0, i.velocity.x);
    setTimeout(() => (dragged.current = false), 0);
  };

  const inc = quickStep(target);
  const step = (d: number) => !future && void stepEntry(habit, date, d * inc).catch(() => {});

  const currentWeek = !!week && week.start === startOfWeek(today, settings.weekStart);
  const label = week
    ? week.achieved
      ? t.row.weekReached(weekLabel(week, habit.kind, t))
      : currentWeek ? t.row.remaining(week.target - week.count, weekly) : t.row.pastWeek(weekLabel(week, habit.kind, t))
    : habit.kind === 'binary' ? (done ? t.common.done : t.common.open) : `${fmtNum(value)} / ${fmtNum(target)}${unit}`;

  return (
    <div className={'row-wrap' + (done ? ' done' : '')}>
      {blur.filter}
      {/* Revealed by swipe right */}
      <motion.div className="row-under left" aria-hidden="true" style={{ visibility: leftVis }}>
        <motion.span style={{ scale: checkScale, opacity: checkOpacity }} className="under-check">
          <Icon name={(frequency ? doneOnDate : done) ? 'restore' : 'check'} size={22} />
        </motion.span>
      </motion.div>
      {/* Revealed by swipe left; focusable, so keyboard users open the row by tabbing in */}
      <motion.div className="row-under right" style={{ visibility: rightVis }}>
        <button className="row-action" onClick={() => (settle(0), onOpen())} onFocus={() => settle(-ACTIONS_W)} tabIndex={open ? 0 : -1}>
          <Icon name="info" size={20} /><span>{t.common.details}</span>
        </button>
        <button className="row-action" onClick={() => (settle(0), onEdit())} onFocus={() => settle(-ACTIONS_W)} tabIndex={open ? 0 : -1}>
          <Icon name="edit" size={20} /><span>{t.common.edit}</span>
        </button>
        <button className="row-action dark" onClick={() => (settle(0), setArchived(habit.id, true))} onFocus={() => settle(-ACTIONS_W)} tabIndex={open ? 0 : -1}>
          <Icon name="archive" size={20} /><span>{t.common.archive}</span>
        </button>
      </motion.div>

      <motion.div
        ref={blur.ref}
        className="row"
        style={{ x }}
        drag={sorting ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: -ACTIONS_W, right: 0 }}
        dragElastic={{ left: 0.12, right: weekly ? 0 : 0.55 }}
        dragMomentum={false}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={onDragEnd}
      >
        <button
          className="row-main"
          onClick={() => {
            if (dragged.current) return;
            if (open) settle(0);
            else onOpen();
          }}
          aria-label={t.row.openDetails(habit.name, label)}
        >
          <span className="row-icon"><Icon habit={habit.icon} /></span>
          <span className="row-text">
            <span className="row-name">{habit.name}</span>
            <span className="row-sub">{habit.kind === 'binary' && !frequency ? habit.description || t.row.onceADay : label}</span>
            {(habit.kind === 'numeric' || week) && (
              <span className="bar" aria-hidden="true">
                <motion.span className="bar-fill" initial={false} animate={{ scaleX: week ? Math.min(1, week.count / week.target) : Math.min(1, value / target) }} transition={springs.gentle} />
              </span>
            )}
          </span>
        </button>

        {sorting ? (
          <div className="sort-ctl">
            <button
              className="icon-btn handle"
              aria-label={t.row.move(habit.name)}
              onPointerDown={(ev) => dragControls?.start(ev)}
              onKeyDown={(ev) => {
                if (ev.key === 'ArrowUp') (ev.preventDefault(), onMove?.(-1));
                if (ev.key === 'ArrowDown') (ev.preventDefault(), onMove?.(1));
              }}
              style={{ touchAction: 'none' }}
            >
              <Icon name="grip" />
            </button>
          </div>
        ) : weekly ? (
          <motion.button
            className={'icon-btn round' + (done ? ' filled' : '')}
            onClick={onAddAnalysis}
            aria-label={t.row.addAnalysis(habit.name)}
            whileTap={reduce ? undefined : { scale: 0.86 }}
          >
            <Icon name="plus" size={18} />
          </motion.button>
        ) : frequency && multi ? (
          <motion.button
            className="icon-btn round"
            onClick={toggle}
            disabled={future}
            aria-label={t.row.addCompletion(habit.name)}
            whileTap={reduce ? undefined : { scale: 0.86 }}
          >
            <Icon name="plus" size={18} />
          </motion.button>
        ) : frequency ? (
          <motion.button
            className={'check' + (doneOnDate ? ' on' : '')}
            onClick={toggle}
            disabled={future}
            aria-pressed={doneOnDate}
            aria-label={doneOnDate ? t.row.removeCompletion(habit.name) : t.row.addCompletion(habit.name)}
            whileTap={reduce ? undefined : { scale: 0.86 }}
            transition={springs.snappy}
          >
            <motion.svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: doneOnDate ? 1 : 0, opacity: doneOnDate ? 1 : 0 }} transition={{ duration: reduce ? 0 : 0.25, ease: 'easeOut' }} />
            </motion.svg>
          </motion.button>
        ) : habit.kind === 'binary' ? (
          <motion.button
            className={'check' + (done ? ' on' : '')}
            onClick={toggle}
            disabled={future}
            aria-pressed={done}
            aria-label={done ? t.row.uncheck(habit.name) : t.row.check(habit.name)}
            whileTap={reduce ? undefined : { scale: 0.86 }}
            transition={springs.snappy}
          >
            <motion.svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }} transition={{ duration: reduce ? 0 : 0.25, ease: 'easeOut' }} />
            </motion.svg>
          </motion.button>
        ) : (
          <div className="stepper">
            <motion.button className="icon-btn round" onClick={() => step(-1)} disabled={future || value <= 0} aria-label={t.row.decrease(habit.name, fmtNum(inc))} whileTap={reduce ? undefined : { scale: 0.86 }}>
              <Icon name="minus" size={18} />
            </motion.button>
            <AmountInput value={value} disabled={future} label={t.row.amount(habit.name)} onCommit={(v) => void setEntry(habit, date, v).catch(() => {})} />
            <motion.button className={'icon-btn round' + (done ? ' filled' : '')} onClick={() => step(1)} disabled={future} aria-label={t.row.increase(habit.name, fmtNum(inc))} whileTap={reduce ? undefined : { scale: 0.86 }}>
              {done ? <Icon name="check" size={18} /> : <Icon name="plus" size={18} />}
            </motion.button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export const fmtNum = formatNumber;

const plain = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 2, useGrouping: false });

/**
 * Direct entry for numeric habits. Shows the stored value; while focused the typed text is local, and it is
 * saved on Enter or blur (Escape or invalid input restores the stored value). Typing never moves the row.
 */
function AmountInput({ value, label, disabled, onCommit }: { value: number; label: string; disabled: boolean; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancel = useRef(false);
  const finish = () => {
    const n = draft == null || cancel.current ? null : parseAmount(draft);
    cancel.current = false;
    setDraft(null);
    if (n != null && n !== value) onCommit(n);
  };
  return (
    <input
      className="amount"
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label}
      disabled={disabled}
      value={draft ?? plain(value)}
      onFocus={(e) => {
        setDraft(plain(value));
        e.currentTarget.select();
      }}
      onPointerDown={(e) => e.stopPropagation()} // selecting text must not start the row swipe
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancel.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
