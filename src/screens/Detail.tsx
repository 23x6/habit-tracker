import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { AnalysisSheet } from '../components/AnalysisSheet';
import { CompletionSheet } from '../components/CompletionSheet';
import { fmtNum } from '../components/HabitRow';
import { Confirm, Icon, Segmented, Sheet, springs, useReduce } from '../components/ui';
import { addDays, addMonths, endOfMonth, formatLong, formatMonth, formatShort, fromKey, startOfMonth, startOfWeek, weekdayOrder, weekdayShort, type DateKey } from '../lib/date';
import { isArchived, isComplete, isScheduled, isWeeklyGoalAt, latestRule, pct, rate, ruleAt, streaks, targetAt, type Analysis, type Completion, type Habit } from '../lib/model';
import { countSource, itemsInWeek, weekEnd, weekLabel, weeklyStats, weekStatus } from '../lib/weekly';
import { useStore } from '../store';

type Period = 7 | 30 | 90 | 0;

export function Detail({ habit, onBack, onEdit }: { habit: Habit; onBack: () => void; onEdit: () => void }) {
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
      ? `${r.target} ${r.target === 1 ? 'Analyse' : 'Analysen'} pro Woche`
      : r.perWeek != null
        ? `${r.perWeek}-mal pro Woche${r.multi ? ' · mehrmals täglich möglich' : ''}`
        : r.days.length === 7 ? 'Täglich' : weekdayOrder(settings.weekStart).filter((d) => r.days.includes(d)).map((d) => weekdayShort(d)).join(', ');
  const schedText = describe(rule);
  const pendingRule = latestRule(habit).from > today ? latestRule(habit) : null;
  const ownItems = weekly ? analyses.filter((a) => a.habitId === habit.id).length : completions.filter((c) => c.habitId === habit.id).length;

  return (
    <motion.div
      className="detail"
      role="region"
      aria-label={`Details: ${habit.name}`}
      initial={reduce ? { opacity: 0 } : { x: '100%' }}
      animate={reduce ? { opacity: 1 } : { x: 0 }}
      exit={reduce ? { opacity: 0 } : { x: '100%' }}
      transition={springs.sheet}
    >
      <div className="detail-inner">
        <header className="detail-head">
          <button className="icon-btn" onClick={onBack} aria-label="Zurück" autoFocus><Icon name="left" /></button>
          <div className="head-actions">
            <button className="icon-btn" onClick={onEdit} aria-label="Bearbeiten"><Icon name="edit" /></button>
          </div>
        </header>

        <div className="detail-title">
          <span className="row-icon big"><Icon habit={habit.icon} size={26} /></span>
          <div>
            <h1>{habit.name}</h1>
            <p className="muted small">
              {schedText}
              {habit.kind === 'numeric' && ` · ${fmtNum(rule.target)} ${habit.unit}`}
              {archived && ' · Archiviert'}
            </p>
          </div>
        </div>
        {habit.description && <p className="muted">{habit.description}</p>}
        {pendingRule && <p className="effect-note">Ab {formatLong(pendingRule.from)}: {describe(pendingRule)}</p>}

        {weeklyView ? <WeeklyBody habit={habit} /> : (<>
        <div className="stat-grid">
          <Stat label="Aktuelle Serie" value={s.current} unit={s.current === 1 ? 'Tag' : 'Tage'} />
          <Stat label="Längste Serie" value={s.longest} unit={s.longest === 1 ? 'Tag' : 'Tage'} />
        </div>

        <section className="card">
          <div className="card-head">
            <h2>Quote</h2>
            <Segmented<Period> label="Zeitraum" value={period} onChange={setPeriod} options={[{ value: 7, label: '7 T' }, { value: 30, label: '30 T' }, { value: 90, label: '90 T' }, { value: 0, label: 'Alle' }]} />
          </div>
          {p === null ? (
            <p className="muted">Noch keine geplanten Tage in diesem Zeitraum.</p>
          ) : (
            <p className="big-num">{p}<span> %</span> <span className="muted small">{r.done} von {r.scheduled} Tagen</span></p>
          )}
          <WeekBars weeks={weeks} />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{formatMonth(month)}</h2>
            <div className="head-actions">
              <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Vorheriger Monat"><Icon name="left" size={18} /></button>
              <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= startOfMonth(today)} aria-label="Nächster Monat"><Icon name="right" size={18} /></button>
            </div>
          </div>
          <MonthGrid habit={habit} month={month} onPick={setEditing} />
          <p className="muted small">Tippe auf einen vergangenen Tag, um ihn zu bearbeiten.</p>
        </section>

        {notes.length > 0 && (
          <section className="card">
            <h2>Notizen</h2>
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
            <Icon name={archived ? 'restore' : 'archive'} size={18} /> {archived ? 'Wiederherstellen' : 'Archivieren'}
          </button>
          <button className="btn wide danger-text" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={18} /> Endgültig löschen
          </button>
          <p className="muted small">Archivierte Gewohnheiten behalten ihren Verlauf und zählen in der Archivzeit nicht gegen Serien.</p>
        </section>
      </div>

      <EntrySheet habit={habit} date={editing} onClose={() => setEditing(null)} />
      <Confirm
        open={confirmDelete}
        title="Endgültig löschen?"
        text={`„${habit.name}" und alle ${weekly ? `${ownItems} Analysen` : `${entriesOf(habit.id).length + ownItems} Einträge`} werden unwiderruflich gelöscht. Archivieren behält den Verlauf.`}
        action="Löschen"
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
    b.start < firstWeek ? 'noch nicht begonnen' : !isWeeklyGoalAt(habit, b.start) ? 'kein Wochenziel' : weekLabel(b, habit.kind);
  const isCurrent = ws === current;
  const unit = isAnalysis ? (st.target === 1 ? 'Analyse' : 'Analysen') : '';
  const add = () => (isAnalysis ? setAnalysisSheet({ analysis: null }) : setCompletionSheet({ completion: null }));
  const timeF = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <div className="stat-grid">
        <Stat label="Wochen in Folge" value={stats.current} unit={stats.current === 1 ? 'Woche' : 'Wochen'} />
        <Stat label="Längste Folge" value={stats.longest} unit={stats.longest === 1 ? 'Woche' : 'Wochen'} />
      </div>

      <section className="card" aria-labelledby="week-h">
        <div className="card-head">
          <h2 id="week-h">{isCurrent ? 'Diese Woche' : `${formatShort(ws)} – ${formatShort(weekEnd(ws))}`}</h2>
          <div className="head-actions">
            <button className="icon-btn" onClick={() => setWs(addDays(ws, -7))} disabled={ws <= firstWeek} aria-label="Vorherige Woche"><Icon name="left" size={18} /></button>
            <button className="icon-btn" onClick={() => setWs(addDays(ws, 7))} disabled={isCurrent} aria-label="Nächste Woche"><Icon name="right" size={18} /></button>
          </div>
        </div>
        {goalWeek ? (
          <div className="week-goal" aria-live="polite">
            <p className="big-num">{st.count}<span> von {st.target}{unit && ` ${unit}`}</span></p>
            {st.achieved && <p className="goal-badge"><Icon name="check" size={14} /> Wochenziel erreicht</p>}
            {!st.achieved && isCurrent && <p className="muted small">Noch {st.target - st.count} bis zum Wochenziel – an beliebigen Tagen.</p>}
            <span className="bar thick" role="progressbar" aria-valuemin={0} aria-valuemax={st.target} aria-valuenow={Math.min(st.count, st.target)} aria-label={weekLabel(st, habit.kind)}>
              <motion.span className="bar-fill" initial={false} animate={{ scaleX: Math.min(1, st.count / st.target) }} transition={springs.gentle} />
            </span>
          </div>
        ) : (
          <p className="muted">In dieser Woche galt ein täglicher Zeitplan.</p>
        )}
        {items.length === 0 ? (
          goalWeek && <p className="muted">{isCurrent ? (isAnalysis ? 'Diese Woche noch keine Analyse. Füge deine erste hinzu.' : 'Diese Woche noch keine Erledigung.') : isAnalysis ? 'In dieser Woche wurde keine Analyse gespeichert.' : 'In dieser Woche wurde nichts erledigt.'}</p>
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
                      <button className="note-item" onClick={() => setCompletionSheet({ completion: it as Completion })} aria-label={`Erledigung vom ${formatLong(it.date)} bearbeiten`}>
                        <span>{formatLong(it.date)}</span>
                        <span className="muted small">erfasst {timeF.format(it.createdAt)}</span>
                      </button>
                      <button className="icon-btn" onClick={() => void deleteCompletion(it.id)} aria-label={`Erledigung vom ${formatLong(it.date)} löschen`}>
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
            <Icon name="plus" size={18} /> {isAnalysis ? 'Analyse hinzufügen' : 'Erledigung hinzufügen'}
          </button>
        )}
      </section>

      <section className="card">
        <h2>Wochenziele</h2>
        {p === null ? (
          <p className="muted">Noch keine abgeschlossene Woche.</p>
        ) : (
          <p className="big-num">{p}<span> %</span> <span className="muted small">{stats.achieved} von {stats.weeks} Wochen erreicht</span></p>
        )}
        <div className="bars" role="img" aria-label={`${isAnalysis ? 'Analysen' : 'Erledigungen'} pro Woche, letzte 12 Wochen: ` + bars.map((b) => `${formatShort(b.start)}: ${barText(b)}`).join(', ')}>
          {bars.map((b) => (
            <div key={b.start} className="bar-col" title={`Woche ab ${formatShort(b.start)}: ${barText(b)}`}>
              <motion.div className={'bar-v' + (b.count === 0 ? ' none' : '')} initial={{ scaleY: 0 }} animate={{ scaleY: Math.max(0.04, Math.min(1, b.count / b.target)) }} transition={springs.gentle} />
            </div>
          ))}
        </div>
        <p className="muted small">Gesamt {stats.total} {isAnalysis ? (stats.total === 1 ? 'Analyse' : 'Analysen') : stats.total === 1 ? 'Erledigung' : 'Erledigungen'}. Eine Woche gilt erst nach ihrem Ende als verpasst.</p>
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
  return (
    <div className="bars" role="img" aria-label={'Wöchentliche Quote, letzte 12 Wochen: ' + weeks.map((w) => `${formatShort(w.start)} ${pct(w.rate) ?? '–'} %`).join(', ')}>
      {weeks.map((w) => {
        const p = pct(w.rate);
        return (
          <div key={w.start} className="bar-col" title={`Woche ab ${formatShort(w.start)}: ${p ?? '–'} %`}>
            <motion.div className={'bar-v' + (p === null ? ' none' : '')} initial={{ scaleY: 0 }} animate={{ scaleY: p === null ? 0.04 : Math.max(0.04, p / 100) }} transition={springs.gentle} />
          </div>
        );
      })}
    </div>
  );
}

export function MonthGrid({ habit, month, onPick }: { habit: Habit; month: DateKey; onPick: (d: DateKey) => void }) {
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
        const state = done ? 'erledigt' : partial ? 'teilweise' : sched ? (future ? 'geplant' : 'offen') : 'nicht geplant';
        return (
          <button
            key={d}
            className={['day', !inMonth && 'out', done && 'done', partial && 'partial', sched && 'sched', d === today && 'today', e?.note && 'has-note'].filter(Boolean).join(' ')}
            disabled={future || d < habit.startDate}
            onClick={() => onPick(d)}
            aria-label={`${formatLong(d)}: ${state}${e?.note ? ', mit Notiz' : ''}`}
          >
            {fromKey(d).getDate()}
          </button>
        );
      })}
    </div>
  );
}

