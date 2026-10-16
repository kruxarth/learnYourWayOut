# Learn Your Way Out

*Every learning game is a quiz in a costume. In ours, the maze is the quiz.*

A browser 3D game (three.js / React Three Fiber). Run a hedge maze; answer by moving through doors, onto tiles, across stepping stones, or by carrying blocks. Wrong answers lead to a detour that teaches, while the slime rises.

## Run
`npm install` · `npm run dev` · `npm run build` · `npm run check` (types + tests + build)

## Any Topic (type your own topic)
Walk onto the pink **Any Topic** pad in the hub (or press the **Any Topic** button), type a topic such as "Roman Empire", pick Easy / Medium / Hard, and a server-side AI writes a full question set. The game works without the server: the built-in domains and the two example packs (Roman Empire, Volcanoes) play offline. Recent topics (the last 6) replay without the server too.

Run the game server (needs an OpenAI-compatible API key; the key never reaches the browser):
1. DeepSeek: `cp .env.example .env` and set `DEEPSEEK_API` to your key; nothing else is needed. Other providers (OpenCode Zen, OpenRouter, any OpenAI-compatible host): `cp server/.env.example server/.env` and fill in `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL` (`LLM_API_KEY` wins over `DEEPSEEK_API`). Both `.env` files are gitignored.
2. `npm run dev:all` runs Vite and the server together (Vite proxies `/api` to port 8787). `npm run server` runs the server alone. After `npm run build`, the server also serves `dist/`, so one laptop can host the whole game on a LAN.
3. `npm run gen-pack -- "Roman Empire" normal` prints a generated pack as JSON (a human should review every question before it is committed).

Without a key the server starts with Any Topic switched off (`/api/health` says `llm:false`) and the panel points players to the examples. AI-made questions can be wrong: they pass validation and a second review pass, are marked "AI-made", and every question has a "Looks wrong?" button. Only the topic text and level are ever sent to the model. Optional client setting: `VITE_SERVER_URL` (empty means same origin).

## Multiplayer (race friends, one laptop each)
2 to 8 players race the same course at the same time and see each other as see-through avatars (no collisions). Everyone plays their own run; the first to qualify wins.

**Host on a LAN** (one laptop runs the server, the others only need a browser):
1. On the host laptop: `npm run build && npm run server`. The console prints the LAN address, e.g. `Other laptops on this network can open http://192.168.1.20:8787`. (For development, `npm run dev:all` also works: Vite proxies `/api` and `/ws` to port 8787.) A phone hotspot works the same way if the venue Wi-Fi blocks laptop-to-laptop traffic.
2. Every player opens that address in their browser. The lobby also shows the address.
3. Pick a name in the Wardrobe, then stand on the blue **Play Online** pad (south-east of the spawn) or press the **Play Online** button.
4. One player picks a topic (a built-in domain, or a recent or example Any Topic pack) and a difficulty and presses **Create race**. The lobby shows a 4-letter **room code** (consonants only, so it never spells a word). The others type the code and press **Join**.
5. Everyone presses **Ready**. The host presses **Start** (needs 2 or more players, all ready; after 20 s the host can start anyway). All laptops count 3-2-1 at the same moment.

Rules online: no pausing (Esc opens "Leave race?" while the game keeps running), no debug keys. Close the tab and reopen within 30 s to resume your place. Guests never call the AI: an Any Topic pack travels with the room. There is no chat; names are filtered on the client and the server. The game works without the server; the Play Online button is then greyed out.

In the race: the **race strip** (right, under the minimap) lists everyone by progress (rooms solved), with a tick for qualified, a skull for eliminated and a pause icon for disconnected; on a phone it collapses to "You: 3rd / 6" (tap to open). Rivals appear on the minimap as coloured dots and in the maze as 85%-opaque avatars with name tags; a rival with a bad connection fades and shows a 📶. **Emotes**: keys **6 7 8 9** (or the four buttons at the bottom) send 👋 👍 😄 GG, with a 3 s cooldown. When the race ends the results card opens on a **Race** tab: standings, a podium and awards (🧠 Brainiest, 🔥 Hot Streak, 🎯 Comeback). The host presses **Race again** (new seed, same room); everyone else can press **Back to hub**. Your own run is one tab away (**My run**). While the connection drops, a "Reconnecting…" banner shows and your run keeps going.

