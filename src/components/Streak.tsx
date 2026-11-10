import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { addDays, formatLong, fromKey, startOfWeek, weekday, weekdayShort, type DateKey } from '../lib/date';
import { computeStreak, dayStateAt, streakVerified, welcomeStep, type DayState, type StreakResult } from '../lib/streak';
import { useStore } from '../store';
import { Sheet, useReduce } from './ui';

/** Activity streak of the current partition, recomputed from the stored history (see lib/streak.ts). */
export function useStreak(): StreakResult {
  const { snapshot, habits, today, settings } = useStore();
  return useMemo(
    () => computeStreak({ habits, entries: snapshot.entries, completions: snapshot.completions, analyses: snapshot.analyses }, today, settings.weekStart),
    [habits, snapshot.entries, snapshot.completions, snapshot.analyses, today, settings.weekStart],
  );
}

// ---------- Artwork (original SVG) ----------

type FlameState = 'lit' | 'frozen' | 'cold';
type FlameMode = 'static' | 'ignite' | 'flare' | 'fade';

const FLAME = 'M50 6C58 26 80 40 80 70C80 96 66 112 50 112C34 112 20 96 20 70C20 52 30 42 36 30C38 42 42 48 48 50C46 34 44 20 50 6Z';
const CORE = 'M50 50C55 60 63 68 63 80C63 92 57 99 50 99C43 99 37 92 37 80C37 70 45 62 50 50Z';
const SNOW = 'M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9.5 3.5L12 5.5l2.5-2M9.5 20.5L12 18.5l2.5 2M3.6 10.4l2.9-.9-.6-3M20.4 13.6l-2.9.9.6 3M3.6 13.6l2.9.9-.6 3M20.4 10.4l-2.9-.9.6-3';
// Canvas extends 24 units beyond the flame on every side: the blurred glow (3σ = 21) is never clipped.
const VIEW = '-24 -24 148 160';
const SPARKS = [
  { x: 44, y: 22, dx: -10, delay: 260 },
  { x: 55, y: 18, dx: 8, delay: 340 },
  { x: 50, y: 12, dx: -2, delay: 420 },
  { x: 38, y: 34, dx: -14, delay: 380 },
  { x: 62, y: 36, dx: 12, delay: 300 },
];

/**
 * Silver flame. `lit`: soft glow; `frozen`: frosted, hatched and marked with a snowflake (readable without colour);
 * `cold`: outline only (no streak). Motion is one-shot CSS (ignite on the welcome, flare on a newly earned day);
 * the blur is transient and the glow sits inside the padded canvas.
 */
