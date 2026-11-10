import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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

// ---------- Artwork (original SVG; layering after design/…jpg and …gif, drawn from scratch) ----------

type FlameState = 'lit' | 'frozen' | 'cold';
/**
 * static — at rest; idle — slow breathing/sway loop (lit dashboard flame); fade — reduced motion;
 * ignite — colour rises from the base (welcome); celebrate — ignite, warm pulse and the counter rolling from `from`
 * to `number`; recover — frost cracks and shatters, the lit flame underneath ignites, then the counter rolls.
 */
export type FlameAnim = 'static' | 'idle' | 'fade' | 'ignite' | 'celebrate' | 'recover';

// Three nested layers: rounded outer flame (main tip, small right tongue), a warm middle flame and a small inner
// flame at the base that holds the number. Flame bounds: x 16–86, y 6–114.
const OUTER = 'M47 6C49 20 58 28 64 40C66 44 67 49 67 54C71 50 74 45 75 39C82 49 86 61 86 75C86 98 70 114 51 114C32 114 16 99 16 77C16 55 30 42 38 28C42 21 45 14 47 6Z';
const MID = 'M52 38C55 51 66 60 68 73C69 79 68 83 66 87C70 85 73 81 74 76C77 82 78 89 77 95C75 105 65 112 51 112C37 112 27 104 26 92C25 76 36 66 44 56C48 50 51 45 52 38Z';
const INNER = 'M50 66C55 75 65 82 65 94C65 104 58 110 50 110C42 110 35 104 35 94C35 82 45 75 50 66Z';
const HIGHLIGHT = 'M29 64C25 74 25 87 30 97';
const CRYSTALS = 'M28 74l5-5l3 6M33 69l1-6M70 62l-5-4M73 86l-6 2l2 5M44 34l3 6';
const SNOW = 'M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9.5 3.5L12 5.5l2.5-2M9.5 20.5L12 18.5l2.5 2M3.6 10.4l2.9-.9-.6-3M20.4 13.6l-2.9.9.6 3M3.6 13.6l2.9.9-.6 3M20.4 10.4l-2.9-.9.6-3';
// The canvas extends 24 units beyond the flame on every side: the glow (3σ = 18), the pulse and embers stay inside.
const VIEW = { x: -8, y: -18, w: 118, h: 156 };
const VIEWBOX = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;
type Palette = 'lit' | 'frozen' | 'ash';
const COLORS: Record<Palette, { outer: string[]; mid: string[]; inner: string[]; hi: string; glow: string; stroke: string }> = {
  lit: { outer: ['#ff7b5c', '#e2362b'], mid: ['#ffa64e', '#ff6b22'], inner: ['#fff2dc', '#ffc58a'], hi: '#ffd8c4', glow: '#ff5a36', stroke: '#b9321b' },
  frozen: { outer: ['#a9e1ff', '#3a8fd8'], mid: ['#d2f0ff', '#78c0f1'], inner: ['#f7fcff', '#d4f0ff'], hi: '#ffffff', glow: '#5cc6ff', stroke: '#2a6aa8' },
  ash: { outer: ['#5f5f5c', '#484845'], mid: ['#6d6d69', '#57574f'], inner: ['#85857f', '#6c6c66'], hi: '#8a8a85', glow: '#000000', stroke: '#3a3a37' },
};
const EMBERS = [
  { x: 38, y: 26, dx: -10, d: 0 },
  { x: 48, y: 12, dx: -3, d: 90 },
  { x: 64, y: 40, dx: 9, d: 40 },
  { x: 74, y: 40, dx: 12, d: 150 },
  { x: 30, y: 52, dx: -13, d: 120 },
];
// Ice shards: six wedges around the impact point; cracks run along their borders.
const HIT = { x: 50, y: 64 };
const SHARD_ANGLES = [-100, -40, 15, 75, 140, 200];
const rad = (a: number) => (a * Math.PI) / 180;
const at = (a: number, r: number) => `${(HIT.x + r * Math.cos(rad(a))).toFixed(1)} ${(HIT.y + r * Math.sin(rad(a))).toFixed(1)}`;
const SHARDS = SHARD_ANGLES.map((a, i) => {
  const b = i + 1 < SHARD_ANGLES.length ? SHARD_ANGLES[i + 1] : SHARD_ANGLES[0] + 360;
  const mid = (a + b) / 2;
  return { poly: `${HIT.x} ${HIT.y} ${at(a, 130)} ${at(mid, 130)} ${at(b, 130)}`, sx: 26 * Math.cos(rad(mid)), sy: 26 * Math.sin(rad(mid)) + 16, rot: i % 2 ? 14 : -12 };
});
const CRACKS = SHARD_ANGLES.map((a, i) => `M${HIT.x} ${HIT.y}L${at(a + (i % 2 ? 7 : -7), 14)}L${at(a - 4, 28)}L${at(a + 5, 42)}L${at(a - 2, 58)}`);

