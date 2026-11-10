import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { AnalysisSheet } from '../components/AnalysisSheet';
import { CompletionSheet } from '../components/CompletionSheet';
import { fmtNum } from '../components/HabitRow';
import { Confirm, Icon, Segmented, Sheet, springs, useReduce } from '../components/ui';
import { useT } from '../i18n';
import { addDays, addMonths, endOfMonth, formatLong, formatMonth, formatShort, formatTime, fromKey, startOfMonth, startOfWeek, weekdayOrder, weekdayShort, type DateKey } from '../lib/date';
import { isArchived, isComplete, isScheduled, isWeeklyGoalAt, latestRule, pct, rate, ruleAt, streaks, targetAt, type Analysis, type Completion, type Habit } from '../lib/model';
import { countSource, itemsInWeek, weekEnd, weekLabel, weeklyStats, weekStatus } from '../lib/weekly';
import { useStore } from '../store';

type Period = 7 | 30 | 90 | 0;

export function Detail({ habit, onBack, onEdit }: { habit: Habit; onBack: () => void; onEdit: () => void }) {
  const t = useT();
  const { today, getEntry, entriesOf, setArchived, deleteHabit, settings, analyses, completions } = useStore();
  const weekly = habit.kind === 'weekly';
  const weeklyView = isWeeklyGoalAt(habit, today); // analyses, or "X-mal pro Woche" in force now
  const reduce = useReduce();
  const [month, setMonth] = useState(startOfMonth(today));
  const [period, setPeriod] = useState<Period>(30);
  const [editing, setEditing] = useState<DateKey | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = isArchived(habit);

  const s = streaks(habit, getEntry, today);
  const from = period === 0 ? habit.startDate : addDays(today, -(period - 1));
  const r = rate(habit, getEntry, from < habit.startDate ? habit.startDate : from, today, today);
  const p = pct(r);
  const notes = entriesOf(habit.id).filter((e) => e.note).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  const rule = ruleAt(habit, today);

  // Weekly completion for the last 12 weeks (grayscale bars).
  const weeks = useMemo(() => {
    const w0 = startOfWeek(today, settings.weekStart);
    return Array.from({ length: 12 }, (_, i) => {
      const ws = addDays(w0, -7 * (11 - i));
      return { start: ws, rate: rate(habit, getEntry, ws, addDays(ws, 6), today) };
    });
  }, [habit, getEntry, today, settings.weekStart]);

  useEffect(() => {
    // Escape goes back only when no sheet is open above the detail view.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.sheet') && onBack();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  const describe = (r: typeof rule) =>
    weekly
      ? t.detail.perWeekAnalyses(r.target)
      : r.perWeek != null
        ? t.detail.perWeek(r.perWeek, !!r.multi)
        : r.days.length === 7 ? t.detail.daily : weekdayOrder(settings.weekStart).filter((d) => r.days.includes(d)).map((d) => weekdayShort(d)).join(', ');
  const schedText = describe(rule);
  const pendingRule = latestRule(habit).from > today ? latestRule(habit) : null;
  const ownItems = weekly ? analyses.filter((a) => a.habitId === habit.id).length : completions.filter((c) => c.habitId === habit.id).length;

  return (
    <motion.div
      className="detail"
      role="region"
      aria-label={t.detail.region(habit.name)}
      initial={reduce ? { opacity: 0 } : { x: '100%' }}
      animate={reduce ? { opacity: 1 } : { x: 0 }}
      exit={reduce ? { opacity: 0 } : { x: '100%' }}
      transition={springs.sheet}
    >
      <div className="detail-inner">
        <header className="detail-head">
          <button className="icon-btn" onClick={onBack} aria-label={t.common.back} autoFocus><Icon name="left" /></button>
          <div className="head-actions">
            <button className="icon-btn" onClick={onEdit} aria-label={t.common.edit}><Icon name="edit" /></button>
          </div>
        </header>

        <div className="detail-title">
          <span className="row-icon big"><Icon habit={habit.icon} size={26} /></span>
          <div>
            <h1>{habit.name}</h1>
            <p className="muted small">
              {schedText}
              {habit.kind === 'numeric' && ` · ${fmtNum(rule.target)} ${habit.unit}`}
              {archived && t.detail.archivedTag}
            </p>
          </div>
        </div>
        {habit.description && <p className="muted">{habit.description}</p>}
        {pendingRule && <p className="effect-note">{t.detail.from(formatLong(pendingRule.from), describe(pendingRule))}</p>}

        {weeklyView ? <WeeklyBody habit={habit} /> : (<>
        <div className="stat-grid">
          <Stat label={t.detail.streak} value={s.current} unit={t.detail.days(s.current)} />
          <Stat label={t.detail.longest} value={s.longest} unit={t.detail.days(s.longest)} />
        </div>

        <section className="card">
          <div className="card-head">
            <h2>{t.detail.rate}</h2>
            <Segmented<Period> label={t.detail.period} value={period} onChange={setPeriod} options={([7, 30, 90, 0] as Period[]).map((v) => ({ value: v, label: t.detail.periods[v] }))} />
          </div>
          {p === null ? (
            <p className="muted">{t.detail.noScheduled}</p>
          ) : (
            <p className="big-num">{p}<span> %</span> <span className="muted small">{t.detail.ofDays(r.done, r.scheduled)}</span></p>
          )}
          <WeekBars weeks={weeks} />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{formatMonth(month)}</h2>
            <div className="head-actions">
              <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label={t.common.prevMonth}><Icon name="left" size={18} /></button>
              <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= startOfMonth(today)} aria-label={t.common.nextMonth}><Icon name="right" size={18} /></button>
            </div>
          </div>
          <MonthGrid habit={habit} month={month} onPick={setEditing} />
          <p className="muted small">{t.detail.tapDay}</p>
        </section>

        {notes.length > 0 && (
          <section className="card">
            <h2>{t.detail.notes}</h2>
            <ul className="plain-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <button className="note-item" onClick={() => setEditing(n.date)}>
                    <span className="muted small">{formatShort(n.date)}</span>
                    <span>{n.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        </>)}

        <section className="actions-list">
          <button className="btn wide" onClick={() => setArchived(habit.id, !archived)}>
            <Icon name={archived ? 'restore' : 'archive'} size={18} /> {archived ? t.common.restore : t.common.archive}
          </button>
          <button className="btn wide danger-text" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={18} /> {t.detail.deleteForever}
          </button>
          <p className="muted small">{t.detail.archiveNote}</p>
        </section>
      </div>

      <EntrySheet habit={habit} date={editing} onClose={() => setEditing(null)} />
      <Confirm
        open={confirmDelete}
        title={t.detail.deleteTitle}
        text={t.detail.deleteText(habit.name, weekly ? t.detail.nAnalyses(ownItems) : t.detail.nEntries(entriesOf(habit.id).length + ownItems))}
        action={t.common.delete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          onBack();
          deleteHabit(habit.id);
        }}
      />
    </motion.div>
  );
}

/** Weekly goal view: analyses ("Substack analysieren") or completions ("X-mal pro Woche"). */
function WeeklyBody({ habit }: { habit: Habit }) {
  const t = useT();
  const { today, settings, analyses, completions, deleteCompletion } = useStore();
  const reduce = useReduce();
  const isAnalysis = habit.kind === 'weekly';
  const source = countSource(habit, analyses, completions);
  const current = startOfWeek(today, settings.weekStart);
  const [ws, setWs] = useState(current);
  const [analysisSheet, setAnalysisSheet] = useState<{ analysis: Analysis | null } | null>(null);
  const [completionSheet, setCompletionSheet] = useState<{ completion: Completion | null } | null>(null);
  useEffect(() => setWs(current), [current]); // week start preference changed or a new week began

  const goalWeek = isWeeklyGoalAt(habit, ws);
  const st = weekStatus(habit, source, ws);
  const items = itemsInWeek(source, habit.id, ws);
  const stats = weeklyStats(habit, source, today, settings.weekStart);
  const p = stats.weeks ? Math.round((stats.achieved / stats.weeks) * 100) : null;
  const firstWeek = startOfWeek(habit.startDate, settings.weekStart);
  const bars = Array.from({ length: 12 }, (_, i) => weekStatus(habit, source, addDays(current, -7 * (11 - i))));
  const barText = (b: (typeof bars)[number]) =>
    b.start < firstWeek ? t.detail.notStarted : !isWeeklyGoalAt(habit, b.start) ? t.detail.noGoal : weekLabel(b, habit.kind, t);
  const isCurrent = ws === current;
  const add = () => (isAnalysis ? setAnalysisSheet({ analysis: null }) : setCompletionSheet({ completion: null }));

  return (
    <>
      <div className="stat-grid">
        <Stat label={t.detail.weeksInRow} value={stats.current} unit={t.detail.weeks(stats.current)} />
        <Stat label={t.detail.longestRun} value={stats.longest} unit={t.detail.weeks(stats.longest)} />
      </div>

      <section className="card" aria-labelledby="week-h">
        <div className="card-head">
          <h2 id="week-h">{isCurrent ? t.common.thisWeek : `${formatShort(ws)} – ${formatShort(weekEnd(ws))}`}</h2>
          <div className="head-actions">
            <button className="icon-btn" onClick={() => setWs(addDays(ws, -7))} disabled={ws <= firstWeek} aria-label={t.common.prevWeek}><Icon name="left" size={18} /></button>
            <button className="icon-btn" onClick={() => setWs(addDays(ws, 7))} disabled={isCurrent} aria-label={t.common.nextWeek}><Icon name="right" size={18} /></button>
          </div>
        </div>
        {goalWeek ? (
          <div className="week-goal" aria-live="polite">
            <p className="big-num">{st.count}<span>{weekLabel(st, habit.kind, t).slice(String(st.count).length)}</span></p>
            {st.achieved && <p className="goal-badge"><Icon name="check" size={14} /> {t.detail.weekReached}</p>}
            {!st.achieved && isCurrent && <p className="muted small">{t.detail.remaining(st.target - st.count)}</p>}
            <span className="bar thick" role="progressbar" aria-valuemin={0} aria-valuemax={st.target} aria-valuenow={Math.min(st.count, st.target)} aria-label={weekLabel(st, habit.kind, t)}>
              <motion.span className="bar-fill" initial={false} animate={{ scaleX: Math.min(1, st.count / st.target) }} transition={springs.gentle} />
            </span>
          </div>
        ) : (
          <p className="muted">{t.detail.dailyWeek}</p>
        )}
        {items.length === 0 ? (
          goalWeek && <p className="muted">{isCurrent ? (isAnalysis ? t.detail.noAnalysisThisWeek : t.detail.noCompletionThisWeek) : isAnalysis ? t.detail.noAnalysisThen : t.detail.noCompletionThen}</p>
        ) : (
          <ul className="plain-list">
            <AnimatePresence initial={false}>
              {items.map((it) => (
                <motion.li
                  key={it.id}
                  layout={reduce ? false : 'position'}
                  initial={reduce ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={springs.gentle}
                >
                  {isAnalysis ? (
                    <button className="note-item" onClick={() => setAnalysisSheet({ analysis: it as Analysis })}>
                      <span className="muted small">{formatLong(it.date)}</span>
                      <span className="entry-title">{(it as Analysis).title}</span>
                      <span className="entry-text clamp">{(it as Analysis).learnings}</span>
                    </button>
                  ) : (
                    <div className="completion-item">
                      <button className="note-item" onClick={() => setCompletionSheet({ completion: it as Completion })} aria-label={t.detail.editCompletion(formatLong(it.date))}>
                        <span>{formatLong(it.date)}</span>
                        <span className="muted small">{t.detail.recordedAt(formatTime(it.createdAt))}</span>
                      </button>
                      <button className="icon-btn" onClick={() => void deleteCompletion(it.id)} aria-label={t.detail.deleteCompletion(formatLong(it.date))}>
                        <Icon name="trash" size={18} />
                      </button>
                    </div>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {(goalWeek || isAnalysis) && (
          <button className="btn primary" onClick={add}>
            <Icon name="plus" size={18} /> {isAnalysis ? t.detail.addAnalysis : t.detail.addCompletion}
          </button>
        )}
      </section>

      <section className="card">
        <h2>{t.detail.weeklyGoals}</h2>
        {p === null ? (
          <p className="muted">{t.detail.noFinishedWeek}</p>
        ) : (
          <p className="big-num">{p}<span> %</span> <span className="muted small">{t.detail.weeksReached(stats.achieved, stats.weeks)}</span></p>
        )}
        <div className="bars" role="img" aria-label={t.detail.barsLabel(isAnalysis) + bars.map((b) => `${formatShort(b.start)}: ${barText(b)}`).join(', ')}>
          {bars.map((b) => (
            <div key={b.start} className="bar-col" title={`${t.detail.weekFrom(formatShort(b.start))}: ${barText(b)}`}>
              <motion.div className={'bar-v' + (b.count === 0 ? ' none' : '')} initial={{ scaleY: 0 }} animate={{ scaleY: Math.max(0.04, Math.min(1, b.count / b.target)) }} transition={springs.gentle} />
            </div>
          ))}
        </div>
        <p className="muted small">{t.detail.total(stats.total, isAnalysis)}</p>
      </section>

      {analysisSheet && <AnalysisSheet open habit={habit} analysis={analysisSheet.analysis} onClose={() => setAnalysisSheet(null)} />}
      {completionSheet && <CompletionSheet habit={habit} completion={completionSheet.completion} onClose={() => setCompletionSheet(null)} />}
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="card stat">
      <span className="muted small">{label}</span>
      <span className="big-num">{value}<span> {unit}</span></span>
    </div>
  );
}

function WeekBars({ weeks }: { weeks: { start: DateKey; rate: { done: number; scheduled: number } }[] }) {
  const t = useT();
  return (
    <div className="bars" role="img" aria-label={t.detail.weeklyRateLabel + weeks.map((w) => `${formatShort(w.start)} ${pct(w.rate) ?? '–'} %`).join(', ')}>
      {weeks.map((w) => {
        const p = pct(w.rate);
        return (
          <div key={w.start} className="bar-col" title={`${t.detail.weekFrom(formatShort(w.start))}: ${p ?? '–'} %`}>
            <motion.div className={'bar-v' + (p === null ? ' none' : '')} initial={{ scaleY: 0 }} animate={{ scaleY: p === null ? 0.04 : Math.max(0.04, p / 100) }} transition={springs.gentle} />
          </div>
        );
      })}
    </div>
  );
}

export function MonthGrid({ habit, month, onPick }: { habit: Habit; month: DateKey; onPick: (d: DateKey) => void }) {
  const t = useT();
  const { settings, today, getEntry } = useStore();
  const first = startOfWeek(month, settings.weekStart);
  const last = endOfMonth(month);
  const cells: DateKey[] = [];
  for (let d = first; d <= last || cells.length % 7; d = addDays(d, 1)) cells.push(d);
  return (
    <div className="month" role="grid" aria-label={formatMonth(month)}>
      {weekdayOrder(settings.weekStart).map((w) => <span key={w} className="month-wd" aria-hidden="true">{weekdayShort(w).slice(0, 2)}</span>)}
      {cells.map((d) => {
        const inMonth = d.slice(0, 7) === month.slice(0, 7);
        const e = getEntry(habit.id, d);
        const sched = isScheduled(habit, d);
        const done = isComplete(habit, e, d);
        const partial = !done && !!e && e.value > 0;
        const future = d > today;
        const ds = t.detail.dayState;
        const state = done ? ds.done : partial ? ds.partial : sched ? (future ? ds.planned : ds.open) : ds.none;
        return (
          <button
            key={d}
            className={['day', !inMonth && 'out', done && 'done', partial && 'partial', sched && 'sched', d === today && 'today', e?.note && 'has-note'].filter(Boolean).join(' ')}
            disabled={future || d < habit.startDate}
            onClick={() => onPick(d)}
            aria-label={`${formatLong(d)}: ${state}${e?.note ? t.detail.withNote : ''}`}
          >
            {fromKey(d).getDate()}
          </button>
        );
      })}
    </div>
  );
}

export function EntrySheet({ habit, date, onClose }: { habit: Habit; date: DateKey | null; onClose: () => void }) {
  const t = useT();
  const { getEntry, setEntry } = useStore();
  const [value, setValue] = useState(0);
  const [note, setNote] = useState('');
  const e = date ? getEntry(habit.id, date) : undefined;
  useEffect(() => {
    if (!date) return;
    setValue(e?.value ?? 0);
    setNote(e?.note ?? '');
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = date ? targetAt(habit, date) : 1;

  const save = async () => {
    if (!date) return;
    try {
      await setEntry(habit, date, Number.isFinite(value) ? value : 0, note.trim(), t.toast.daySaved(formatShort(date)));
      onClose();
    } catch { /* toast shown */ }
  };

  return (
    <Sheet
      open={!!date}
      onClose={onClose}
      title={date ? formatLong(date) : ''}
      footer={<><button className="btn" onClick={onClose}>{t.common.cancel}</button><button className="btn primary" onClick={save}>{t.common.save}</button></>}
    >
      {date && (
        <div className="form">
          {date && !isScheduled(habit, date) && <p className="muted small">{t.detail.notScheduledNote}</p>}
          {habit.kind === 'binary' ? (
            <Segmented label={t.detail.status} value={value >= 1 ? 1 : 0} onChange={setValue} options={[{ value: 0, label: t.common.open }, { value: 1, label: t.common.done }]} />
          ) : (
            <label className="field">
              <span>{t.detail.value(habit.unit, fmtNum(target))}</span>
              <div className="inline">
                <button type="button" className="icon-btn round" onClick={() => setValue((v) => Math.max(0, (v || 0) - 1))} aria-label={t.detail.decrease}><Icon name="minus" size={18} /></button>
                <input type="number" inputMode="decimal" min={0} value={Number.isFinite(value) ? value : ''} onChange={(ev) => setValue(ev.target.valueAsNumber)} />
                <button type="button" className="icon-btn round" onClick={() => setValue((v) => (v || 0) + 1)} aria-label={t.detail.increase}><Icon name="plus" size={18} /></button>
              </div>
            </label>
          )}
          <label className="field">
            <span>{t.detail.note} <em>{t.common.optional}</em></span>
            <textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={3} maxLength={2000} placeholder={t.detail.notePlaceholder} />
          </label>
        </div>
      )}
    </Sheet>
  );
}
