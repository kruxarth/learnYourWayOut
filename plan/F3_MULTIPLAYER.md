# F3: Online multiplayer (one laptop per player)

Read `plan/NEXT_FEATURES.md` first. This feature builds on the `server/` folder from F2-M1 and the `Avatar` from F1.

## 1. Goal

2–8 players, each on their own laptop, race the **same course** at the same time and see each other running. Whoever qualifies first wins, but the game also rewards accuracy so it stays a learning game.

## 2. The model: a "ghost race" (decided; don't build server physics)

- **Same course on every laptop.** Everyone gets the same `seed`, domain, difficulty and pack. `buildCourse` is deterministic (tested), so each laptop already builds an identical course.
- **Each laptop simulates only its own player.** It runs its own run, slime, questions and detours, exactly like single player. The engine needs almost no change.
- **Each client sends its state 10 times a second:** position, facing and progress. The server **relays** it to the others.
- **Other players are drawn as "ghosts": real avatars with no collision.** You can run through them.
- **Why:**
  - No shoving means no latency arguments, no griefing between players, and nothing to reconcile.
  - The physics stays deterministic and testable.
  - Lag only makes a ghost look slightly behind; it never changes your game.
  - Fall Guys-style grabbing is deliberately out of scope.
- **Questions:** every player keeps adaptive tiers, so a struggling player gets easier questions. This acts as a built-in handicap. Players see the same course, but not always the same questions.
  - Stretch: a host toggle "Same questions for everyone" (fixed tier) for classroom review afterwards.
- **Any Topic packs (F2)** work in multiplayer. The host picks the pack, the server stores it in the room, and it goes to everyone in `start`. Guests need no LLM call.

## 3. Protocol (`src/net/protocol.ts`, shared with the server, pure TS)

- All messages are JSON, `{ t: '<type>', … }`, protocol version `PROTOCOL_V = 1`.
- Every incoming message is checked by a guard function (`parseClientMsg` / `parseServerMsg`). Anything that fails the guard is dropped.

**Client → server**

| t | Fields |
|---|---|
| `hello` | `v, name, avatar, resumeToken?`. `name` must pass `cleanName` (F1 §6); the server uses the cleaned value. `avatar` goes through `sanitizeAvatar`. |
| `create` | `domainId, difficulty, pack?` (only for `custom`; ≤ 200 KB; validated with `validateDomainPack`) |
| `join` | `code` |
| `ready` | `ready: boolean` |
| `start` | host only |
| `state` | `seq, x, y, z, f (facing), sp (speed), g (grounded), spin, seg (segIndex), slime, solved (rooms resolved), asked, correct, detour: boolean` |
| `finish` | `outcome, timeMs, stars, asked, correct` |
| `emote` | `id: 0..3` |
| `ping` | `c` (client ms) |
| `leave` | — |

**Server → client**

| t | Fields |
|---|---|
| `welcome` | `playerId, resumeToken` |
| `lobby` | `code, hostId, players: [{ id, name, avatar, ready, connected }], domainId, difficulty, packName?` |
| `start` | `seed, domainId, difficulty, pack?, startAt` (server epoch ms, about now + 4 s), `totalRooms` |
| `states` | `[{ id, …state fields }]`, batched, 10 Hz |
| `finished` | `id, place, outcome, timeMs` |
| `raceOver` | `standings: [...]` (see §6) |
| `emote` | `from, id` |
| `pong` | `c, s` (server ms) |
| `error` | `code: 'bad-code'\|'full'\|'started'\|'bad-name'\|'bad-pack'\|'version', message` |

## 4. Server (`server/mp/`)

- **`rooms.ts`**: a **pure** room state machine with no sockets, so it is testable. A room moves through `lobby → countdown → racing → over`.
  - **Room code:** 4 characters from `BCDFGHJKLMNPQRSTVWXZ`. With no vowels, codes can't spell words.
  - **Size:** max 8 players. Nobody can join after `start`.
  - **Host:** the creator. If the host leaves, host passes to the longest-connected player.
  - **Disconnects:** a disconnected player keeps their slot for 30 s and can resume with `resumeToken` (stored in `sessionStorage`).
  - **Race end:** when every player has finished, been eliminated, or disconnected for over 30 s, **or** 180 s after the first qualifier. Players still running then get **DNF**.
  - **Empty rooms** are deleted after 60 s.
