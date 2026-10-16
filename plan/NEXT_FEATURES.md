# Next features: overview for the dev team

Written 2026-10-15 for the agents who will build these features. Paths are relative to `learn-your-way-out/`.

**Read these before you start:**
1. `docs/ARCHITECTURE.md`
2. `docs/DECISIONS.md`, for what is already built and why
3. This file. Its "Rules" section applies to every change.
4. The doc for your feature.

| ID | Feature | Doc | Size | Depends on |
|---|---|---|---|---|
| F1 | Custom avatars and wardrobe | `plan/F1_AVATARS.md` | M | — |
| F2 | Any Topic: LLM-generated question packs | `plan/F2_CUSTOM_TOPICS.md` | L | Creates `server/` |
| F3 | Online multiplayer (ghost race, one laptop per player) | `plan/F3_MULTIPLAYER.md` | XL | F1 (avatars tell players apart), `server/` from F2 |
| F4 | Obstacle rooms, random room pool, Gauntlet, Daily | `plan/F4_NEW_MODES.md` | one per item | F4-0 first; F4-X needs F3 |

## Work order (one milestone per session; run `npm run check` after each)

F1 and F2 touch different files, so two agents can build them **in parallel**. F3 starts once the F2 server skeleton (F2-M1) is merged.

1. **F1-M1** (avatar data and component) ‖ **F2-M1** (server skeleton and pack pipeline, tested against a fake LLM)
2. **F1-M2** (wardrobe, names, save) ‖ **F2-M2** (client Topic panel, custom run, recent topics)
3. **F1-M3** (unlocks) ‖ **F2-M3** (safety gate, fact-check pass, report button)
4. **F4-0** (room pool and slots; Gauntlet). It only touches `generation.ts`, `pool.ts` and the tests, so it can run in parallel with F1-M3/F2-M3.
5. **F4-1 Launch Pads → F4-2 Rule Minefield → F4-3 Key Hunt**: the three demo rooms. Each joins the pool as soon as its bot test passes.
6. **F3-M1 → M4** (multiplayer), in parallel with **F4-4 … F4-9** (the other obstacles, one per session) and **F4-D** (Daily plus ghost)
7. **F4-X** Hex Finale (the multiplayer final round), **F4-G** Gold Door

If time runs short, cut from the bottom. F1 + F2 + F4-0 with the three demo rooms already make a strong demo. Show F3 only if the two-laptop test (`F3_MULTIPLAYER.md` §9) passes at least a day before judging.

## Rules any change must follow

### Base rules (these already held for the code that exists)

1. **Layering** (`docs/ARCHITECTURE.md`):
   - The engine is plain TS with no React.
   - The renderer only reads engine state in `useFrame`.
   - The UI calls engine methods.
   - Do not allocate geometry, materials or textures inside `useFrame`.
2. **Every number goes in `src/game/tuning.ts`.** Use per-difficulty records, like the existing `SLIME_RATE: { easy, normal, hard }`.
3. **Determinism.**
   - Layout randomness comes from `stream(seed, 'layout')` (`g.rng` in segments). Question and runtime randomness comes from `run.qRng`.
   - Never call `Math.random()` in the engine.
   - Same seed → same course is tested.
4. **Tests stay green:** `npm run check` (types + tests + build).
   - When you add a room or segment kind, teach the bot to solve it (`Player.solve` in `src/tests/bot.ts`) so the full-run and balance tests still reach QUALIFIED.
   - Keep the `course.test.ts` checks passing: a path exists, openings align at segment boundaries, and there are no duplicate walls.
5. **Easy stays friendly.**
   - `?demo=1` (math, normal, seed 4242) must stay winnable and stable.
   - If recipes change, update `docs/DEMO_SCRIPT.md` and `docs/DELIVERABLES.md`.
6. **Labels are ≤ 22 characters** (`docs/CONTENT_GUIDE.md`). Any new spot that shows answers must fit that.
7. **Log spec deviations as one line each** in `docs/DECISIONS.md`. When you add a room kind, update the "Adding a room kind" steps in `docs/ARCHITECTURE.md`.
8. **Balance:** after changing slime, rooms or recipes, run the harness and compare with the targets in `docs/DECISIONS.md`:
   ```
   BALANCE_N=40 BALANCE_DIFF=hard npx vitest run src/tests/balance.test.ts --silent=false
   ```

### Rules for the new features

1. **The game works without the server.**
   - A static `dist/` with no server must still play every built-in domain.
   - Custom topics and multiplayer show a friendly "needs the game server" message.
   - `npm run check` must never need the network, an API key or a running server.
2. **No API key in the browser, ever.**
   - LLM calls happen only in `server/`.
   - Keys come from `server/.env`. Add `.env` to `.gitignore` in your first commit, and commit a `server/.env.example`.
3. **Shared code direction.** `server/` may import pure modules from `src/`:
   - `src/content/schema.ts`
   - `src/content/validate.ts`
   - `src/net/protocol.ts`

   `src/` never imports from `server/`. Shared modules must not import React, three, zustand or browser globals.