export function Flame({ state, size, number, mode = 'static', label }: { state: FlameState; size: number; number?: number; mode?: FlameMode; label?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      className={`flame flame-${state} flame-${mode}`}
      width={size}
      height={(size * 160) / 148}
      viewBox={VIEW}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={`fl${id}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#fbfbf9" />
          <stop offset="55%" stopColor="#d9d9d5" />
          <stop offset="100%" stopColor="#9d9d99" />
        </linearGradient>
        <linearGradient id={`fz${id}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#eef0f1" />
          <stop offset="100%" stopColor="#8f9497" />
        </linearGradient>
        <pattern id={`hz${id}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="2" />
        </pattern>
        <filter id={`gw${id}`} filterUnits="userSpaceOnUse" x="-24" y="-24" width="148" height="160">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      {state !== 'cold' && <path className="flame-glow" d={FLAME} fill={state === 'frozen' ? '#c9ced1' : '#f2f2ef'} filter={`url(#gw${id})`} />}
      <g className="flame-body">
        <path d={FLAME} fill={state === 'cold' ? 'none' : state === 'frozen' ? `url(#fz${id})` : `url(#fl${id})`} stroke={state === 'cold' ? '#77776f' : 'none'} strokeWidth="3" strokeLinejoin="round" />
        {state === 'lit' && <path className="flame-core" d={CORE} fill="#ffffff" opacity="0.38" />}
        {state === 'frozen' && <path d={FLAME} fill={`url(#hz${id})`} />}
      </g>
      {mode === 'ignite' && SPARKS.map((p, i) => (
        <circle key={i} className="flame-spark" cx={p.x} cy={p.y} r="1.8" fill="#f4f4f2" style={{ ['--dx' as string]: `${p.dx}px`, animationDelay: `${p.delay}ms` }} />
      ))}
      {number != null && (
        <text className="flame-num" x="50" y="94" textAnchor="middle" fill={state === 'cold' ? '#b5b5b0' : '#1b1b1b'} fontSize={number > 99 ? 28 : 36}>
          {number}
        </text>
      )}
      {state === 'frozen' && (
        <g transform="translate(64 16)">
          <circle cx="12" cy="12" r="15" fill="#1d1d1d" stroke="#d6dadc" strokeWidth="1.5" />
          <path d={SNOW} fill="none" stroke="#eef0f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" transform="translate(3.6 3.6) scale(0.7)" />
        </g>
      )}
    </svg>
  );
}

function DayIcon({ state }: { state: DayState }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (state === 'done') return <svg {...common} viewBox="14 2 72 114"><path d={FLAME} fill="currentColor" stroke="none" /></svg>;
  if (state === 'frozen') return <svg {...common}><path d={SNOW} /></svg>;
  if (state === 'missed') return <svg {...common}><path d="M7 7l10 10M17 7L7 17" /></svg>;
  if (state === 'pending') return <svg {...common}><circle cx="12" cy="12" r="7.5" strokeDasharray="3 3" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></svg>;
}

/** Seven days with distinct, non-colour states. `labels`: accessible per-day text (off when the parent describes it). */
function DayStrip({ days, today, show, stagger = false, labels = true }: { days: { date: DateKey; state: DayState }[]; today: DateKey; show: 'weekday' | 'date'; stagger?: boolean; labels?: boolean }) {
  const t = useT();
  return (
    <ol className="streak-strip" aria-hidden={labels ? undefined : true}>
      {days.map((d, i) => (
        <li
          key={d.date}
          className={`sday s-${d.state}` + (d.date === today ? ' is-today' : '') + (stagger ? ' sday-in' : '')}
          style={stagger ? { animationDelay: `${420 + i * 55}ms` } : undefined}
          aria-label={labels ? t.streak.dayLabel(formatLong(d.date), t.streak.state[d.state]) : undefined}
        >
          <span className="sday-icon"><DayIcon state={d.state} /></span>
          <span className="sday-label" aria-hidden="true">{show === 'weekday' ? weekdayShort(weekday(d.date)).slice(0, 2) : fromKey(d.date).getDate()}</span>
        </li>
      ))}
    </ol>
  );
}

function useWeekDays(r: StreakResult, start: DateKey) {
  const { habits, today } = useStore();
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, state: dayStateAt(r, habits, date, today) };
  });
}

const flameState = (r: StreakResult): FlameState => (r.current === 0 ? 'cold' : r.protectedByFreeze ? 'frozen' : 'lit');

// ---------- Dashboard ----------

/** Compact streak next to the progress ring; opens the explanation and history. Separate from the ring's numbers. */
export function StreakBadge() {
  const t = useT();
  const r = useStreak();
  const { today, settings, localWrites } = useStore();
  const reduce = useReduce();
  const [open, setOpen] = useState(false);
  const [flare, setFlare] = useState(0);
  const week = useWeekDays(r, startOfWeek(today, settings.weekStart));

  // Celebrate only a day newly earned by the user's own, durably saved action — not a render, a sync or a reload.
  const prev = useRef({ current: r.current, writes: localWrites });
  useEffect(() => {
    const p = prev.current;
    prev.current = { current: r.current, writes: localWrites };
    if (r.current > p.current && localWrites !== p.writes) setFlare((k) => k + 1);
  }, [r.current, localWrites]);

  return (
    <>
      <button className="streak-badge" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={t.streak.badge(r.current, r.protectedByFreeze)}>
        <span className="streak-badge-main">
          <Flame key={flare} state={flameState(r)} size={30} mode={flare && !reduce ? 'flare' : 'static'} />
          <span className="streak-badge-text">
            <span className="streak-num">{r.current}</span> <span className="streak-unit">{t.streak.unit(r.current)}</span>
            <span className="streak-sub">{t.streak.inARow}</span>
          </span>
        </span>
        <DayStrip days={week} today={today} show="weekday" labels={false} />
      </button>
      <StreakSheet open={open} onClose={() => setOpen(false)} r={r} />
    </>
  );
}

function DataBasis() {
  const t = useT();
  const { partition, sync } = useStore();
  if (!partition.sync) return null;
  return <p className="muted small">{streakVerified(sync) ? t.streak.verified : t.streak.cached}</p>;
}