## Controls
WASD/arrows move (camera-relative) · in mazes the camera drops in behind the bean: A/D (or the stick left/right) steer, W/S drive forward and back · Space jump · drag mouse to look (outside mazes) · the question is always in the card at the top · Q 50/50 · E hint · F drop block · 1–5 power-ups (5 = Shield) · R read aloud · M mute · Esc/P pause · Tab Quick Select (hub) · stand on the purple Wardrobe pad (south-west of the spawn) or press the Wardrobe button to dress your character; Esc closes it

## Difficulty
| | Easy | Normal | Hard |
|---|---|---|---|
| Maze rows / fog radius | 4 / none | 6 / 10 m | 8 / 7 m |
| Crossroads quiz mazes (junctions) | — | 1 (2) | 2 (3) |
| Fork | free choice | Junction Hall | Junction Hall |
| Door/Gate answer timer | — | — | 12 s (×2 with Relaxed timers) |
| Glowing hints after misses | yes | yes | no |
Key Hunt: the exit of this maze is a locked gate; the question is in the question card. Keys labelled with answers lie in the dead ends. Walk over one to carry it (F drops it) and bring it to the gate: the right key opens it, a wrong key zaps you back 3 m and marks itself with an X. The minimap shows keys you have seen, the Compass points to the nearest unchecked key (then to the gate), and 50/50 crosses out a wrong key.

Rule Minefield: the question card states a rule ("Step only on prime numbers"); cross a 4 x 3 grid of tiles over the slime, stepping only on items that fit it. A wrong tile drops you back and comes back as a red X. Uses the new `classify` question type.

Launch Pads: stand on the pad with the right answer until its ring fills and you are launched over a hedge with no door; a wrong pad drops you in a slime pond.

Boulder Run (Normal and Hard): a 40 m corridor. The question appears and the ground rumbles for 3 s (Hard 2 s); then a boulder rolls in behind you, slower than you run. Run to the end and duck into the alcove with the right answer: its back wall opens onto a way round to the exit. A wrong alcove is a dead end marked X (and costs a surge); a boulder that catches you squashes you back to the start. A Shield blocks one squash. Hard has two waves.

Shifting Maze (Normal and Hard, a maze variant): two glowing shrines stand on the way out. Walk into one to get a question, then stand on the plate with the answer. Right: hedges slide away and open a shortcut. Wrong: a surge, and hedges close the way ahead and open a longer one. The exit always stays reachable. You may skip a shrine.
Three first-try answers in a row earn a power-up: 🏮 Lantern, 🧭 Compass, ❄️ Slime Freeze, 🔍 X-ray or 🛡️ Shield (keys 1–5; Shield is not granted on Easy, which has no hazards). The streak also adds up to +20% speed.
Door Carousel: one opening in a wall, with a train of labelled door panels sliding sideways behind it (1 / 1.6 / 2.4 m/s on Easy / Normal / Hard). Wait until the right answer is in the gap, then run into it. A wrong panel works like a wrong Door Rush door (trapdoor, surge, detour). It can also open a Gold Door.
Memory Floor: a 3x3 field of big tiles. Four tiles flip up and show answers for 7 / 5 / 3 s (Easy / Normal / Hard), then flip face down and the question appears. Stand still on the tile you remember for 1 s. Right: a bridge to the exit rises. Wrong: the tile drops, you respawn at the room start with a slime surge (Easy and Normal show the labels again for a moment, Hard does not).
Gold Door: after a first-try right Door Rush or Door Carousel answer a golden star door opens at the back of the room. Run into it for a bonus question one tier harder, answered in the question panel (click or keys 1-4): right gives double slime pushback and +2 coins, wrong gives a double surge.
Answer Lifts (Normal and Hard): 3 or 4 lifts carry the answers, and the exit is on a ledge 6 m up. Stand on a lift until its ring fills. The right lift rises to the ledge, then hop down the far edge. A wrong lift stops halfway, sinks into the slime pond and takes a surge; wade out up the steps between the lifts (that lift is marked X) and try another.

