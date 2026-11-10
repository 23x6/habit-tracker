import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DailyList, GoalList } from '../components/ProgressLists';
import { Icon, springs, useReduce } from '../components/ui';
import { useDraft } from '../components/useDraft';
import { useT } from '../i18n';
import { addDays, formatDateTime, formatLong, formatRange, startOfWeek, type DateKey } from '../lib/date';
import { pct, sumRates } from '../lib/model';
import { dailyStats, draftOf, goalStats, notesIn, overlappingReviews, reviewId, type ReviewDraft } from '../lib/review';
import { useStore } from '../store';

export interface WeekRange {
  start: DateKey;
  end: DateKey;
}

const PROMPTS = ['wentWell', 'heldBack', 'nextWeek'] as const;
const same = (a: ReviewDraft, b: ReviewDraft) => PROMPTS.every((k) => a[k] === b[k]);

/**
 * One week at a glance: daily completions and weekly goal results first, the week's journal notes and analysis
 * learnings on demand, then three optional reflection prompts (local draft while typing, explicit save).
 */
export function WeeklyReview({ range, onRange, onBack }: { range: WeekRange; onRange: (r: WeekRange) => void; onBack: () => void }) {
  const t = useT();
  const reduce = useReduce();
  const { habits, getEntry, analyses, completions, journal, reviews, today, settings } = useStore();
  const { start, end } = range;
  const cur = startOfWeek(today, settings.weekStart);
  const [notesOpen, setNotesOpen] = useState(false);
  const daily = useMemo(() => dailyStats(habits, getEntry, start, end, today), [habits, getEntry, start, end, today]);
  const goals = useMemo(() => goalStats(habits, analyses, completions, start, end, today, settings.weekStart), [habits, analyses, completions, start, end, today, settings.weekStart]);
  const notes = useMemo(() => notesIn(journal, analyses, start, end), [journal, analyses, start, end]);
  const others = overlappingReviews(reviews, start, end);
  const total = sumRates(daily);
  const nNotes = notes.journal.length + notes.learnings.length;
  const habitName = (id: string) => habits.find((h) => h.id === id)?.name ?? '';
  // Navigation stays on the configured week grid (an older review with another week start is snapped back).
  const go = (dir: -1 | 1) => {
    const s = startOfWeek(addDays(start, 7 * dir), settings.weekStart);
    onRange({ start: s, end: addDays(s, 6) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.sheet') && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <motion.div
      className="detail"
      role="region"
      aria-label={t.review.region(formatRange(start, end))}
      initial={reduce ? { opacity: 0 } : { x: '100%' }}
      animate={reduce ? { opacity: 1 } : { x: 0 }}
      exit={reduce ? { opacity: 0 } : { x: '100%' }}
      transition={springs.sheet}
    >
      <div className="detail-inner">
        <header className="detail-head">
          <button className="icon-btn" onClick={onBack} aria-label={t.common.back} autoFocus><Icon name="left" /></button>
        </header>

        <div className="review-title">
          <h1>{t.review.title}</h1>
          <div className="review-nav">
            <button className="icon-btn" onClick={() => go(-1)} aria-label={t.review.prev}><Icon name="left" /></button>
            <p className="review-range" aria-live="polite">
              {formatRange(start, end)}
              {start === cur && <span className="muted small"> · {t.review.thisWeek}</span>}
            </p>
            <button className="icon-btn" onClick={() => go(1)} aria-label={t.review.next} disabled={start >= cur}><Icon name="right" /></button>
          </div>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>{t.review.daily}</h2>
            {total.scheduled > 0 && <span className="muted small">{t.stats.dailyTotal(total.done, total.scheduled)} · {pct(total)} %</span>}
          </div>
          {daily.length ? <DailyList rows={daily} /> : <p className="muted">{t.review.noDaily}</p>}
        </section>

        <section className="card">
          <h2>{t.review.goals}</h2>
          {goals.length ? <GoalList rows={goals} /> : <p className="muted">{t.review.noGoals}</p>}
        </section>

        <section className="card">
          <button className="review-notes-toggle" aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)} disabled={!nNotes}>
            <span>{nNotes ? t.review.notes(nNotes) : t.review.noNotes}</span>
            {nNotes > 0 && <Icon name={notesOpen ? 'minus' : 'plus'} size={18} />}
          </button>
          {notesOpen && nNotes > 0 && (
            <ul className="plain-list review-notes">
              {notes.journal.map((j) => (
                <li key={j.id}>
                  <span className="muted small">{t.review.journalNote} · {formatLong(j.date)}</span>
                  {j.title && <strong>{j.title}</strong>}
                  {j.notes && <p className="entry-text">{j.notes}</p>}
                  {j.learned && <p className="entry-text">{t.journal.learned}: {j.learned}</p>}
                </li>
              ))}
              {notes.learnings.map((a) => (
                <li key={a.id}>
                  <span className="muted small">{t.review.learning} · {habitName(a.habitId)} · {formatLong(a.date)}</span>
                  <strong>{a.title}</strong>
                  <p className="entry-text">{a.learnings}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ReviewForm key={reviewId(start, end)} range={range} />

        {others.length > 0 && (
          <section className="card">
            <h2>{t.review.otherRanges}</h2>
            <p className="muted small">{t.review.otherRangesNote}</p>
            <ul className="plain-list review-others">
              {others.map((r) => (
                <li key={r.id}>
                  <button className="btn wide" onClick={() => onRange({ start: r.weekStart, end: r.weekEnd })}>{t.review.openRange(formatRange(r.weekStart, r.weekEnd))}</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </motion.div>
  );
}

function ReviewForm({ range }: { range: WeekRange }) {
  const t = useT();
  const { reviews, saveReview } = useStore();
  const existing = reviews.find((r) => r.weekStart === range.start && r.weekEnd === range.end);
  const base = draftOf(existing);
  const [d, setD] = useState<ReviewDraft>(base);
  const [saving, setSaving] = useState(false);
  const draft = useDraft(`review:${reviewId(range.start, range.end)}`, d, base, setD);
  // A newer version arriving by sync replaces the form only while nothing was typed here.
  const shown = useRef(base);
  useEffect(() => {
    const next = draftOf(existing);
    if (same(d, shown.current) && !same(next, shown.current)) setD(next);
    shown.current = next;
  }, [existing?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !same(d, base);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // No draft.committed(): the form stays open, and text typed while saving must stay a draft. The draft
      // clears itself once it equals the saved review (useDraft compares against `base`).
      await saveReview(range.start, range.end, d);
    } catch {
      /* the draft keeps the text; the save status shows the error */
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2>{t.review.reflect}</h2>
      <form className="form" onSubmit={(e) => (e.preventDefault(), void save())} onBlur={draft.flush} noValidate>
        {draft.restored && (
          <p className="form-info" role="status">
            {t.draft.restored}{' '}
            <button type="button" className="link-btn inline-link" onClick={draft.discard}>{t.draft.discard}</button>
          </p>
        )}
        <p className="muted small">{t.review.optional}</p>
        {PROMPTS.map((k) => (
          <label key={k} className="field">
            <span>{t.review.prompts[k]}</span>
            <textarea value={d[k]} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} rows={3} maxLength={20000} />
          </label>
        ))}
        <div className="review-save">
          <span className="muted small" aria-live="polite">
            {dirty ? (draft.savedAt ? t.draft.saved : '') : existing ? t.review.savedAt(formatDateTime(existing.updatedAt)) : ''}
          </span>
          <button type="submit" className="btn primary" disabled={saving || !dirty}>{t.common.save}</button>
        </div>
      </form>
    </section>
  );
}
