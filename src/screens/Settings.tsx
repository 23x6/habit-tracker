import { useRef, useState } from 'react';
import { AccountSection, LangSwitch } from '../components/Account';
import { useT } from '../i18n';
import { Confirm, Segmented, Sheet } from '../components/ui';
import { toExport, validateImport } from '../lib/io';
import { isArchived, type Settings as S } from '../lib/model';
import { permission, requestPermission, type PermissionState } from '../lib/reminders';
import { emptySnapshot, type Snapshot } from '../lib/db';
import { today as todayKey } from '../lib/date';
import { useStore } from '../store';

export function Settings() {
  const t = useT();
  const { settings, setSettings, habits, entriesOf, analyses, journal, completions, replaceAll, showToast, addExamples, partition } = useStore();
  const account = partition.sync;
  const [perm, setPerm] = useState<PermissionState>(permission());
  const [pending, setPending] = useState<{ data: Snapshot; fromVersion: number } | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const withReminder = habits.filter((h) => h.reminder && !isArchived(h)).length;

  const doExport = () => {
    const entries = habits.flatMap((h) => entriesOf(h.id));
    const blob = new Blob([JSON.stringify(toExport({ habits, entries, settings, analyses, journal, completions }), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `still-export-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast(t.toast.exported(habits.length, entries.length + completions.length, analyses.length, journal.length));
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (file.current) file.current.value = '';
    let raw: unknown;
    try {
      if (f.size > 20_000_000) throw new Error(t.settings.fileTooLarge);
      raw = JSON.parse(await f.text());
    } catch (e) {
      return setImportErrors([e instanceof SyntaxError ? t.settings.notJson : String((e as Error).message)]);
    }
    const r = validateImport(raw, t);
    if (r.ok) setPending({ data: r.data, fromVersion: r.fromVersion });
    else setImportErrors(r.errors);
  };

  const enableReminders = async (on: boolean) => {
    await setSettings({ remindersEnabled: on }); // flip first so the switch never waits on the browser prompt
    if (on && perm === 'default') setPerm(await requestPermission());
  };

  return (
    <div className="screen">
      <h1 className="screen-title">{t.settings.title}</h1>

      <AccountSection />

      <section className="card">
        <h2>{t.lang.name}</h2>
        <LangSwitch />
      </section>

      <section className="card">
        <h2>{t.settings.reminders}</h2>
        <label className="switch-row">
          <span>{t.settings.showReminders}</span>
          <input type="checkbox" role="switch" checked={settings.remindersEnabled} onChange={(e) => enableReminders(e.target.checked)} />
        </label>
        <p className="muted small">{t.settings.status(t.settings.perm[perm])}</p>
        {perm === 'default' && settings.remindersEnabled && (
          <button className="btn small" onClick={async () => setPerm(await requestPermission())}>{t.settings.allowNotifications}</button>
        )}
        <p className="muted small">{t.settings.reminderInfo(withReminder)}</p>
      </section>

      <section className="card">
        <h2>{t.settings.appearance}</h2>
        <div className="setting">
          <span>{t.settings.weekStart}</span>
          <Segmented<S['weekStart']> label={t.settings.weekStart} value={settings.weekStart} onChange={(v) => setSettings({ weekStart: v })} options={[{ value: 1, label: t.settings.monday }, { value: 0, label: t.settings.sunday }]} />
        </div>
        <div className="setting">
          <span>{t.settings.motion}</span>
          <Segmented<S['motion']> label={t.settings.motion} value={settings.motion} onChange={(v) => setSettings({ motion: v })} options={[{ value: 'system', label: t.settings.motionSystem }, { value: 'reduce', label: t.settings.motionReduce }, { value: 'full', label: t.settings.motionFull }]} />
        </div>
        <p className="muted small">{t.settings.motionNote}</p>
      </section>

      <section className="card">
        <h2>{t.settings.data}</h2>
        <p className="muted small">{account ? t.settings.dataAccount : t.settings.dataLocal}</p>
        <p className="muted small">{t.settings.saveNote}</p>
        <div className="btn-col">
          <button className="btn wide" onClick={doExport}>{t.settings.export}</button>
          <button className="btn wide" onClick={() => file.current?.click()}>{t.settings.import}</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn wide" onClick={addExamples}>{t.today.addExamples}</button>
          <button className="btn wide danger-text" onClick={() => setConfirmClear(true)}>{account ? t.settings.clearAccount : t.settings.clearLocal}</button>
        </div>
      </section>

      <p className="muted small center">{account ? t.settings.footerAccount : t.settings.footerLocal}</p>

      <Confirm
        open={!!pending}
        title={t.settings.importTitle}
        text={pending ? t.settings.importText(pending.fromVersion < 3, pending.data.habits.length, pending.data.entries.length + pending.data.completions.length, pending.data.analyses.length, pending.data.journal.length, account) : ''}
        action={t.settings.replace}
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          try {
            await replaceAll(pending.data);
            showToast(t.toast.importDone);
          } catch (e) {
            showToast(t.toast.importFailed((e as Error).message));
          }
        }}
      />
      <Sheet open={!!importErrors} onClose={() => setImportErrors(null)} title={t.settings.importImpossible}>
        <p className="muted">{t.settings.nothingChanged}</p>
        <ul className="error-list">{importErrors?.map((e, i) => <li key={i}>{e}</li>)}</ul>
      </Sheet>
      <Confirm
        open={confirmClear}
        title={account ? t.settings.clearTitleAccount : t.settings.clearTitleLocal}
        text={t.settings.clearText(habits.length, analyses.length, journal.length, account)}
        action={t.settings.clearAll}
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          try {
            await replaceAll(emptySnapshot());
            showToast(t.toast.cleared);
          } catch (e) {
            showToast(t.toast.clearFailed((e as Error).message));
          }
        }}
      />
    </div>
  );
}
