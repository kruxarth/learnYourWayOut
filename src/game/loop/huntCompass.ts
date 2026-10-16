import { G } from '../state';
import type { RunState } from '../runtime';
import type { MazeInfo } from '../types';
import { pathBetween, type Cell, type Maze } from './maze';

const out = { x: 0, z: 0 };

/**
 * Key Hunt compass: inside a Key Hunt maze it points to the nearest key that has not been checked yet
 * (still in its dead end), or to the gate while you carry a key. Null elsewhere, so the normal
 * "way out of the maze" arrow applies. Returns a shared object.
 */
export function huntCompassTarget(run: RunState, m: MazeInfo, x: number, z: number): { x: number; z: number } | null {
  const room = run.rooms.find((r) => r.kind === 'keyHunt' && r.layout.segIndex === m.segIndex);
  if (!room || room.state !== 'active' || !room.layout.hunt) return null;
  const H = room.layout.hunt;
  const maze: Maze = { rows: m.rows, exitC: m.exitC, wallE: m.wallE, wallN: m.wallN, deadEnds: [], coins: [] };
  const c = Math.min(4, Math.max(0, Math.floor((x - m.laneX + 10) / 4)));
  const r = Math.min(m.rows - 1, Math.max(0, Math.floor((m.z0 - z) / 4)));
  const here: Cell = { c, r };
  const cellXZ = (cell: Cell) => { out.x = m.laneX - 8 + 4 * cell.c; out.z = m.z0 - (2 + 4 * cell.r); return out; };

  let goal: Cell | null = null;
  let aim: { x: number; z: number } | null = null;
  if (room.keys.some((k) => k.id === G.player.carrying)) {
    goal = { c: m.exitC, r: m.rows - 1 };
    aim = H.gate;
  } else {
    let best = Infinity;
    room.keys.forEach((k, i) => {
      if (k.state !== 'home') return;
      const spot = H.spots[i];
      const len = pathBetween(maze, here, { c: spot.c, r: spot.r }).length;
      if (len > 0 && len < best) { best = len; goal = { c: spot.c, r: spot.r }; aim = k.home; }
    });
  }
  if (!goal || !aim) return null;
  const g = goal as Cell;
  if (g.c === c && g.r === r) { out.x = aim.x; out.z = aim.z; return out; }
  const path = pathBetween(maze, here, g);
  if (path.length < 2) return null;
  return cellXZ(path[1]);
}