// Timeline (ms). Overlay: ~1.8–1.95 s on screen including the exit, dismissable at any time.
export const T = {
  ignite: { wipe: 140, wipeDur: 560, embers: 560, roll: 640 },
  recover: { crack: 200, shatter: 560, embers: 620, roll: 600 },
};

function Gradients({ id, palette }: { id: string; palette: Palette }) {
  const c = COLORS[palette];
  const lin = (k: 'outer' | 'mid' | 'inner', x2 = '0') => (
    <linearGradient id={`${id}${k[0]}${palette}`} x1="0" y1="0" x2={x2} y2="1">
      <stop offset="0%" stopColor={c[k][0]} />
      <stop offset="100%" stopColor={c[k][1]} />
    </linearGradient>
  );
  return <>{lin('outer', '0.25')}{lin('mid')}{lin('inner')}</>;
}

/** The three layers plus a soft highlight; frozen adds a translucent frost rim and fine crystal lines. */
function Body({ id, palette, frost = false }: { id: string; palette: Palette; frost?: boolean }) {
  const c = COLORS[palette];
  return (
    <>
      <path className="fl-o" d={OUTER} fill={`url(#${id}o${palette})`} />
      <path className="fl-m" d={MID} fill={`url(#${id}m${palette})`} />
      <path className="fl-i" d={INNER} fill={`url(#${id}i${palette})`} />
      <path d={HIGHLIGHT} fill="none" stroke={c.hi} strokeOpacity="0.35" strokeWidth="3.4" strokeLinecap="round" />
      {frost && (
        <g clipPath={`url(#${id}outer)`}>
          <path d={OUTER} fill="#ffffff" fillOpacity="0.12" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="4" />
          <path d={CRYSTALS} fill="none" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </>
  );
}

function SnowBadge() {
  return (
    <g transform="translate(68 6)">
      <circle cx="12" cy="12" r="13" fill="#1d1d1d" stroke="#bfe9ff" strokeWidth="1.5" />
      <path d={SNOW} fill="none" stroke="#dff5ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" transform="translate(3.6 3.6) scale(0.7)" />
    </g>
  );
}

const fontSize = (n: number) => (n > 999 ? 12 : n > 99 ? 16 : 22);
/** White numeral with a dark outline (painted behind the fill), so it stays crisp on the bright inner flame. */
function Num({ n, palette, className, blur, d }: { n: number; palette: Palette; className?: string; blur?: string; d?: number }) {
  const s = fontSize(n);
  return (
    <text className={className} x="50" y={96 + s * 0.36} fontSize={s} fill="#ffffff" stroke={COLORS[palette].stroke} strokeWidth={s / 6.5} strokeLinejoin="round" paintOrder="stroke" filter={blur} style={d != null ? { ['--d' as string]: `${d}ms` } : undefined}>
      {n}
    </text>
  );
}

/**
 * Streak flame, one artwork everywhere. Active: coral-red outer flame, orange middle, peach inner flame, warm glow.
 * Frozen: icy blue/cyan with translucent frost, crystal lines and a snowflake badge (readable without colour).
 * Cold (no streak): outline only.
 *
 * Safari: no CSS filters on SVG children (the roll blur is an SVG filter on a crossfading copy); the SMIL colour
 * wipe has a timed fallback that shows the full colour, so the flame never stays gray.
 */
export function Flame({ state, size, number, from, anim = 'static', label }: { state: FlameState; size: number; number?: number; from?: number; anim?: FlameAnim; label?: string }) {
  const id = 'f' + useId().replace(/:/g, '');
  const palette: Palette = state === 'frozen' ? 'frozen' : 'lit';
  const roll = (anim === 'celebrate' || anim === 'recover') && from != null && number != null && from !== number;
  const rollAt = anim === 'recover' ? T.recover.roll : T.ignite.roll;
  const igniting = anim === 'ignite' || anim === 'celebrate';
  // SMIL times count from page load, not from when this flame appears: start the wipe explicitly on mount.
  const wipe = useRef<SVGAnimateTransformElement>(null);
  const [wiped, setWiped] = useState(false);
  useEffect(() => {
    if (!igniting) return;
    wipe.current?.beginElementAt?.(T.ignite.wipe / 1000);
    const tm = setTimeout(() => setWiped(true), T.ignite.wipe + T.ignite.wipeDur + 80); // fallback if SMIL never ran
    return () => clearTimeout(tm);
  }, [igniting]);
  const pulseAt = anim === 'recover' ? T.recover.shatter : T.ignite.roll;
  return (
    <svg
      className={`flame flame-${state} anim-${anim}`}
      width={size}
      height={(size * VIEW.h) / VIEW.w}
      viewBox={VIEWBOX}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ ['--p' as string]: `${pulseAt}ms` }}
    >
      <defs>
        <Gradients id={id} palette="lit" />
        <Gradients id={id} palette="frozen" />
        <Gradients id={id} palette="ash" />
        <filter id={`${id}glow`} filterUnits="userSpaceOnUse" x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h}>
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={`${id}mb`} x="-0.3" y="-0.8" width="1.6" height="2.6">
          <feGaussianBlur stdDeviation="0.3 1.8" />
        </filter>
        <clipPath id={`${id}outer`}>
          <path d={OUTER} />
        </clipPath>
        {igniting && !wiped && (
          // Colour rises from the base with a licking top edge (as in the reference). SMIL, so it also runs in Safari.
          <clipPath id={`${id}wipe`}>
            <path d="M-10 6Q2 -4 14 6T38 6T62 6T86 6T110 6V200H-10Z" transform="translate(0 132)">
              <animateTransform ref={wipe} attributeName="transform" type="translate" from="0 132" to="0 -30" begin="indefinite" dur={`${T.ignite.wipeDur}ms`} fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.35 0.1 0.25 1" />
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
        <path className={'fl-glow' + (anim === 'recover' || anim === 'celebrate' ? ' fl-glowpulse' : '')} d={OUTER} fill={COLORS[palette].glow} filter={`url(#${id}glow)`} />
      )}

      {state === 'cold' ? (
        <g fill="none" stroke="#77776f" strokeWidth="2.6" strokeLinejoin="round">
          <path d={OUTER} />
          <path d={INNER} />
        </g>
      ) : (
        <g className={'fl-main' + (anim === 'fade' ? ' fl-fade' : '') + (anim === 'celebrate' || anim === 'recover' ? ' fl-pulse' : '')}>
          {igniting && !wiped ? (
            <>
              <Body id={id} palette="ash" />
              <g clipPath={`url(#${id}wipe)`}>
                <Body id={id} palette={palette} />
              </g>
            </>
          ) : (
            <Body id={id} palette={palette} frost={state === 'frozen'} />
          )}
        </g>
      )}

      {anim === 'recover' && (
        <>
          {/* Frost over the lit flame: cracks spread, then the ice becomes shards that drift apart and fade. */}
          <g className="rv-ice">
            <Body id={id} palette="frozen" frost />
          </g>
          {SHARDS.map((s, i) => (
            <g key={i} className="rv-shard" style={{ ['--sx' as string]: `${s.sx}px`, ['--sy' as string]: `${s.sy}px`, ['--rot' as string]: `${s.rot}deg` }}>
              <g clipPath={`url(#${id}s${i})`}>
                <Body id={id} palette="frozen" frost />
              </g>
            </g>
          ))}
          <g className="rv-cracks">
            {CRACKS.map((d, i) => <path key={i} d={d} pathLength={1} />)}
          </g>
          <g className="rv-badge"><SnowBadge /></g>
        </>
      )}

      {(anim === 'celebrate' || anim === 'recover' || anim === 'ignite') &&
        EMBERS.map((p, i) => (
          <ellipse key={i} className="fl-ember" cx={p.x} cy={p.y} rx="1.3" ry="2.4" fill="#ffb27a" style={{ ['--dx' as string]: `${p.dx}px`, ['--d' as string]: `${(anim === 'recover' ? T.recover.embers : T.ignite.embers) + p.d}ms` }} />
        ))}

      {number != null && (
        <g className="fl-num" fontWeight="800" textAnchor="middle">
          {roll ? (
            <g clipPath={`url(#${id}outer)`}>
              <Num n={from!} palette={anim === 'recover' ? 'frozen' : 'lit'} className="fl-num-old" d={rollAt} />
              <Num n={from!} palette={anim === 'recover' ? 'frozen' : 'lit'} className="fl-num-oldblur" blur={`url(#${id}mb)`} d={rollAt} />
              <Num n={number} palette="lit" className="fl-num-newblur" blur={`url(#${id}mb)`} d={rollAt} />
              <Num n={number} palette="lit" className="fl-num-new" d={rollAt} />
            </g>
          ) : state === 'cold' ? (
            <text x="50" y={96 + fontSize(number) * 0.36} fontSize={fontSize(number)} fill="#b5b5b0">{number}</text>
          ) : (
            <Num n={number} palette={palette} className={anim === 'ignite' ? 'fl-num-fade' : undefined} />
          )}
        </g>
      )}

      {state === 'frozen' && anim !== 'recover' && <SnowBadge />}
    </svg>
  );
}

