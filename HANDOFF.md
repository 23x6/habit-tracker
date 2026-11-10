# Still — Handoff

## Status (2026-11-10)
Iteration 3 is implemented: accounts and sync (Supabase), "X-mal pro Woche" goals, the dashboard ring, refined motion, and the desktop layout. **The Supabase backend has not been connected yet:** no project or credentials were available and the Docker daemon wasn't running. All code, migrations and locally testable parts are done; real authentication and multi-device sync remain unverified (see "External setup"). Nothing is committed yet.

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
- `npm test`: **62/62 pass**, also with TZ America/New_York, Australia/Sydney and Pacific/Kiritimati.
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
- **Bugs found and fixed during verification:**
  - Postgres jsonb key order caused false conflicts → canonical comparison.
  - The `today` screen class collided with the weekday button class (broken week strip on desktop).
  - The week strip overflowed at 320 px.
  - The account mode line wrapped badly.

## External setup required (to finish accounts and sync)
See README "Enabling accounts and sync":
1. create a Supabase project;
2. run the migration;
3. keep email confirmation on;
4. set Site URL and Redirect URLs;
5. preferably configure SMTP;
6. fill `.env.local` from `.env.example` (URL and anon key only);
7. build and deploy.

Then verify:
- register → confirmation email → sign in;
- password reset;
- two browser sessions with the same account (edit on one, see it on the other; offline edit then reconnect; a journal conflict);
- a second account can't see the first account's data;
- sign-out and account switch show no other account's data.

Alternatively, run `npx supabase start` with Docker for a local stack.

## Not verified
- **Anything against a real Supabase instance:** Auth emails, links, session refresh, PostgREST behaviour, and sync between two real sessions.
- Real iPhone/Android devices (keyboard behaviour, install, touch feel) and Safari.
- Screen readers beyond roles and labels.

## Remaining / ideas
- Sync uses polling; Supabase Realtime could push changes immediately.
- The server-wins policy for structured records could become per-field merging.
- Weekly goals have no reminders.
- The account's own settings (week start, motion) are synced as one record; device-specific motion preferences could be split out.
