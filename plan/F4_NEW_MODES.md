# F4: Obstacle rooms, the room pool, and new modes

Read `plan/NEXT_FEATURES.md` first. For new room kinds, follow "Adding a room kind" in `docs/ARCHITECTURE.md`.

Every new room must be:
- solvable by the bot (`tests/bot.ts`)
- tuned so the balance targets in `docs/DECISIONS.md` still hold

Rewritten 2026-10-15. The owner wants all of the obstacle ideas, not a chosen few. The design below makes that possible without making runs long:
- **A run fills a few slots at random from a pool of rooms.**
- **A Gauntlet mode includes every room once.**

## The rule every obstacle follows

**How you move is how you answer.** Each obstacle asks a question, and the player answers by where they go, what they stand on, when they run through, or what they carry. Pure physical hazards (§F4-H) are the one exception. They make plain mazes dangerous, and correct answers earn the power-ups that beat them ("Knowledge Power-Ups" in the PS).

## Order of work (one item per session; each new room joins the pool as soon as the bot can solve it)

| # | Item | Kind | Size |
|---|---|---|---|
| F4-0 | **Room pool and slots, per-course par time, Gauntlet mode** (infrastructure; do this first) | system | M |
| F4-1 | Launch Pads | room | M |
| F4-2 | Rule Minefield (+ new `classify` question type) | room + content | M |
| F4-3 | Key Hunt | maze variant | S |
| F4-4 | Hazards (sweeper, hammer, ice) + Shield power-up | maze decoration | M |
| F4-5 | Door Carousel | room | M |
| F4-6 | Boulder Run | room | M |
| F4-7 | Memory Floor | room | S |
| F4-8 | Answer Lifts | room | M |
| F4-9 | Shifting Maze | maze variant | M |
| F4-D | Daily Challenge plus your ghost | mode | M |
| F4-X | Hex Finale (multiplayer final round) | room | M |
| F4-G | Gold Door | Door Rush add-on | S |

Because rooms join the pool one by one, the game can ship after **any** item. If time runs out after F4-3, the pool simply has 7 room kinds instead of 12.

---

## F4-0. Room pool and slots

### Recipes get slots

In `src/game/loop/generation.ts`, add two step kinds:
- `{ k: 'slot' }` is filled with a room.
- `{ k: 'mazeSlot' }` is filled with a plain maze or a maze variant.

These stay **fixed (anchors)**, because they carry PS requirements and the balance work already done:
- `start`
- the first maze
- `quizMaze`
- the fork / Junction Hall, **including its lane rooms**
- `slimeGate`
- `exit`

```ts
easy:   [start, maze, slot, mazeSlot, slot, FORK_EASY, slot, slimeGate, exit]                                   // 3 slots
normal: [start, maze, slot, quizMaze, slot, FORK_FULL, slot, mazeSlot, slot, slimeGate, exit]                    // 4 slots
hard:   [start, maze, slot, quizMaze, slot, mazeSlot, slot, FORK_FULL, slot, quizMaze, slot, slimeGate, exit]    // 5 slots
```

The room count stays the same as today, so a normal run is no longer than now.

### The pool: `src/game/loop/pool.ts`

```ts
export interface PoolEntry {
  kind: RoomKind;                 // or a maze variant id for mazeSlot entries
  slot: 'room' | 'maze';
  minDifficulty: Difficulty;      // e.g. boulderRun: 'normal'
  weight: number;
  big: boolean;                   // a big set piece (launchPads, boulderRun, doorCarousel, answerLifts)
  classic: boolean;               // doorRush, tileDrop, stepStones, bridgeBuilder
  fits(pack: DomainPack): boolean; // question supply, e.g. ruleMinefield needs ≥ 4 classify questions
}
export function resolveRecipe(recipe: Step[], sel: RunSelection, pack: DomainPack, rng: Rng): Step[];
```

**Rules for `resolveRecipe`** (pure; tested over 500 seeds):
1. Use a **new named stream**, `stream(seed, 'recipe')`. Add `'recipe'` to the `stream` name union.
   - Do not use the `layout` stream. Taking numbers from it would change every existing course for the same seed.
2. No kind appears twice in a run, unless the eligible pool is smaller than the number of slots.
3. No two `big` rooms are next to each other.
4. On Normal and Hard, at least half the slots, rounded up, are non-classic. That way players actually meet the new obstacles.
5. Drop entries where `minDifficulty` is above the run's difficulty, or where `fits(pack)` is false.
6. `?demo=1` uses a **pinned** `DEMO_RECIPE` instead, so the judges' demo is identical every time.
   - Pin the three best-looking rooms: Launch Pads, Rule Minefield and Key Hunt.
   - Update `docs/DEMO_SCRIPT.md`.
