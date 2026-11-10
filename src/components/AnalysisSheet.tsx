import { useEffect, useState } from 'react';
import { uid, type Analysis, type Habit } from '../lib/model';
import { validateAnalysis, type AnalysisDraft } from '../lib/weekly';
import { useStore } from '../store';
import { Confirm, Icon, Sheet } from './ui';

/** Create / view / edit / delete one analysis of a weekly habit. */
export function AnalysisSheet({ open, habit, analysis, onClose }: { open: boolean; habit: Habit; analysis: Analysis | null; onClose: () => void }) {
  const { today, saveAnalysis, deleteAnalysis } = useStore();
  const [id, setId] = useState('');
  const [d, setD] = useState<AnalysisDraft>({ title: '', url: '', date: today, learnings: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    // The id is fixed per opened form: a second click or a retry overwrites the same record.
    setId(analysis?.id ?? uid());
    setD(analysis ? { title: analysis.title, url: analysis.url, date: analysis.date, learnings: analysis.learnings } : { title: '', url: '', date: today, learnings: '' });
    setTouched(false);
    setSaving(false);
  }, [open, analysis, today]);

  const errors = validateAnalysis(d, today, habit.startDate);
  const set = <K extends keyof AnalysisDraft>(k: K, v: AnalysisDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const err = (k: keyof AnalysisDraft) => touched && errors[k] && <p className="field-error" role="alert">{errors[k]}</p>;

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length || saving) return;
    setSaving(true);
    try {
      await saveAnalysis(id, habit.id, d);
      onClose();
    } catch {
      setSaving(false); // toast shown; input stays so nothing is lost
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={analysis ? 'Analyse' : 'Analyse hinzufügen'}
        footer={
          <>
            <button className="btn" onClick={onClose}>Abbrechen</button>
            <button className="btn primary" onClick={save} disabled={saving}>Sichern</button>
          </>
        }
      >
        <form className="form" onSubmit={(e) => (e.preventDefault(), save())} noValidate>
          <label className="field">
            <span>Artikeltitel</span>
            <input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={300} autoComplete="off" aria-invalid={touched && !!errors.title} placeholder="Titel des Artikels" />
            {err('title')}
          </label>
          <label className="field">
            <span>Artikel-URL <em>optional</em></span>
            <div className="inline">
              <input type="url" inputMode="url" value={d.url} onChange={(e) => set('url', e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://…" aria-invalid={touched && !!errors.url} />
              {analysis?.url && !errors.url && (
                <a className="icon-btn" href={analysis.url} target="_blank" rel="noopener noreferrer" aria-label="Artikel öffnen"><Icon name="link" size={18} /></a>
              )}
            </div>
            {err('url')}
          </label>
          <label className="field">
            <span>Datum der Analyse</span>
            <input type="date" value={d.date} min={habit.startDate} max={today} onChange={(e) => set('date', e.target.value)} aria-invalid={touched && !!errors.date} />
            {err('date')}
          </label>
          <label className="field">
            <span>Wichtigste Erkenntnisse</span>
            <textarea value={d.learnings} onChange={(e) => set('learnings', e.target.value)} rows={6} maxLength={20000} aria-invalid={touched && !!errors.learnings} placeholder="Was nimmst du aus dem Artikel mit?" />
            {err('learnings')}
          </label>
          {analysis && (
            <button type="button" className="btn wide danger-text" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={18} /> Analyse löschen …
            </button>
          )}
          <button type="submit" hidden />
        </form>
      </Sheet>
      <Confirm
        open={confirm}
        title="Analyse löschen?"
        text={analysis ? `„${analysis.title}" wird gelöscht und zählt nicht mehr zum Wochenziel.` : ''}
        action="Löschen"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (!analysis) return;
          onClose();
          void deleteAnalysis(analysis.id).catch(() => {});
        }}
      />
    </>
  );
}
