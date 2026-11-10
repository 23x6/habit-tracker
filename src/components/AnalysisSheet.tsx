import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { uid, type Analysis, type Habit } from '../lib/model';
import { validateAnalysis, type AnalysisDraft } from '../lib/weekly';
import { useStore } from '../store';
import { Confirm, Icon, Sheet } from './ui';
import { useDraft } from './useDraft';

/** Create / view / edit / delete one analysis of a weekly habit. Unsaved text is kept as a draft. */
export function AnalysisSheet({ open, habit, analysis, onClose }: { open: boolean; habit: Habit; analysis: Analysis | null; onClose: () => void }) {
  const t = useT();
  const { today, saveAnalysis, deleteAnalysis } = useStore();
  const [id, setId] = useState('');
  const base: AnalysisDraft = analysis
    ? { title: analysis.title, url: analysis.url, date: analysis.date, learnings: analysis.learnings }
    : { title: '', url: '', date: today, learnings: '' };
  const [d, setD] = useState<AnalysisDraft>(base);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // A draft is only ever a draft: it never counts toward the weekly goal until saved explicitly.
  const draft = useDraft(open ? (analysis ? `analysis:${analysis.id}` : `analysis:new:${habit.id}`) : null, d, base, setD);

  useEffect(() => {
    if (!open) return;
    // The id is fixed per opened form: a second click or a retry overwrites the same record.
    setId(analysis?.id ?? uid());
    setD(base);
    setTouched(false);
    setSaving(false);
  }, [open, analysis, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateAnalysis(d, today, habit.startDate, t);
  const set = <K extends keyof AnalysisDraft>(k: K, v: AnalysisDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const err = (k: keyof AnalysisDraft) => touched && errors[k] && <p className="field-error" role="alert">{errors[k]}</p>;

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length || saving) return;
    setSaving(true);
    try {
      await saveAnalysis(id, habit.id, d); // immediately, no debounce
      draft.committed();
      onClose();
    } catch {
      setSaving(false); // toast shown; input and draft stay so nothing is lost
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={analysis ? t.analysis.title : t.analysis.add}
        footer={
          <>
            <button className="btn" onClick={onClose}>{t.common.cancel}</button>
            <button className="btn primary" onClick={save} disabled={saving}>{t.common.save}</button>
          </>
        }
      >
        <form className="form" onSubmit={(e) => (e.preventDefault(), save())} onBlur={draft.flush} noValidate>
          {draft.restored && (
            <p className="form-info" role="status">
              {t.draft.restored}{' '}
              <button type="button" className="link-btn inline-link" onClick={draft.discard}>{t.draft.discard}</button>
            </p>
          )}
          <label className="field">
            <span>{t.analysis.articleTitle}</span>
            <input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={300} autoComplete="off" aria-invalid={touched && !!errors.title} placeholder={t.analysis.articlePlaceholder} />
            {err('title')}
          </label>
          <label className="field">
            <span>{t.analysis.url} <em>{t.common.optional}</em></span>
            <div className="inline">
              <input type="url" inputMode="url" value={d.url} onChange={(e) => set('url', e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://…" aria-invalid={touched && !!errors.url} />
              {analysis?.url && !errors.url && (
                <a className="icon-btn" href={analysis.url} target="_blank" rel="noopener noreferrer" aria-label={t.analysis.openArticle}><Icon name="link" size={18} /></a>
              )}
            </div>
            {err('url')}
          </label>
          <label className="field">
            <span>{t.analysis.date}</span>
            <input type="date" value={d.date} min={habit.startDate} max={today} onChange={(e) => set('date', e.target.value)} aria-invalid={touched && !!errors.date} />
            {err('date')}
          </label>
          <label className="field">
            <span>{t.analysis.learnings}</span>
            <textarea value={d.learnings} onChange={(e) => set('learnings', e.target.value)} rows={6} maxLength={20000} aria-invalid={touched && !!errors.learnings} placeholder={t.analysis.learningsPlaceholder} />
            {err('learnings')}
          </label>
          {draft.savedAt && <p className="muted small draft-note" aria-live="polite">{t.draft.saved}</p>}
          {analysis && (
            <button type="button" className="btn wide danger-text" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={18} /> {t.analysis.delete}
            </button>
          )}
          <button type="submit" hidden />
        </form>
      </Sheet>
      <Confirm
        open={confirm}
        title={t.analysis.deleteTitle}
        text={analysis ? t.analysis.deleteText(analysis.title) : ''}
        action={t.common.delete}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (!analysis) return;
          draft.committed();
          onClose();
          void deleteAnalysis(analysis.id).catch(() => {});
        }}
      />
    </>
  );
}
