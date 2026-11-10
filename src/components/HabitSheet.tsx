import { useEffect, useState } from 'react';
import { addDays, formatLong, startOfWeek, weekdayLong, weekdayOrder, weekdayShort } from '../lib/date';
import { ICON_NAMES } from '../lib/icons';
import { ALL_DAYS, latestRule, ruleAt, type Habit } from '../lib/model';
import { useStore, type Draft, type ScheduleType } from '../store';
import { Icon, Segmented, Sheet } from './ui';

const blank = (today: string): Draft => ({
  name: '', description: '', icon: 'circle', kind: 'binary', unit: '', schedule: 'daily', days: ALL_DAYS, target: 1, perWeek: 3, multi: false, startDate: today, reminder: null,
});

function fromHabit(h: Habit): Draft {
  const r = latestRule(h); // includes a change that only starts next week
  const schedule: ScheduleType = r.perWeek != null ? 'weekly' : r.days.length === 7 ? 'daily' : 'days';
  return {
    name: h.name, description: h.description, icon: h.icon, kind: h.kind, unit: h.unit, schedule, days: r.days,
    target: r.target, perWeek: r.perWeek ?? 3, multi: !!r.multi, startDate: h.startDate, reminder: h.reminder,
  };
}

export function HabitSheet({ open, habit, onClose }: { open: boolean; habit: Habit | null; onClose: () => void }) {
  const { today, settings, createHabit, updateHabit } = useStore();
  const [d, setD] = useState<Draft>(blank(today));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setD(habit ? fromHabit(habit) : blank(today));
  }, [open, habit, today]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const analyses = d.kind === 'weekly';
  const frequency = d.kind === 'binary' && d.schedule === 'weekly';
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!d.name.trim()) errors.name = 'Bitte einen Namen eingeben.';
  if (d.name.length > 80) errors.name = 'Höchstens 80 Zeichen.';
  if (!analyses && d.schedule === 'days' && !d.days.length) errors.days = 'Mindestens einen Tag wählen.';
  if (d.kind === 'numeric' && (!Number.isFinite(d.target) || d.target < 1 || d.target > 100000)) errors.target = 'Ziel zwischen 1 und 100 000.';
  if (analyses && (!Number.isInteger(d.target) || d.target < 1 || d.target > 50)) errors.target = 'Wochenziel: ganze Zahl zwischen 1 und 50.';
  if (frequency && (!Number.isInteger(d.perWeek) || d.perWeek < 1 || d.perWeek > 50)) errors.perWeek = 'Bitte eine ganze Zahl zwischen 1 und 50.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate)) errors.startDate = 'Bitte ein Datum wählen.';
  const valid = !Object.keys(errors).length;

  const save = async () => {
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (habit) await updateHabit(habit.id, d);
      else await createHabit(d);
      onClose();
    } catch {
      /* toast already shown; keep sheet open so input isn't lost */
    } finally {
      setSaving(false);
    }
  };

  const err = (k: keyof Draft) => touched && errors[k] && <p className="field-error" role="alert">{errors[k]}</p>;

  // When does a change take effect? (Mirrors updateHabit in the store.)
  const nextWeek = addDays(startOfWeek(today, settings.weekStart), 7);
  let effectNote: string | null = null;
  if (habit && habit.startDate <= today) {
    const cur = ruleAt(habit, today);
    const was = fromHabit({ ...habit, rules: [cur] });
    const changed =
      was.schedule !== d.schedule ||
      (analyses ? was.target !== d.target : frequency ? was.perWeek !== d.perWeek || was.multi !== d.multi : was.target !== d.target || was.days.join() !== [...d.days].sort((a, b) => a - b).join());
    const weeklyInvolved = analyses || frequency || cur.perWeek != null;
    if (changed)
      effectNote = weeklyInvolved
        ? `Gilt ab ${formatLong(nextWeek)} (nächste Woche). Die laufende Woche und frühere Wochen behalten ihr Ziel.`
        : 'Gilt ab heute. Vergangene Tage behalten ihre bisherigen Regeln.';
    else if (latestRule(habit).from > today) effectNote = `Geplante Änderung gilt ab ${formatLong(latestRule(habit).from)}.`;
  }
  const kindLabel = { binary: 'Erledigt / offen', numeric: 'Zahlenwert', weekly: 'Analysen pro Woche' }[d.kind];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={habit ? 'Gewohnheit bearbeiten' : 'Neue Gewohnheit'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {habit ? 'Sichern' : 'Erstellen'}
          </button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), save())} noValidate>
        <label className="field">
          <span>Name</span>
          <input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="z. B. Sport machen" autoComplete="off" aria-invalid={touched && !!errors.name} enterKeyHint="done" />
          {err('name')}
        </label>
        <label className="field">
          <span>Beschreibung <em>optional</em></span>
          <textarea value={d.description} onChange={(e) => set('description', e.target.value)} rows={2} maxLength={300} />
        </label>

        <fieldset className="field">
          <legend>Symbol</legend>
          <div className="icon-grid" role="radiogroup" aria-label="Symbol">
            {ICON_NAMES.map((n) => (
              <button type="button" key={n} role="radio" aria-checked={d.icon === n} aria-label={n} className={'icon-choice' + (d.icon === n ? ' on' : '')} onClick={() => set('icon', n)}>
                <Icon habit={n} />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <span className="label">Erfassung</span>
          {habit ? (
            <p className="muted small">{kindLabel} · Der Typ ist nach dem Erstellen fest, damit der Verlauf stimmig bleibt.</p>
          ) : (
            <Segmented
              label="Erfassung"
              value={d.kind}
              onChange={(v) => setD((x) => ({ ...x, kind: v, target: v === 'weekly' ? 2 : v === 'binary' ? 1 : x.target, schedule: v !== 'binary' && x.schedule === 'weekly' ? 'daily' : x.schedule }))}
              options={[{ value: 'binary', label: 'Erledigt' }, { value: 'numeric', label: 'Zahlenwert' }, { value: 'weekly', label: 'Analysen' }]}
            />
          )}
          {analyses && <p className="muted small">Jede gespeicherte Analyse (Titel und Erkenntnisse) zählt einmal zum Wochenziel. Mehrere pro Tag sind möglich.</p>}
        </div>

        {d.kind === 'numeric' && (
          <div className="field-row">
            <label className="field">
              <span>Tagesziel</span>
              <input type="number" inputMode="decimal" min={1} max={100000} value={Number.isFinite(d.target) ? d.target : ''} onChange={(e) => set('target', e.target.valueAsNumber)} aria-invalid={touched && !!errors.target} />
              {err('target')}
            </label>
            <label className="field">
              <span>Einheit</span>
              <input value={d.unit} onChange={(e) => set('unit', e.target.value)} maxLength={30} placeholder="Minuten, Seiten, Gläser" list="units" />
              <datalist id="units"><option value="Minuten" /><option value="Seiten" /><option value="Gläser" /><option value="Schritte" /><option value="km" /></datalist>
            </label>
          </div>
        )}

        {analyses ? (
          <label className="field">
            <span>Analysen pro Woche</span>
            <input type="number" inputMode="numeric" min={1} max={50} step={1} value={Number.isFinite(d.target) ? d.target : ''} onChange={(e) => set('target', e.target.valueAsNumber)} aria-invalid={touched && !!errors.target} />
            {err('target')}
          </label>
        ) : (
          <fieldset className="field">
            <legend>Zeitplan</legend>
            <Segmented<ScheduleType>
              label="Zeitplan"
              value={d.schedule}
              onChange={(v) => setD((x) => ({ ...x, schedule: v, days: v === 'days' && x.days.length === 7 ? [1, 2, 3, 4, 5] : x.days }))}
              options={[
                { value: 'daily', label: 'Täglich' },
                { value: 'days', label: 'Wochentage' },
                ...(d.kind === 'binary' ? [{ value: 'weekly' as const, label: 'X-mal pro Woche' }] : []),
              ]}
            />
            {d.schedule === 'days' && (
              <div className="day-picks">
                {weekdayOrder(settings.weekStart).map((wd) => {
                  const on = d.days.includes(wd);
                  return (
                    <button type="button" key={wd} aria-pressed={on} aria-label={weekdayLong(wd)} className={'day-pick' + (on ? ' on' : '')} onClick={() => set('days', on ? d.days.filter((x) => x !== wd) : [...d.days, wd])}>
                      {weekdayShort(wd).slice(0, 2)}
                    </button>
                  );
                })}
              </div>
            )}
            {err('days')}
            {frequency && (
              <>
                <label className="field">
                  <span>Wie oft pro Woche?</span>
                  <div className="inline">
                    <input type="number" inputMode="numeric" min={1} max={50} step={1} value={Number.isFinite(d.perWeek) ? d.perWeek : ''} onChange={(e) => set('perWeek', e.target.valueAsNumber)} aria-invalid={touched && !!errors.perWeek} className="num-small" />
                    <span className="muted">-mal pro Woche, an beliebigen Tagen</span>
                  </div>
                  {err('perWeek')}
                </label>
                <label className="switch-row">
                  <span>Mehrere Erledigungen pro Tag erlauben</span>
                  <input type="checkbox" role="switch" checked={d.multi} onChange={(e) => set('multi', e.target.checked)} />
                </label>
              </>
            )}
          </fieldset>
        )}
        {effectNote && <p className="effect-note" role="status">{effectNote}</p>}

        <div className="field-row">
          <label className="field">
            <span>Beginn</span>
            <input type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} aria-invalid={touched && !!errors.startDate} />
            {err('startDate')}
          </label>
          {!analyses && (
            <label className="field">
              <span>Erinnerung <em>optional</em></span>
              <div className="inline">
                <input type="time" value={d.reminder ?? ''} onChange={(e) => set('reminder', e.target.value || null)} />
                {d.reminder && <button type="button" className="icon-btn" aria-label="Erinnerung entfernen" onClick={() => set('reminder', null)}><Icon name="close" size={18} /></button>}
              </div>
            </label>
          )}
        </div>
        {d.reminder && !analyses && <p className="muted small">Erinnerungen erscheinen nur, solange Still geöffnet ist. Details unter Einstellungen.</p>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
