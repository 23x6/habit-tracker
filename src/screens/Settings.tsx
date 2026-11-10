import { useRef, useState } from 'react';
import { AccountSection } from '../components/Account';
import { Confirm, Segmented, Sheet } from '../components/ui';
import { toExport, validateImport } from '../lib/io';
import { isArchived, type Settings as S } from '../lib/model';
import { permission, requestPermission, type PermissionState } from '../lib/reminders';
import { emptySnapshot, type Snapshot } from '../lib/db';
import { today as todayKey } from '../lib/date';
import { useStore } from '../store';

const permText: Record<PermissionState, string> = {
  granted: 'Mitteilungen erlaubt',
  denied: 'Mitteilungen blockiert – in den Browser- bzw. iOS-Einstellungen änderbar',
  default: 'Noch nicht erlaubt',
  unsupported: 'Dieser Browser unterstützt keine Mitteilungen. Auf dem iPhone erst nach „Zum Home-Bildschirm" (iOS 16.4+).',
};

export function Settings() {
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
    showToast(`Export: ${habits.length} Gewohnheiten, ${entries.length + completions.length} Erledigungen, ${analyses.length} Analysen, ${journal.length} Journal-Einträge`);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (file.current) file.current.value = '';
    let raw: unknown;
    try {
      if (f.size > 20_000_000) throw new Error('Datei ist zu groß.');
      raw = JSON.parse(await f.text());
    } catch (e) {
      return setImportErrors([e instanceof SyntaxError ? 'Die Datei ist kein gültiges JSON.' : String((e as Error).message)]);
    }
    const r = validateImport(raw);
    if (r.ok) setPending({ data: r.data, fromVersion: r.fromVersion });
    else setImportErrors(r.errors);
  };

  const enableReminders = async (on: boolean) => {
    await setSettings({ remindersEnabled: on }); // flip first so the switch never waits on the browser prompt
    if (on && perm === 'default') setPerm(await requestPermission());
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Einstellungen</h1>

      <AccountSection />

      <section className="card">
        <h2>Erinnerungen</h2>
        <label className="switch-row">
          <span>Erinnerungen anzeigen</span>
          <input type="checkbox" role="switch" checked={settings.remindersEnabled} onChange={(e) => enableReminders(e.target.checked)} />
        </label>
        <p className="muted small">Status: {permText[perm]}</p>
        {perm === 'default' && settings.remindersEnabled && (
          <button className="btn small" onClick={async () => setPerm(await requestPermission())}>Mitteilungen erlauben</button>
        )}
        <p className="muted small">
          {withReminder} Gewohnheit{withReminder === 1 ? '' : 'en'} mit Uhrzeit. Wichtig: Still verschickt keine Push-Nachrichten. Erinnerungen erscheinen
          nur, solange die App geöffnet ist – geschlossen oder im Hintergrund kann der Browser sie nicht zuverlässig zustellen. Ohne Erlaubnis erscheint
          der Hinweis innerhalb der App.
        </p>
      </section>

      <section className="card">
        <h2>Darstellung</h2>
        <div className="setting">
          <span>Wochenbeginn</span>
          <Segmented<S['weekStart']> label="Wochenbeginn" value={settings.weekStart} onChange={(v) => setSettings({ weekStart: v })} options={[{ value: 1, label: 'Montag' }, { value: 0, label: 'Sonntag' }]} />
        </div>
        <div className="setting">
          <span>Bewegung</span>
          <Segmented<S['motion']> label="Bewegung" value={settings.motion} onChange={(v) => setSettings({ motion: v })} options={[{ value: 'system', label: 'System' }, { value: 'reduce', label: 'Reduziert' }, { value: 'full', label: 'Voll' }]} />
        </div>
        <p className="muted small">„Reduziert" schaltet Bewegungsunschärfe und große Bewegungen ab.</p>
      </section>

      <section className="card">
        <h2>Daten</h2>
        <p className="muted small">
          {account
            ? 'Diese Daten gehören zu deinem Konto und werden zwischen deinen Geräten synchronisiert. Ein Export ist zusätzlich eine Sicherung für dich.'
            : 'Lokaler Modus: Alle Daten liegen nur in diesem Browser auf diesem Gerät, ohne Synchronisierung. Ein Export ist deine Sicherung – etwa vor dem Löschen der Website-Daten oder einem Gerätewechsel.'}
        </p>
        <div className="btn-col">
          <button className="btn wide" onClick={doExport}>Als JSON exportieren</button>
          <button className="btn wide" onClick={() => file.current?.click()}>JSON importieren …</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn wide" onClick={addExamples}>Beispielgewohnheiten hinzufügen</button>
          <button className="btn wide danger-text" onClick={() => setConfirmClear(true)}>{account ? 'Alle Kontodaten löschen …' : 'Alle Daten löschen …'}</button>
        </div>
      </section>

      <p className="muted small center">{account ? 'Still · Konto · funktioniert auch offline' : 'Still · lokal gespeichert · funktioniert offline'}</p>

      <Confirm
        open={!!pending}
        title="Import ersetzt alle Daten"
        text={pending ? `Die Datei ist gültig${pending.fromVersion < 3 ? ' (ältere Version, wird übernommen)' : ''}: ${pending.data.habits.length} Gewohnheiten, ${pending.data.entries.length + pending.data.completions.length} Erledigungen, ${pending.data.analyses.length} Analysen, ${pending.data.journal.length} Journal-Einträge. ${account ? 'Alle Daten in deinem Konto werden ersetzt – auf allen Geräten.' : 'Deine aktuellen Daten werden vollständig ersetzt.'} Exportiere vorher, wenn du sie behalten möchtest.` : ''}
        action="Ersetzen"
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          try {
            await replaceAll(pending.data);
            showToast('Import abgeschlossen');
          } catch (e) {
            showToast('Import fehlgeschlagen, nichts wurde geändert: ' + (e as Error).message);
          }
        }}
      />
      <Sheet open={!!importErrors} onClose={() => setImportErrors(null)} title="Import nicht möglich">
        <p className="muted">Es wurde nichts geändert.</p>
        <ul className="error-list">{importErrors?.map((e, i) => <li key={i}>{e}</li>)}</ul>
      </Sheet>
      <Confirm
        open={confirmClear}
        title={account ? 'Alle Kontodaten löschen?' : 'Alle Daten löschen?'}
        text={`${habits.length} Gewohnheiten mit allen Einträgen, ${analyses.length} Analysen, ${journal.length} Journal-Einträge und die Einstellungen werden ${account ? 'aus deinem Konto gelöscht – auf allen Geräten' : 'von diesem Gerät gelöscht'}. Das kann nicht rückgängig gemacht werden.`}
        action="Alles löschen"
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          try {
            await replaceAll(emptySnapshot());
            showToast('Alle Daten gelöscht');
          } catch (e) {
            showToast('Löschen fehlgeschlagen: ' + (e as Error).message);
          }
        }}
      />
    </div>
  );
}
