import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { addDays, formatLong, fromKey, startOfWeek, weekday, weekdayShort, type DateKey } from '../lib/date';
import { celebrationFor, computeStreak, dayStateAt, streakVerified, welcomeStep, type Celebration, type DayState, type StreakResult } from '../lib/streak';
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

// ---------- Artwork (original SVG; silhouette after design/…jpg, motion after design/…gif) ----------

type FlameState = 'lit' | 'frozen' | 'cold';
/**
 * static — at rest; fade — reduced motion; ignite — colour rises from the base (welcome);
 * celebrate — ignite, embers and the counter rolling from `from` to `number`;
 * recover — frozen flame cracks and shatters, the lit flame underneath flares up, then the counter rolls.
 */
type FlameAnim = 'static' | 'fade' | 'ignite' | 'celebrate' | 'recover';

// Two tongues (large left, smaller right) with a drop inside that holds the number.
const OUTER = 'M40 8C30 30 18 44 18 72C18 96 32 112 50 112C70 112 84 98 84 74C84 58 80 44 74 30C70 42 66 48 60 54C56 38 50 22 40 8Z';
const INNER = 'M50 56C57 67 67 77 67 90C67 101 59 108 50 108C41 108 33 101 33 90C33 77 43 67 50 56Z';
const SNOW = 'M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9.5 3.5L12 5.5l2.5-2M9.5 20.5L12 18.5l2.5 2M3.6 10.4l2.9-.9-.6-3M20.4 13.6l-2.9.9.6 3M3.6 13.6l2.9.9-.6 3M20.4 10.4l-2.9-.9.6-3';
// The canvas extends 24 units beyond the flame (x 18–84, y 8–112) on every side: the glow (3σ = 21) is never clipped.
const VIEW = { x: -6, y: -16, w: 114, h: 152 };
const VIEWBOX = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;
const COLORS = {
  lit: { outer: ['#ff7a59', '#e0382c'], inner: ['#ffc24f', '#ff8a1e'], edge: '#ffb39c', glow: '#ff5a36', num: '#3b1407' },
  frozen: { outer: ['#b4e8ff', '#3c9ce2'], inner: ['#ecfaff', '#a7ddfb'], edge: '#f2fbff', glow: '#5cc6ff', num: '#0b2a40' },
  ash: { outer: ['#5d5d5a', '#474744'], inner: ['#73736f', '#5f5f5b'] },
};
const EMBERS = [
  { x: 36, y: 24, dx: -12, d: 0 },
  { x: 46, y: 14, dx: -4, d: 80 },
  { x: 62, y: 40, dx: 10, d: 40 },
  { x: 72, y: 32, dx: 14, d: 140 },
  { x: 54, y: 30, dx: 4, d: 200 },
  { x: 28, y: 50, dx: -16, d: 120 },
];
// Ice shards: six wedges around the impact point; cracks run along their borders.
const HIT = { x: 50, y: 66 };
const SHARD_ANGLES = [-100, -40, 15, 75, 140, 200];
const rad = (a: number) => (a * Math.PI) / 180;
const at = (a: number, r: number) => `${(HIT.x + r * Math.cos(rad(a))).toFixed(1)} ${(HIT.y + r * Math.sin(rad(a))).toFixed(1)}`;
const SHARDS = SHARD_ANGLES.map((a, i) => {
  const b = i + 1 < SHARD_ANGLES.length ? SHARD_ANGLES[i + 1] : SHARD_ANGLES[0] + 360;
  const mid = (a + b) / 2;
  return { poly: `${HIT.x} ${HIT.y} ${at(a, 130)} ${at(mid, 130)} ${at(b, 130)}`, sx: 44 * Math.cos(rad(mid)), sy: 44 * Math.sin(rad(mid)) + 14, rot: i % 2 ? 28 : -24 };
});
const CRACKS = SHARD_ANGLES.map((a, i) => `M${HIT.x} ${HIT.y}L${at(a + (i % 2 ? 6 : -6), 16)}L${at(a - 3, 30)}L${at(a + 4, 46)}`);

// Timeline (ms). Overlay: ~1.7–1.9 s on screen, dismissable at any time.
const T = {
  ignite: { wipe: 150, wipeDur: 520, embers: 560, roll: 680 },
  recover: { crack: 160, shatter: 560, flare: 580, embers: 700, roll: 900 },
};

