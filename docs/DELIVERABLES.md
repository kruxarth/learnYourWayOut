# Deliverables

| Brief requirement | How we meet it | Where in code | How to verify |
|---|---|---|---|
| Functional maze and navigation | Seeded hedge mazes (4/6/8 rows) with dead ends, exits in a random column, and fog that hides the maze beyond 10/7 m on Normal/Hard. Bean controller, camera, minimap. | `loop/generation.ts`, `loop/maze.ts`, `loop/navigation.ts`, `render/visibility.ts` | Start any Normal run and walk a maze. |
| Multiple stages / challenge points | 16 room kinds (a random pool, plus a Gauntlet that plays them all), 6–12 rooms per run: crossroads quiz mazes, a Junction Hall and a final Slime Gate (or, optionally and in online races of 3 or more, the Hex Finale). | `rooms/*` | Play one Normal run. |
| Working question system | 247 built-in questions, 5 types, validator, adaptive selection, cross-run variety (questions seen before are picked later). | `content/*` | `npm test` |
| Domain / difficulty selection | Hub portals and pads. Quick Select. URL parameters. | `loop/selection.ts` | Stand on a pad. |
| Player decisions affect progression | Door, tile, step and block choices. The answer picks the corridor at crossroads and the lane at the Junction Hall. Lifelines, power-ups (every 3 in a row), coin hunting. | `loop/progression.ts`, `loop/powerups.ts`, `rooms/junctionHall.ts` | Answer the Junction Hall right, then wrong. |
| Penalties, dead ends, alternate paths, harder questions | Wrong corridors are real dead ends. Shifting Maze shrines slide hedges to open a shortcut or close your path. Boulder Run alcoves. Detour zone, slime surge, the scenic route, adaptive tier. Hard: answer timers, no glowing hints, Step Stones/Bridge resets. | `rooms/quizMaze.ts`, `rooms/detour.ts`, `loop/evaluation.ts` | Answer wrong on purpose. |
| Balanced difficulty | A balance harness plays whole runs as a perfect bot, a 60%-accuracy player and a guesser. | `tests/bot.ts`, `tests/balance.test.ts` | `npm test` |
| Clear success / failure | QUALIFIED! at the portal. ELIMINATED at 100% slime. | `loop/outcome.ts` | Debug keys L and K. |
| Source code | This repository. | — | — |
| Technical documentation | README and `docs/`. | — | — |
| Demo / presentation | `docs/DEMO_SCRIPT.md` | — | — |
