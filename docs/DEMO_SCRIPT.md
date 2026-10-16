# Demo script (about 3 minutes)

1. Open on live gameplay in the hub. Hook: *"Every learning game is a quiz in a costume. In ours, the maze is the quiz."*
2. Ask a judge to pick a domain. Walk to that portal's NORMAL pad.
3. Answer the first Door Rush correctly (confetti).
4. Pick a wrong door on purpose: trapdoor → detour → explanation → retry → back on the main path. Point at the slime meter.
5. Crossroads maze: the fog closes in, so you can't read the maze from above. At a junction the answers hang over the corridors. Walk into a wrong one to show the red sign, the dead end and the surge, then take the right corridor.
6. Launch Pads (the demo course pins it right after the crossroads): *"A wall with no door. The answer is where you stand."* Stand on the right pad until the ring fills, and the bean flies over the hedge. Optionally stand on a wrong pad first: it splashes into the slime pond, the pad turns red, and you wade back (the slime surges).
7. Junction Hall: *"The fork is a question."* Answer right and the SHORTCUT gate opens. (A wrong answer opens the SCENIC ROUTE, with the explanation boards at its start.)
8. Rule Minefield (pinned after the fork): *"A rule, and a field of mines."* Read the sign, step only on tiles that fit. Step on a wrong one on purpose: it drops, comes back as a red X, and you land a row back. If you get 3 in a row, point at the power-up (🔥 combo, keys 1–4).
9. Key Hunt (the second maze after the fork): *"The maze exit is locked. Keys with answers hide in the dead ends."* Pick up a key (the minimap shows the ones you have seen), carry it to the gate. A wrong key zaps you back and gets an X; the Compass (key 2) points to the next unchecked key.
10. Win. Show the results card (third star = beat the par time). Press **Run my weak spots**.
11. One architecture slide that mirrors the brief's loop.
12. A QR code on screen: *"Play it now on your phone."*

Safety: use `?demo=1` for a fixed layout. It pins `DEMO_RECIPE` (Door Rush, Crossroads, Launch Pads, Junction Hall, Rule Minefield, Key Hunt, Bridge Builder, Slime Gate), and `fullrun.test.ts` checks that it is winnable both ways through the Junction Hall. Normal runs fill their room slots at random; the "Up ahead" strip during the countdown shows which rooms a run has. For a tour of everything, start the Gauntlet from the hub.
Easy has no fog, timers or crossroads. Use it if a judge wants to play. Keep `?debug=1` ready (G = god mode). Run `npm run preview` as the offline backup. Record a backup video.

## Optional: two-laptop race (about 60 seconds, needs `npm run build && npm run server` on laptop A)
1. Laptop B opens A's LAN address. A presses Play Online, picks Math, Normal, Create race; B types the code and Joins. Both press Ready, A presses Start.
2. Say: "Same course, same moment. Each laptop only simulates its own player, so there is no lag in the controls." Point at B's avatar with its name tag on A's screen, and at the race strip.
3. Send an emote from B (key 8). Let B answer wrong on purpose so A sees B pop into the detour.
4. Both finish. Show the Race tab: podium, standings and the Brainiest / Hot Streak awards ("it rewards accuracy, not only speed"). A presses Race again.
5. Backup: if the venue Wi-Fi blocks laptop-to-laptop traffic, use a phone hotspot; if online fails, skip this segment, solo play never needs the server.
