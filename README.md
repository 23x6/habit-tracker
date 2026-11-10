# Still

A calm, dark-gray habit tracker with weekly goals, a journal and optional cross-device sync. Installable, offline-first PWA built with React and TypeScript. German or English interface (German by default); works on iPhone, Android, macOS and Windows.

Still works fully **without an account** (local mode: data only in this browser). With a **Supabase** backend configured, users can register, sign in and sync their data between devices.

## Setup

Requires Node 18+.

```sh
npm install
npm run dev        # development server (no service worker)
npm test           # domain, sync, migration and RLS tests (vitest, fake-indexeddb, PGlite)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173 (service worker active)
```

Without `.env.local` the app runs in local mode, and Settings says that accounts are not set up.

## Enabling accounts and sync (Supabase)

Supabase's free tier is enough to start. Nothing paid is activated by this project.

1. **Create a project** at https://supabase.com/dashboard.
2. **Create the database schema.** Either:
   - open *SQL Editor*, paste the contents of `supabase/migrations/20261110000000_still_records.sql` and run it; or
   - with the Supabase CLI: `npx supabase link --project-ref <ref>` and then `npx supabase db push`.
3. **Configure Auth.** Under *Authentication → Sign In / Providers → Email*:
   - keep *Email* enabled and *Confirm email* on.
   - Optional: set the minimum password length to 8 (the app also enforces 8).
4. **Set the URLs.** Under *Authentication → URL Configuration*:
   - set **Site URL** to the address where the app is hosted, e.g. `https://still.example.com/`;
   - add the same URL (and `http://localhost:4173/` for local testing) under **Redirect URLs**.
   - Confirmation and password-reset links return there.
5. **Email delivery.** Supabase's built-in email sender is heavily rate-limited (a few emails per hour). For real use, set up your own SMTP server under *Authentication → Emails → SMTP Settings*.
6. **Configure the client.** Copy `.env.example` to `.env.local`, then fill in the **Project URL** and the **publishable/anon key** from *Project Settings → API*.
   - Never use the `service_role` key in the client.
   - `.env.local` is ignored by Git.
7. **Build and deploy.** Run `npm run build` and deploy `dist/` to any HTTPS static host.

To test without the cloud, `npx supabase start` runs a complete local stack, including a mail inbox. It needs Docker.

## Features

