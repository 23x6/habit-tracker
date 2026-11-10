import { useMemo, useState } from 'react';
import { DailyList, GoalList } from '../components/ProgressLists';
import { Icon, Segmented } from '../components/ui';
import { useT } from '../i18n';
import { addDays, formatRange, formatShort, startOfWeek, weekdayOrder, weekdayShort, type DateKey } from '../lib/date';
import { isComplete, isScheduled, pct, sumRates, type Habit } from '../lib/model';
import { dailyStats, goalStats, spanRange, type Span } from '../lib/review';
import { useStore } from '../store';

const HEAT_WEEKS = 18;

const SPAN_KEY = 'still-stats-span';
const readSpan = (): Span => {
  try {
    return localStorage.getItem(SPAN_KEY) === '30' ? 30 : 7;
  } catch {
    return 7;
  }
};

export function Stats({ onOpen, onReview }: { onOpen: (h: Habit) => void; onReview: () => void }) {
  const t = useT();
  const { habits, today, getEntry, settings, analyses, completions } = useStore();
  const [span, setSpanState] = useState<Span>(readSpan);
  const setSpan = (v: Span) => {
    setSpanState(v);
    try {
      localStorage.setItem(SPAN_KEY, String(v)); // per-device convenience only
    } catch { /* ignore */ }
  };
  const { from, to } = spanRange(span, today);
  const daily = useMemo(() => dailyStats(habits, getEntry, from, to, today), [habits, getEntry, from, to, today]);
  const goals = useMemo(() => goalStats(habits, analyses, completions, from, to, today, settings.weekStart), [habits, analyses, completions, from, to, today, settings.weekStart]);
  const total = sumRates(daily);

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
      <div className="screen-head">
        <h1 className="screen-title">{t.stats.title}</h1>
        <button className="btn" onClick={onReview}><Icon name="journal" size={18} /> {t.stats.openReview}</button>
      </div>

      <section className="card span-card" aria-label={t.stats.span}>
        <Segmented<Span> label={t.stats.span} value={span} onChange={setSpan} options={[{ value: 7, label: t.stats.days7 }, { value: 30, label: t.stats.days30 }]} />
        <p className="span-range" aria-live="polite">{formatRange(from, to)}</p>
      </section>

      {!daily.length && !goals.length ? (
        <p className="card muted">{t.stats.emptyRange(span)}</p>
      ) : (
        <>
          {daily.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>{t.stats.dailyTitle}</h2>
                <span className="muted small">{t.stats.dailyTotal(total.done, total.scheduled)}{pct(total) !== null && ` · ${pct(total)} %`}</span>
              </div>
              <DailyList rows={daily} onOpen={onOpen} />
              <p className="muted small">{t.stats.streakNote}</p>
            </section>
          )}
          {goals.length > 0 && (
            <section className="card">
              <h2>{t.stats.goalsTitle}</h2>
              <GoalList rows={goals} onOpen={onOpen} />
            </section>
          )}
        </>
      )}

      <section className="card">
        <h2>{t.stats.activity}</h2>
        <Heatmap />
      </section>
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