function Gradients({ id, palette }: { id: string; palette: 'lit' | 'frozen' | 'ash' }) {
  const c = COLORS[palette];
  return (
    <>
      <linearGradient id={`${id}o${palette}`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0%" stopColor={c.outer[0]} />
        <stop offset="100%" stopColor={c.outer[1]} />
      </linearGradient>
      <linearGradient id={`${id}i${palette}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={c.inner[0]} />
        <stop offset="100%" stopColor={c.inner[1]} />
      </linearGradient>
    </>
  );
}

/** Outer flame, inner drop and a fine bright edge (the neon line of the reference). */
function Body({ id, palette, frost = false }: { id: string; palette: 'lit' | 'frozen' | 'ash'; frost?: boolean }) {
  const edge = palette === 'ash' ? 'none' : COLORS[palette].edge;
  return (
    <>
      <path d={OUTER} fill={`url(#${id}o${palette})`} stroke={edge} strokeOpacity="0.6" strokeWidth="1.4" strokeLinejoin="round" />
      <path d={INNER} fill={`url(#${id}i${palette})`} />
      {frost && (
        <>
          <path d={OUTER} fill={`url(#${id}hatch)`} />
          <path d="M28 70l6-4M30 84l7-1M74 60l-6 5M72 82l-6-2M44 30l4 6" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </>
      )}
    </>
  );
}

function SnowBadge() {
  return (
    <g transform="translate(70 12)">
      <circle cx="12" cy="12" r="14" fill="#1d1d1d" stroke="#bfe9ff" strokeWidth="1.5" />
      <path d={SNOW} fill="none" stroke="#dff5ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" transform="translate(3.6 3.6) scale(0.7)" />
    </g>
  );
}

/**
 * Streak flame. Active: red/coral outer flame, orange inner drop, warm glow. Frozen: icy blue, hatched frost and a
 * snowflake badge (readable without colour), cool glow. Cold (no streak): outline only.
 */
export function Flame({ state, size, number, from, anim = 'static', label }: { state: FlameState; size: number; number?: number; from?: number; anim?: FlameAnim; label?: string }) {
  const id = 'f' + useId().replace(/:/g, '');
  const palette = state === 'frozen' ? 'frozen' : 'lit';
  const roll = (anim === 'celebrate' || anim === 'recover') && from != null && from !== number;
  const rollAt = anim === 'recover' ? T.recover.roll : T.ignite.roll;
  const igniting = anim === 'ignite' || anim === 'celebrate';
  const fontSize = (n?: number) => (n != null && n > 99 ? 15 : 21);
  // SMIL times count from page load, not from when this flame appears: start the wipe explicitly on mount.
  const wipe = useRef<SVGAnimateTransformElement>(null);
  useEffect(() => {
    wipe.current?.beginElementAt?.(T.ignite.wipe / 1000);
  }, []);
  return (
    <svg
      className={`flame flame-${state} anim-${anim}`}
      width={size}
      height={(size * VIEW.h) / VIEW.w}
      viewBox={VIEWBOX}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <Gradients id={id} palette="lit" />
        <Gradients id={id} palette="frozen" />
        <Gradients id={id} palette="ash" />
        <pattern id={`${id}hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeOpacity="0.32" strokeWidth="1.6" />
        </pattern>
        <filter id={`${id}glow`} filterUnits="userSpaceOnUse" x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h}>
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <clipPath id={`${id}drop`}>
          <path d={INNER} />
        </clipPath>
        {igniting && (
          // Colour rises from the base with a licking top edge (as in the reference). SMIL, so it also runs in Safari.
          <clipPath id={`${id}wipe`}>
            <path d="M-10 6Q2 -4 14 6T38 6T62 6T86 6T110 6V200H-10Z" transform="translate(0 132)">
              <animateTransform ref={wipe} attributeName="transform" type="translate" from="0 132" to="0 -30" begin="indefinite" dur={`${T.ignite.wipeDur}ms`} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.3 0.6 0.3 1" />
            </path>
          </clipPath>
        )}
        {anim === 'recover' && SHARDS.map((s, i) => (
          <clipPath key={i} id={`${id}s${i}`}>
            <polygon points={s.poly} />
          </clipPath>
        ))}
      </defs>

      {state !== 'cold' && (
        <path
          className={'fl-glow' + (anim === 'recover' || anim === 'celebrate' ? ' fl-glowpulse' : '')}
          d={OUTER}
          fill={COLORS[palette].glow}
          filter={`url(#${id}glow)`}
          style={{ ['--d' as string]: `${anim === 'recover' ? T.recover.flare : T.ignite.embers}ms` }}
        />
      )}

      {state === 'cold' ? (
        <g fill="none" stroke="#77776f" strokeWidth="2.6" strokeLinejoin="round">
          <path d={OUTER} />
          <path d={INNER} />
        </g>
      ) : igniting ? (
        <>
          <Body id={id} palette="ash" />
          <g clipPath={`url(#${id}wipe)`}>
            <Body id={id} palette={palette} frost={state === 'frozen'} />
          </g>
        </>
      ) : (
        <g className={anim === 'fade' ? 'fl-fade' : undefined}>
          <Body id={id} palette={palette} frost={state === 'frozen'} />
        </g>
      )}

      {anim === 'recover' && (
        <>
          {/* Ice over the lit flame: cracks form, the ice is swapped for shards that fly apart and fade. */}
          <g className="rv-ice" style={{ ['--d' as string]: `${T.recover.shatter}ms` }}>
            <Body id={id} palette="frozen" frost />
            <SnowBadge />
          </g>
          <g className="rv-cracks" style={{ ['--d' as string]: `${T.recover.crack}ms`, ['--h' as string]: `${T.recover.shatter}ms` }}>
            {CRACKS.map((d, i) => <path key={i} d={d} pathLength={1} />)}
          </g>
          {SHARDS.map((s, i) => (
            <g key={i} className="rv-shard" style={{ ['--sx' as string]: `${s.sx}px`, ['--sy' as string]: `${s.sy}px`, ['--rot' as string]: `${s.rot}deg`, ['--d' as string]: `${T.recover.shatter}ms` }}>
              <g clipPath={`url(#${id}s${i})`}>
                <Body id={id} palette="frozen" frost />
              </g>
            </g>
          ))}
        </>
      )}

      {(anim === 'celebrate' || anim === 'recover' || anim === 'ignite') &&
        EMBERS.map((p, i) => (
          <ellipse
            key={i}
            className="fl-ember"
            cx={p.x}
            cy={p.y}
            rx="1.4"
            ry="2.6"
            fill="#ff8a4c"
            style={{ ['--dx' as string]: `${p.dx}px`, ['--d' as string]: `${(anim === 'recover' ? T.recover.embers : T.ignite.embers) + p.d}ms` }}
          />
        ))}

      {number != null && (
        <g clipPath={`url(#${id}drop)`} fontWeight="800" textAnchor="middle" className="fl-num">
          {roll ? (
            <>
              <text className="fl-num-old" x="50" y="98" fontSize={fontSize(from)} fill={anim === 'recover' ? COLORS.frozen.num : COLORS.lit.num} style={{ ['--d' as string]: `${rollAt}ms` }}>
                {from}
              </text>
              <text className="fl-num-new" x="50" y="98" fontSize={fontSize(number)} fill={COLORS.lit.num} style={{ ['--d' as string]: `${rollAt}ms` }}>
                {number}
              </text>
            </>
          ) : (
            <text className={anim === 'ignite' ? 'fl-num-fade' : undefined} x="50" y="98" fontSize={fontSize(number)} fill={state === 'cold' ? '#b5b5b0' : COLORS[palette].num}>
              {number}
            </text>
          )}
        </g>
      )}

      {state === 'frozen' && anim !== 'recover' && <SnowBadge />}
    </svg>
  );
}

function DayIcon({ state }: { state: DayState }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (state === 'done') return <svg {...common} viewBox="14 4 74 112"><path d={OUTER} fill="currentColor" stroke="none" /></svg>;
  if (state === 'frozen') return <svg {...common}><path d={SNOW} /></svg>;
  if (state === 'missed') return <svg {...common}><path d="M7 7l10 10M17 7L7 17" /></svg>;
  if (state === 'pending') return <svg {...common}><circle cx="12" cy="12" r="7.5" strokeDasharray="3 3" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></svg>;
}

/** Seven days with distinct, non-colour states. `labels`: accessible per-day text (off when the parent describes it). */
function DayStrip({ days, today, show, stagger = false, labels = true, pop }: { days: { date: DateKey; state: DayState }[]; today: DateKey; show: 'weekday' | 'date'; stagger?: boolean; labels?: boolean; pop?: DateKey }) {
  const t = useT();
  return (
    <ol className="streak-strip" aria-hidden={labels ? undefined : true}>
      {days.map((d, i) => (
        <li
          key={d.date}
          className={`sday s-${d.state}` + (d.date === today ? ' is-today' : '') + (stagger ? ' sday-in' : '') + (d.date === pop ? ' sday-pop' : '')}
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

/**
 * Compact streak next to the progress ring; opens the explanation and history. Separate from the ring's numbers.
 * Updates quietly (sync, edits of other days); the celebration of a newly earned day is StreakCelebration.
 */
export function StreakBadge() {
  const t = useT();
  const r = useStreak();
  const { today, settings } = useStore();
  const [open, setOpen] = useState(false);
  const week = useWeekDays(r, startOfWeek(today, settings.weekStart));

  return (
    <>
      <button className="streak-badge" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={t.streak.badge(r.current, r.protectedByFreeze)}>
        <span className="streak-badge-main">
          <Flame state={flameState(r)} size={32} />
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

// ---------- Celebration of a newly earned day ----------

const CELEBRATED = 'streak-celebrated'; // per account (partition meta), per earned day
const isEditable = (el: Element | null) => !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type)) || (el as HTMLElement).isContentEditable);

/**
 * Large centred flame when the user's own durably saved action earns today as a new streak day. The counter rolls
 * from the real previous value to the new one; after a freeze the ice cracks and shatters first. Never on reload,
 * sync, token refresh, account switch, failed saves, backdated edits or a second time for the same day (stored per
 * account). Doesn't take focus; a tap or Escape closes it at once; while someone is typing it ignores input.
 */
export function StreakCelebration() {
  const t = useT();
  const { localWrite, today, prefs, settings } = useStore();
  const r = useStreak();
  const reduce = useReduce();
  const week = useWeekDays(r, startOfWeek(today, settings.weekStart));
  const prev = useRef<StreakResult | null>(null);
  const lastWrite = useRef(localWrite.n);
  const claimed = useRef<DateKey | null>(null);
  const [cel, setCel] = useState<(Celebration & { id: number; size: number; passive: boolean }) | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const before = prev.current;
    prev.current = r;
    if (!before || localWrite.n === lastWrite.current) return; // first render, or a change that wasn't a local save
    lastWrite.current = localWrite.n;
    const c = celebrationFor(before, r, today, localWrite.dates, claimed.current);
    if (!c) return;
    claimed.current = c.date;
    void prefs
      .load<DateKey>(CELEBRATED)
      .then(async (done) => {
        if (done === c.date) return; // already celebrated on this account (e.g. undo and redo, or before a reload)
        await prefs.save(CELEBRATED, c.date);
        setLeaving(false);
        setCel({ ...c, id: Date.now(), size: Math.round(Math.min(window.innerWidth * 0.56, window.innerHeight * 0.36, 280)), passive: isEditable(document.activeElement) });
      })
      .catch(() => {});
  }, [r, localWrite, today, prefs]);

  const dismiss = () => setLeaving(true);
  useEffect(() => {
    if (!cel) return;
    const stay = reduce ? 1500 : cel.kind === 'recovery' ? 1850 : 1700;
    const a = setTimeout(() => setLeaving(true), stay);
    return () => clearTimeout(a);
  }, [cel, reduce]);
  useEffect(() => {
    if (!leaving) return;
    const b = setTimeout(() => (setCel(null), setLeaving(false)), reduce ? 150 : 260);
    return () => clearTimeout(b);
  }, [leaving, reduce]);
  useEffect(() => {
    if (!cel || cel.passive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // only the overlay closes, not a sheet underneath
      setLeaving(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cel]);

  if (!cel) return null;
  const anim: FlameAnim = reduce ? 'fade' : cel.kind === 'recovery' ? 'recover' : 'celebrate';
  return (
    <div
      className={'celebrate' + (leaving ? ' leaving' : '') + (reduce ? ' reduced' : '') + (cel.passive ? ' passive' : '')}
      onClick={dismiss}
      role="status"
      aria-live="polite"
    >
      <div className="celebrate-card" key={cel.id}>
        <Flame state="lit" size={cel.size} number={cel.to} from={cel.from} anim={anim} />
        <p className="celebrate-count">{t.streak.daysActive(cel.to)}</p>
        <p className="celebrate-kind">{t.streak.celebrate[cel.kind]}</p>
        <DayStrip days={week} today={today} show="weekday" labels={false} pop={reduce ? undefined : today} />
        <span className="sr-only">{t.streak.dismissHint}</span>
      </div>
    </div>
  );
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
 * 5 s). Shows the current streak as it is — the flame lights up into its state; nothing is counted or added.
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
        <Flame state={flameState(r)} size={140} number={r.current} anim={reduce || r.current === 0 ? 'fade' : 'ignite'} />
        <p className={'streak-hero-text' + (reduce ? '' : ' streak-rise')}>{r.current ? t.streak.daysActive(r.current) : t.streak.zero}</p>
        {r.protectedByFreeze && <p className={'streak-note' + (reduce ? '' : ' streak-rise')}>{t.streak.frozenNow}</p>}
        <DayStrip days={week} today={today} show="weekday" stagger={!reduce} />
        <p className="muted small">{streakVerified(sync) ? t.streak.verified : t.streak.cached}</p>
        <p className="muted small">{t.streak.loginNote}</p>
      </div>
    </Sheet>
  );
}