Hex Finale: an optional last room that replaces the Slime Gate. Turn on **Hex Finale as the last room** in Settings for solo runs (the default is the Slime Gate). A round disc of hex tiles floats over the slime. Each round shows a question with its answers painted on colour slices of the disc; when the timer ends (12 s, 1 s less each round, never under 6 s) every tile outside the right slice sinks, and after rounds 2 and 4 the outer ring crumbles for good. A fall costs a large slime surge and puts you back on the rim. Survive 5 rounds to qualify (the slime still decides elimination). **Online**, a race with 3 or more players always ends in the Hex Finale (the server sends the player count in `start`, so every laptop builds the same course); with 2 players it ends in the Slime Gate. Being eliminated in the finale counts as eliminated in the standings. The daily course, the Gauntlet and `?demo=1` always use the Slime Gate.
Hazards (Normal and Hard, plain mazes and corridors only): red sweeper bars that spin in a cell (jump over them), hammers that swing across a corridor cell, and slippery ice patches. A hit knocks you back, spins you, locks your input for 0.4 s and adds a little slime; it is never lethal. The Shield (press 5 to arm it) blocks the next hit and is used up. Slime Freeze stops the hazards too. Density: Easy 0, Normal 2 per maze, Hard 4.

## Gauntlet
Pick **Gauntlet** in the hub (button, or Tab for Quick Select and choose the mode). Every room of the pool appears once in a seeded random order, with plain mazes between the big set pieces, a crossroads maze, a Junction Hall and the Slime Gate. It plays on Normal rules with the slime 30% slower, and the results card lists time and answers per room. A normal run fills its room slots at random from the same pool, so two runs rarely have the same rooms; `?demo=1` pins one course. The "Up ahead" strip during the 3-2-1 shows the rooms of the run.

## URL parameters
`?seed=N` · `?avatar=body.eyes.mouth.hat.extra` (debug, e.g. `red.wide.grin.crown.cape`) · `?domain=math|science|history|programming&difficulty=easy|normal|hard` · `?demo=1` (math, normal, seed 4242) · `?debug=1` (G god, N next room, K lose, L win, C coins, B boxes, O log)

## Deploy
Build and upload `dist/` to Vercel or Netlify. Any Topic then needs the game server hosted elsewhere (set `VITE_SERVER_URL` at build time and add the site to `ALLOWED_ORIGINS`); without it the rest of the game still works.

Docs: see the `docs/` folder (ARCHITECTURE, DELIVERABLES, CONTENT_GUIDE, DEMO_SCRIPT, DECISIONS).

## Characters
Pick a colour, face, hat and extra in the Wardrobe (hub), and type a name (a dice button suggests one). Choices are saved in this browser. More items unlock by learning: lifetime stars, qualifying in each domain, answering 50 questions right, finishing weak-spot runs. Locked items can also be bought with coins: the coins you pick up in finished runs go into a bank (shown in the Wardrobe), and a locked item shows its price (stars-locked items cost their star count, at least 5; achievement items cost 20). Demo runs (`?demo=1`) never change progress.

## Daily Challenge
The Daily button in the hub starts today's course: the same for everyone (seed from the UTC date, Normal difficulty, the domain rotates math, science, history, programming). Your best qualified run of the day is recorded as a translucent ghost that you race on later attempts. The hub shows your best time and your streak (consecutive UTC days with a qualified daily). Stored in this browser only (`lywo:daily:v1`, today and yesterday). Daily runs ignore the seen-questions list.