function StreakSheet({ open, onClose, r }: { open: boolean; onClose: () => void; r: StreakResult }) {
  const t = useT();
  const { today, settings } = useStore();
  const ws = startOfWeek(today, settings.weekStart);
  const weeks = [-28, -21, -14, -7, 0].map((o) => addDays(ws, o));
  return (
    <Sheet open={open} onClose={onClose} title={t.streak.title}>
      <div className="streak-hero">
        <Flame state={flameState(r)} size={92} number={r.current} />
        <div>
          <p className="streak-hero-text">{r.current ? t.streak.daysActive(r.current) : t.streak.zero}</p>
          <p className="muted small">{t.streak.longest(r.longest)}</p>
          <p className="muted small">{r.freezeUsedThisWeek ? t.streak.freezeUsed : t.streak.freezeAvailable}</p>
        </div>
      </div>
      {r.protectedByFreeze && <p className="streak-note">{t.streak.frozenNow}</p>}
      <DataBasis />
      <h3 className="streak-h">{t.streak.history}</h3>
      <div className="streak-history">
        {weeks.map((w) => <HistoryWeek key={w} r={r} start={w} />)}
      </div>
      <h3 className="streak-h">{t.streak.legend}</h3>
      <ul className="streak-legend">
        {(['done', 'frozen', 'missed', 'pending', 'none'] as DayState[]).map((s) => (
          <li key={s} className={`s-${s}`}><span className="sday-icon"><DayIcon state={s} /></span>{t.streak.state[s]}</li>
        ))}
      </ul>
      <h3 className="streak-h">{t.streak.rulesTitle}</h3>
      <ul className="streak-rules">{t.streak.rules.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </Sheet>
  );
}

function HistoryWeek({ r, start }: { r: StreakResult; start: DateKey }) {
  const { today } = useStore();
  return <DayStrip days={useWeekDays(r, start)} today={today} show="date" />;
}

// ---------- Post-login welcome ----------

const SKIP_KEY = 'still-skip-streak-welcome';
export const readSkipWelcome = () => {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
};
export const writeSkipWelcome = (v: boolean) => {
  try {
    localStorage.setItem(SKIP_KEY, v ? '1' : '0');
  } catch { /* per-device convenience only */ }
};

/**
 * Shown once after an explicit sign-in, when the account's data has loaded and the first sync settled (or after
 * 5 s). Shows the real streak — the flame lights up into its current state; nothing is added for signing in.
 */
export function StreakWelcome() {
  const t = useT();
  const { welcomeFor, consumeWelcome } = useAuth();
  const { partition, status, sync, today, settings } = useStore();
  const reduce = useReduce();
  const r = useStreak();
  const week = useWeekDays(r, startOfWeek(today, settings.weekStart));
  const [waited, setWaited] = useState(false);
  const [open, setOpen] = useState(false);
  const step = welcomeStep({ welcomeFor, userId: partition.userId, storeReady: status === 'ready', sync, waited, skip: readSkipWelcome() });

  useEffect(() => {
    if (step !== 'wait') return;
    const tm = setTimeout(() => setWaited(true), 5000); // never block on a slow or failing network
    return () => clearTimeout(tm);
  }, [step]);
  useEffect(() => {
    if (step === 'skip') consumeWelcome();
    if (step === 'show') setOpen(true);
  }, [step, consumeWelcome]);

  const close = () => {
    setOpen(false);
    consumeWelcome();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t.streak.welcomeTitle}
      footer={<button className="btn primary wide streak-continue" autoFocus onClick={close}>{t.streak.continue}</button>}
    >
      <div className="streak-welcome">
        <Flame state={flameState(r)} size={140} number={r.current} mode={reduce ? 'fade' : 'ignite'} />
        <p className={"streak-hero-text" + (reduce ? "" : " streak-rise")}>{r.current ? t.streak.daysActive(r.current) : t.streak.zero}</p>
        {r.protectedByFreeze && <p className={"streak-note" + (reduce ? "" : " streak-rise")}>{t.streak.frozenNow}</p>}
        <DayStrip days={week} today={today} show="weekday" stagger={!reduce} />
        <p className="muted small">{streakVerified(sync) ? t.streak.verified : t.streak.cached}</p>
        <p className="muted small">{t.streak.loginNote}</p>
      </div>
    </Sheet>
  );
}