7. Multiplayer (F3) works for free: same seed, same pack, so the same resolved recipe.

`buildCourse` calls `resolveRecipe` first, then builds as today. The fork depth logic only ever sees resolved steps.

### Par time per course

Today the third star uses a fixed `parTimeMs(difficulty, route)`. With mixed rooms that is unfair.
- Add `T.PAR_S: Record<kind, number>` and compute par time from the course: base + the sum over its segments.
- Calibrate each value at about 1.8× the bot's time in that room, measured with the balance harness.
- `computeStars` keeps its signature. Only the par source changes.

### Balance and tests

- `fullrun.test.ts` and `balance.test.ts` iterate over **seeds** as well as difficulty and lane: 20 seeds per difficulty in CI, `BALANCE_N` for tuning. The bot must qualify on every seed.
- Pool tests:
  - The rules above hold.
  - Same seed gives the same recipe.
  - Every pool entry gets picked at least once in 500 seeds per difficulty.
  - `fits` excludes `ruleMinefield` for a pack without classify questions.

### "Up ahead" banner

During the 3-2-1 countdown, show a strip of icons for the rooms in this run, e.g. 🚀 🧩 🗝️ 🚪. Players learn there is variety and look forward to it. The minimap already has a letter per kind; give each new kind one too.

### Gauntlet mode

- **What:** `RunSelection.mode = 'gauntlet'`. Every eligible pool entry appears **once**, in seeded random order, with plain mazes between big rooms, then `slimeGate` and `exit`.
  - Difficulty is Normal rules with slime rate ×0.7, because the run takes 6–8 minutes.
- **Where:** a "Gauntlet" option in QuickSelect and a HubOverlay button.
- **Results:** the results card shows a per-room breakdown (time and correct answers per room).
- **Uses:** for players who want everything, and for recording the demo video.

---

## F4-1. Launch Pads 🚀

- **Room:** a room ending in a **tall hedge wall with no door**. In front of it stand 2–4 launch pads in a row, each labelled with an answer. The question shows on the room panel.
- **Answering:**
  - Stand on a pad for 0.5 s. A charge ring fills, so a pad can't be triggered by accident.
  - Then the bean is **launched on a scripted arc**: input locked, a parametric path, collision off during the flight, and a camera that follows.
- **Right:** the arc clears the hedge and lands on the far side, at the room exit.
- **Wrong:**
  - The arc lands in a **slime pond** pocket at the side of the room: wade zone, slow movement, normal surge.
  - A ramp leads back to the pads. The used pad turns red and stays disabled.
  - **Hard:** you land in a small trap maze (3×2 cells) instead, and it exits back to the room start.
- **Build notes:**
  - Add `player.flight: { t, dur, from, to, apex } | null`, stepped in `stepPlayer`, and deterministic.
  - Landing points are computed at build time. Assert in a test that each landing point lies on a solid floor.
  - Use 2 pads with true/false questions, 3–4 with mcq. The detour flow is not used; the pond is the penalty.
  - Lifelines: 50/50 disables one wrong pad.
- **Bot:** walk to the correct pad and wait for the landing.

## F4-2. Rule Minefield 🧩

- **Room:** a sign at the entrance states a rule, e.g. *"Step only on prime numbers"*, *"Only things made by the Romans"* or *"Only valid Python names"*.
  - Ahead is a grid of tiles, 4 rows × 3 columns, with a slime pit underneath. Each tile shows an item.
- **Answering:**
  - Cross the grid by stepping only on tiles whose item fits the rule.
  - Every row has 1–2 safe tiles, and from any tile every tile in the next row is reachable.
- **Wrong tile:**
  - The tile shakes for 0.4 s, then drops.
  - The fallen tile reappears with a red ✗ and its item, so the player learns from it.
  - You land back at the start of the previous row (Normal) or at row 0 (Hard).
  - The first wrong tile is a full surge; later ones are ×0.5, like Step Stones.
  - The room counts as correct only with zero wrong tiles.
- **New question type `classify`** (`src/content/schema.ts`, validator, CONTENT_GUIDE):
  ```ts
  interface ClassifyQuestion extends QBase { type: 'classify'; rule: string /* = prompt */; items: { label: string; fits: boolean }[] }
  // 8–10 items, ≥ 3 fit and ≥ 3 don't; labels 1–22 chars; all items differ
  ```
  - Hand packs: write 4 classify questions per built-in domain, at least 2 concepts, mixed tiers.
  - F2: the generator writes 1 classify per concept. This is **optional for the quota**; without enough of them, `fits()` excludes the room.
  - Items repeat to fill 12 tiles. The grid builder places them by the row rule above, using the `layout` rng.
