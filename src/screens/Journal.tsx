import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Confirm, Icon, Sheet, springs, useReduce } from '../components/ui';
import { addDays, formatLong } from '../lib/date';
import { uid, type JournalEntry } from '../lib/model';
import { groupByDate, validateJournal, type JournalDraft } from '../lib/weekly';
import { useStore } from '../store';

const timeF = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Journal() {
  const { journal, today } = useStore();
  const reduce = useReduce();
  const [editing, setEditing] = useState<{ entry: JournalEntry | null } | null>(null);
  const groups = groupByDate(journal);
  const dayLabel = (d: string) => (d === today ? 'Heute' : d === addDays(today, -1) ? 'Gestern' : formatLong(d));

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">Journal</h1>
        <button className="btn primary" onClick={() => setEditing({ entry: null })}>
          <Icon name="plus" size={18} /> Eintrag hinzufügen
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="empty">
          <div className="empty-mark" aria-hidden="true"><Icon name="journal" size={26} /></div>
          <p>Noch keine Einträge. Halte deinen ersten Gedanken fest.</p>
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
                          <span className="muted small">Gelernt</span>
                          <span className="entry-text">{e.learned}</span>
                        </span>
                      )}
                      <span className="muted small">
                        {timeF.format(e.createdAt)}
                        {e.updatedAt - e.createdAt > 1000 && ` · bearbeitet ${timeF.format(e.updatedAt)}`}
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
      <p className="muted small center">Journal-Einträge sind unabhängig von deinen Gewohnheiten und haken nichts automatisch ab.</p>

      <JournalSheet open={!!editing} entry={editing?.entry ?? null} onClose={() => setEditing(null)} />
    </div>
  );
}

function JournalSheet({ open, entry, onClose }: { open: boolean; entry: JournalEntry | null; onClose: () => void }) {
  const { today, saveJournal, deleteJournal } = useStore();
  const [id, setId] = useState('');
  const [d, setD] = useState<JournalDraft>({ date: today, title: '', notes: '', learned: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setId(entry?.id ?? uid()); // fixed per form: repeated saves update the same entry
    setD(entry ? { date: entry.date, title: entry.title, notes: entry.notes, learned: entry.learned } : { date: today, title: '', notes: '', learned: '' });
    setTouched(false);
    setSaving(false);
  }, [open, entry, today]);

  const errors = validateJournal(d, today);
  const set = <K extends keyof JournalDraft>(k: K, v: JournalDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length || saving) return;
    setSaving(true);
    try {
      await saveJournal(id, d);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={entry ? 'Eintrag' : 'Neuer Eintrag'}
        footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" onClick={save} disabled={saving}>Sichern</button></>}
      >
        <form className="form" onSubmit={(e) => (e.preventDefault(), save())} noValidate>
          <div className="field-row">
            <label className="field">
              <span>Datum</span>
              <input type="date" value={d.date} max={today} onChange={(e) => set('date', e.target.value)} aria-invalid={touched && !!errors.date} />
              {touched && errors.date && <p className="field-error" role="alert">{errors.date}</p>}
            </label>
            <label className="field">
              <span>Titel <em>optional</em></span>
              <input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={200} autoComplete="off" />
            </label>
          </div>
          <label className="field">
            <span>Notizen</span>
            <textarea value={d.notes} onChange={(e) => set('notes', e.target.value)} rows={4} maxLength={20000} />
          </label>
          <label className="field">
            <span>Was habe ich heute gelernt?</span>
            <textarea value={d.learned} onChange={(e) => set('learned', e.target.value)} rows={3} maxLength={20000} />
          </label>
          {touched && errors.content && <p className="field-error" role="alert">{errors.content}</p>}
          {entry && (
            <>
              <p className="muted small">Erstellt {timeF.format(entry.createdAt)}{entry.updatedAt - entry.createdAt > 1000 && ` · zuletzt bearbeitet ${timeF.format(entry.updatedAt)}`}</p>
              <button type="button" className="btn wide danger-text" onClick={() => setConfirm(true)}>
                <Icon name="trash" size={18} /> Eintrag löschen …
              </button>
            </>
          )}
          <button type="submit" hidden />
        </form>
      </Sheet>
      <Confirm
        open={confirm}
        title="Eintrag löschen?"
        text="Der Journal-Eintrag wird gelöscht."
        action="Löschen"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (!entry) return;
          onClose();
          void deleteJournal(entry.id).catch(() => {});
        }}
      />
    </>
  );
}
