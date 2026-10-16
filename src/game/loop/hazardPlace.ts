import { T } from '../tuning';
import { pick, shuffle, type Rng } from '../rng';
import type { Difficulty, Hazard, HazardKind, WallBox } from '../types';
import { MAZE_COLS, hasWall, inBounds, openSides, type Maze } from './maze';

/**
 * Hazard placement (F4-4). Own file and own random stream (`stream(seed, 'hazards')`), so adding or
 * removing hazards never shifts the layout draws of the anchors. Called from the plain maze and the
 * plain corridor builders only (never rooms, quiz mazes or Key Hunt).
 */

export interface HazardSink {
  difficulty: Difficulty;
  hazRng: Rng;
  hazards: Hazard[];
}

interface SegLike { index: number; laneX: number; z0: number }

/** Local (lx, d) of a maze cell centre, as in `maze.cellCenter` (kept here to avoid a cycle with segments). */
function cellLocal(c: number, r: number): { lx: number; d: number } {
  return { lx: -8 + 4 * c, d: 2 + 4 * r };
}

function add(g: HazardSink, seg: SegLike, kind: HazardKind, lx: number, d: number, hw: number, hd: number): void {
  const rng = g.hazRng;
  let head: WallBox | null = null;
  const x = seg.laneX + lx, z = seg.z0 - d;
  if (kind === 'hammer') {
    head = {
      id: 100000 + g.hazards.length, minX: x - T.HAMMER_HW, maxX: x + T.HAMMER_HW, minY: 0, maxY: T.HAMMER_H,
      minZ: z - T.HAMMER_HD, maxZ: z + T.HAMMER_HD, kind: 'invisible', enabled: true, isStatic: false,
    };
  }
  g.hazards.push({
    id: g.hazards.length, kind, segIndex: seg.index, x, z, hw, hd,
    phase: rng() * Math.PI * 2, dir: rng() < 0.5 ? 1 : -1, head,
  });
}

/** Maze: `HAZARDS_PER_MAZE` hazards in distinct cells, never the entrance or the exit cell. */
export function placeMazeHazards(g: HazardSink, seg: SegLike, m: Maze): void {
  const want = T.HAZARDS_PER_MAZE[g.difficulty];
  if (want <= 0) return;
  const cells: { c: number; r: number }[] = [];
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < MAZE_COLS; c++) {
      if (c === 2 && r === 0) continue;
      if (c === m.exitC && r === m.rows - 1) continue;
      if (openSides(m, c, r) >= 2) cells.push({ c, r });
    }
  }
  const open = (c: number, r: number, dc: number, dr: number) => inBounds(m, c + dc, r + dr) && !hasWall(m, c, r, dc, dr);
  let placed = 0;
  for (const cell of shuffle(cells, g.hazRng)) {
    if (placed >= want) break;
    const { lx, d } = cellLocal(cell.c, cell.r);
    const x = seg.laneX + lx, z = seg.z0 - d;
    // not right next to another hazard of this maze
    if (g.hazards.some((h) => h.segIndex === seg.index && Math.abs(h.x - x) + Math.abs(h.z - z) < 5)) continue;
    const straightNS = open(cell.c, cell.r, 0, 1) && open(cell.c, cell.r, 0, -1) && !open(cell.c, cell.r, 1, 0) && !open(cell.c, cell.r, -1, 0);
    const kinds: HazardKind[] = straightNS ? ['hammer', 'ice', 'sweeper'] : ['sweeper', 'ice'];
    const kind = pick(kinds, g.hazRng);
    if (kind === 'sweeper') add(g, seg, kind, lx, d, T.SWEEPER_LEN / 2, 0);
    else if (kind === 'hammer') add(g, seg, kind, lx, d, T.HAMMER_AMP, 0);
    else add(g, seg, kind, lx, d, T.ICE_CELL_HALF, T.ICE_CELL_HALF);
    placed++;
  }
}

/** Corridor: sweepers and ice patches spread along its length (no hammers: the corridor is 20 m wide). */
export function placeCorridorHazards(g: HazardSink, seg: SegLike & { depth: number }): void {
  const want = T.HAZARDS_PER_CORRIDOR[g.difficulty];
  if (want <= 0 || seg.depth < 10) return;
  const ds: number[] = [];
  for (let tries = 0; tries < 20 && ds.length < want; tries++) {
    const d = 4 + g.hazRng() * (seg.depth - 8);
    if (ds.some((x) => Math.abs(x - d) < 6)) continue;
    ds.push(d);
  }
  for (const d of ds) {
    const lx = (g.hazRng() * 2 - 1) * 6;
    if (g.hazRng() < 0.5) add(g, seg, 'sweeper', lx, d, T.SWEEPER_LEN / 2, 0);
    else add(g, seg, 'ice', lx, d, T.ICE_CORRIDOR_HW, T.ICE_CORRIDOR_HD);
  }
}