- **Reuse:** Tile Drop's tile state machine (`solid → shaking → falling → gone`) and `labelTexture`.
- **Bot:** step only on fitting tiles.

## F4-3. Key Hunt 🗝️ (maze variant)

- **Maze:** the exit of this maze is a **locked gate** with the question on a sign above it.
  - 3–4 **keys**, each labelled with an answer, lie in the maze's dead ends. Use the dead-end cells that `maze.coins` already finds; keys replace coins there.
- **Answering:**
  - Walk over a key to pick it up. You can carry one at a time, as with Bridge Builder blocks, and F drops it.
  - Carry it to the gate.
- **Right key:** the gate opens.
- **Wrong key:**
  - A zap pushes you back 3 m, the key returns to its dead end marked ✗, and you take a surge.
  - Every wrong key is a long walk, which makes dead ends meaningful. This directly covers the PS's "dead ends".
- **Notes:**
  - The minimap shows a key icon once you've seen it.
  - On Hard, the fog makes the search the real challenge.
  - Compass power-up: points to the nearest **unchecked** key.
  - Lifelines: 50/50 marks one wrong key ✗ from afar.
- **Bot:** BFS to the correct key, then BFS to the gate.

## F4-4. Hazards + Shield power-up ⚠️

These are pure Fall Guys flavour, placed in **plain mazes and corridors only**, never inside question rooms.

| Hazard | Behaviour | Collision |
|---|---|---|
| Sweeper | A 3.6 m bar spinning in an open maze cell | Rotating segment vs circle (new, small: point-to-segment distance) |
| Hammer | A pendulum swinging across a corridor | A moving AABB in `dynWalls` |
| Ice patch | A floor area with friction ×0.2 | A floor flag; affects acceleration in `stepPlayer` |

- **Hit:**
  - Knockback impulse, a spin (the existing `player.spin`) and input locked for 0.4 s.
  - Slime +0.01 (Normal) or +0.02 (Hard).
  - It is never lethal by itself.
- **Density** (`T.HAZARDS_PER_MAZE`): Easy 0 · Normal 2 · Hard 4, placed by the `layout` rng. Never on the solution path's first or last cell.
- **All motion uses the run clock** (`run.elapsedMs`), so it is deterministic and the same for every multiplayer player.
- **Shield** 🛡️, a new 5th power-up (key **5**):
  - Add it to `POWER_KINDS` and the grant pool.
  - It blocks the next hazard hit, or one boulder squash in F4-6. It is used up automatically.
  - Slime Freeze also stops all hazards while it lasts.
  - Update F3: emote keys move to 6–9.
- **Bot:** waits for a safe phase before passing. A test checks that a bot ignoring hazards still qualifies, just slower.

## F4-5. Door Carousel 🎠

- **Room:** a wall across the room with **one** 4 m opening in the centre.
  - Behind it, a train of 4 labelled door panels **slides sideways in a loop**, so a different panel fills the opening every few seconds.
  - Panels outside the opening are hidden behind the wall.
- **Answering:** run through the opening when the correct panel is there. You burst it, as in Door Rush.
- **Wrong:** you burst a wrong panel, and the result follows Door Rush rules: surge, then detour.
- **Speed:** 1 m/s (Easy), 1.6 (Normal), 2.4 (Hard).
- **Build:** each panel is a dynamic WallBox moved every step from the run clock. `dynWalls` are already checked every step.
- **Bot:** waits until the correct panel is centred, then runs.

## F4-6. Boulder Run 🪨 (Normal+)

- **Room:** a 40 m corridor.
  1. On entry the question appears and the room rumbles for 3 s (Hard: 2 s).
  2. Then a boulder is released behind you. It rolls at 0.8 × `MAX_SPEED`, or 0.9 on Hard.
  3. Near the end, 3 side **alcoves** are labelled with answers. Only the correct one leads on to the exit.
- **Right:** duck into the correct alcove and the boulder rolls past and smashes into the end wall.
- **Wrong alcove:** it's a shallow dead end. You're safe from the boulder but lose time, the alcove gets ✗, and you take a surge.
- **Caught by the boulder:**
  - You're flattened: squash animation, surge ×0.5 and a respawn at the room start.
  - The boulder resets, and the same question stays.