4. **Tests do not use the real network.**
   - Inject the LLM client (`LlmClient` interface) and the socket transport (`Transport` interface).
   - Tests use fakes.
5. **Safe for a public demo.** The audience is students in general, not only young kids, but the game will be on a projector in front of judges.
   - There is no text chat.
   - Players type their own names. Every name goes through `cleanName()` (`plan/F1_AVATARS.md` §6) on the client **and** on the server.
   - Topics typed by a player pass a safety gate before any questions are generated.
6. **Engine stays deterministic and single-player inside.**
   - Remote players are rendered from network data. They never enter `G.run` or the physics step.
   - `Math.random()` is still allowed only in `newSeed()`.
7. **Save data.**
   - Keep the localStorage key `lywo:v1`.
   - New `SaveData` fields are optional. `loadSave()` fills defaults and drops invalid values, so an old save never crashes the game.
8. **Docs.** When you finish a milestone, update:
   - `docs/DECISIONS.md`: one line per deviation.
   - `README.md`: controls, URL params, how to run the server.
   - `docs/DELIVERABLES.md` and `docs/DEMO_SCRIPT.md`, if the demo changes.

## Merge hotspots (several features touch these; keep each edit small and additive)

| File | Who touches it | How to stay out of each other's way |
|---|---|---|
| `src/game/types.ts` | F2 (`DomainId`), F3 (`RunSelection.mode`) | Add union members or optional fields only. |
| `src/game/persistence.ts` | F1 (avatar, name, stars), F2 (recent topics), F4 (daily) | One optional field each, each with its own `load…`/`save…` helper. |
| `src/ui/store.ts` | all | Add new slices. Don't reshape existing ones. |
| `src/game/loop/selection.ts`, `src/render/HubScene.tsx`, `src/ui/HubOverlay.tsx` | F1 (wardrobe), F2 (topic portal), F3 (play online) | The hub layout is agreed in the "Hub layout" section below. |
| `src/App.tsx` | all | Mount new top-level panels next to the existing ones. |
| `package.json` | F2 (`tsx`, `ws`), F3 | Add new scripts. Don't change `check`'s meaning. |
| `src/game/loop/generation.ts`, `segments.ts`, `challenge.ts`, `tests/bot.ts` | every F4 room | One room per branch. Add each room's `case` in its own block. Register it in `pool.ts` last, once its bot test passes. |
| `src/content/schema.ts`, `validate.ts` | F2 (`facts`, `topic`), F4-2 (`classify`) | Additive only. `classify` stays optional in the quota checks. |
| `src/game/loop/powerups.ts`, `src/game/input.ts` | F4-4 (Shield, key 5), F3 (emotes, keys 6–9) | Keys are reserved as listed here. |

### Hub layout (agreed, so F1, F2 and F3 don't collide)
- Domain portals sit on the north arc at radius 16. Respace them to 5 portals at φ = −60°, −30°, 0°, 30°, 60°, with **Any Topic** at **0°** (centre, most visible).
  - Order: math −60, science −30, custom 0, history 30, programming 60.
  - The Any Topic portal has no difficulty pads. Walking into its pad (radius 7.5, the "easy" spot) opens the Topic panel.
  - Update `hub.test.ts`.
- **Wardrobe** booth: a pad at (−6, 9), south-west of the spawn. Standing on it opens the wardrobe panel.
- **Play Online** booth: a pad at (6, 9), south-east of the spawn. It opens the multiplayer lobby.
- Each of these is also a button in `HubOverlay`, so touch and keyboard users can reach them without walking.

## Configuration

`server/.env` (gitignored):
```
PORT=8787
LLM_BASE_URL=https://api.deepseek.com        # any OpenAI-compatible /chat/completions base
LLM_API_KEY=...
LLM_MODEL=deepseek-v4-flash                  # check the provider's current model list first
LLM_REVIEW_MODEL=                            # optional; defaults to LLM_MODEL
ALLOWED_ORIGINS=http://localhost:5173
```
- **Client:** `VITE_SERVER_URL`. Empty means same origin. In dev, Vite proxies `/api` and `/ws` to `localhost:8787`; add a `server.proxy` block to `vite.config.ts`.
- **Run:** `npm run server` (the server alone) and `npm run dev:all` (Vite + server).

## Questions for the project owner (defaults the docs assume)

1. **Deadline and demo scope.** Default: F1, F2, and F4-0 with Launch Pads, Rule Minefield and Key Hunt are must-haves. F3 is in the demo only if it is stable.
2. **Server hosting.** Default: for the demo, run the server on one laptop on the venue LAN or a phone hotspot. Also deploy a public copy to Render or Fly.io, which support long-lived WebSockets. Vercel and Netlify don't, so `dist/` can stay there.
3. **LLM provider.** Default: DeepSeek, called directly. OpenCode Zen and OpenRouter also expose OpenAI-compatible endpoints, so switching is a `.env` change only.
4. **Player names.** Decided 2026-10-15: players type their own name. A 🎲 button suggests a random name.
