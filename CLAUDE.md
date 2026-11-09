# Claude Code — Still Habit Tracker

## Source of truth
Read BUILD_PROMPT.md before implementation. It contains the complete product specification and acceptance criteria.

## Current state
This repository was initialized with planning documents only. No application has been implemented or tested yet. Inspect the actual repository before relying on this initial status.

## Objective
Implement Still as a fully functional, iPhone-first, installable PWA with React and TypeScript. It is not currently specified as a native SwiftUI app.

## Working approach
- Inspect relevant files and preserve existing user changes.
- If no application exists, choose a lightweight stack such as Vite + React + TypeScript.
- Make reasonable implementation choices and proceed through completion.
- Implement real storage, calculations, and interactions; do not substitute mock functionality.
- Keep architecture small and local-first. No account or paid service is required for the initial version.
- Never commit credentials, environment secrets, personal exports, node_modules, or build output.
- Keep German UI copy consistent and English code/documentation readable.

## Design priorities
- Restrained, muted gray iOS-inspired interface.
- Finger-following gestures, spring animations, and pronounced velocity-responsive swipe blur.
- Sharp content at rest; reduced-motion support; accessible alternatives to all gestures.
- Maintain readable contrast and smooth performance.

## Correctness priorities
- Versioned IndexedDB persistence and offline support.
- Local calendar dates and correct scheduled-day streak calculations.
- Historical schedule/target semantics that preserve past statistics.
- Validated import before storage mutation, explicit destructive-action confirmation, and undo where appropriate.
- Honest notification support; never claim unreliable background timers provide dependable reminders.

## Verification and handoff
Run the project's type checking, production build, and meaningful domain tests. Verify key browser flows where possible and report untested platform behavior honestly.

Update README.md with setup commands, actual features, offline installation instructions, and limitations. Update HANDOFF.md with implemented work, validation results, and remaining tasks. Do not claim completion before checking acceptance criteria in BUILD_PROMPT.md.