- **`ws.ts`**: wires the `ws` package to `rooms.ts` on the same http server, at path `/ws`. Set `maxPayload` to 256 KB.
  - Rate-limit each socket: `state` at most 15 per second. Extra messages are dropped.
- **Relay:** each 100 ms tick, the server sends one `states` batch per room, holding the latest state of each player. Don't forward each message on its own.
- **Light sanity checks, not anti-cheat:**
  - Ignore `finish` with `timeMs` below 50% of the bot par time for that difficulty.
  - Clamp `slime` to 0..1.

  This is a classroom game; keep it simple.
- **LAN help:** `/api/health` also returns `lanUrls` (built from `os.networkInterfaces()`), e.g. `http://192.168.1.20:8787`. The lobby shows it so other laptops know where to connect.

## 5. Client

**`src/net/client.ts`**: `NetClient` over an injectable `Transport` (`{ send(s), onMessage(cb), onClose(cb), close() }`).
- There are two transports: a real `WebSocket` one and an in-memory one for tests.
- **Time sync:** 5 pings when you join, then one every 5 s. Keep the median offset and use `serverNow()`.
- **Reconnect:** back off 0.5 → 1 → 2 → 4 s and send `resumeToken`.

**`src/net/store.ts`** (a separate zustand store, `useNet`): `status`, `room` (lobby info), `me`, `standings`.
- Remote player snapshots live in a **plain mutable map**, not in React state: `remotes: Map<id, { buf: Snapshot[], name, avatar, … }>`.
- The renderer reads `remotes` in `useFrame`. Add this as a third exception to ARCHITECTURE data-flow rule 6, next to Minimap and DebugOverlay.

**Engine changes (keep them small):**
- `RunSelection` gets an optional `mode?: 'solo' | 'online' | 'daily'`.
- **Synced start:** `engine.startRun(sel, { countdownAt?: number })`. The run stays in the `countdown` phase, with the bean locked and banner "Get ready…", until local time reaches `countdownAt`. Then the normal 3-2-1-GO plays.
  - The client sets `countdownAt = startAt − offset − 3 × COUNTDOWN_STEP × 1000`.
  - Watch out: `stepCountdown` must not show "4", "5" … while waiting.
- **In `online` mode:**
  - No pause. Esc opens a small "Leave race?" menu while the game keeps running.
  - The `visibilitychange` auto-pause is skipped.
  - Debug keys are off.
- **State source:** `engine.netSnapshot()` returns the `state` fields above without allocating (it reuses one object). `NetClient` calls it on a 100 ms timer during a run.
- **Finish:** when `outcome.ts` makes a `RunResult`, emit a game event. The net layer listens for it and sends `finish`.

**Hub and lobby:**
- **Play Online** pad at (6, 9), plus a HubOverlay button, opens `src/ui/Lobby.tsx`. Disable it if `/api/health` fails.
- **Lobby, first screen:**
  - **Create race:** choose a domain (the 4 built-ins, or a recent or example Any Topic pack from F2) and a difficulty.
  - **Join race:** a 4-letter code field. It upper-cases letters, rejects other characters, and is never shown to other players.
- **Lobby, in a room:**
  - The code in big letters, plus the LAN URL.
  - The player list with `AvatarThumb`, name and ready tick.
  - A Ready toggle.
  - For the host: **Start**, enabled when there are ≥ 2 players and everyone is ready. The host can also force-start after 20 s.
  - Leave.
- On `start`: `setCustomPack` if needed, then `engine.startRun({ … , seed, mode: 'online' }, { countdownAt })`.

**Rendering (`src/render/RemotePlayers.tsx`, mounted in `Scene.tsx` only when online):**
- **Interpolation:** render each remote player **150 ms in the past**, between the two snapshots around that time. Lerp the position and take the shortest-arc lerp of the facing.
  - If two snapshots are more than 6 m apart (respawn, detour teleport), snap instead of lerping.
  - With no snapshot for over 2 s, fade the ghost to 40% opacity and show a "📶" tag.
- **Avatar:** the F1 `<Avatar>`, with a pose driven by `sp` (waddle and lean), `g` (squash on landing) and `spin`.
  - Draw it at 85% opacity, so players can tell it is a ghost they can pass through.