- **Fairness:** the boulder is slower than the player, so anyone who knows the answer always escapes. Hesitating is what costs you.
- **Hard:** two waves, i.e. one set of alcoves halfway and one at the end, with 2 questions.
- **Bot:** run straight and take the correct alcove.

## F4-7. Memory Floor 🧠

- **Room:** a 3×3 grid of big tiles over the slime.
  1. On entry, 4 tiles flip up showing answer labels for 5 s (Easy 7, Hard 3).
  2. Then they flip face-down, and only then does the question appear.
- **Answering:** stand on the tile you remember holds the right answer for 1 s.
- **Right:** a bridge to the exit rises.
- **Wrong:**
  - The tile drops (fall, respawn at the room start) and you take a surge.
  - On Normal, the remaining labels re-flash for 1 s. On Hard they don't.
- This combines Fall Guys' Perfect Match with a knowledge twist: you need to remember *and* know the answer.
- **Bot:** goes to the correct tile.

## F4-8. Answer Lifts 🛗 (Normal+)

- **Room:** the exit sits on a ledge 6 m up. Below it stand 3–4 lift platforms, each labelled with an answer.
- **Answering:** stand on a lift and it rises.
- **Right:** the lift rises to the ledge.
- **Wrong:** the lift rises halfway, stops, then **sinks into a slime pond**. You wade out up some steps, take a surge, and that lift is ✗.
- **Build:** moving floors need a `top` that changes every step, plus "ride along" snapping when grounded on a moving floor. Add this to `navigation.ts` in a generic way, because Hex Finale and future rooms can reuse it.
- **Bot:** stands on the correct lift.

## F4-9. Shifting Maze 🌀 (maze variant, Normal+)

- **Maze:** 2 **switch shrines** inside the maze, each with a question and 2–3 labelled pressure plates.
- **Right:** hedges slide away to open a **shortcut** toward the exit.
- **Wrong:** 2–3 hedges slide to **close your current path** and open a longer one.
- **Hedges:** shifting hedges are dynamic walls (`isStatic: false`). Before applying a change, check that the exit is still reachable with `reachableCells`; test this over many seeds.
- This is the PS's "alternate paths" made literal.
- **Bot:** takes the correct plate, then re-plans with BFS after the walls move.

---

## F4-D. Daily Challenge plus your ghost

- **Daily course:** a Daily button in the hub. Everyone gets the same course today.
  - Seed: `hashString('daily:' + YYYY-MM-DD in UTC)`. The domain rotates by day and the difficulty is Normal.
  - Its recipe is resolved by the pool, so the daily mix changes every day too.
- **Ghost:** your best attempt today is recorded as a ghost.
  - Sample position, facing, speed and grounded at 10 Hz, delta-encoded.
  - Store it in `lywo:daily:v1`, keeping today and yesterday only.
  - Later attempts show it as a translucent avatar.
- **Streak:** a counter, e.g. "🔥 4 days".
- **Shared code:** this builds the snapshot rendering that F3 reuses: `src/net/interp.ts` (`sampleSnapshots`) and `RemotePlayers` with a local source. Whichever feature lands first creates it.
- **Seen questions:** off for daily runs, so the questions are identical for everyone. Generalise the `params.demo` check.

## F4-X. Hex Finale (multiplayer final round)

- **Arena:** a round arena of hex tiles over the slime.
- **Each round:**
  - A question appears and answer labels are painted across colour clusters.
  - After a timer (12 s, −1 s per round, minimum 6 s), every hex outside the correct cluster falls.
  - The edge shrinks one ring every 2 rounds.
- **When it's used:** the last room (instead of `slimeGate`) in **online races with ≥ 3 players**; last players standing win.
  - Solo: an optional finale where surviving 5 rounds qualifies you.
- **Reuse:** Tile Drop's states and the moving-floor code from F4-8.

## F4-G. Gold Door

An old idea, never built until now.
- **What:** Door Rush, and Door Carousel too, get a golden ★ door with a tier+1 follow-up question.
  - Right: double pushback and +2 coins.
  - Wrong: double surge.
- **Done when:** the balance harness shows it pays off for strong players and hurts guessers.

---

## Dropped or deferred

- **Study Stops:** dropped. The owner prefers obstacles to reading.
- **Fact or Fiction Conveyor:** replaced by Rule Minefield, which is faster to build and more varied.
- **Answer Ball:** deferred. Ball physics is costly.
- **Team Relay:** deferred until F3 is stable.

Still out:
- grabbing or shoving other players, because it breaks the ghost model
- text chat
- paid or random loot
