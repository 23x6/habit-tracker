# Roadmap (RYVO)

Live: https://still-ashy-seven.vercel.app/ (Vercel project `still`, deployed from `feature/still-app`). Details and verification: HANDOFF.md.

## Done
1. **Core PWA:** habits, journal, weekly analyses, offline storage.
2. **Accounts and sync:** Supabase with RLS. "X-mal pro Woche" goals. Dashboard ring.
3. **Interface:** DE/EN, autosave and drafts, large dashboard, schedule-selector fix.
4. **Deployment:** Vercel production deployment.
5. **Today list:** ring glow fix, "what remains today" grouping, quick actions.
6. **Activity streak:**
   - app-wide consistency streak with a weekly freeze;
   - dashboard flame and 7-day strip, with an explanation and 5-week history;
   - one-time welcome after an explicit sign-in.

   Rules: HANDOFF.md, "Iteration 6".
7. **Streak celebration (this iteration):**
   - a large overlay when a saved action earns today: ignition, and the counter rolls from the real old value;
   - an ice-break recovery after a freeze;
   - a red/orange active flame and a blue frozen flame;
   - per-account deduplication.

   Details: HANDOFF.md, "Iteration 7".
8. **Flame polish (this iteration):**
   - redrawn flame (coral/orange/peach, crisp outlined number) and a frosted blue state;
   - idle breathing loop on the dashboard;
   - smoother celebration and recovery;
   - animation previews in Settings;
   - visible name RYVO.

   Details: HANDOFF.md, "Iteration 8".
9. **Progress overview and weekly review (this iteration):**
   - Statistics with a 7/30-day switch, counts beside percentages, finished weeks vs. the running week;
   - a weekly review with notes and three optional prompts, synced per account and week range;
   - Supabase migration `20261111000000_reviews.sql`.

   Details: HANDOFF.md, "Iteration 9".

## Next (named by the user, not started)
- Reminders beyond the open app.
- Pauses (planned breaks as a feature, beyond archiving).
- Journal search.

## Open questions / decisions to confirm
- **Streak and weekly goals.** Days with only a weekly goal in force can *earn* a streak day but never *break* it. Otherwise everyone with a "3× pro Woche" goal would need activity every day. A day where only an unscheduled habit was recorded (e.g. a weekday habit done on Saturday) is neutral, per the "neutral days neither increase nor break" rule.
- **References.** `design/` holds the flame image (JPG) and the motion reference (GIF). They were used as described in HANDOFF.md, "Iteration 7", and are kept out of Git and the deployment because they look like third-party material. The ice-break isn't in the GIF; it is our own reverse of its freeze. Real-device check is pending: use Settings → „Animationsvorschau“ on the iPhone.
- **Name.** Done for everything visible (iteration 8). Stored-data identifiers, the export format id and the Vercel URL intentionally still say "still".
- **Review prompts.** Saving is explicit ("Sichern"), with a local draft while typing, like journal entries. Saving on every pause would create many synced versions and more conflicts. Can be revisited.
- **Dashboard review link.** Shown on the last two days of the week only. It doesn't nag after the week has ended; the review stays reachable from Statistics.
- **"Skip the animation" setting.** It is stored per device (`localStorage`), not per account.
