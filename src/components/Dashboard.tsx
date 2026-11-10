import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, useId, useRef, useState } from 'react';
import { addDays, formatShort, startOfWeek, type DateKey } from '../lib/date';
import { dayProgress, percent, shouldCelebrate, weekProgress, type Progress } from '../lib/dashboard';
import { weekEnd } from '../lib/weekly';
import { useStore } from '../store';
import { Segmented, useReduce } from './ui';

type Mode = 'day' | 'week';
const MODE_KEY = 'still-dashboard-mode';
const readMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'week' ? 'week' : 'day';
  } catch {
    return 'day';
  }
};

/** Compact home dashboard: "Heute / Woche" switch, glowing progress ring, clear caption. */
export function Dashboard({ date }: { date: DateKey }) {
  const { habits, getEntry, analyses, completions, settings, today } = useStore();
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m); // per-device convenience only
    } catch { /* ignore */ }
  };
  const ws = startOfWeek(date, settings.weekStart);
  const p: Progress = mode === 'day' ? dayProgress(habits, getEntry, date) : weekProgress(habits, analyses, completions, ws);
  const pc = percent(p.ratio);

  const dayName = date === today ? 'Heute' : date === addDays(today, -1) ? 'Gestern' : formatShort(date);
  const weekName = ws === startOfWeek(today, settings.weekStart) ? 'Diese Woche' : `${formatShort(ws)} – ${formatShort(weekEnd(ws))}`;
  const caption =
    p.ratio == null
      ? mode === 'day'
        ? `${dayName} · keine täglichen Gewohnheiten geplant`
        : `${weekName} · keine Wochenziele`
      : mode === 'day'
        ? `${dayName} · ${p.done} von ${p.total} erledigt`
        : `${weekName} · ${p.done} von ${p.total} ${p.total === 1 ? 'Ziel' : 'Zielen'} erreicht`;
  const hint =
    p.ratio == null
      ? mode === 'day'
        ? 'Wochenziele findest du unter „Woche".'
        : 'Lege eine Gewohnheit mit „X-mal pro Woche" an oder nutze Analysen.'
      : mode === 'week'
        ? 'Durchschnitt aller Wochenziele, jedes höchstens 100 %.'
        : null;

  return (
    <section className="card dashboard" aria-label="Fortschritt">
      <Segmented<Mode> label="Zeitraum des Fortschritts" value={mode} onChange={setMode} options={[{ value: 'day', label: 'Heute' }, { value: 'week', label: 'Woche' }]} />
      <div className="dash-body">
        <GlowRing ratio={p.ratio} ringKey={`${mode}|${mode === 'day' ? date : ws}`} label={`${caption}${pc != null ? `, ${pc} Prozent` : ''}`} />
        <div className="dash-text">
          <p className="dash-caption" aria-live="polite">{caption}</p>
          {hint && <p className="muted small">{hint}</p>}
        </div>
      </div>
    </section>
  );
}

const SIZE = 132;
const STROKE = 9;
const R = (SIZE - STROKE) / 2 - 6; // room for the glow
const C = 2 * Math.PI * R;

/**
 * SVG donut. One motion value drives arc, glow and percentage, so rapid updates interrupt each other smoothly
 * (each change animates from the value currently shown). Readable without glow; the label is the text summary.
 */
function GlowRing({ ratio, ringKey, label }: { ratio: number | null; ringKey: string; label: string }) {
  const reduce = useReduce();
  const id = useId().replace(/:/g, '');
  const target = ratio ?? 0;
  const mv = useMotionValue(target);
  const glow = useMotionValue(0.32);
  const scale = useMotionValue(1);
  const offset = useTransform(mv, (v) => C * (1 - Math.min(1, Math.max(0, v))));
  const shown = useTransform(mv, (v) => Math.round(Math.min(1, Math.max(0, v)) * 100));
  // Round caps would leave a dot at 0 %: hide the arc (and its glow) while it is empty.
  const arcOpacity = useTransform(mv, (v) => (v < 0.004 ? 0 : 1));
  const glowOpacity = useTransform([glow, mv], ([g, v]: number[]) => (v < 0.004 ? 0 : g));
  const prev = useRef<{ key: string; ratio: number | null }>({ key: ringKey, ratio });
  const lastCelebration = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = { key: ringKey, ratio };
    const sameRing = before.key === ringKey;
    const ctl = animate(mv, target, reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 150, damping: 24, mass: 0.9 });
    if (!sameRing || reduce) return () => ctl.stop();
    if (ratio != null && (before.ratio ?? 0) < ratio) {
      // Progress increased: brief, restrained brightening of the glow.
      animate(glow, [0.32, 0.8, 0.32], { duration: 0.75, ease: 'easeOut' });
    }
    if (shouldCelebrate(before.ratio, ratio, ringKey, lastCelebration.current, Date.now())) {
      lastCelebration.current = { key: ringKey, at: Date.now() };
      animate(scale, [1, 1.045, 1], { duration: 0.6, ease: 'easeInOut' });
      animate(glow, [0.32, 1, 0.4], { duration: 1.1, ease: 'easeOut' });
    }
    return () => ctl.stop();
  }, [ratio, ringKey, target, reduce, mv, glow, scale]);

  return (
    <motion.figure className="ring-figure" role="img" aria-label={label} style={{ scale }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f4f4f2" />
            <stop offset="100%" stopColor="#b9b9b5" />
          </linearGradient>
          <filter id={`f${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#2e2e2e" strokeWidth={STROKE} />
          {!reduce && (
            <motion.circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#e8e8e5" strokeWidth={STROKE + 2} strokeLinecap="round"
              strokeDasharray={C} style={{ strokeDashoffset: offset, opacity: glowOpacity }} filter={`url(#f${id})`} />
          )}
          <motion.circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={`url(#g${id})`} strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={C} style={{ strokeDashoffset: offset, opacity: arcOpacity }} />
        </g>
      </svg>
      <span className="ring-center" aria-hidden="true">
        {ratio == null ? <span className="ring-empty">–</span> : <><motion.span>{shown}</motion.span><span className="ring-pct">%</span></>}
      </span>
    </motion.figure>
  );
}
