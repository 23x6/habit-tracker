# RYVO (formerly Still) — Handoff

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

## Iteration 10 (2026-11-11): push reminders while the app is closed
### Delivery path (checked against official docs on 2026-11-11)
- **iPhone/iPad:** Web Push works only for Home Screen web apps from iOS/iPadOS 16.4, in standalone display mode, and the permission must be requested from a user action (WebKit, "Web Push for Web Apps on iOS and iPadOS"). Safari tabs on iOS get no push. Desktop Chrome, Edge, Firefox and Safari support standard Web Push with VAPID.
- **Hosting limits:**
  - Vercel is on the **Hobby** plan (`vercel teams ls`). Vercel Cron Jobs run at most once a day there (with up to an hour of jitter), and the newer Vercel Schedules at most every 15 minutes with 15 minutes of jitter. Neither is usable for reminders.
  - Supabase's platform supports pg_cron with pg_net to call HTTP endpoints on a schedule (Supabase docs "Scheduling Edge Functions", "Cron").
- **Chosen setup (no paid service):** Supabase pg_cron calls `POST /api/reminders` on Vercel **every 5 minutes** through pg_net.
  - That is about 8,640 function calls a month, well inside Hobby's included invocations.
  - The function computes what is due and sends Web Push with the `web-push` library (VAPID).
  - The UI says reminders arrive up to about 5 minutes after their time.

### What is sent (`src/lib/pushPlan.ts`, pure and shared with the app's model)
- **Daily / weekday habits with a reminder time:** sent when the habit is scheduled on that **local** date (device time zone, IANA) and its target is still open in the synced records. Example: 3/10 pages → "Noch offen: 3/10 Seiten"; 10/10 → nothing. Archived, unscheduled and completed habits are skipped, and deleted records (tombstones) are ignored.
- **Weekly goals** (analyses or "X-mal pro Woche"): an optional reminder day and time (`Habit.weeklyReminder`, set in the habit form). It is sent on that weekday while the week's count is below the target, e.g. "Noch 1 Analyse diese Woche" / "Noch 2× diese Woche". The week follows the configured week start. The reminder day is only a notification preference.
- **Window:** a reminder is due from its time for 60 minutes. A late or skipped run still sends it; much later runs don't send stale reminders.
- **Daylight saving:** local time is read per run. A time skipped in spring (02:30) is sent at the first run after the jump; the repeated hour in autumn can't send twice (same key).
- **Tapping a notification** opens RYVO on that habit (`./?habit=<id>`): an open window is focused and told which habit to open; otherwise a new window opens with the URL. The app removes the parameter afterwards.

### Server (`api/reminders.ts`, `api/push-test.ts`, `src/server/*`)
- `POST /api/reminders`:
  - requires `Authorization: Bearer <CRON_SECRET>`, compared in constant time;
  - reads data only through the `push_*` SQL functions, which check the same secret (hash in `private.push_config`);
  - **Vercel holds no Supabase service-role key**; it uses the public anon key plus the secret.
- **Each reminder is claimed** once per device and key (`push_deliveries`, primary key), before sending, so overlapping or duplicate runs never alert twice.
- **Send results:** 404/410 removes the device (expired subscription); other failures release the claim, so a later run within the window retries. TTL is 1 hour.
- `POST /api/push-test`: sends a test notification to the caller's own device. It authenticates with the user's access token, and RLS proves ownership.
- **Packaging:** Vercel compiles `api/*.ts` as ES modules without bundling. The functions' import graph therefore uses explicit `.js` specifiers (`src/lib/{date,model,weekly,io,icons,pushPlan}.ts`, `src/i18n/messages.ts`, `src/server/*`); TypeScript and Vite resolve them to the `.ts` files. A preview deployment showed that extensionless imports fail there (`ERR_MODULE_NOT_FOUND`).
- `tsconfig.server.json` type-checks `api/` and `src/server/` with Node types. `npm run typecheck` and `build` run both configs.

### Database (`supabase/migrations/20261112000000_push.sql`)
- **Tables:**
  - `push_subscriptions` (one row per device: endpoint, keys, time zone, language; unique endpoint);
  - `push_deliveries` (sent keys; cleaned after 40 days);
  - `private.push_config` (SHA-256 of the scheduler secret).
- **RLS:** users can select and delete only their own subscriptions. Nobody else can see deliveries or the config.
- **Functions:**
  - `push_register` (authenticated): an endpoint registered by another user moves to the caller; at most 20 devices per user;
  - `push_unregister(endpoint)` (anon/authenticated): an unguessable endpoint is the device's capability; used on logout;
  - scheduler functions `push_due_data`, `push_claim`, `push_result` (anon + secret).
