import { useT } from '../i18n';
import { formatNumber, formatRange } from '../lib/date';
import { isArchived, pct, type Habit } from '../lib/model';
import type { DailyStat, GoalStat, GoalWeek } from '../lib/review';
import { weekLabel } from '../lib/weekly';
import { Icon } from './ui';

/** Daily / weekday habits: completed of scheduled days, count beside the percentage; today shown as still open. */
export function DailyList({ rows, onOpen }: { rows: DailyStat[]; onOpen?: (h: Habit) => void }) {
  const t = useT();
  return (
    <ul className="plain-list rates">
      {rows.map(({ habit: h, done, scheduled, open }) => {
        const p = pct({ done, scheduled });
        const openText = open && (h.kind === 'numeric' ? t.stats.openTodayNum(formatNumber(open.value), formatNumber(open.target), h.unit) : t.stats.openToday);
        const body = (
          <>
            <span className="row-icon"><Icon habit={h.icon} /></span>
            <span className="rate-text">
              <span className="row-name">{h.name}{isArchived(h) && <span className="muted small"> · {t.stats.archivedTag}</span>}</span>
              {openText && <span className="row-sub">{openText}</span>}
              <span className="bar" aria-hidden="true"><span className="bar-fill" style={{ transform: `scaleX(${(p ?? 0) / 100})` }} /></span>
            </span>
            <span className="rate-num">
              <span>{p === null ? '–' : `${p} %`}</span>
              <span className="rate-count">{done}/{scheduled}</span>
              <span className="sr-only">{p === null ? t.stats.noScheduledSr : t.stats.ofDaysSr(done, scheduled)}</span>
            </span>
          </>
        );
        return <li key={h.id}>{onOpen ? <button className="rate-row" onClick={() => onOpen(h)}>{body}</button> : <div className="rate-row">{body}</div>}</li>;
      })}
    </ul>
  );
}

function WeekLine({ w, kind, current }: { w: GoalWeek; kind: Habit['kind']; current?: boolean }) {
  const t = useT();
  const range = formatRange(w.start, w.end);
  const label = weekLabel({ start: w.start, count: w.count, target: w.target, achieved: w.achieved }, kind, t);
  return (
    <li className={'goal-week' + (w.achieved ? ' ok' : '') + (current ? ' current' : '')}>
      <span className="goal-week-range">{current ? t.stats.thisWeek(range) : range}{w.partial && !current && <span aria-hidden="true"> *</span>}</span>
      <span className="goal-week-count">
        {label}
        {!current && <> · {w.achieved ? t.stats.reached : t.stats.missed}</>}
      </span>
      {w.partial && !current && <span className="sr-only">{t.stats.partial}</span>}
    </li>
  );
}

/** Weekly goals: finished calendar weeks as results, the running week separately with its actual progress. */
export function GoalList({ rows, onOpen }: { rows: GoalStat[]; onOpen?: (h: Habit) => void }) {
  const t = useT();
  const anyPartial = rows.some((r) => r.weeks.some((w) => w.partial));
  return (
    <>
      <ul className="plain-list goal-list">
        {rows.map(({ habit: h, weeks, current }) => {
          const reached = weeks.filter((w) => w.achieved).length;
          const head = (
            <>
              <span className="row-icon"><Icon habit={h.icon} /></span>
              <span className="rate-text">
                <span className="row-name">{h.name}{isArchived(h) && <span className="muted small"> · {t.stats.archivedTag}</span>}</span>
                {(weeks.length > 0 || !current) && <span className="row-sub">{weeks.length ? t.stats.weeksResult(reached, weeks.length) : t.stats.noFinishedWeeks}</span>}
              </span>
            </>
          );
          return (
            <li key={h.id} className="goal-item">
              {onOpen ? <button className="rate-row" onClick={() => onOpen(h)}>{head}</button> : <div className="rate-row">{head}</div>}
              <ul className="plain-list goal-weeks">
                {weeks.map((w) => <WeekLine key={w.start} w={w} kind={h.kind} />)}
                {current && <WeekLine w={current} kind={h.kind} current />}
              </ul>
            </li>
          );
        })}
      </ul>
      {anyPartial && <p className="muted small">* {t.stats.partial}</p>}
    </>
  );
}
