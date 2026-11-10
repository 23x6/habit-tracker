import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Confirm, Icon, Sheet, springs, useReduce } from '../components/ui';
import { useDraft } from '../components/useDraft';
import { useT } from '../i18n';
import { addDays, formatDateTime, formatLong } from '../lib/date';
import { uid, type JournalEntry } from '../lib/model';
import { groupByDate, validateJournal, type JournalDraft } from '../lib/weekly';
import { useStore } from '../store';

export function Journal() {
  const t = useT();
  const { journal, today } = useStore();
  const reduce = useReduce();
  const [editing, setEditing] = useState<{ entry: JournalEntry | null } | null>(null);
  const groups = groupByDate(journal);
  const dayLabel = (d: string) => (d === today ? t.common.today : d === addDays(today, -1) ? t.common.yesterday : formatLong(d));

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">{t.journal.title}</h1>
        <button className="btn primary" onClick={() => setEditing({ entry: null })}>
          <Icon name="plus" size={18} /> {t.journal.add}
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          <div className="empty-mark" aria-hidden="true"><Icon name="journal" size={26} /></div>
          <p>{t.journal.empty}</p>
        </div>
      ) : (
        <div className="timeline">
          {groups.map((g, gi) => (
            <section key={g.date} className="tl-day" aria-label={formatLong(g.date)}>
              <h2 className="tl-date">{dayLabel(g.date)}</h2>
              <ul className="plain-list tl-list">
                <AnimatePresence initial={false}>
                  {g.entries.map((e, i) => (
                    <motion.li
                      key={e.id}
                      layout={reduce ? false : 'position'}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0, transition: { ...springs.gentle, delay: Math.min(gi * 2 + i, 8) * 0.03 } }}
                      exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: { duration: 0.16 } }}
                      transition={springs.gentle}
                    >
                      <button className="card entry-card" onClick={() => setEditing({ entry: e })}>
                        {e.title && <span className="entry-title">{e.title}</span>}
                        {e.notes && <span className="entry-text">{e.notes}</span>}
                        {e.learned && (
                          <span className="entry-learned">
                            <span className="muted small">{t.journal.learned}</span>
                            <span className="entry-text">{e.learned}</span>
                          </span>
                        )}
                        <span className="muted small">
                          {formatDateTime(e.createdAt)}
                          {e.updatedAt - e.createdAt > 1000 && t.journal.edited(formatDateTime(e.updatedAt))}
                        </span>
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="muted small center">{t.journal.independent}</p>

      <JournalSheet open={!!editing} entry={editing?.entry ?? null} onClose={() => setEditing(null)} />
    </div>
  );
}

function JournalSheet({ open, entry, onClose }: { open: boolean; entry: JournalEntry | null; onClose: () => void }) {
  const t = useT();
  const { today, saveJournal, deleteJournal } = useStore();
  const [id, setId] = useState('');
  const base: JournalDraft = entry ? { date: entry.date, title: entry.title, notes: entry.notes, learned: entry.learned } : { date: today, title: '', notes: '', learned: '' };
  const [d, setD] = useState<JournalDraft>(base);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const draft = useDraft(open ? `journal:${entry?.id ?? 'new'}` : null, d, base, setD);

  useEffect(() => {
    if (!open) return;
    setId(entry?.id ?? uid()); // fixed per form: repeated saves update the same entry
    setD(base);
    setTouched(false);
    setSaving(false);
  }, [open, entry, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateJournal(d, today, t);
  const set = <K extends keyof JournalDraft>(k: K, v: JournalDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length || saving) return;
    setSaving(true);
    try {
      await saveJournal(id, d); // immediately, no debounce
      draft.committed();
      onClose();
    } catch {
      setSaving(false); // the draft keeps the text
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={entry ? t.journal.entry : t.journal.newEntry}
        footer={<><button className="btn" onClick={onClose}>{t.common.cancel}</button><button className="btn primary" onClick={save} disabled={saving}>{t.common.save}</button></>}
      >
        <form className="form" onSubmit={(e) => (e.preventDefault(), save())} onBlur={draft.flush} noValidate>
          {draft.restored && (
            <p className="form-info" role="status">
              {t.draft.restored}{' '}
              <button type="button" className="link-btn inline-link" onClick={draft.discard}>{t.draft.discard}</button>
            </p>
          )}
          <div className="field-row">
            <label className="field">
              <span>{t.common.date}</span>
              <input type="date" value={d.date} max={today} onChange={(e) => set('date', e.target.value)} aria-invalid={touched && !!errors.date} />
              {touched && errors.date && <p className="field-error" role="alert">{errors.date}</p>}
            </label>
            <label className="field">
              <span>{t.common.title} <em>{t.common.optional}</em></span>
              <input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={200} autoComplete="off" />
            </label>
          </div>
          <label className="field">
            <span>{t.journal.notes}</span>
            <textarea value={d.notes} onChange={(e) => set('notes', e.target.value)} rows={4} maxLength={20000} />
          </label>
          <label className="field">
            <span>{t.journal.learnedQ}</span>
            <textarea value={d.learned} onChange={(e) => set('learned', e.target.value)} rows={3} maxLength={20000} />
          </label>
          {touched && errors.content && <p className="field-error" role="alert">{errors.content}</p>}
          {draft.savedAt && <p className="muted small draft-note" aria-live="polite">{t.draft.saved}</p>}
          {entry && (
            <>
              <p className="muted small">{t.journal.created(formatDateTime(entry.createdAt))}{entry.updatedAt - entry.createdAt > 1000 && t.journal.lastEdited(formatDateTime(entry.updatedAt))}</p>
              <button type="button" className="btn wide danger-text" onClick={() => setConfirm(true)}>
                <Icon name="trash" size={18} /> {t.journal.delete}
              </button>
            </>
          )}
          <button type="submit" hidden />
        </form>
      </Sheet>
      <Confirm
        open={confirm}
        title={t.journal.deleteTitle}
        text={t.journal.deleteText}
        action={t.common.delete}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (!entry) return;
          draft.committed();
          onClose();
          void deleteJournal(entry.id).catch(() => {});
        }}
      />
    </>
  );
}