export function EntrySheet({ habit, date, onClose }: { habit: Habit; date: DateKey | null; onClose: () => void }) {
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
      await setEntry(habit, date, Number.isFinite(value) ? value : 0, note.trim(), `${formatShort(date)} gesichert`);
      onClose();
    } catch { /* toast shown */ }
  };

  return (
    <Sheet
      open={!!date}
      onClose={onClose}
      title={date ? formatLong(date) : ''}
      footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" onClick={save}>Sichern</button></>}
    >
      {date && (
        <div className="form">
          {date && !isScheduled(habit, date) && <p className="muted small">An diesem Tag war die Gewohnheit nicht geplant. Ein Eintrag zählt nicht in Serie oder Quote.</p>}
          {habit.kind === 'binary' ? (
            <Segmented label="Status" value={value >= 1 ? 1 : 0} onChange={setValue} options={[{ value: 0, label: 'Offen' }, { value: 1, label: 'Erledigt' }]} />
          ) : (
            <label className="field">
              <span>Wert {habit.unit && `(${habit.unit})`} · Ziel an diesem Tag: {fmtNum(target)}</span>
              <div className="inline">
                <button type="button" className="icon-btn round" onClick={() => setValue((v) => Math.max(0, (v || 0) - 1))} aria-label="Verringern"><Icon name="minus" size={18} /></button>
                <input type="number" inputMode="decimal" min={0} value={Number.isFinite(value) ? value : ''} onChange={(ev) => setValue(ev.target.valueAsNumber)} />
                <button type="button" className="icon-btn round" onClick={() => setValue((v) => (v || 0) + 1)} aria-label="Erhöhen"><Icon name="plus" size={18} /></button>
              </div>
            </label>
          )}
          <label className="field">
            <span>Notiz <em>optional</em></span>
            <textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={3} maxLength={2000} placeholder="Wie lief es?" />
          </label>
        </div>
      )}
    </Sheet>
  );
}
