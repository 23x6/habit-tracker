import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { addDays, formatLong, startOfWeek, weekdayLong, weekdayOrder, weekdayShort } from '../lib/date';
import { ICON_NAMES } from '../lib/icons';
import { ALL_DAYS, latestRule, ruleAt, type Habit } from '../lib/model';
import { useStore, type Draft, type ScheduleType } from '../store';
import { Icon, Segmented, Sheet, SwitchContent } from './ui';

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

/**
 * Create / edit a habit. Switching type or schedule keeps all typed values in the draft (so switching back
 * restores them); validation and saving only use the fields of the selected mode (see the store).
 */
export function HabitSheet({ open, habit, onClose }: { open: boolean; habit: Habit | null; onClose: () => void }) {
  const t = useT();
  const { today, settings, createHabit, updateHabit } = useStore();
  const [d, setD] = useState<Draft>(blank(today));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // Targets typed per type, so switching away and back restores them.
  const [stash, setStash] = useState<Partial<Record<Habit['kind'], number>>>({});
  // If a mode switch removes the focused field, focus goes to the selected segment of that switch.
  const kindSeg = useRef<HTMLDivElement>(null);
  const scheduleSeg = useRef<HTMLDivElement>(null);
  const focusKind = useCallback(() => kindSeg.current?.querySelector<HTMLElement>('[aria-checked="true"]'), []);
  const focusSchedule = useCallback(() => scheduleSeg.current?.querySelector<HTMLElement>('[aria-checked="true"]'), []);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setStash({});
    setD(habit ? fromHabit(habit) : blank(today));
  }, [open, habit, today]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const analyses = d.kind === 'weekly';
  const frequency = d.kind === 'binary' && d.schedule === 'weekly';
  // A numeric habit can't be "X times per week": show its schedule as daily without losing the stored choice.
  const schedule: ScheduleType = d.kind !== 'binary' && d.schedule === 'weekly' ? 'daily' : d.schedule;
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!d.name.trim()) errors.name = t.sheet.errName;
  if (d.name.length > 80) errors.name = t.sheet.errNameLong;
  if (!analyses && schedule === 'days' && !d.days.length) errors.days = t.sheet.errDays;
  if (d.kind === 'numeric' && (!Number.isFinite(d.target) || d.target < 1 || d.target > 100000)) errors.target = t.sheet.errTarget;
  if (analyses && (!Number.isInteger(d.target) || d.target < 1 || d.target > 50)) errors.target = t.sheet.errAnalysesTarget;
  if (frequency && (!Number.isInteger(d.perWeek) || d.perWeek < 1 || d.perWeek > 50)) errors.perWeek = t.sheet.errPerWeek;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate)) errors.startDate = t.sheet.errDate;
  const valid = !Object.keys(errors).length;

  const save = async () => {
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    try {
      const out = { ...d, schedule };
      if (habit) await updateHabit(habit.id, out);
      else await createHabit(out);
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
      was.schedule !== schedule ||
      (analyses ? was.target !== d.target : frequency ? was.perWeek !== d.perWeek || was.multi !== d.multi : was.target !== d.target || was.days.join() !== [...d.days].sort((a, b) => a - b).join());
    const weeklyInvolved = analyses || frequency || cur.perWeek != null;
    if (changed) effectNote = weeklyInvolved ? t.sheet.effectNextWeek(formatLong(nextWeek)) : t.sheet.effectToday;
    else if (latestRule(habit).from > today) effectNote = t.sheet.effectPlanned(formatLong(latestRule(habit).from));
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={habit ? t.sheet.editHabit : t.sheet.newHabit}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {habit ? t.common.save : t.sheet.create}
          </button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), save())} noValidate>
        <label className="field">
          <span>{t.sheet.name}</span>
          <input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder={t.sheet.namePlaceholder} autoComplete="off" aria-invalid={touched && !!errors.name} enterKeyHint="done" />
          {err('name')}
        </label>
        <label className="field">
          <span>{t.sheet.description} <em>{t.common.optional}</em></span>
          <textarea value={d.description} onChange={(e) => set('description', e.target.value)} rows={2} maxLength={300} />
        </label>

        <fieldset className="field">
          <legend>{t.sheet.icon}</legend>
          <div className="icon-grid" role="radiogroup" aria-label={t.sheet.icon}>
            {ICON_NAMES.map((n) => (
              <button type="button" key={n} role="radio" aria-checked={d.icon === n} aria-label={t.sheet.iconNames[n] ?? n} className={'icon-choice' + (d.icon === n ? ' on' : '')} onClick={() => set('icon', n)}>
                <Icon habit={n} />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <span className="label">{t.sheet.tracking}</span>
          {habit ? (
            <p className="muted small">{t.sheet.kindFixed(t.sheet.kindLabel[d.kind])}</p>
          ) : (
            <div ref={kindSeg}>
            <Segmented
              label={t.sheet.tracking}
              value={d.kind}
              onChange={(v) => {
                const next = { ...stash, [d.kind]: d.target };
                setStash(next);
                setD((x) => ({ ...x, kind: v, target: next[v] ?? (v === 'weekly' ? 2 : 1) }));
              }}
              options={[{ value: 'binary', label: t.sheet.kindBinary }, { value: 'numeric', label: t.sheet.kindNumeric }, { value: 'weekly', label: t.sheet.kindAnalyses }]}
            />
            </div>
          )}
        </div>

        <SwitchContent id={d.kind === 'numeric' ? 'numeric' : 'none'} focusFallback={focusKind}>
          {d.kind === 'numeric' && (
            <div className="field-row">
              <label className="field">
                <span>{t.sheet.dailyTarget}</span>
                <input type="number" inputMode="decimal" min={1} max={100000} value={Number.isFinite(d.target) ? d.target : ''} onChange={(e) => set('target', e.target.valueAsNumber)} aria-invalid={touched && !!errors.target} />
                {err('target')}
              </label>
              <label className="field">
                <span>{t.sheet.unit}</span>
                <input value={d.unit} onChange={(e) => set('unit', e.target.value)} maxLength={30} placeholder={t.sheet.unitPlaceholder} list="units" />
                <datalist id="units">{t.sheet.units.map((u) => <option key={u} value={u} />)}</datalist>
              </label>
            </div>
          )}
        </SwitchContent>

        <SwitchContent id={analyses ? 'analyses' : 'schedule'} focusFallback={focusKind}>
          {analyses ? (
            <div className="form">
              <p className="muted small">{t.sheet.analysesHint}</p>
              <label className="field">
                <span>{t.sheet.analysesPerWeek}</span>
                <input type="number" inputMode="numeric" min={1} max={50} step={1} value={Number.isFinite(d.target) ? d.target : ''} onChange={(e) => set('target', e.target.valueAsNumber)} aria-invalid={touched && !!errors.target} />
                {err('target')}
              </label>
            </div>
          ) : (
            <fieldset className="field">
              <legend>{t.sheet.schedule}</legend>
              <div ref={scheduleSeg}>
              <Segmented<ScheduleType>
                label={t.sheet.schedule}
                value={schedule}
                onChange={(v) => setD((x) => ({ ...x, schedule: v, days: v === 'days' && x.days.length === 7 ? [1, 2, 3, 4, 5] : x.days }))}
                options={[
                  { value: 'daily', label: t.sheet.daily },
                  { value: 'days', label: t.sheet.weekdays },
                  ...(d.kind === 'binary' ? [{ value: 'weekly' as const, label: t.sheet.perWeek }] : []),
                ]}
              />
              </div>
              <SwitchContent id={schedule} focusFallback={focusSchedule}>
                {schedule === 'days' && (
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
                {frequency && (
                  <div className="form switch-pad">
                    <label className="field">
                      <span>{t.sheet.howOften}</span>
                      <div className="inline">
                        <input type="number" inputMode="numeric" min={1} max={50} step={1} value={Number.isFinite(d.perWeek) ? d.perWeek : ''} onChange={(e) => set('perWeek', e.target.valueAsNumber)} aria-invalid={touched && !!errors.perWeek} className="num-small" />
                        <span className="muted">{t.sheet.perWeekSuffix}</span>
                      </div>
                      {err('perWeek')}
                    </label>
                    <label className="switch-row">
                      <span>{t.sheet.multi}</span>
                      <input type="checkbox" role="switch" checked={d.multi} onChange={(e) => set('multi', e.target.checked)} />
                    </label>
                  </div>
                )}
              </SwitchContent>
              {err('days')}
            </fieldset>
          )}
        </SwitchContent>
        {effectNote && <p className="effect-note" role="status">{effectNote}</p>}

        <div className="field-row">
          <label className="field">
            <span>{t.sheet.start}</span>
            <input type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} aria-invalid={touched && !!errors.startDate} />
            {err('startDate')}
          </label>
          {!analyses && (
            <label className="field">
              <span>{t.sheet.reminder} <em>{t.common.optional}</em></span>
              <div className="inline">
                <input type="time" value={d.reminder ?? ''} onChange={(e) => set('reminder', e.target.value || null)} />
                {d.reminder && <button type="button" className="icon-btn" aria-label={t.sheet.removeReminder} onClick={() => set('reminder', null)}><Icon name="close" size={18} /></button>}
              </div>
            </label>
          )}
        </div>
        {d.reminder && !analyses && <p className="muted small">{t.sheet.reminderNote}</p>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
