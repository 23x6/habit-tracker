# Still

A calm, dark-gray habit tracker with weekly goals, a journal and optional cross-device sync. Installable, offline-first PWA built with React and TypeScript. German interface; works on iPhone, Android, macOS and Windows.

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
  - All habits due on the selected day, plus the weekly goals.
  - One tap completes a habit; undo is available.
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
  - **Heute:** only daily habits scheduled that day, one equal share each, e.g. "Heute · 3 von 4 erledigt".
  - **Woche:** only weekly goals; the mean of each goal's progress, capped at 100% per goal. Cards still show real counts such as "3 von 2".
  - **No goals:** an empty state, never 100%.
  - **Motion:** the arc and the percentage animate smoothly, interrupt cleanly on rapid changes and reverse on undo. The glow brightens briefly on completion, and there is a single restrained pulse when the goal is reached, never repeated by quick undo/redo.
- **Journal:**
  - Entries have a date, an optional title, "Notizen" and "Was habe ich heute gelernt?".
  - The timeline is grouped by date; entries can be edited and deleted with confirmation and undo.
  - Journal entries never complete a habit.
- **Details and statistics:** daily streaks and rates, a calendar for daily habits, and weekly streaks and achieved weeks for weekly goals. Daily and weekly statistics are kept strictly separate.
- **Account (Settings):** Anmelden (sign in), Registrieren (register, with email confirmation), Passwort vergessen (password reset by link), Abmelden (sign out), and a sync status badge ("Synchronisiert", "Offline", "Synchronisierung ausstehend", or the number of conflicts).
  - Signing out only affects this device. It can also remove this account's local copy; that option is off by default while changes are still waiting to upload.
- **Motion:**
  - Consistent springs and interruptible animations.
  - Tabs cross-fade without waiting for the old screen to finish.
  - Rows glide into place when the list changes, and swipes settle with the finger's momentum.
  - Velocity blur appears only on moving elements; content at rest is sharp.
  - Reduced motion removes blur, glow, pulses and large movements.
- **Layout:** phone-first. On wide screens the date column and dashboard sit next to the list. Sheets move up above the on-screen keyboard (`visualViewport`).

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