- **Heute (Today):**
  - The date header and swipeable week strip.
  - A **dashboard ring** with a "Heute / Woche" switch (see below).
  - **What remains first:** the habits for the selected day are sorted into three groups:
    - open daily habits;
    - weekly goals that aren't reached yet, with what is left ("Sport · noch 2× diese Woche" / "2 more this week");
    - a collapsible **Erledigt · n** / **Done · n** section, remembered per device.
    Manual order is kept within each group. Unscheduled, archived or not-yet-started habits aren't listed. A row you are tapping or typing in stays where it is and moves about 1.2 s after you stop.
  - **Quick actions,** separate from opening details:
    - done/not-done habits: one tap, with undo;
    - numeric habits: − and + (step 1 below a target of 100, otherwise a tenth of the target's order of magnitude, e.g. 100 for 2000), plus a field for direct entry (Enter saves, Escape cancels). Undo after reaching the target takes back only that step;
    - "X-mal pro Woche": one tap adds a completion for the selected day, within the one-per-day limit unless several per day are allowed;
    - analysis goals: only "Analyse hinzufügen", never a completion shortcut.
  - Rapid taps are written one after another, each from the latest stored value, so none is lost or duplicated.
- **Habit types and schedules:**
  - Done/not done or a numeric value (target and unit).
  - Daily or on selected weekdays.
  - **X-mal pro Woche** ("X times per week"):
    - no fixed weekdays; every completion counts toward the week.
    - one per day by default, or several with *Mehrere Erledigungen pro Tag erlauben*.
    - "Erledigung hinzufügen" (add a completion), backdating within the habit's history, editing and deleting individual completions, undo.
    - progress shown as "2 von 4", with week-by-week navigation and history.
  - **Analysen pro Woche** ("Substack analysieren"): each saved analysis (title, optional URL, date, "Wichtigste Erkenntnisse") counts once.
- **Effective dates:**
  - Target and schedule changes for weekly goals apply **from next week**, and the form shows the date. Daily changes apply from today.
  - History is never rewritten. Switching an existing habit between daily and weekly keeps its history.
- **Dashboard ring:**
  - **Placement:** on phones a compact stacked card below the date (ring about 150 px). From 768 px a large dashboard sits centered at the top of the content (ring 224 px, 256 px from 1200 px), with the date navigation and list below it.
  - **Heute:** only daily habits scheduled that day, one equal share each, e.g. "Heute · 3 von 4 erledigt".
  - **Woche:** only weekly goals; the mean of each goal's progress, capped at 100% per goal. Cards still show real counts such as "3 von 2".
  - **No goals:** an empty state, never 100%.
  - **Motion:** the arc and the percentage animate smoothly, interrupt cleanly on rapid changes and reverse on undo. The glow brightens briefly on completion, and there is a single restrained pulse when the goal is reached, never repeated by quick undo/redo.
- **Journal:**
  - Entries have a date, an optional title, "Notizen" and "Was habe ich heute gelernt?".
  - The timeline is grouped by date; entries can be edited and deleted with confirmation and undo.
  - Journal entries never complete a habit.
- **Details and statistics:** daily streaks and rates, a calendar for daily habits, and weekly streaks and achieved weeks for weekly goals. Daily and weekly statistics are kept strictly separate.
- **Account (Settings):** Anmelden (sign in), Registrieren (register, with email confirmation), Passwort vergessen (password reset by link), Abmelden (sign out), and the save status (see "Saving and sync").
  - Signing out only affects this device. It can also remove this account's local copy; that option is off by default while changes are still waiting to upload.
- **Header (≥ 768 px):** save status on the left; a compact DE / EN switch and a Log in / Log out button on the right, using the same sheets as Settings. Below 768 px the header is hidden entirely (not focusable), and language and account live in Settings.
- **Language (DE / EN):**
  - All interface text comes from central dictionaries (`src/i18n/messages.ts`). Dates, weekdays and numbers follow the language.
  - German is the default. The choice is stored per device (`localStorage`) and applies immediately, without reloading; forms keep their content and focus.
  - Your own content (habit names, journal text, article titles, units) is never translated. The language never affects stored data, date keys, week start or calculations.
- **Motion:**
  - Consistent springs and interruptible animations.
  - Segmented controls: the selection slides in about 160 ms without overshoot; arrow keys move the selection. Fields that depend on the selected mode appear at once with a 140 ms fade, 4 px of travel and a brief 3 px blur on that content only, while only that area's height animates (140 ms). The previous fields disappear immediately, so rapid clicks always end on the latest selection.
  - Tabs cross-fade without waiting for the old screen to finish.
  - Rows glide into place when the list changes, and swipes settle with the finger's momentum.
  - Velocity blur appears only on moving elements; content at rest is sharp.
  - Reduced motion removes blur, glow, pulses and large movements.
- **Layout:** phone-first. On wide screens the content is up to 1160 px wide, with the list column centered under the dashboard. Sheets move up above the on-screen keyboard (`visualViewport`).

## Saving and sync

- **Every confirmed change is saved immediately in this browser:** check-offs, edits, settings, journal entries and analyses.
  - The changed record and its pending sync operation are written in **one IndexedDB transaction**: either both are stored or neither.
  - The status shows "Wird gespeichert …" only while that transaction runs.
  - If a write fails, nothing is stored and the status offers "Erneut speichern".
- **Account mode:**
  - After a change the status reads "Lokal gespeichert · Synchronisierung ausstehend" until the server confirms, then "Synchronisiert".
  - Sync starts automatically about 1 s after a change (quick changes are batched; saving locally is never delayed). It also runs on app start, when the connection returns, when the window regains focus or becomes visible, and every 30 s.
  - "Jetzt synchronisieren" is only a manual fallback.
- **The upload queue lives in IndexedDB,** so it survives reloads, closing the browser and crashes. Retries are idempotent.
  - An edit made while an older upload is still in flight stays queued; the older acknowledgement never removes it.
- **Drafts:** unfinished journal and analysis text is saved as a draft after a short typing pause (about 0.7 s), when a field loses focus, and when the form closes. The draft is offered again when you reopen the form, even after restarting the app.
  - Drafts stay on this device in the account's own local database. They are never synced and never count as entries or analyses.
  - Saving explicitly writes immediately and removes the draft.
- **Honest limits:**
  - Only changes that were committed locally can survive a crash; text typed in the last moment before the debounce or a blur may be lost.
  - Changes that haven't synced yet exist only in this browser's storage on this device.
  - Nothing relies on `beforeunload` or a last-second network request.

## Data and sync

- **Partitions:** IndexedDB database `still` holds local mode. Each account gets its own cache, `still-account-<userId>`. Signing out or switching accounts remounts the data layer on a different database, so no data of one account can appear in another.
- **Schema v3:** adds completions plus sync bookkeeping (outbox, versions, conflicts). Upgrades only add stores; v1 and v2 data are kept.
- **Server:** a single table `public.records` (`user_id`, `kind`, `id`, `data` jsonb, `deleted`, `version`, `last_op`, `seq`).
  - **Row Level Security** limits every operation to `auth.uid()`. `anon` has no access.
  - Writes go through `push_changes` (SECURITY INVOKER, so RLS applies) with optimistic version checks and an operation id, which makes retries idempotent.
- **Offline:**
  - Every change is stored locally first and queued.
  - Syncing happens on start, after edits, when the connection returns, when the app becomes visible, and every 30 seconds.
  - Failures retry with backoff; nothing is dropped.
- **Duplicates:** stable ids (one-per-day completions and daily entries use `habitId|date`) and idempotent writes prevent duplicates, even when the same day is completed on two devices.
- **Conflicts:**
  - Journal and analysis text edited on two devices is **kept in both versions**. "Konflikte lösen" shows them side by side.
  - For other records (habits, check-ins, settings) the server version wins, and the app counts it.
- **Deletions** are synced as tombstones.
- **Local data import:** after signing in, *Lokale Daten in dieses Konto übernehmen* shows a preview and copies local data into the account once.
  - Duplicates are avoided by id; same-named habits are merged without doubling days.
  - The local data stays untouched.
  - Nothing is uploaded without this explicit step.
- **Export/import:** JSON is version 3, including completions. Versions 1 and 2 are still accepted. Every file is fully validated before anything changes.
  - In account mode, an import replaces the account's data on all devices.

## Deployment (Vercel)
Live: **https://still-ashy-seven.vercel.app/** (deployed from `feature/still-app`).

`vercel.json` contains the build, SPA fallback and cache headers. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (publishable key only) as Vercel environment variables, then run `npx vercel deploy --prod`. In Supabase, add the production URL as Site URL and Redirect URL (keep `http://localhost:4173/`). For people outside your Supabase organization to receive confirmation emails, configure custom SMTP. Details: HANDOFF.md, "Deployment (Vercel)".

App updates install in the background and are used from the next start. Local data and unsent changes stay in IndexedDB and are not affected.

## Install on iPhone (offline)

1. Open the hosted URL in Safari once (HTTPS).
2. Tap Share → **Zum Home-Bildschirm** (Add to Home Screen).
3. Start Still from the home screen. After the first load it also works offline.

Android Chrome: menu → *App installieren*. Desktop Chrome/Edge: the install icon in the address bar.

## Limitations

- **Only partly verified against a real Supabase project.** Sign-in and sync of a habit and its completion between two browser sessions of the same account were tested manually on desktop. Not yet tested against the real project: password reset, offline reconnect, conflict resolution, cross-user isolation (covered by automated RLS tests against the migration in PGlite) and real mobile devices.
- **Sync isn't real-time:** it polls (on start, after edits, on focus, every 30 s).
- **Structured conflicts:** for non-text records (e.g. a habit renamed differently on two devices), the server version wins.
- **Reminders only fire while Still is open** (no push). Weekly goals have no reminders.
- **Local mode** keeps data only in this browser; Safari may evict website data after long inactivity. Export regularly or use an account.
- **Week start:** changing it regroups past weeks; weekly targets stay stable.
