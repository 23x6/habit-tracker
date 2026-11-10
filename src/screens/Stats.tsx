import { motion } from 'framer-motion';
import { Icon, springs, useReduce } from '../components/ui';
import { useT } from '../i18n';
import { addDays, endOfMonth, formatMonth, formatShort, startOfMonth, startOfWeek, weekdayOrder, weekdayShort, type DateKey } from '../lib/date';
import { isArchived, isComplete, isFrequencyAt, isScheduled, pct, rate, sumRates, type Habit } from '../lib/model';
import { countSource, weekLabel, weeklyGoals as goalsOf, weeklyStats, weekStatus } from '../lib/weekly';
import { useStore } from '../store';

const HEAT_WEEKS = 18;

export function Stats({ onOpen }: { onOpen: (h: Habit) => void }) {
  const t = useT();
  const { habits, today, getEntry, settings, analyses, completions } = useStore();
  const reduce = useReduce();
  const ws = startOfWeek(today, settings.weekStart);
  const weeklyGoals = goalsOf(habits, ws); // analyses and "X-mal pro Woche" — same set as the dashboard
  const ms = startOfMonth(today);
  const week = sumRates(habits.map((h) => rate(h, getEntry, ws, addDays(ws, 6), today)));
  const prevWeek = sumRates(habits.map((h) => rate(h, getEntry, addDays(ws, -7), addDays(ws, -1), today)));
  const month = sumRates(habits.map((h) => rate(h, getEntry, ms, endOfMonth(ms), today)));
  const active = habits.filter((h) => !isArchived(h) && h.kind !== 'weekly' && !isFrequencyAt(h, today));
  const from30 = addDays(today, -29);

  if (!habits.length) {
    return (
      <div className="screen">
        <h1 className="screen-title">{t.stats.title}</h1>
        <div className="empty">
          <div className="empty-mark" aria-hidden="true"><Icon name="chart" size={26} /></div>
          <h2>{t.stats.emptyTitle}</h2>
          <p>{t.stats.emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="screen-title">{t.stats.title}</h1>

      <div className="stat-grid">
        <Summary label={t.stats.weekDaily} r={week} sub={pct(prevWeek) !== null ? t.stats.prevWeek(pct(prevWeek)!) : undefined} />
        <Summary label={t.stats.monthDaily(formatMonth(today))} r={month} />
      </div>

      {weeklyGoals.length > 0 && (
        <section className="card">
          <h2>{t.stats.weeklyGoals}</h2>
          <ul className="plain-list rates">
            {weeklyGoals.map((h) => {
              const src = countSource(h, analyses, completions);
              const st = weekStatus(h, src, ws);
              const ws12 = weeklyStats(h, src, today, settings.weekStart);
              return (
                <li key={h.id}>
                  <button className="rate-row" onClick={() => onOpen(h)}>
                    <span className="row-icon"><Icon habit={h.icon} /></span>
                    <span className="rate-text">
                      <span className="row-name">{h.name}</span>
                      <span className="row-sub">{st.achieved ? t.row.weekReached(weekLabel(st, h.kind, t)) : weekLabel(st, h.kind, t)}</span>
                      <span className="bar" aria-hidden="true"><motion.span className="bar-fill" initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, st.count / st.target) }} transition={springs.gentle} /></span>
                    </span>
                    <span className="rate-num small-num">{ws12.weeks ? `${ws12.achieved}/${ws12.weeks}` : '–'}<span className="sr-only">{t.stats.weeksReachedSr}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="muted small">{t.stats.weeklyNote}</p>
        </section>
      )}

      <section className="card">
        <h2>{t.stats.activity}</h2>
        <Heatmap />
      </section>

      <section className="card">
        <h2>{t.stats.habits30}</h2>
        {active.length === 0 ? (
          <p className="muted">{t.stats.noActive}</p>
        ) : (
          <ul className="plain-list rates">
            {active.map((h, i) => {
              const r = rate(h, getEntry, from30 < h.startDate ? h.startDate : from30, today, today);
              const p = pct(r);
              return (
                <motion.li key={h.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.gentle, delay: Math.min(i, 8) * 0.03 }}>
                  <button className="rate-row" onClick={() => onOpen(h)}>
                    <span className="row-icon"><Icon habit={h.icon} /></span>
                    <span className="rate-text">
                      <span className="row-name">{h.name}</span>
                      <span className="bar" aria-hidden="true"><motion.span className="bar-fill" initial={{ scaleX: 0 }} animate={{ scaleX: (p ?? 0) / 100 }} transition={springs.gentle} /></span>
                    </span>
                    <span className="rate-num">{p === null ? '–' : `${p} %`}<span className="sr-only">{p === null ? t.stats.noScheduledSr : t.stats.ofDaysSr(r.done, r.scheduled)}</span></span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Summary({ label, r, sub }: { label: string; r: { done: number; scheduled: number }; sub?: string }) {
  const t = useT();
  const p = pct(r);
  return (
    <div className="card stat">
      <span className="muted small">{label}</span>
      {p === null ? <span className="big-num muted">–</span> : <span className="big-num">{p}<span> %</span></span>}
      <span className="muted small">{p === null ? t.stats.noDue : t.stats.ofDone(r.done, r.scheduled)}</span>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

function Heatmap() {
  const t = useT();
  const { habits, today, getEntry, settings } = useStore();
  const start = addDays(startOfWeek(today, settings.weekStart), -7 * (HEAT_WEEKS - 1));
  const cols: DateKey[][] = Array.from({ length: HEAT_WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const level = (d: DateKey) => {
    if (d > today) return -1;
    const due = habits.filter((h) => isScheduled(h, d));
    if (!due.length) return -1;
    const done = due.filter((h) => isComplete(h, getEntry(h.id, d), d)).length;
    return done / due.length;
  };
  return (
    <div className="heat-wrap">
      <div className="heat-labels" aria-hidden="true">
        {weekdayOrder(settings.weekStart).map((w, i) => <span key={w}>{i % 2 === 0 ? weekdayShort(w).slice(0, 2) : ''}</span>)}
      </div>
      <div className="heat" role="img" aria-label={t.stats.heatLabel(HEAT_WEEKS, formatShort(start))}>
        {cols.map((c) => (
          <div key={c[0]} className="heat-col">
            {c.map((d) => {
              const l = level(d);
              return <span key={d} className={'heat-cell' + (l < 0 ? ' blank' : '')} style={l >= 0 ? { opacity: 0.12 + l * 0.88 } : undefined} title={`${formatShort(d)}: ${l < 0 ? t.stats.nothingPlanned : t.common.percent(Math.round(l * 100))}`} />;
            })}
          </div>
        ))}
      </div>
      <div className="heat-legend muted small" aria-hidden="true">
        {t.stats.less} {[0.12, 0.4, 0.7, 1].map((o) => <span key={o} className="heat-cell" style={{ opacity: o }} />)} {t.stats.more}
      </div>
    </div>
  );
}
