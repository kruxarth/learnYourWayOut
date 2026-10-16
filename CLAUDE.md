# Learn Your Way Out

Browser 3D maze-learning game (Vite + React Three Fiber + zustand, TypeScript). The hackathon brief is `PS.md`.

## Before you change anything
Read `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md` for past deviations. The old `plan/` docs are gone; there is no feature roadmap to follow.

## Working rules
- Do what you were asked for, no more.
- `npm run check` (types + tests + build) must pass before you finish. Tests never use the network or an API key.
- The engine (`src/game/`) is plain TS: no React, no `Math.random()` outside `newSeed()`, and every number goes in `tuning.ts`.
- When you finish:
  - Log deviations in `docs/DECISIONS.md`, one line each.
  - Update `README.md` if the controls or how to run the game changed.
  - Commit on your branch with a clear message.
  - Report what you built, what you skipped, and anything the next milestone needs to know.
