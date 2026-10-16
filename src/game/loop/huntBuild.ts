import { shuffle } from '../rng';
import { T } from '../tuning';
import type { SegmentInfo } from '../types';
import { cellCenter, generateMaze, type Cell, type Maze } from './maze';
import { Gen, emptyRoom, exitColumn, mazeRowsFor, placeMaze, rectToWorld, toWorld } from './segments';

/** Dead ends that can hold a key: not the entrance cell and not the exit cell. */
export function keyCandidates(m: Maze): Cell[] {
  return m.deadEnds.filter((e) => !(e.c === 2 && e.r === 0) && !(e.c === m.exitC && e.r === m.rows - 1));
}

/**
 * Key Hunt (F4-3): a plain maze whose exit is a locked gate. The keys lie in dead ends (the cells
 * that would otherwise hold coins) and are labelled at activation. Same depth as a plain maze.
 */
export function buildKeyHunt(g: Gen, seg: SegmentInfo): void {
  const rows = mazeRowsFor(g.difficulty, seg.depth);
  const exitC = exitColumn(g);
  const want = T.HUNT_KEYS[g.difficulty];
  let maze: Maze | null = null;
  for (let t = 0; t < T.HUNT_TRIES; t++) {
    const m = generateMaze(rows, T.HUNT_BRAID[g.difficulty], g.rng, exitC);
    if (!maze || keyCandidates(m).length > keyCandidates(maze).length) maze = m;
    if (keyCandidates(maze).length >= want) break;
  }
  const m = maze!;
  const picked = shuffle(keyCandidates(m), g.rng).slice(0, want);
  // keys replace coins in their dead ends
  m.coins = m.coins.filter((c) => !picked.some((p) => p.c === c.c && p.r === c.r));
  placeMaze(g, seg, m, []);

  const H = T.WALL_T / 2;
  const top = 4 * rows;
  const gate = g.wall('gate', rectToWorld(seg, -10 + 4 * exitC + H, -6 + 4 * exitC - H, top - T.HUNT_GATE_D - H, top - T.HUNT_GATE_D + H),
    T.H_ROOM, { isStatic: false, enabled: true });

  const room = emptyRoom(seg.roomId!, 'keyHunt', seg, 0, null);
  g.trigger(rectToWorld(seg, -10, 10, 0.8, 3), 'roomActivate', { roomId: room.id }, true);
  const gp = toWorld(seg, -8 + 4 * exitC, top - T.HUNT_GATE_D);
  room.hunt = {
    gateWallId: gate.id, gate: gp,
    spots: picked.map((c) => {
      const { lx, d } = cellCenter(c.c, c.r);
      return { ...toWorld(seg, lx, d), c: c.c, r: c.r };
    }),
  };
  g.rooms.push(room);
}

