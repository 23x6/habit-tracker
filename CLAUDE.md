# Claude Code — Still Habit Tracker

## Source of truth
BUILD_PROMPT.md holds the original product specification. Later iterations are recorded in HANDOFF.md, which describes the current implementation, its verification status and open work. Read both, then inspect the actual code before relying on them.

## Current state
A working PWA (Vite + React 18 + TypeScript + framer-motion) with:
- a dark monochrome design;
- daily, weekday, numeric and "X-mal pro Woche" habits, plus analysis-based weekly goals;
- a journal and a dashboard ring;
- offline-first IndexedDB storage;
- optional Supabase accounts with sync.

There is no native app.

## Working approach
- Inspect relevant files and preserve existing user changes and user data. Schema changes only add (see `src/lib/db.ts` upgrade steps and `supabase/migrations`).
- Implement real storage, calculations and interactions; never mock success, and never simulate authentication or sync.
- Local-only use must keep working without any backend. Accounts are optional and use Supabase Auth + Postgres with Row Level Security.
- **Never commit credentials.** That means `.env*` files (except `.env.example` with placeholders), personal exports, `node_modules` and build output.
- Only the public Supabase URL and the anon/publishable key may be used in the client, never the service-role key.
- Every server-side access rule belongs in RLS policies (migrations), not only in frontend filtering.
- Don't activate paid services without approval.
- Keep German UI copy consistent and English code/documentation readable.

## Design priorities
- Dark, restrained gray iOS-inspired interface (tokens in `src/styles.css`).
- Finger-following gestures, consistent springs (`springs` in `src/components/ui.tsx`), velocity-responsive swipe blur on moving layers only.
- Sharp content at rest; reduced-motion support; accessible alternatives to all gestures.
- Maintain readable contrast and smooth performance; no continuous background motion.

## Correctness priorities
- Versioned IndexedDB per partition: `still` is local-only; `still-account-<userId>` is a per-account cache with an outbox.
- Local calendar dates. Daily streaks only count scheduled days. Weekly goals use the configured week start and are only "missed" after the week ends.
- Schedule and target changes never rewrite history. Daily changes apply from today; weekly goal changes apply from next week.
- Sync uses stable ids, idempotent writes (operation ids) and version-based conflict detection. Conflicting journal or analysis text is preserved for the user to resolve.
- Imports are validated before any storage mutation. Destructive actions need explicit confirmation; offer undo where appropriate.
- Honest notification support: reminders only appear while the app is open.

## Verification and handoff
Run `npm run typecheck`, `npm test` (includes the RLS/sync tests against the real migration in PGlite) and `npm run build`. Verify key browser flows where possible.

Report untested platform behaviour honestly, especially anything that needs a real Supabase project or real devices. Update README.md and HANDOFF.md with setup, actual features, verification results and limitations.
