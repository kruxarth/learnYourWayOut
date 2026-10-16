import { T } from '../tuning';
import type { SegmentInfo } from '../types';
import { MAZE_COLS, cellCenter, generateMaze, pathBetween, type Maze } from './maze';
import {
  Gen, buildSegmentEnter, buildSideWalls, buildSouthWall, emptyRoom, exitColumn, mazeRowsFor, rectToWorld, toWorld,
} from './segments';

const H = T.WALL_T / 2;

/** Cells of the solution path that hold the two shrines: about a third and two thirds of the way. */
export function shrineCells(path: { c: number; r: number }[]): { c: number; r: number }[] {
  const n = path.length;
  const a = Math.max(2, Math.round(n * 0.3));
  const b = Math.min(n - 3, Math.max(a + 3, Math.round(n * 0.65)));
  return [path[a], path[b]];
}

/**
 * Shifting Maze (F4-9): a plain-sized maze in which every interior hedge is a dynamic wall (enabled when the
 * edge is closed), so the shrines can slide any of them. The corner posts stay put. Two switch shrines stand on
 * cells of the solution path. The maze's wall arrays are the live ones: the minimap and the compass read them.
 */
export function buildShiftMaze(g: Gen, seg: SegmentInfo): void {
  const rows = mazeRowsFor(g.difficulty, seg.depth);
  const exitC = exitColumn(g);
  let maze: Maze | null = null;
  let path: { c: number; r: number }[] = [];
  for (let t = 0; t < 20; t++) {
    maze = generateMaze(rows, T.SHIFT_BRAID[g.difficulty], g.rng, exitC);
    path = pathBetween(maze, { c: 2, r: 0 }, { c: exitC, r: rows - 1 });
    if (path.length >= 9) break;
  }
  const m = maze!;
  const shrines = shrineCells(path);

  buildSouthWall(g, seg, 'hedge', T.H_HEDGE, [[-T.OPENING_HALF, T.OPENING_HALF]]);
  buildSideWalls(g, seg, 'hedge', T.H_HEDGE);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), g.nextFloorColor());
  const edgesE: number[][] = [], edgesN: number[][] = [];
  for (let r = 0; r < rows; r++) {
    edgesE.push([]);
    for (let c = 0; c < MAZE_COLS - 1; c++) {
      const x = -6 + 4 * c;
      edgesE[r].push(g.wall('hedge', rectToWorld(seg, x - H, x + H, 4 * r + H, 4 * r + 4 - H), T.H_HEDGE, { isStatic: false, enabled: m.wallE[r][c] }).id);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    edgesN.push([]);
    for (let c = 0; c < MAZE_COLS; c++) {
      const d = 4 * r + 4;
      edgesN[r].push(g.wall('hedge', rectToWorld(seg, -10 + 4 * c + H, -6 + 4 * c - H, d - H, d + H), T.H_HEDGE, { isStatic: false, enabled: m.wallN[r][c] }).id);
    }
  }
  for (let c = 1; c <= MAZE_COLS - 1; c++) {
    for (let r = 1; r <= rows - 1; r++) {
      const x = -10 + 4 * c, d = 4 * r;
      g.wall('hedge', rectToWorld(seg, x - H, x + H, d - H, d + H), T.H_HEDGE);
    }
  }
  const top = 4 * rows;
  if (seg.depth > top + 1e-6) {
    const a = -10 + 4 * exitC + H, b = -6 + 4 * exitC - H;
    if (a > -10 + H + 1e-6) g.wall('hedge', rectToWorld(seg, -10 + H, a, top - H, top + H), T.H_HEDGE);
    if (b < 10 - H - 1e-6) g.wall('hedge', rectToWorld(seg, b, 10 - H, top - H, top + H), T.H_HEDGE);
  }
  // coins, but not in a shrine cell
  for (const cell of m.coins) {
    if (shrines.some((s) => s.c === cell.c && s.r === cell.r)) continue;
    const { lx, d } = cellCenter(cell.c, cell.r);
    const p = toWorld(seg, lx, d);
    g.coin(p.x, 0.8, p.z);
  }
  g.deadEnds += m.deadEnds.length;
  g.mazes.push({
    segIndex: seg.index, laneX: seg.laneX, z0: seg.z0, depth: seg.depth, rows, exitC, wallE: m.wallE, wallN: m.wallN, path: [],
  });
  buildSegmentEnter(g, seg);

  const room = emptyRoom(seg.roomId!, 'shiftMaze', seg, 0, null);
  g.trigger(rectToWorld(seg, -10, 10, 0.8, 3), 'roomActivate', { roomId: room.id }, true);
  room.shift = {
    rows, exitC, edgesE, edgesN,
    shrines: shrines.map((s) => {
      const { lx, d } = cellCenter(s.c, s.r);
      return { c: s.c, r: s.r, ...toWorld(seg, lx, d) };
    }),
  };
  g.rooms.push(room);
}