- `grant usage on schema public to anon` (needed to call the functions). anon still has no table privileges.
- **Scheduler setup** is separate (pg_cron/pg_net aren't in PGlite): `supabase/setup/reminders-cron.sql` with a `<CRON_SECRET>` placeholder; the secret goes into Vault. A filled copy with the real secret was generated locally only (`supabase/.temp/`, git-ignored).

### Device (`src/lib/push.ts`, Settings → „Erinnerungen bei geschlossener App“)
- **Buttons:** turn on (permission is requested only after the tap, as the first step), send a test notification, turn off.
- **Guidance (DE/EN):**
  - an account is required (the server must know the entries);
  - iPhone not installed: add to the Home Screen;
  - permission denied: where to allow it;
  - unsupported browser;
  - not configured;
  - offline.
- **Shown always:** timing (every 5 minutes) and the offline edge case. The server can only suppress a reminder after it receives the completion, so something checked off offline can still be reminded until it syncs.
- **Shared devices:** `still-push-owner` remembers who turned push on in this browser. Signing out turns push off (server row removed, browser subscription removed). When another user signs in, the previous user's subscription is removed, not taken over. Offline, the push service reports the dead endpoint (410) at the next send.
- **No double alerts:** while push is on for the signed-in user on this device, the in-app reminder loop doesn't run.
- On every start the registration is refreshed (time zone, language, rotated keys).

### Configuration
- **Vercel (production):**
  - `VITE_VAPID_PUBLIC_KEY` (public);
  - `VAPID_PRIVATE_KEY` (sensitive);
  - `VAPID_SUBJECT` = `https://still-ashy-seven.vercel.app/`;
  - `CRON_SECRET` (sensitive).
- **Not done by Claude:** adding these was blocked by the session's permission rules (secret-store write). The user adds them (README "Push reminders").

### Verification
- `npm run typecheck` (app + server) clean, `npm test` **169/169** (28 new), `npm run build` OK.
- **`lib/pushPlan.test.ts`:** open vs. completed (3/10 vs. 10/10), weekday not scheduled, archived, no time, the 60-minute window, weekly goals (remaining count, target reached, other weekday, Sunday week start), time zones (New York, Tokyo, unknown zone), DST spring and autumn in Berlin, a target change in force on the local date.
- **`server/reminders.test.ts`** (real migrations in PGlite, RLS active, scheduler as `anon` + secret):
  - only open reminders, from synced records, and tombstones ignored;
  - a synced completion suppresses the next reminder;
  - three overlapping runs send once per device; two devices each get one;
  - retries within the window, none after it; expired devices removed;
  - accounts isolated (each device gets only its owner's reminders);
  - users can't read others' devices, deliveries, config or scheduler data; wrong secret → forbidden;
  - logout (`push_unregister`) stops delivery; the shared device moves to the next user.
- **Encrypted message:** a real `web-push` request is decrypted with the device keys (aes128gcm, VAPID header, TTL).
- **`lib/push.test.ts`** (jsdom, fake push APIs): permission first, then subscribe and register; denied; another user on the same browser removes the subscription; owner refresh; sign-out; iPhone-in-Safari → install guidance; `weeklyReminder` validation and sanitizing.
- **Browser (Chromium via Playwright, production build via `vite preview`):**
  - a push delivered to the real service worker via the DevTools protocol (`ServiceWorker.deliverPushMessage`) produced `showNotification("10 Seiten lesen", body "Heute noch offen", tag, data.url "./?habit=example-reading")`;
  - the click handler with that notification opened the habit in the open window;
  - a cold start with `?habit=` opened it and cleaned the URL;
  - Settings without an account shows the account requirement;
  - the weekly reminder field saves `{ day: 3, time: "19:30" }`.
  - Headless Chromium shows no system notifications and has no push service, so a real browser subscription and visible notification weren't possible there.
- **Preview deployment:** both functions load on Vercel and answer 503 "not configured" (preview has no secrets).
- **Not verified yet:**
  - scheduled delivery with the app closed on a real device (needs the configuration above and a real iPhone);
  - the live pg_cron run;
  - VoiceOver.

  A test notification only proves that the device receives push, not that the schedule works.

## Iteration 9 (2026-11-11): progress overview (7 / 30 days) and weekly review
### Statistics (`screens/Stats.tsx`, logic in `lib/review.ts`)
- **Period switch** "7 Tage / 30 Tage": the last 7 or 30 local calendar days including today, with the exact range ("8.–14. Nov. 2026", via `formatRange`). The choice is remembered per device (`still-stats-span`).
- **Daily habits** (`dailyStats`):
  - completed of scheduled days per habit, with the count next to the percentage;
  - each day uses the rule, target, start date and pauses in force on that day (`rate`/`isScheduled`/`targetAt`), so changes never rewrite history;
  - today counts only once completed; otherwise it shows as "heute noch offen" (numeric: "heute 3/20 Seiten – noch offen");
  - a note explains that the activity streak counts any activity, while here only a reached goal counts.
- **Weekly goals** (`goalStats`):
  - analysis and "X-mal pro Woche" goals, per calendar week of the configured week start, with the rule in force at the week's start;
  - finished weeks overlapping the range are results ("1 von 1 abgeschlossener Woche erreicht", per week "2 von 2 Analysen · erreicht");
  - the running week is listed separately ("Diese Woche (…) · läuft noch – 1 von 2 Analysen");
  - weeks that reach outside the range are marked `*` and explained: the whole week is counted.
- **Empty period:** a DE/EN message suggesting a habit or a longer period. The old week/month summary cards and the 30-day list were replaced by this overview; the activity heatmap stays.

### Weekly review (`screens/WeeklyReview.tsx`)
- **Opening it:**
  - from the "Wochenrückblick" button in Statistics;
  - from a compact dashboard link on the last two days of the week (`reviewDue`); it says "ansehen" once a review exists.
  - It always opens on the current week; the arrows move by week on the configured week start, and "next" stops at the current week.
- **Order on one mobile screen:**
  1. daily completions;
  2. weekly goal results;
  3. an expandable "Notizen und Erkenntnisse der Woche (n)" list (journal notes and saved analysis learnings of that week);
  4. the three prompts: „Was lief gut?“, „Was hat mich gebremst?“, „Was ändere ich nächste Woche?“ (EN: "What went well?", "What held me back?", "What will I change next week?").
- **Saving:**
  - while typing, `useDraft` keeps a local draft (per partition, never synced);
  - "Sichern" writes the review record (outbox, sync);
  - clearing all three prompts and saving removes the record.
  - If a newer version arrives by sync while nothing was typed, the form shows it.
- **Week start changes:** reviews are stored under their explicit range (`id = <weekStart>_<weekEnd>`). When the week start changes, `overlappingReviews` lists earlier reviews whose dates overlap the shown week, with a button to open them under their original dates.

### Storage, sync, export
- **Model:** `Review { id, weekStart, weekEnd, wentWell, heldBack, nextWeek, createdAt, updatedAt }`.
- **IndexedDB v4:** adds the `reviews` store (additive upgrade). The partitions are unchanged, so each account has its own reviews and drafts.
- **Sync:** new record kind `review`, in `PRESERVE`, so conflicting texts are kept for the user like journal text. The conflict sheet shows the week range and the three answers.
- **Validation:** `reviewErrors` (range of exactly 7 days, id matches the range, text limits, at least one answer) and `cleanRecord('review')` for pulls.
- **Export/import:** format version 4 includes `reviews`. Versions 1–3 still import (no reviews). The import dialog shows the review count.
- **Account import:** local reviews are added to the account unless the account already has one for the same range (kept, never overwritten).
- **Fix in `useDraft`:** typing again after a save (form still open) is a draft again. The review form doesn't mark its draft as committed: the draft clears itself once it equals the saved text, so text typed during a save isn't lost.

### Supabase migration (required before deploying this version)
- `supabase/migrations/20261111000000_reviews.sql` replaces the check constraint `records_kind_check` so that `kind` may also be `review`. RLS policies, privileges and `push_changes` are unchanged and apply to reviews as to all other records.
- **Why it must come first:** the old constraint rejects a review, and `push_changes` then fails for the whole batch, so sync stalls (nothing is lost; changes wait in the outbox). A test reproduces exactly this.
- The test backend (`src/test/server.ts`) now applies all migrations in file order (twice, to prove re-runs are safe). `createServer(grants, upTo)` can stop earlier to test an upgrade.

### Verification
- `npm run typecheck` clean, `npm test` **152/152** (21 new), `npm run build` OK.
- **`lib/review.test.ts`:**
  - **Weekday-only habit:** Mon/Wed/Fri over 7 days (1/2, today open) and 30 days (1/12, dates listed in the test).
  - **Numeric target changed mid-period:** 10 → 20 pages; 15 pages count before the change, not after. 3 of 20 today earn an activity-streak day but stay open.
  - **Archive period and start date.**
  - **Empty week:** no rows.
  - **Partial edge weeks and the running week:** "1 von 2 Analysen".
  - **New Year week:** 2025-12-29 – 2026-01-04 with Monday and Sunday starts; the range label shows both years.
  - **Analysis moved** from one week to the previous one.
  - **"2× pro Woche" completions.**
  - **Review records:** creation, emptying, overlap after a week-start change, validation, export v4 and import of v3, `reviewDue`.
- **`lib/reviewSync.test.ts`** (real migrations in PGlite, RLS active):
  - a project with only the first migration rejects reviews; after applying the new one (also twice, and with the first re-run afterwards) they sync and old rows stay;
  - **offline edit:** the app is closed while offline; the text is back after reopening; one more failed attempt, then reconnection; the second device receives it;
  - an earlier week's review is edited later (version 2);
  - **concurrent edits** on phone and laptop: a conflict with both texts, the server text shown meanwhile, resolved for the laptop, and the phone receives it;
  - two accounts with a review for the same week stay separate; RLS blocks cross-account updates.
- **`screens/review.test.tsx`** (jsdom, real store and IndexedDB):
  - typed text survives closing the app as a draft and isn't a stored review;
  - after "Sichern" and reopening, the saved text and "Gesichert …" appear;
  - an earlier week is edited twice (one record), and "next" is disabled on the current week;
  - after switching to Sunday weeks, the Monday review is offered and opens with its text;
  - switching accounts shows only that account's review and draft.
- **Browser (Chromium via Playwright, dev server, clock set to Saturday 2026-11-14, data loaded through the real JSON import):**
  - **Statistics, 7 days (8.–14. Nov.):** Gym (Mo/Mi/Fr) 67 % 2/3; Lesen 50 % 3/6 with "heute 3/20 Seiten – noch offen"; total 5 of 9. Substack: Nov 2–8 "2 von 2 Analysen · erreicht" with `*`, this week "1 von 2 Analysen". All match the records by hand.
  - **30 days:** "16. Okt. – 14. Nov. 2026".
  - **Review, current week:** Gym 2/3, Lesen 2/5 with today open, notes (2) = journal note Nov 10 + analysis Nov 11.
  - **Review, previous week:** Gym 3/3, Lesen 2/7, Substack 2/2; the imported review text is in the prompts.
  - **Dashboard link** on Saturday: "Die Woche endet bald. Wochenrückblick öffnen".
  - **DE and EN** at 390 and 1440 px: no horizontal overflow, no page errors.
- **Migration and deployment:**
  - the user ran `20261111000000_reviews.sql` on the production Supabase project and reported success (2026-11-11);
  - commit `9348b0a` was then deployed to `https://still-ashy-seven.vercel.app/` (deployment `dpl_EW7dTBdPJwtSPd8FAfyMqRZkgGp8`).
- **Live check** (fresh Chromium profiles, local mode, DE 390 px and EN 1440 px):
  - Statistics shows "5.–11. Nov. 2026" for 7 days and "13. Okt. – 11. Nov. 2026" for 30 days, with the daily, weekly-goal and activity cards;
  - the review opens on "9.–15. Nov. 2026 · Diese Woche", "next" is disabled, and "previous" shows Nov 2–8;
  - the three prompts appear in DE and EN;
  - a saved answer is back after a reload;
  - no overflow, no page errors.
- **Not verified:**
  - syncing a review with a real account (needs a sign-in; the server side is covered by the PGlite tests against the same migration);
  - two real devices;
  - iPhone Safari (layout, keyboard over the prompts, draft restore after the app is killed);
  - VoiceOver.

## Iteration 8 (2026-11-10): flame polish, idle motion, animation previews, name RYVO
The user moved the flame polish ahead of the statistics/weekly-review milestone. That milestone had not been started (no code and no uncommitted work for it), so nothing of it was touched. Streak rules, triggers and deduplication are unchanged (`lib/streak.ts` untouched).

### References
Both files in `design/` were reviewed again. The GIF was read frame by frame in Chromium via WebCodecs `ImageDecoder` (101 frames, about 6 s). Taken from them:
- three nested layers;
- the number at the base, inside the inner flame, as a white numeral with a coloured outline;
- colour rising from the base with a licking edge;
- a blue frost state.

Nothing is embedded; the artwork is drawn from scratch.

### Artwork
`Flame` in `components/Streak.tsx` is one component for the dashboard, overlay, details sheet and welcome.
- **Silhouette:** a rounded outer flame with a gently tapered main tip and a small right tongue, a warm middle flame and a small inner flame at the base. The neon edge line is gone.
- **Active:** coral-to-red outer flame, orange middle flame, peach inner flame, a soft peach highlight stroke on the left and a restrained glow (σ 6, opacity 0.36).
- **Number:** white with a dark outline painted behind the fill (`paint-order: stroke`), sitting in the inner flame. Font size is 22, 16 or 12 for up to 2, 3 or 4+ digits (1234 checked).
- **Frozen:** icy blue/cyan layers, a translucent frost sheen with a white inner rim, fine crystal lines and the snowflake badge, so it reads without colour.
- **Cold:** gray outline. The day-strip icon uses the new silhouette.

### Idle motion (dashboard badge, lit only)
- A seamless 3.2 s loop:
  - the outer and middle layers sway out of phase (`skewX` pivoting on the base, so the base stays anchored);
  - the inner flame breathes and the glow follows;
  - the number never moves.
- It pauses while the page is hidden (`visibilitychange` toggles `html.page-hidden`). It is static with reduced motion (app setting or system).

### Celebration (same trigger as before)
- `FlameOverlay` is the shared overlay. `StreakCelebration` decides when it appears; the Settings previews use the same overlay.
- **Sequence:**
  1. The backdrop fades in and the card enters with a restrained spring (scale 0.88 → 1, slight overshoot).
  2. Colour rises from the base (140–700 ms).
  3. At 640 ms a warm pulse (scale 1.055 from the base, glow flare) and the counter rolls from the real old value; embers rise.
  4. The text under the flame appears with the new count.
  5. Hold, then fade and scale to 0.92.
- **Duration, measured in Chromium** (appear to removal): **1.82 s** for a new day, **1.96 s** for a recovery.
- **Roll blur without CSS filters:** each number has a sharp copy and a copy with a vertical SVG `feGaussianBlur`; they crossfade while moving. Safari ignores CSS `filter` on SVG children, but SVG filter elements work there.
- **Wipe fallback:** `beginElementAt` starts the SMIL colour wipe, and a single timer (780 ms) then removes the clip. If SMIL never ran, the flame snaps to full colour instead of staying gray.
- Dismissal, focus and typing behaviour are unchanged: a tap or Escape closes it at once, it never takes focus, and it is passive while a text field has focus.

### Recovery
1. Frozen flame with frost.
2. Cracks spread (200–560 ms).
3. At 560 ms the ice turns into six shards that drift a short distance and fade. Meanwhile the middle and inner layers of the warm flame grow from the base and the glow pulses.
4. The counter rolls at 600 ms. The snowflake badge lifts away.

A genuinely broken streak still uses the normal ignite (0 → 1) without ice.

### Animation previews (Settings → „Animationsvorschau“)
- Four buttons: Aktive Flamme, Neuer Serientag (5 → 6), Eingefrorene Flamme, Freeze-Rettung (5 → 6).
- The overlay shows a „Vorschau“ label, and a note says nothing is saved.
- They render `FlamePreviewOverlay`, which uses the production `FlameOverlay` and `Flame` with fixed sample numbers.
- They read and write nothing: no store call, no entries, no streak change, no freeze, no celebration-dedup key, nothing to sync.

### Name
- The visible name is now **RYVO**: page title, home-screen name (manifest, Apple title), notifications, UI texts (DE/EN) and the export file name `ryvo-export-<date>.json`.
- **Unchanged on purpose**, because changing them would orphan stored data or break old exports:
  - IndexedDB names (`still`, `still-account-<id>`);
  - `localStorage` keys (`still-*`);
  - the export format id `app: "still"`, so old and new exports import both ways;
  - the Vercel project and URL, and the package name.
- An already installed home-screen icon may keep the old name until it is added again.

### Verification
- `npm run typecheck` clean, `npm test` **131/131**, `npm run build` OK.
- **Tests:**
  - the badge test now expects the idle loop, and `static` with reduced motion;
  - a new test checks that all four previews show the production overlay (5 → 6 roll, 6 shards for recovery) and leave local writes, the snapshot, the dedup key and the badge unchanged.
- **Browser (Chromium via Playwright, dev server):**
  - **Frames:** seeked frames of both sequences (0–1800 ms) and real-time frames of a real check-off show gray → colour rising from the base → full colour, with no jump when the wipe clip is removed.
  - **Real flow at 390 px, fresh profile:** a check-off showed the overlay 0 → 1 after about 50 ms; focus stayed on the check button; it was removed after about 1.8 s; a second check-off didn't replay; no horizontal overflow.
  - **Idle frames 0–3200 ms:** only the tip sways; the number stays fixed.
  - **Large numbers** 99, 365 and 1234 fit.
  - **1440 px:** flame 300 px, no overflow.
  - **Reduced motion:** `anim-fade`, no roll.
- **Not verified:**
  - Safari/iPhone: the SMIL start, the SVG blur filter, `transform-box` transforms on SVG, touch feel;
  - VoiceOver;
  - a real account across two devices.

  Use the previews on the iPhone to check the look.
- **Deployed** commit `f5682ff` to production (`https://still-ashy-seven.vercel.app/`, deployment `dpl_4d5zb4uzjnRGdMYnrgRh6p4x7rPk`). Live check in a fresh Chromium profile: title and manifest name „RYVO“, no overlay on load, the recovery preview plays (5 → 6), no page errors.

## Iteration 7 (2026-11-10): streak celebration, red/blue flame, ice-break recovery
### References (`design/`, local only; not committed, not deployed)
- **`3216526ca7be165f63f0eb090a2be702.jpg`** (still image, not an HTML animation):
  - neon flame icon: one outline with a large left tongue and a smaller right tongue, a drop inside, and a pink-to-blue glow;
  - used for the **silhouette** (`OUTER`/`INNER` in `Streak.tsx`) and the fine bright edge line.
- **`67d03661b8a24310378e5629_Disco_Streak_Freeze_EN 2.gif`** (101 frames, about 6 s; read frame by frame in Chromium with WebCodecs `ImageDecoder`):
  - gray flame with 0 → colour rises from the base (orange outer, yellow inner) while the number jumps to 8;
  - a day of the strip turns into a snowflake; embers fly up;
  - the flame crossfades to blue with a frost ring, ice particles and a frosted halo.
  - Used for the **motion**: ignition as a rising wipe with a licking edge, embers, the day pop in the strip, and the frozen look. The ice-break is the reverse of its freeze (it isn't in the GIF).
- Neither file is embedded. Their UI (white page, "Next" button, sample counter) wasn't copied. The requested `design/streak-reference.gif` didn't exist; these two files were used instead.

### Celebration (`StreakCelebration` in `Streak.tsx`, decision in `celebrationFor` in `lib/streak.ts`)
- **Trigger:** only after the user's own write has been committed to IndexedDB. The store exposes `localWrite = { n, dates }`, set after the commit and never for sync pulls, import reloads or failed writes. Network sync is not awaited.
- **Conditions:**
  - today's state goes from not-done to `done`, and the write stored an action dated today;
  - the day hasn't been celebrated on this account yet: `pref:streak-celebrated` in the partition's local `meta` store (per account and device, never synced).
  - Consequences:
    - another action the same day, or undo then redo, never replays;
    - a reload, a token refresh, the initial historical sync or an account switch never triggers it;
    - backdated edits only change the number quietly.
- **Kinds:**
  - `continue`: 5 → 6;
  - `start`: 0 → 1, for the first day or after a genuinely broken streak, with no ice and nothing "restored";
  - `recovery`: the streak was held by the freeze (`protectedByFreeze`) and today continues it, e.g. 3 → 4; the frozen day added nothing.
- **Sequence:**
  - `celebrate`, about 1.7 s on screen: dim backdrop; the gray flame fills with colour from the base (SMIL wipe started with `beginElementAt` on mount); embers; the counter rolls from the real old value to the new one with a short vertical roll, crossfade and a transient 1.4 px blur; the today cell of the strip pops; hold; fade out.
  - `recover`, about 1.85 s: the blue frozen flame with the old number; cracks draw in; six shard wedges fly apart and fade; the red/orange flame underneath flares; then the counter roll.
- **Interaction:**
  - a tap anywhere or Escape closes it at once; Escape is captured, so a sheet underneath doesn't close too;
  - it never takes focus (focus stays on the tapped control), so nothing needs restoring;
  - if a text field has focus when it starts, the overlay ignores input entirely (`pointer-events: none`, no key handling);
  - `role="status"` announces the new count.
- **Reduced motion:** 150 ms fade, the new number only; no roll, blur, shards or wipe.
- The **login welcome** stays separate: it shows the current streak and never counts or rolls.
- The **dashboard badge** now updates quietly; its earlier flare was removed in favour of the overlay.

### Colours (same `Flame` everywhere: overlay, dashboard, details sheet, welcome)
- **Active:** coral-to-red outer flame, orange drop, warm glow; the number in deep brown.
- **Frozen:** icy blue outer flame, pale cyan drop, hatched frost and crystal strokes, a snowflake badge and a cool glow.
- **Cold:** gray outline.
- **Day strip:** coral flame for active days, cyan snowflake for frozen days.
- The rest of the interface stays charcoal gray. The glow canvas keeps 24 units of padding (3σ = 21), so it is never clipped.

### Verification
- `npm run typecheck` clean, `npm test` **130/130**, `npm run build` OK.
- `lib/streak.test.ts`, 7 new cases for `celebrationFor`:
  - first day; consecutive day and a second action;
  - freeze recovery (3 → 4); genuinely broken streak (0 → 1, `start`);
  - undo/redo already celebrated; backdating; a write without an action dated today.
- `components/streak.test.tsx` (jsdom, real store and IndexedDB), 6 new tests:
  - 5 → 6 after a real save with the real old value, focus unchanged, Escape closes it, and no replay for a second action or undo/redo;
  - 0 → 1, then no replay after a remount ("reload");
  - recovery renders 6 shards and cracks and rolls 2 → 3;
  - broken streak renders no ice and rolls 0 → 1;
  - nothing on a failed write (DataCloneError), a backdated edit or an account switch;
  - reduced motion: fade only, no roll.
  - The welcome tests still pass.
- **Browser (Chromium via Playwright, dev server, Playwright's own profile):**
  - **Frame captures:** `celebrate` at 60–2000 ms shows gray → the colour wipe rising → embers → 5/6 roll with blur → rest. `recover` at 100–2000 ms shows blue with the snowflake → cracks → shards → red flame → 3/4 roll.
  - **Real app flow at 390 and 1440 px:** checking off a habit showed the overlay with 0 → 1 (flame 218 px and 280 px); focus stayed on the check button; Escape closed it at once; it disappeared on its own after about 2 s; a second check-off the same day didn't replay; no horizontal overflow.
  - **Reduced motion** (emulated): `anim-fade`.
- **Not verified:**
  - Safari or iPhone: the SMIL wipe and `beginElementAt`, CSS animations and filters on SVG elements (Safari ignores CSS `filter` on SVG children, so the roll blur may be missing there), touch timing;
  - a real account: a celebration on one device while the other only updates quietly through sync;
  - VoiceOver.

## Iteration 6 (2026-11-10): activity streak, flame, login welcome
Plan and open decisions: ROADMAP.md. The reference GIF named in the request was not available (not in the repository or the conversation). The artwork is original SVG built from the written description.

### Streak rules (`src/lib/streak.ts`; per-habit streaks in `model.ts` unchanged)
- **Action:** a done/not-done habit checked off, numeric value > 0, an "X-mal pro Woche" completion, or a saved analysis.
  - The habit must be active that day (started, not archived or paused).
  - Journal notes, drafts and signing in never count. Several actions on one day count once.
- **Day states** (local calendar days, historical rules via `isScheduled` / `isWeeklyGoalAt`):
  - `done`: an action on a day with a habit due by its daily schedule, or with a weekly goal in force;
  - `missed`: a daily-scheduled habit was due, the day has ended, and nothing was recorded;
  - `frozen`: see Freeze;
  - `pending`: today or later, still earnable;
  - `none`: neutral.
  - Weekly-goal-only days can earn but never break (see ROADMAP "Open questions"). An unfinished today never breaks the streak.
- **Freeze:**
  - one per calendar week (configured week start), applied to the first otherwise missed day of that week, only after it has ended and only while a streak exists;
  - a frozen day keeps the streak but adds nothing and never counts as done (statistics are untouched);
  - a further missed day breaks the streak.
- **Deterministic:** derived entirely from the stored history. Nothing new is stored and there is no schema change, so two devices can't spend a freeze twice. Undo, deletion and backdating recompute the result.

### UI (`src/components/Streak.tsx`)
- **Flame:** original SVG.
  - States: lit (silver gradient, soft glow), frozen (frosted, hatched, snowflake badge, so it reads without colour) and cold (outline, no streak).
  - The canvas is padded by 24 units, so the blurred glow (3σ = 21) is never clipped.
  - Motion is one-shot CSS: ignite with a transient blur and 5 sparks, once; a flare on a newly earned day. `animation-fill-mode: backwards`, so no filter or transform remains at rest. Reduced motion: a 150 ms fade or static.
- **Dashboard badge** below the ring:
  - flame, number, "Tag/Tage in Folge aktiv", and the current week's 7-day strip with distinct icons (flame, snowflake, ×, dashed circle, dot);
  - it opens a sheet with the explanation (DE/EN rules), the freeze status, the longest streak, a 5-week history with per-day accessible labels and a legend;
  - the ring's own calculations are unchanged.
- **Celebration:** only when the streak grows after a durably committed local write. The store exposes `localWrites`, incremented after the IndexedDB commit. A reload, sync pull or first render never celebrates.
- **Welcome:**
  - **When it is triggered:** `AuthProvider.signIn` sets `welcomeFor` after a successful password sign-in. The first session from an email sign-in link opened in this page load also sets it (`welcomeOnAuthEvent` with `signInLinkAtLoad`, read before supabase-js consumes the URL). Restored sessions, `TOKEN_REFRESHED`, `USER_UPDATED` and re-emitted `SIGNED_IN` events never do.
  - **When it opens** (`welcomeStep`): once the account data has loaded and the first sync has settled (synced, offline or error), or after 5 s, so it never blocks.
  - **What it shows:** the real streak (no count-up, and "Das Anmelden selbst zählt nicht als Aktivität"). It says whether the number is verified (synced with nothing pending) or this device's data.
  - **Interaction:** Continue (focused), Escape and the close button dismiss it; focus returns.
  - **Settings:** "Serien-Animation nach dem Anmelden überspringen" (per device, `localStorage` `still-skip-streak-welcome`).

### Verification
- `npm run typecheck` clean, `npm test` **117/117** (20 new), `npm run build` OK.
- `src/lib/streak.test.ts` (13):
  - zero-day state (no freeze without a streak); first day; several actions on one day count once;
  - numeric > 0 counts, zero values and note-only entries don't;
  - pending today; unscheduled weekend neutral; weekly goals earn but don't break;
  - freeze; protected state; second missed day breaks;
  - week boundaries with Monday vs Sunday start; undo and backdating; archived periods; future days.
- `src/components/streak.test.tsx` (7, jsdom, real store and IndexedDB):
  - explicit-login decision (restored session, token refresh, user update and focus `SIGNED_IN` don't trigger it);
  - waiting and never blocking; the verified label;
  - the welcome shows the real number (2), not blocked by a never-settling sync, Continue focused, Escape dismisses, shown once;
  - no welcome without an explicit sign-in or when skipped;
  - account switching (A 2 days, B 0, A 2 again);
  - celebration only after a saved action, not on reload; undo recomputes.
- **Found while testing:** Vitest loads `.env.local`. A first version of the component test used `sync: true` partitions with a fake user id, so the SyncManager sent real requests to the configured Supabase project. They were rejected: no session; "invalid input syntax for type uuid". Nothing was written. The tests now use local partitions only; no other test talks to the real backend (sync tests use PGlite).
- **Browser (Chromium via Playwright, dev server, Playwright's own profile; welcome via a temporary preview page with a local partition and a fake auth context, deleted again):**
  - **Dashboard badge** at 320, 390 and 1440 px: no horizontal overflow.
  - **Sheet:** opens; Escape closes it and focus returns to the badge; 35 history cells, each with a label.
  - **Flames:** lit, frozen and cold at 140 px and 30 px. The glow isn't clipped; after the ignite no filter remains on the flame body and the sparks end invisible.
  - **Welcome:** at 390 and 1440 px with a real 8-day streak protected by a freeze (frozen flame, note) and with 9 days lit; Continue focused.
  - **Reduced motion** (emulated): `flame-fade` only.
- **Not verified:**
  - a real sign-in against Supabase (password or email link) showing the welcome;
  - a real token refresh;
  - two real devices computing the same freeze;
  - Safari or iPhone rendering of the SVG filter and CSS animations on SVG elements;
  - VoiceOver.

## Iteration 5 (2026-11-10): ring glow, "what remains today", quick actions

### Ring glow
- **Cause** (reproduced at 390 and 1440 px at 100 %): the glow (blur σ 5 on an arc whose outer edge is at 61 units) reaches about 76 units from the centre. The `<svg>` viewport was only 66 units, and an inner `<svg>` clips at its viewport (`overflow: hidden`), so the glow was cut off in straight lines at the left, right, top and bottom. The filter region and the ancestors weren't the cause; no other ancestor clips.
- **Fix** (`Dashboard.tsx`, CSS):
  - the viewBox is extended by 14 units on every side, and the SVG is positioned that far beyond the ring box, so the ring keeps its size and position;
  - the filter region uses `userSpaceOnUse` over the whole canvas.
- No horizontal overflow at 320, 390 or 1440 px. Animation and reduced motion are unchanged.

### What remains today
- New `src/lib/today.ts` (`todayItems`):
  - groups `daily` (open daily habits), `weekly` (weekly goals of the selected date's week not yet reached) and `done`;
  - manual order within each group;
  - unscheduled, archived and not-yet-started habits are excluded.
  - Display only: `lib/dashboard.ts` is unchanged.
- `Today.tsx` renders one flat list (rows and headings), so a row that changes group glides to its place:
  - headings for weekly goals and a collapsible "Erledigt · n" section (`aria-expanded`), remembered in `localStorage` (`still-done-open`);
  - **hold while interacting:** rows keep their group while the pointer or keys are active (until 1.2 s of quiet) or while a value field has focus;
  - empty states:
    - nothing daily planned, but weekly goals are open;
    - everything done;
    - nothing planned at all (the existing state).

### Quick actions and reliability
- Store (`store.tsx`):
  - all writes go through **one queue**. Ops can be built from the state left by all earlier writes, so rapid taps never compute from a stale render. The memory snapshot is updated right after each IndexedDB commit;
  - same atomic record-plus-outbox write, failure handling and save status as before.
- New store actions:
  - `toggleEntry` (binary; decided at write time, with undo);
  - `stepEntry` (numeric; adds a delta to the stored value. Undo after reaching the target takes back only that step);
  - `toggleCompletion` now also decides at write time.
- `HabitRow`:
  - a tap is ignored while the same row's previous write is still running;
  - a second "add" on a several-per-day habit within 350 ms counts as an accidental double tap;
  - numeric rows get − and + (`quickStep`: 1 below a target of 100, otherwise a tenth of the order of magnitude) and a direct-entry field (`AmountInput`; saved on Enter or blur, Escape or invalid input restores the stored value; 16 px font, so iOS doesn't zoom);
  - on phones (< 480 px) a numeric row hides its icon, so the name keeps room;
  - weekly rows say "noch 2× diese Woche" / "2 more this week".

### Verification
- `npm run typecheck` clean, `npm test` **97/97** (12 new), `npm run build` OK.
- New tests:
  - `src/lib/today.test.ts`: grouping and order, exclusions, selected date and week, dashboard unchanged, step sizes, parsing;
  - `src/screens/today.test.tsx` (jsdom, real store and IndexedDB):
    - grouping with hold and the collapsible section;
    - binary undo leaves unrelated data alone;
    - 19 rapid + taps count fully (1900);
    - undo of the target-crossing step only;
    - direct entry, including invalid input;
    - one per day: no duplicate on a double tap; several per day with the double-tap guard; undo removes only the latest;
    - analysis goals have no completion shortcut;
    - quick actions write to the selected date.
  - **Mutation check:** with the old render-based step (`value + step`) the rapid-tap test fails (1000 instead of 1900).
- **Browser (Chromium via Playwright, dev server, Playwright's own profile):**
  - **Ring:** checked at 0 %, 80 % and 100 % at 390 and 1440 px; the glow is round and even with no flat edges; ring size unchanged.
  - **Rapid input:** 20 rapid + taps gave exactly 2000; the row stayed in place during the taps and then moved to "Erledigt".
  - **Direct entry:** "1.234,5" was rejected and restored; "1250,5" was saved; Escape restored; the value survived a reload.
  - **Layout:** no horizontal overflow at 320, 390 and 1440 px.
  - **English:** "Weekly goals", "Done · 5", "2 more analyses this week" and the accessible labels.
- **Not verified:**
  - real iPhone or Safari touch behaviour (tap timing, the decimal keyboard);
  - quick actions against the real backend with sync between two devices;
  - VoiceOver.

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