function DayIcon({ state }: { state: DayState }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (state === 'done') return <svg {...common} viewBox="12 4 78 112"><path d={OUTER} fill="currentColor" stroke="none" /></svg>;
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
  const reduce = useReduce();
  const state = flameState(r);
  useEffect(() => {
    // The idle loop pauses while the page is hidden (CSS: .page-hidden).
    const sync = () => document.documentElement.classList.toggle('page-hidden', document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  return (
    <>
      <button className="streak-badge" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={t.streak.badge(r.current, r.protectedByFreeze)}>
        <span className="streak-badge-main">
          <Flame state={state} size={34} anim={state === 'lit' && !reduce ? 'idle' : 'static'} />
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
const EXIT_MS = 300;

/**
 * Large centred flame over a dimmed backdrop. Shared by the real celebration and the Settings previews, so the
 * preview is exactly what a newly earned day shows. Never takes focus; a tap or Escape closes it at once; while
 * someone is typing (`passive`) it ignores input entirely. `stay`: ms until it leaves on its own (null: on tap only).
 */
export function FlameOverlay({ state, anim, from, to, title, subtitle, stay, passive = false, preview, onClose, children }: {
  state: FlameState;
  anim: FlameAnim;
  from?: number;
  to: number;
  title: string;
  subtitle: string;
  stay: number | null;
  passive?: boolean;
  preview?: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  const reduce = useReduce();
  const [leaving, setLeaving] = useState(false);
  const [size] = useState(() => Math.round(Math.min(window.innerWidth * 0.66, window.innerHeight * 0.42, 300)));
  useEffect(() => {
    if (stay == null) return;
    const a = setTimeout(() => setLeaving(true), stay);
    return () => clearTimeout(a);
  }, [stay]);
  useEffect(() => {
    if (!leaving) return;
    const b = setTimeout(onClose, reduce ? 150 : EXIT_MS);
    return () => clearTimeout(b);
  }, [leaving, reduce, onClose]);
  useEffect(() => {
    if (passive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // only the overlay closes, not a sheet underneath
      setLeaving(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [passive]);

  // The text under the flame changes together with the counter.
  const textAt = anim === 'celebrate' ? T.ignite.roll : anim === 'recover' ? T.recover.roll : 0;
  return (
    <div className={'celebrate' + (leaving ? ' leaving' : '') + (reduce ? ' reduced' : '') + (passive ? ' passive' : '')} onClick={() => setLeaving(true)} role="status" aria-live="polite">
      <div className="celebrate-card">
        {preview && <p className="celebrate-preview">{preview}</p>}
        <Flame state={state} size={size} number={to} from={from} anim={anim} />
        <div className="celebrate-text" style={{ ['--d' as string]: `${textAt}ms` }}>
          <p className="celebrate-count">{title}</p>
          <p className="celebrate-kind">{subtitle}</p>
        </div>
        {children}
        <span className="sr-only">{t.streak.dismissHint}</span>
      </div>
    </div>
  );
}

/**
 * Celebrates when the user's own durably saved action earns today as a new streak day. The counter rolls from the
 * real previous value to the new one; after a freeze the ice cracks and shatters first. Never on reload, sync, token
 * refresh, account switch, failed saves, backdated edits or a second time for the same day (stored per account).
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
  const [cel, setCel] = useState<(Celebration & { id: number; passive: boolean }) | null>(null);
  const close = useCallback(() => setCel(null), []);

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
        setCel({ ...c, id: Date.now(), passive: isEditable(document.activeElement) });
      })
      .catch(() => {});
  }, [r, localWrite, today, prefs]);

  if (!cel) return null;
  return (
    <FlameOverlay
      key={cel.id}
      state="lit"
      anim={reduce ? 'fade' : cel.kind === 'recovery' ? 'recover' : 'celebrate'}
      from={cel.from}
      to={cel.to}
      title={t.streak.daysActive(cel.to)}
      subtitle={t.streak.celebrate[cel.kind]}
      stay={reduce ? 1500 : cel.kind === 'recovery' ? 1650 : 1500}
      passive={cel.passive}
      onClose={close}
    >
      <DayStrip days={week} today={today} show="weekday" labels={false} pop={reduce ? undefined : today} />
    </FlameOverlay>
  );
}

/** Settings previews: the production overlay with sample numbers. Reads and writes nothing. */
export type FlamePreview = 'lit' | 'celebrate' | 'frozen' | 'recover';
export function FlamePreviewOverlay({ kind, onClose }: { kind: FlamePreview; onClose: () => void }) {
  const t = useT();
  const reduce = useReduce();
  const p = t.streak.preview;
  const common = { to: kind === 'lit' || kind === 'frozen' ? 5 : 6, preview: p.badge, onClose };
  if (kind === 'lit') return <FlameOverlay {...common} state="lit" anim={reduce ? 'fade' : 'idle'} title={t.streak.daysActive(5)} subtitle={p.tapToClose} stay={null} />;
  if (kind === 'frozen') return <FlameOverlay {...common} state="frozen" anim={reduce ? 'fade' : 'static'} title={t.streak.daysActive(5)} subtitle={t.streak.frozenNow} stay={null} />;
  const rec = kind === 'recover';
  return <FlameOverlay {...common} state="lit" anim={reduce ? 'fade' : rec ? 'recover' : 'celebrate'} from={5} title={t.streak.daysActive(6)} subtitle={t.streak.celebrate[rec ? 'recovery' : 'continue']} stay={reduce ? 1500 : rec ? 1650 : 1500} />;
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
