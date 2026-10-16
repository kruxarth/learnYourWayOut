# Review notes: `next-features` (overnight build, 2026-10-15 → 16)

Everything in `plan/NEXT_FEATURES.md` (F1–F4) is built on the branch **`next-features`**. `main` is untouched.

The work was done by Sonnet workers in separate git worktrees, then merged and integration-tested here. Review it with:

```
git diff main...next-features --stat
git log --oneline main..next-features
```

## Status at hand-off
- **`npm run check`**: green, 456 tests passed, 1 skipped (the opt-in calibration tool). Types and build are OK.
- **Bot sweep**: 60 seeds × 3 difficulties × both lanes, all qualify.
- **Balance**: on target at BALANCE_N=40 for all difficulties. See the last section of `docs/DECISIONS.md`.
- **Lint** (`npx oxlint src server`): warnings only, in the same react-immutability pattern the existing render code already had.
- **Not verified in a browser.** Nothing was ever loaded in a browser. All logic is covered by headless tests; **every visual is unverified** (see the checklist below).

## What was built
| Feature | What you get | Where to start reading |
|---|---|---|
| F1 Avatars | Customisable bean: 12 colours, faces, 12 hats, extras. Wardrobe booth (hub, south-west). Typed player names with a profanity filter. Unlocks earned by stars and achievements. | `src/game/avatar.ts`, `src/render/avatar/`, `src/ui/Wardrobe.tsx`, `src/game/names.ts` |
| F2 Any Topic | Type a topic and pick Easy/Medium/Hard; the server generates a full question pack with an LLM. Safety gate, review pass, "Looks wrong?" report button, recent topics, 2 offline example packs. | `server/`, `server/llm/pipeline.ts`, `src/ui/TopicPanel.tsx` |
| F3 Multiplayer | Ghost race on a LAN: lobby with 4-letter codes, synced countdown, see-through rivals with name tags, race strip, results with podium and awards, emotes on 6–9, reconnect. | `server/mp/`, `src/net/`, `src/ui/Lobby.tsx` |
| F4 Room pool | Every run fills its slots at random (seeded) from the pool. Gauntlet mode plays every room. The "Up ahead" strip shows the coming rooms. | `src/game/loop/pool.ts` |
| F4 Obstacles | Launch Pads, Rule Minefield (new `classify` questions), Key Hunt, Door Carousel, Memory Floor, Answer Lifts, Boulder Run, Shifting Maze, Hex Finale. Hazards (sweeper, hammer, ice) with a Shield power-up on key 5. Gold Door. | `src/game/rooms/*`, `src/game/loop/hazards.ts` |
| F4 Daily | Daily Challenge (same course for everyone that day) and a ghost of your best run. | `src/game/daily.ts`, `src/render/GhostPlayers.tsx` |

## Try it
- **Solo:** `npm run dev`. The hub now has a Wardrobe, Any Topic, Play Online, Daily and Gauntlet.
- **Demo:** `?demo=1` is a pinned course with Launch Pads, Rule Minefield and Key Hunt. `docs/DEMO_SCRIPT.md` is updated.
- **Any Topic, for real:**
  1. `cp server/.env.example server/.env`
  2. Add `LLM_API_KEY`, and check that `LLM_MODEL` is current (the default is `deepseek-v4-flash`).
  3. Run `npm run dev:all`.

  Without a key, only the two offline example packs work.
- **Multiplayer:** `npm run build && npm run server`, then open `http://localhost:8787` in two tabs with different names, or on two laptops via the LAN URL the server prints.
  - With 3 or more players, the race ends in the Hex Finale.
  - Hex Finale for solo runs is a checkbox in Settings.

## Needs your eyes (decisions the workers made; all logged in `docs/DECISIONS.md`)
1. **Content accuracy:** these were all written by AI and only format-checked, so read them:
   - the 2 hand-written example packs (`src/content/examples/`)
   - the 24 hand-written `classify` questions (4 per domain and 4 per example pack)
2. **AI pipeline:** never run against a real LLM. Check generation time (target under 30 s), question quality, and the safety gate on tricky topics.
3. **Balance:**
   - Hard slime rate is now 1/425 (it was 1/390).
   - Hard surge is 0.06.
   - Hazard hit costs are halved on Hard compared with the spec.
4. **Hex Finale:**
   - It takes about 72 s, where the Slime Gate takes about 8 s.
   - Online it is not "last one standing": each player runs their own 5 rounds.
5. **Pool:** a run holds at most ⌈slots/2⌉ big set pieces. I added this while merging, after the 500-seed test caught two big rooms next to each other.
6. **Small calls:**
   - The bowtie is free.
   - The first-launch name prompt has no skip.
   - Memory Floor's minimap letter is F.
   - Test timeout is raised to 30 s.

## Visual checklist (nothing was seen)
- **Avatars:** hat and face placement at the default camera, the cape direction, and the Wardrobe preview.
- **Launch Pads:** the camera during the 8 m arc, and the 4.5 m hedge hiding the landing.
- **Hazards:** sweeper, hammer and ice look and feel, and the Shield bubble.
- **Rooms:** for every new room, readable labels, the fall and sink animations, and the boulder roll.
- **Shifting Maze:** hedge slides.
- **Hex Finale:** hex prisms with no visible seams.
- **Multiplayer:** name tags, see-through rivals fading in maze fog, the race strip on narrow screens, and the podium.
- **Performance:** frame time on the Hard maze with the `?debug=1` overlay, especially with 8 remote avatars.

## Housekeeping
- **Worker worktrees:** they are still in `.claude/worktrees/`. They are excluded from git via `.git/info/exclude` and each has its own `node_modules`, so they take a lot of disk space. When you're done reviewing, delete them:
  ```
  git worktree list
  git worktree remove --force <path>
  ```
  Then delete their `worktree-agent-*` branches. Every one of them is merged into `next-features`.
- **Merge into main:** when you're happy, `git checkout main && git merge next-features`.
