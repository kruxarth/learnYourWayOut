# Learn Your Way Out

Browser 3D maze-learning game (Vite + React Three Fiber + zustand, TypeScript). The hackathon brief is `PS.md`.

## Before you change anything
1. Read `plan/NEXT_FEATURES.md`. It holds the rules every change must follow, the build order, and the merge hotspots.
2. Read the doc for your feature: `plan/F1_AVATARS.md`, `F2_CUSTOM_TOPICS.md`, `F3_MULTIPLAYER.md` or `F4_NEW_MODES.md`.
3. Read `docs/ARCHITECTURE.md`.

## Working rules
- Build **one milestone per session**, the one you were asked for. Don't start the next one.
- `npm run check` (types + tests + build) must pass before you finish. Tests never use the network or an API key.
- The engine (`src/game/`) is plain TS: no React, no `Math.random()` outside `newSeed()`, and every number goes in `tuning.ts`.
- Edits to the files listed under "Merge hotspots" stay small and additive.
- When you finish:
  - Log deviations in `docs/DECISIONS.md`, one line each.
  - Update `README.md` if the controls or how to run the game changed.
  - Commit on your branch with a clear message.
  - Report what you built, what you skipped, and anything the next milestone needs to know.
