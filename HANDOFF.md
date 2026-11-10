# Still — Handoff

## Status (2026-11-10)
Iteration 3 is implemented: accounts and sync (Supabase), "X-mal pro Woche" goals, the dashboard ring, refined motion, and the desktop layout. Branch `feature/still-app`.

A real Supabase project is now connected for local use (app at `http://localhost:4173/`, config in the untracked `.env.local`). The hardened migration has been applied there.

**Manually verified by the user:** sync in both directions between a normal browser window and an incognito window signed in to the same account. A habit and its completion synchronized correctly. Everything else against the real backend is still unverified (see "Not verified").

## Deployment (Vercel)
Production URL: **https://still-ashy-seven.vercel.app/**
- Vercel project `still`, deployed with the CLI from `feature/still-app`; first deployment from commit `5ba9990`.
- The deployment alias `still-ryvo7.vercel.app` also works. Use only the URL above, since local data and the login are per address.
- The project isn't connected to GitHub, so pushes don't deploy by themselves.

Automated checks on the live URL (2026-11-10, Chromium via Playwright, Playwright's own profile, not signed in):
- **Responses:** `/`, `/sw.js`, the manifest, icons and a deep link `/some/deep/link` all return 200 without login; Deployment Protection doesn't block the production URL.
- **Cache headers:** `sw.js` is `no-cache`; `/assets/*` is `immutable`.
- **Bundle:** contains the Supabase URL, no `service_role` and no secret key; the only `sb_secret_` match is supabase-js's prefix check.
- **Layout and navigation:** at 1440, 390 and 320 px all four tabs open, with no horizontal overflow and no page errors.
- **Language:** DE → EN switches immediately, survives a reload, and was switched back.
- **Install and offline:** the service worker is active and controls the page; reload while offline works; the manifest is `standalone` with icons; the apple-touch-icon is present; secure context.
- **Update, simulated locally** (copy of the build at `localhost:4180`; `sw.js` and `index.html` changed while the app was open):
  - the `visibilitychange` check installed and activated the new worker, and the old cache was replaced;
  - the open page kept running, and a check-off made in it was saved;
  - after a reload the new version was shown; habits (5) and both check-offs were intact.

Not tested: login, registration and sync against the production URL; Safari, iPhone and macOS; installing to the iPhone home screen.


Configuration in `vercel.json`:
- Vite build: `npm ci`, then `npm run build`; output `dist/`.
- SPA fallback: every path outside `/assets/` that isn't a file is served `index.html`. The app has no URL routes; this only keeps deep links and auth redirects from returning a 404.
- Caching:
  - `sw.js`, `index.html` and the manifest are sent with `no-cache`, so updates are found;
  - hashed files in `/assets/` are cached as immutable.

Build variables (Vercel → Project → Settings → Environment Variables), the same names as `.env.example`:
- `VITE_SUPABASE_URL`;
- `VITE_SUPABASE_ANON_KEY` (publishable key).

Nothing else belongs there; they are baked into the public bundle, so never use the service_role key or the database password.

Updates:
- A new service worker installs in the background. It is also checked whenever the app comes back to the front (`visibilitychange` → `registration.update()`).
- The running page keeps its code (no forced reload). The new version is used from the next start or reload.
- Only the asset cache is replaced. IndexedDB, including unsent outbox entries and drafts, isn't touched by an update. Schema upgrades only add stores (`src/lib/db.ts`). A tab with an old version open gets `DB_BLOCKED` handling instead of losing data.

Workflow (CLI, from the repository; steps 1–3 are already done):
1. `npx vercel login` (once);
2. `npx vercel link`;
3. `npx vercel env add VITE_SUPABASE_URL production` and the same for `VITE_SUPABASE_ANON_KEY`;
4. `npx vercel deploy --prod` from a clean checkout of `feature/still-app` (commit first).

`vercel link` appends a `VERCEL_OIDC_TOKEN` to `.env.local`. It was removed again here, and the app doesn't need it. `.vercelignore` keeps `.env*`, `dist`, `node_modules` and test artifacts out of the upload.

The CLI deploys the checked-out working tree (here `feature/still-app`), not `main`. For automatic deploys on push, connect the GitHub repository in Vercel and set **Settings → Git → Production Branch** to `feature/still-app`, or merge into `main`.

Supabase Auth (Authentication → URL Configuration):
- **Site URL**: the production URL.
- **Redirect URLs**: `https://still-ashy-seven.vercel.app/**` and `http://localhost:4173/**` (the app redirects to `<origin>/`).
- Email confirmation stays on.

Email delivery:
- Supabase's built-in email service only sends to addresses of the project's organization members and is heavily rate-limited.
- For other people to register, configure custom SMTP (Authentication → Emails → SMTP Settings) with a provider of your choice. Not done; it needs the user's decision and possibly a paid plan.

## Iteration 4 (2026-11-10): dashboard, segmented motion, DE/EN, header, autosave
Not committed yet at the time of writing.

### Changes
- **Dashboard:**
  - From 768 px: large, centered at the top of the content (ring 224 px; 256 px from 1200 px; content up to 1160 px wide). The date title, week strip and actions share one row, with the list column (760 px) below.
  - Phones: compact stacked card below the date (ring 148 px).
  - Calculations unchanged (`src/lib/dashboard.ts` untouched).
- **Segmented controls and mode switches:**
  - *(Superseded by the schedule-selector fix below; timings there are current.)* The pill slides with a CSS transition that retargets from its current position on rapid clicks; labels fade their emphasis.
  - `SwitchContent` (`src/components/ui.tsx`) for mode-dependent fields (habit type, schedule, dashboard caption).
  - Only the swapped content is blurred, and the filter is removed at rest.
  - Reduced motion: opacity only, no blur or height animation.
  - Typed values stay in the form state. Per-type targets are stashed, so switching back restores them. Saving only uses the selected mode's fields.
- **Localization:**
  - Central dictionaries in `src/i18n/messages.ts`; `en` is typed against `de`.
  - `I18nProvider` and `useT()` in `src/i18n/index.tsx`.
  - Lib functions that produce text (validation, week labels, auth errors, import errors, reminders) take the dictionary as a parameter, German by default.
  - Date and number formatting follow the language through `setDateLocale` in `src/lib/date.ts`.
  - The language is stored per device in `localStorage` (`still-lang`) and sets `<html lang>`. German is the default.
  - User content is never translated. Date keys, week start and calculations are independent of the language.
- **Header (≥ 768 px):** save status, a DE/EN switch, and Log in / Log out reusing `AuthSheet` / `LogoutSheet`. During auth loading the button shows a stable spinner. Below 768 px the header is `display:none` (not focusable); Settings keeps the language and account controls.
- **Autosave and sync:**
  - Store: `saving`, a recoverable `saveError` with retry, and a `drafts` API.
  - `SaveStatus` shows "Wird gespeichert …", "Lokal gespeichert", "Lokal gespeichert · Synchronisierung ausstehend", "Synchronisiert", the sync-failure state, and conflicts.
  - Sync is also triggered on window `focus`.
  - Journal and analysis drafts: `src/components/useDraft.ts`, stored in the partition's `meta` store under the `draft:` key prefix.

### Guarantees (and their limits)
- **Atomic local commit:**
  - A confirmed change is written together with its outbox entry in one IndexedDB transaction (`StillDb.write`); if it fails, neither exists.
  - The UI updates only after the transaction commits. Failures show "Speichern fehlgeschlagen" with "Erneut speichern".
- **The outbox persists across reloads and crashes.** Sync triggers:
  - about 1.2 s after a write (batched);
  - app start, `online`, `focus`, becoming visible;
  - every 30 s while visible;
  - backoff retries after errors.
- **Idempotent retries:** the operation id plus `last_op` on the server.
- **Edits during an in-flight sync:** `ack` removes an outbox entry only if its `opId` still matches, so a newer edit stays queued.
- **Drafts:**
  - Saved after 0.7 s of no typing, on field blur, and when the form closes; restored on reopen; removed after an explicit save or "Entwurf verwerfen".
  - Local per partition, never synced, never counted.
- **Not guaranteed:**
  - Text typed in the last moment before the debounce or a blur, if the tab is killed.
  - Changes that haven't synced yet exist only in this browser's storage.
  - No `beforeunload` or last-second network request is used.

## Fix: schedule selector ("Täglich / Wochentage / X-mal pro Woche", "Daily / Weekdays / Times per week")

### Root cause (reproduced before changing anything)
Measured in Chromium at about 165 fps with 12 rounds of rapid clicks. The selection state itself always updated on the next frame; the problem was the shared `SwitchContent`:
1. **Competing nested height animations.** The schedule fields' `SwitchContent` sits inside the habit-type `SwitchContent`. Each animated its own height with a spring, fed by a ResizeObserver that called React `setState` on every frame. While the inner area grew, the outer one kept re-measuring and re-targeting and lagged behind: the inner settled about 400 ms after the last click, the outer about **760 ms** after it.
2. **Outgoing content lingered.** `AnimatePresence mode="popLayout"` kept up to **3 content blocks** during and after the burst. Outgoing blocks were absolutely positioned but still in the DOM and focusable (9 controls), and stale weekday buttons were visible next to the new mode's fields. The incoming block started from a height pinned near 0 px.
3. **Stale callbacks.** `onAnimationComplete` from interrupted height animations switched clipping off mid-animation (`overflow: visible` while still moving), so content spilled over the following fields.
4. **Slow selection pill:** 300 ms.

Found while testing at 320 px (also fixed here):
- the German labels were `nowrap`, so the selector was wider than the sheet (horizontal scroll);
- the weekly-target field was squeezed to 26 px by a CSS specificity issue;
- the end keyframe left `filter: blur(0px)` on settled content.

### Fix (shared code only: `SwitchContent` and `Segmented` in `ui.tsx`, plus CSS)
- **One height owner.** Only the `SwitchContent` whose `id` changed animates its own height: a 140 ms CSS transition from its current visual height to the new height (FLIP, ease-out without overshoot). Ancestors stay at `height: auto` and follow.
  - No React state per frame; the ResizeObserver only updates a ref.
  - Clipping is set inline only for that transition and cleared on its own `transitionend`, or by a timeout fallback.
  - Rapid clicks retarget from the current height.
- **No exit animation.** Outgoing content is removed immediately, so it is never in the layout and never focusable, and the latest selection always wins.
  - Incoming content: CSS keyframes over 140 ms (opacity, 4 px travel, 3 px blur), with `animation-fill-mode: backwards`, so no filter remains afterwards.
  - Reduced motion: an opacity fade over 100 ms; no blur, travel or height animation.
- **Focus.** `focusFallback`: if a mode change removed the element that had focus (e.g. a tap without focusing the button, as on iOS), focus moves to the selected segment. Ordinary re-renders never move focus.
- **Segmented:**
  - the pill takes 160 ms (`--ease-out-quick`, no overshoot) and labels 150 ms;
  - arrow keys, Home and End move the selection (radio-group pattern);
  - labels may wrap between words (hyphenated if needed) and buttons may shrink;
  - smaller labels below 360 px.
- Typed values were already kept in the form state; unchanged. Weekdays and the weekly target survive switching; saving uses only the selected mode.

### Verification
- **Regression test** `src/components/ui.test.tsx › schedule selector`, in DE and EN:
  - 36 clicks with no waiting; immediately afterwards: latest selection, one content block, one target field and no stale weekday buttons;
  - weekly target and weekdays preserved;
  - focus moves to the selected segment when the focused field disappears, and stays put while typing;
  - the saved rule matches (`perWeek: 4`, all days).
  - Against the previous implementation it fails: 7 stale weekday buttons.
- **Chromium, foreground, about 164 fps:**
  - 36 rapid clicks (DE): on the next frame after every click, the selection and the visible fields matched (0 mismatches); always one block; never two containers animating at once; settled 145 ms after the last click (was about 760 ms).
  - Single switch: pill 170 ms (from the click), monotonic; height 152 ms; content animation 140 ms; blur at most 3 px; no filter at all at rest.
  - EN:
    - 36 real mouse clicks ended consistently;
    - weekly target 5 and weekdays Mon/Wed/Fri survived switching;
    - arrow keys move the selection, the fields follow, and focus stays on the segment;
    - the saved IndexedDB rule matched (`perWeek: 5`, all days).
  - Reduced motion (emulated): `switch-fade` only, no height transition.
  - 320 px (DE and EN), 390 px and 1440 px: no horizontal overflow; labels wrap between words; target field 72 px.
- `npm run typecheck` clean, `npm test` **85/85**, `npm run build` OK. The preview at `http://localhost:4173/` (the already-running server) serves the new build.
- **Not verified:** real touch devices or Safari (the iOS no-focus-on-tap case was simulated with a programmatic click).

## Architecture (iteration 3)
- `supabase/migrations/20261110000000_still_records.sql`:
  - a `public.records` table with RLS policies for select, insert, update and delete (owner only; `anon` revoked);
  - the `push_changes(jsonb)` function (SECURITY INVOKER) with version checks and idempotent `last_op`, and a `seq` column for incremental pulls.
- `src/lib/db.ts`: a `StillDb` handle per IndexedDB partition, schema v3 (`completions`, `outbox`, `versions`, `conflicts`). `write(ops)` is atomic and queues an upload in sync mode.
- `src/lib/sync.ts`: `syncOnce` handles push, conflict resolution and pull with a settle window for late commits. `SyncManager` handles scheduling, backoff and status.
- `src/lib/remote.ts`: the Supabase client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` and the remote adapter.
- `src/lib/auth.ts`: a pure auth reducer, partition selection, validation and German error texts. `src/auth.tsx`: the React provider (sign-up with email confirmation, sign-in, local sign-out, reset link, new password, resend confirmation).
- `src/lib/accountImport.ts`: a previewable, idempotent local→account import plan (skip by id, merge same-named habits).
- `src/lib/weekly.ts`: weekly goals for analyses and completions, completion validation, deterministic one-per-day ids.
- `src/lib/dashboard.ts`: ring calculations and the celebration guard.
- `src/store.tsx`: rewritten around `commit(ops)` with generic undo. Keyed by partition in `main.tsx`, so an account switch remounts the data layer.
- UI: `components/Account.tsx` (auth sheets, account section, sync badge, conflicts, import preview, logout, recovery), `components/Dashboard.tsx` (glow ring), `components/CompletionSheet.tsx`. HabitSheet, HabitRow, Today, Detail, Stats and Settings were extended.
- `src/test/server.ts`: test backend that runs the real migration in PGlite with an `auth` stand-in, as role `authenticated`, with RLS active.

## Validation results
- `npm run typecheck`: clean. `npm run build`: OK (376 kB JS, 120 kB gzip).
- `npm test`: **72/72 pass**, also with TZ America/New_York, Australia/Sydney and Pacific/Kiritimati (the original 62 plus the tests below).
  - **Migration privileges** (added after the project was created with "auto-expose new tables" off and automatic RLS on):
    - every privilege is revoked first, then `authenticated` gets only SELECT, INSERT and UPDATE on `records`, USAGE on the sequence and EXECUTE on `push_changes`;
    - no DELETE for clients (deletions sync as tombstones); nothing for `anon` or `service_role`;
    - RLS is enabled with four owner-only policies using `(select auth.uid())`;
    - the function uses `search_path = ''`; the `force row level security` line was removed;
    - verified in two modes (no default grants, and permissive Supabase-style defaults), including running the migration twice;
    - mutation checks: an extra DELETE grant fails 3 tests; dropping the anon/service_role revoke fails the permissive-mode audit.
  - **Input focus** (`src/components/focus.test.tsx`, jsdom): types into the real login, registration and password-reset forms one character at a time and checks focus after each. It also covers mid-text edits, selection replacement, deletion, paste and validation messages.
    - Root cause: `Sheet` re-ran its focus effect whenever an inline `onClose` prop changed, i.e. on every keystroke, and moved focus to the panel.
    - On the old code 5 of 6 tests fail exactly like the bug.
  - **Server isolation (real SQL, PGlite):**
    - user B can't read, update, delete or forge user A's rows;
    - B can't hand its own row to A;
    - a push with the same id creates B's own row;
    - pulls return only the caller's rows;
    - `anon` gets permission denied; no user claim → "not authenticated".
    - Mutation check: with the select policy changed to `using (true)`, 3 tests fail (restored afterwards).
  - **Sync engine:**
    - offline queue plus retry reaches a second device;
    - a lost response is retried idempotently (version stays 1, no conflict);
    - deletions propagate;
    - conflicting journal edits keep both texts until resolved; resolving "local" propagates;
    - edit-vs-delete keeps the edited text;
    - the same day completed on two devices merges without duplicates;
    - differing structured changes → server wins, reported;
    - invalid server data is never stored;
    - two accounts on one device stay separate.
  - **Auth:** sign-in, refresh (no remount), sign-out and switch map to the right partition; recovery mode isn't inherited by another user; validation and German errors; partition isolation and cache removal.
  - **Local import:** merge, skip, keeps account days; a second run adds nothing; local data untouched.
  - **X-mal pro Woche:**
    - counting, one-per-day vs. multiple per day;
    - future, pre-start and pre-rule dates rejected;
    - Monday/Sunday weeks and the year change;
    - target change from next week;
    - missed only after the week ends;
    - daily→weekly switch keeps daily history;
    - never a daily obligation.
  - **Dashboard:**
    - Heute counts equal shares; Woche is the mean of capped ratios;
    - empty sets give no ratio;
    - undo reverses;
    - celebration fires once per ring, not repeated by quick undo/redo.
  - The 35 earlier tests (journal, analyses, migration, import/export) pass on the new storage layer.
- **Browser (Playwright/Chromium, production build) at 320×640, 390×844 and 1280×860, local mode:**
  - **Migration:** the browser profile's real **v2 → v3** database kept 7 habits, 3 entries, 2 analyses and 2 journal entries.
  - **Frequency goals:** created "Laufen" (3/week) and "Meditation" (5/week, multiple per day).
    - Completion, undo and five rapid toggles all worked; the rapid toggles left one stored completion with a deterministic id.
    - Backdating validation worked (before start, same day twice).
    - Editing a completion into the previous week updated both weeks; delete and undo worked.
    - Changing "Sport machen" to 4/week showed "Gilt ab Montag, 16. November"; it stays daily this week.
  - **Dashboard:**
    - Week ring checked by hand: (1 + 1/3)/2 = 67%, then (1 + 1/3 + 2/5)/3 = 58%.
    - Day ring unaffected by weekly goals.
    - At a real frame rate (the page had to be brought to the front, otherwise about 3 fps): the arc animated smoothly (74 monotonic frames) and undo reversed it mid-flight with a maximum jump of 1.8 units per frame.
    - Glow peaked at 1.0, and exactly one pulse ran (scale 1 → 1.045 → 1 over 0.6 s); an immediate undo/redo didn't pulse again.
  - **Auth UI**, using a build pointed at an unreachable address: validation messages, password rules, the German network error, login/register/forgot navigation; the app stays in local mode after a failure. No success was simulated.
  - **Other:** offline reload of the new build; reduced motion (no glow element, text summary intact); swipe blur reaches its 14 px cap at a real frame rate and is gone at rest; no horizontal overflow at 320 px.
- **Real Supabase project (manual, by the user):**
  - Signed in to the same account in a normal and an incognito browser window.
  - A habit and its completion synced in both directions.
- **Real Supabase project (automated checks, without signing in):**
  - Auth health and settings respond; email signup is enabled and email confirmation required.
  - Without a login, both `records` and `push_changes` return permission denied (42501).
  - The browser at `http://localhost:4173/` reaches the project (CORS).
  - Only a publishable key is in the bundle.
- **Bugs found and fixed during verification:**
  - Typing in sheet forms lost focus after every character (see "Input focus" above).
  - Postgres jsonb key order caused false conflicts → canonical comparison.
  - The `today` screen class collided with the weekday button class (broken week strip on desktop).
  - The week strip overflowed at 320 px.
  - The account mode line wrapped badly.

## External setup (done for local use; repeat for a deployment)
See README "Enabling accounts and sync". For the local setup: project created, migration applied, `.env.local` filled, Site URL and Redirect URL `http://localhost:4173/`. For a hosted deployment:
1. create a Supabase project;
2. run the migration;
3. keep email confirmation on;
4. set Site URL and Redirect URLs;
5. preferably configure SMTP;
6. fill `.env.local` from `.env.example` (URL and anon key only);
7. build and deploy.

Still to verify manually:
- password reset by email;
- offline edit, then reconnect; a journal conflict between two sessions;
- a second account can't see the first account's data;
- sign-out and account switch show no other account's data.

Alternatively, run `npx supabase start` with Docker for a local stack.

## Validation results (iteration 4)
- `npm run typecheck`: clean. `npm run build`: OK (650 kB JS, 193 kB gzip; Vite's >500 kB chunk hint).
- `npm test`: **83/83 pass** (72 earlier plus 11 new).
- **`src/lib/autosave.test.ts`** (real migration in PGlite):
  - pending operations survive closing and reopening the database and are pushed afterwards;
  - three failed offline attempts lose nothing, and the latest offline edit wins after reconnecting;
  - a lost response is retried without duplicates or conflicts (server version stays 1);
  - an edit made while a push is in flight stays queued and is pushed next. Mutation check: an unconditional acknowledgement fails this test;
  - a failing local write stores neither the record nor its outbox entry;
  - drafts survive reopening, are never counted and never queued, and are isolated per account.
- **`src/components/ui.test.tsx`** (jsdom):
  - Language: German by default; switching updates text, dates and `<html lang>` immediately and persists across a remount; date keys don't change.
  - A language switch keeps typed values, the same input node and focus.
  - The habit form restores the numeric target after switching modes. Rapid switching ends with exactly the selected mode's fields; the name field never remounts.
  - A failing local write shows the save error with retry and stores nothing.
- The earlier focus regression tests still pass.
- **Browser (Playwright/Chromium, production build at `http://localhost:4173/`, Playwright's own profile, not signed in):**
  - **1440 and 1920 px:**
    - the dashboard is centered (offset −7 px, i.e. half the 15 px scrollbar);
    - the ring is 256 px, and the list starts at 570 px in a 900 px window;
    - the header shows the save status, DE/EN and "Anmelden"; no horizontal overflow.
  - **320 and 390 px:** the header is hidden and none of its buttons are focusable; ring 148 px; no overflow; the mobile save status is visible.
  - **DE → EN:** switched in the header. Every screen was scanned (Today, Week, Journal plus sheet, Statistics, Settings, habit sheet in Number and Analyses modes, both detail views, analysis sheet, login sheet with validation): no German interface words remained, only user content. `<html lang="en">` and English survived a reload; switched back to DE afterwards.
  - **Motion at about 170 fps** (page brought to the front):
    - the segmented pill moved monotonically over 32 frames in 291 ms, without overshoot (before the schedule-selector fix);
    - the conditional field height grew 0 → 75 px over 41 frames (before the fix);
    - blur was present only during the swap and gone at rest;
    - five rapid mode switches ended with one content block per switch and no leftover fields; the typed name and focus survived.
  - **Drafts:** a journal draft was saved after the pause, survived a reload, was not counted as an entry, came back with the "restored" notice, and "Entwurf verwerfen" removed it.
  - **Focus:** typing 18 characters into the header's login form never lost focus.
- **Not tested in this iteration:** login and logout with a real account. The header button was only exercised signed out (opening the login sheet); sign-out reuses the unchanged logout sheet. Also untested: sync status texts against the real backend, and all real devices.

## Not verified
- **Cross-user isolation against the real project, manually.** It's covered only by the automated RLS tests against the migration (PGlite), plus the anonymous permission-denied checks above.
- **Against the real project:** password reset, offline reconnect, conflict resolution, the local-data import, sign-out cache removal, and account switching.
- **Real iPhone/Android devices** (keyboard behaviour, install, touch feel) and Safari. The two-session sync test ran in desktop browser windows only.
- Screen readers beyond roles and labels.
- **Smoothness on real devices:** all motion measurements come from desktop Chromium.
- **English copy** was written here and not reviewed by a native speaker.

## Remaining / ideas
- Sync uses polling; Supabase Realtime could push changes immediately.
- The server-wins policy for structured records could become per-field merging.
- Weekly goals have no reminders.
- The account's own settings (week start, motion) are synced as one record; device-specific motion preferences could be split out.