- **Name tag:** one `labelTexture` sprite above the head, in the player's body colour, created once per player and disposed when they leave. It fades with `visOpacity()` in mazes. On Hard, fog hides rivals, which is good.
- **Minimap:** a coloured dot per remote player.
- **Emotes:**
  - Keys 6–9 (1–5 are power-ups; 5 is the F4-4 Shield), plus 4 buttons on touch: 👋 👍 😄 "GG".
  - A floating icon above the avatar for 2 s, with a 3 s cooldown.
  - There is no chat.

**HUD (`src/ui/RaceStrip.tsx`):**
- A strip on the right, sorted by progress (`solved`, then `seg`, then finished time). Each row shows place, colour dot, name, a progress bar of `solved / totalRooms`, and an icon: ✓ qualified, 💀 eliminated, ⏸ disconnected.
- Collapse it to "You: 3rd / 6" on small screens.

## 6. Race results (`src/ui/RaceResults.tsx`, a tab on the results card)

- **Standings:**
  - Qualified players first, by time.
  - Then eliminated players and DNFs, by `solved`, then accuracy.
- **Podium:** the top 3 avatars on blocks, using the wardrobe preview canvas setup.
- **Awards** that reward learning, not just speed, so slower, careful players also get a moment:
  - 🧠 **Brainiest**: best accuracy, with at least 5 asked.
  - 🔥 **Hot Streak**: longest combo. Add `bestCombo` to `state`/`finish`.
  - 🎯 **Comeback**: most detours completed and still qualified.
- **Buttons:**
  - **Race again**: same room, new seed. The host presses it and the others auto-ready.
  - **Back to hub.**
  - Your own normal solo results stay one tab away.

## 7. Milestones

- **M1. Protocol and server**
  - `protocol.ts`, `rooms.ts`, `ws.ts`, room tests.
  - Done when two in-memory clients can create, join, ready, start, relay states and finish, and the room tests are green.
- **M2. Lobby and synced start**
  - `NetClient`, `useNet`, Lobby UI, hub pad, time sync, synced countdown.
  - Done when two browser tabs on one machine start the countdown within 100 ms of each other.
- **M3. Seeing each other**
  - `RemotePlayers`, interpolation, name tags, minimap dots, `RaceStrip`, the online pause rules.
- **M4. Finish and polish**
  - Race results, awards, podium, emotes, reconnect, Race again.
  - Update docs: README "Multiplayer" section, ARCHITECTURE (network layer and rule 6), DEMO_SCRIPT (two-laptop segment).

## 8. Tests

- **`server/mp/rooms.test.ts`:**
  - Code alphabet and uniqueness.
  - `full`, `started`, `bad-code`, `bad-name`, `bad-pack` errors.
  - Host migration.
  - Resume within 30 s works; after 30 s it doesn't.
  - Finish order and places.
  - The 180 s race-over timeout gives DNF. Use injected clocks; never real timers.
- **`protocol.test.ts`:** the guards reject wrong types, extra-large payloads and unknown `t`.
- **`src/tests/net.test.ts`:**
  - `NetClient` plus the in-memory transport plus `rooms.ts`: both clients get an identical `start`.
  - The time-sync offset converges with a fake clock.
  - The reconnect flow works.
- **Engine:**
  - `startRun(..., { countdownAt })` keeps the phase `countdown` and the input locked until then, then runs 3-2-1-GO.
  - Online mode ignores pause.
  - `netSnapshot()` does not allocate (it returns the same object).
- **Interpolation:** a pure function `sampleSnapshots(buf, renderTime)` in `src/net/interp.ts`. Test lerp, snap-on-teleport and the stale flag.
- The engine is a process-wide singleton, so tests cannot run two real engines in one process. Simulate the remote side with scripted `states` messages instead.

## 9. Two-laptop acceptance test (do this before any demo)

1. Laptop A runs `npm run build && npm run server`. Laptop B opens A's LAN URL in a browser.
2. A creates a Normal Math race. B joins with the code. Both are ready, and A starts.
3. The countdowns match by eye, and each player sees the other running smoothly with a name tag.
4. B answers wrong on purpose. A sees B teleport into the detour (a snap, not a slide).
5. B closes the tab, then reopens and resumes within 30 s.
6. Both finish. The standings and awards match on both screens.
7. Repeat with an Any Topic pack: B must not need the LLM.
8. Repeat over a phone hotspot (the venue Wi-Fi backup).
