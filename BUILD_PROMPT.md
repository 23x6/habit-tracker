# Still — Complete Build Prompt

Build a fully functional, premium habit-tracking app with an extremely minimalist, muted gray aesthetic and fluid, iOS-inspired interactions.

Implement the app, not just a design concept or static prototype. Every visible control must work, and user data must persist.

## Product direction

The app should feel calm, understated, tactile, and meticulously crafted: the clarity of Apple Reminders, a restrained editorial layout, and beautifully animated gestures. Use “Still” as the working app name.

## Platform

Inspect the existing project first and follow its architecture. If starting from scratch, build an iPhone-first, installable progressive web app using React, TypeScript, and an appropriate lightweight stack.

Support desktop and tablet layouts while keeping mobile the priority. Respect safe areas, touch interactions, and the on-screen keyboard.

This specification targets a PWA, not a native SwiftUI application. Do not imply browser features provide native iOS capabilities. Clearly document platform limitations.

## Visual design

Use an almost entirely monochromatic palette:
- Background: subdued light gray, approximately #E7E7E5.
- Surfaces: slightly lighter gray, approximately #F1F1EF.
- Primary text: charcoal, approximately #242424.
- Secondary text: muted gray with sufficient contrast.
- Dividers: faint gray.
- Completed states: charcoal fills, white checkmarks, subtle tonal changes.

The atmosphere should feel deliberately desaturated, quiet, and slightly austere.

Use system typography, preferring the Apple system font on Apple devices. Create hierarchy through font weight, spacing, and scale.

Design details:
- Generous whitespace and precise alignment.
- Rounded cards and iOS-style bottom sheets.
- Subtle borders and restrained shadows.
- Thin, consistent monochrome icons.
- Comfortable touch targets of at least 44 × 44 CSS pixels.
- Compact floating bottom navigation.
- Minimal chrome and short, readable labels.
- German interface copy by default.

Avoid bright accents, gradients, decorative illustrations, excessive glass effects, motivational clutter, and crowded dashboards.

## Main screens

### 1. Today
- Date and a simple daily completion indicator.
- Horizontally swipeable week strip.
- Habit rows showing name, icon, target, and current progress.
- One-tap completion for binary habits.
- Increment and decrement controls for measurable habits.
- Discreet create-habit button.
- Calm, useful empty state.
- Subtle animation when the daily plan is finished.

### 2. Habit creation and editing
Use a polished bottom sheet with:
- Name and optional description.
- Monochrome icon selection.
- Binary or numeric tracking.
- Numeric target and unit, such as minutes, pages, or glasses.
- Daily or selected-weekday scheduling.
- Start date.
- Optional reminder time.
- Validation and clear save/cancel behavior.

Support editing, archiving, restoring, and permanently deleting habits. Confirm destructive deletion.

### 3. Habit details
- Current and longest streak.
- Calendar showing completion history.
- Editable past entries.
- Completion rate over selectable periods.
- Simple grayscale progress chart.
- Optional notes attached to daily entries.

### 4. Statistics
- Weekly and monthly completion summaries.
- Completion rates for each habit.
- Restrained grayscale activity calendar.
- Clear empty states when insufficient data exists.

Calculate all statistics from actual stored entries. Do not display fabricated metrics.

### 5. Settings
- Reminder settings and permission status.
- Week-start preference.
- Reduced-motion preference.
- JSON export and validated JSON import.
- Clear all data with explicit confirmation.

## Motion and gestures — a core requirement

Every interaction should feel smooth and intentional. Motion quality is central to the product.

Use:
- Spring-based bottom sheets.
- Interactive, finger-following swipes.
- Smooth snapping and momentum.
- Subtle press scaling.
- Animated completion indicators.
- Fluid list reordering.
- Seamless transitions between dates and screens.
- Gentle staggered entrances where appropriate.

### Swipe motion blur

Create clearly visible, velocity-responsive motion blur during fast swipes. This is the signature interaction.

The blur should:
- Increase with gesture velocity.
- Follow the horizontal direction of travel where practical.
- Affect the moving content layer rather than the whole interface.
- Be subtle during slow dragging and pronounced during fast flicks.
- Resolve immediately into sharp content as motion settles.
- Never leave resting text blurry.

Use transforms and opacity for most animation work. Keep blur localized and capped to protect performance. Avoid expensive full-screen filters.

Tune transitions around 180–350 ms and sheet animations around 300–450 ms, adjusting spring behavior where more natural.

Provide:
- Swipe left on a habit to reveal actions.
- Swipe right to complete, with a reversible action.
- Horizontal swiping to change the selected day.
- Drag-to-reorder using a dedicated handle.
- Swipe down to dismiss sheets.

Prevent conflicts between row gestures, day navigation, and vertical scrolling. Every gesture must also have an accessible button equivalent.

Respect prefers-reduced-motion and the app setting. Disable motion blur and large spatial transitions in reduced-motion mode.

## Functional correctness

Use durable local storage, preferably IndexedDB, with a versioned data model.

Work offline after the initial load and retain data across reloads and restarts.

Tracking rules:
- One entry per habit per local calendar date.
- No duplicate completions.
- Numeric habits are complete when their target is reached.
- Unscheduled days do not break streaks.
- Days before the start date are excluded.
- An unfinished current day does not break a streak before the day ends.
- Future dates cannot be marked complete.
- Archived habits retain history.
- Schedule and target changes must not retroactively distort historical statistics.

Use local calendar dates consistently and handle daylight-saving changes correctly.

Show undo feedback for reversible actions. Validate imports before modifying storage and make import behavior clear.

Reminders must reflect actual platform support. Do not simulate notifications or rely on background browser timers that cannot reliably deliver them. If reliable reminders require additional infrastructure, implement that capability or explicitly show the limitation.

Do not require an account for this initial version. Keep personal data local and explain in settings that export provides a backup.

## Implementation quality

Create reusable components and consistent design tokens for colors, typography, spacing, radii, and motion.

Handle loading, empty, error, offline, and permission-denied states.

Ensure keyboard accessibility, screen-reader labels, visible focus, and readable contrast.

Use appropriate libraries sparingly. Favor a small, maintainable implementation.

Include meaningful tests for persistence, scheduling, streak calculations, date boundaries, numeric completion, historical edits, and import validation.

Verify core flows in the browser at mobile and desktop sizes. Test touch gestures where supported, and distinguish tested behavior from unverified behavior.

## Delivery

Proceed with reasonable defaults without stopping for routine design decisions.

Build the complete core experience first, then refine visual design and motion. Do not stop after scaffolding or producing a single attractive screen.

The app is complete when a user can:
1. Create and edit a habit.
2. Record and undo daily progress.
3. Navigate dates and update past entries.
4. See accurate history and statistics.
5. Archive and restore habits.
6. Reload without losing data.
7. Export and import data.
8. Use the core experience offline.
9. Navigate comfortably with touch, mouse, or keyboard.

Finish with a concise explanation of what was built, how to run it, what was verified, and remaining platform limitations.

The final result should feel like a real, carefully designed iOS-inspired product: muted gray, extremely minimal, responsive, and exceptionally fluid.
