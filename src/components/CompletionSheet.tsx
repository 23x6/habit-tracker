import { useEffect, useState } from 'react';
import type { Completion, Habit } from '../lib/model';
import { completionError } from '../lib/weekly';
import { useStore } from '../store';
import { Icon, Sheet } from './ui';

/** Add, backdate, edit or delete one completion of an "X-mal pro Woche" habit. */
export function CompletionSheet({ habit, completion, onClose }: { habit: Habit; completion: Completion | null; onClose: () => void }) {
  const { today, completions, saveCompletion, deleteCompletion } = useStore();
  const [date, setDate] = useState(completion?.date ?? today);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDate(completion?.date ?? today), [completion, today]);

  const error = completionError(habit, date, today, completions, completion?.id);
  const save = async () => {
    setTouched(true);
    if (error || saving) return;
    if (completion && completion.date === date) return onClose();
    setSaving(true);
    try {
      await saveCompletion(habit, date, completion ?? undefined);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={completion ? 'Erledigung bearbeiten' : 'Erledigung hinzufügen'}
      footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" onClick={save} disabled={saving}>Sichern</button></>}
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), save())} noValidate>
        <label className="field">
          <span>Datum</span>
          <input type="date" value={date} min={habit.startDate} max={today} onChange={(e) => setDate(e.target.value)} aria-invalid={touched && !!error} />
          {touched && error && <p className="field-error" role="alert">{error}</p>}
        </label>
        <p className="muted small">Zählt zur Woche dieses Datums. Nachtragen ist für vergangene Tage möglich.</p>
        {completion && (
          <button type="button" className="btn wide danger-text" onClick={() => (onClose(), void deleteCompletion(completion.id))}>
            <Icon name="trash" size={18} /> Erledigung löschen
          </button>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
