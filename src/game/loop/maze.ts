import { T } from '../tuning';
import { pick, shuffle, type Rng } from '../rng';

export const MAZE_COLS = 5;

export interface Cell { c: number; r: number }

export interface Maze {
  rows: number;
  /** Column of the exit cell (its north side is open). The entrance is always (2, 0). */
  exitC: number;
  /** wallE[r][c] is true when a wall stands between (c, r) and (c + 1, r); c in 0..3. */
  wallE: boolean[][];
  /** wallN[r][c] is true when a wall stands between (c, r) and (c, r + 1); r in 0..rows-2. */
  wallN: boolean[][];
  deadEnds: Cell[];
  coins: Cell[];
}

/** A wall box in segment-local coordinates (lx across, d depth). */
export interface LocalRect { lx0: number; lx1: number; d0: number; d1: number; post: boolean }

export const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // north (r+1), east, south, west

export function hasWall(m: Maze, c: number, r: number, dc: number, dr: number): boolean {
  if (dc === 1) return m.wallE[r][c];
  if (dc === -1) return m.wallE[r][c - 1];
  if (dr === 1) return m.wallN[r][c];
  return m.wallN[r - 1][c];
}

function setWall(m: Maze, c: number, r: number, dc: number, dr: number, v: boolean): void {
  if (dc === 1) m.wallE[r][c] = v;
  else if (dc === -1) m.wallE[r][c - 1] = v;
  else if (dr === 1) m.wallN[r][c] = v;
  else m.wallN[r - 1][c] = v;
}

export function inBounds(m: Maze, c: number, r: number): boolean {
  return c >= 0 && c < MAZE_COLS && r >= 0 && r < m.rows;
}

/** Number of open sides of a cell. The entrance (south of (2,0)) and exit (north of (exitC,R-1)) count as open. */
export function openSides(m: Maze, c: number, r: number): number {
  let n = 0;
  for (const [dc, dr] of DIRS) {
    if (inBounds(m, c + dc, r + dr) && !hasWall(m, c, r, dc, dr)) n++;
  }
  if (c === 2 && r === 0) n++;
  if (c === m.exitC && r === m.rows - 1) n++;
  return n;
}

function findDeadEnds(m: Maze): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < MAZE_COLS; c++) if (openSides(m, c, r) === 1) out.push({ c, r });
  return out;
}

/** Recursive-backtracker maze (iterative), then braid, then pick coin dead ends (spec §9.7). */
export function generateMaze(rows: number, braidP: number, rng: Rng, exitC = 2): Maze {
  const m: Maze = {
    rows, exitC,
    wallE: Array.from({ length: rows }, () => new Array<boolean>(MAZE_COLS - 1).fill(true)),
    wallN: Array.from({ length: Math.max(0, rows - 1) }, () => new Array<boolean>(MAZE_COLS).fill(true)),
    deadEnds: [], coins: [],
  };
  const visited = Array.from({ length: rows }, () => new Array<boolean>(MAZE_COLS).fill(false));
  const stack: Cell[] = [{ c: 2, r: 0 }];
  visited[0][2] = true;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = DIRS.filter(([dc, dr]) => inBounds(m, cur.c + dc, cur.r + dr) && !visited[cur.r + dr][cur.c + dc]);
    if (options.length === 0) { stack.pop(); continue; }
    const [dc, dr] = pick(options, rng);
    setWall(m, cur.c, cur.r, dc, dr, false);
    visited[cur.r + dr][cur.c + dc] = true;
    stack.push({ c: cur.c + dc, r: cur.r + dr });
  }

  // braid: remove one wall from dead ends, preferring a neighbor that is also a dead end
  const order = shuffle(findDeadEnds(m), rng);
  for (const cell of order) {
    if (openSides(m, cell.c, cell.r) !== 1) continue; // an earlier braid already fixed it
    if (rng() >= braidP) continue;
    const walls = DIRS.filter(([dc, dr]) => inBounds(m, cell.c + dc, cell.r + dr) && hasWall(m, cell.c, cell.r, dc, dr));
    if (walls.length === 0) continue;
    const deadNeighbors = walls.filter(([dc, dr]) => openSides(m, cell.c + dc, cell.r + dr) === 1);
    const [dc, dr] = pick(deadNeighbors.length ? deadNeighbors : walls, rng);
    setWall(m, cell.c, cell.r, dc, dr, false);
  }

  m.deadEnds = findDeadEnds(m);
  const coinCandidates = m.deadEnds.filter((e) => !(e.c === 2 && e.r === 0) && !(e.c === exitC && e.r === rows - 1));
  m.coins = shuffle(coinCandidates, rng).slice(0, T.MAZE_COINS_MAX);
  return m;
}

/** Local center of a cell. */
export function cellCenter(c: number, r: number): { lx: number; d: number } {
  return { lx: -8 + 4 * c, d: 2 + 4 * r };
}

/** All wall boxes of a maze (walls and posts) in segment-local coordinates. Never overlapping. */
export function mazeRects(m: Maze): LocalRect[] {
  const h = T.WALL_T / 2;
  const out: LocalRect[] = [];
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < MAZE_COLS - 1; c++) {
      if (!m.wallE[r][c]) continue;
      const x = -6 + 4 * c;
      out.push({ lx0: x - h, lx1: x + h, d0: 4 * r + h, d1: 4 * r + 4 - h, post: false });
    }
  }
  for (let r = 0; r < m.rows - 1; r++) {
    for (let c = 0; c < MAZE_COLS; c++) {
      if (!m.wallN[r][c]) continue;
      const d = 4 * r + 4;
      out.push({ lx0: -10 + 4 * c + h, lx1: -6 + 4 * c - h, d0: d - h, d1: d + h, post: false });
    }
  }
  for (let c = 1; c <= 4; c++) {
    for (let r = 1; r <= m.rows - 1; r++) {
      const touched = m.wallE[r - 1][c - 1] || m.wallE[r][c - 1] || m.wallN[r - 1][c - 1] || m.wallN[r - 1][c];
      if (!touched) continue;
      const x = -10 + 4 * c, d = 4 * r;
      out.push({ lx0: x - h, lx1: x + h, d0: d - h, d1: d + h, post: true });
    }
  }
  return out;
}

/** BFS over open edges from (2, 0). Returns the number of reachable cells. */
export function reachableCells(m: Maze): number {
  const seen = new Set<number>([2]);
  const q: Cell[] = [{ c: 2, r: 0 }];
  while (q.length) {
    const cur = q.shift()!;
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (!inBounds(m, nc, nr) || hasWall(m, cur.c, cur.r, dc, dr)) continue;
      const k = nr * MAZE_COLS + nc;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ c: nc, r: nr });
    }
  }
  return seen.size;
}

/** Open neighbours of a cell (inside the maze). */
export function openNeighbors(m: Maze, c: number, r: number): [number, number][] {
  return DIRS.filter(([dc, dr]) => inBounds(m, c + dc, r + dr) && !hasWall(m, c, r, dc, dr));
}

/** BFS path over open edges from `from` to `to`, both included. Empty when unreachable. */
export function pathBetween(m: Maze, from: Cell, to: Cell): Cell[] {
  const key = (c: number, r: number) => r * MAZE_COLS + c;
  const prev = new Map<number, number>([[key(from.c, from.r), -1]]);
  const q: Cell[] = [from];
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    if (cur.c === to.c && cur.r === to.r) break;
    for (const [dc, dr] of openNeighbors(m, cur.c, cur.r)) {
      const k = key(cur.c + dc, cur.r + dr);
      if (prev.has(k)) continue;
      prev.set(k, key(cur.c, cur.r));
      q.push({ c: cur.c + dc, r: cur.r + dr });
    }
  }
  if (!prev.has(key(to.c, to.r))) return [];
  const out: Cell[] = [];
  for (let k = key(to.c, to.r); k !== -1; k = prev.get(k)!) out.push({ c: k % MAZE_COLS, r: Math.floor(k / MAZE_COLS) });
  return out.reverse();
}

/** Solution path from the entrance cell (2, 0) to the exit cell. */
export function solutionPath(m: Maze): Cell[] {
  return pathBetween(m, { c: 2, r: 0 }, { c: m.exitC, r: m.rows - 1 });
}

/** Cells reachable through side (dc, dr) of a cell without passing back through it. */
export function branchCells(m: Maze, c: number, r: number, dc: number, dr: number): Cell[] {
  const seen = new Set<number>([r * MAZE_COLS + c, (r + dr) * MAZE_COLS + c + dc]);
  const out: Cell[] = [{ c: c + dc, r: r + dr }];
  for (let qi = 0; qi < out.length; qi++) {
    const cur = out[qi];
    for (const [ec, er] of openNeighbors(m, cur.c, cur.r)) {
      const k = (cur.r + er) * MAZE_COLS + cur.c + ec;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ c: cur.c + ec, r: cur.r + er });
    }
  }
  return out;
}

export interface QuizJunction {
  cell: Cell;
  pathIndex: number;
  /** Side towards the next path cell (the correct corridor). */
  forward: [number, number];
  /** Off-path sides whose branch has at least `minBranch` cells (the wrong corridors). */
  wrong: { dir: [number, number]; size: number }[];
}

export interface QuizMaze { maze: Maze; path: Cell[]; junctions: QuizJunction[] }

/** Junction candidates on the solution path, entrance and exit cells excluded. */
export function junctionCandidates(m: Maze, path: Cell[], minBranch: number): QuizJunction[] {
  const out: QuizJunction[] = [];
  const onPath = new Set(path.map((p) => p.r * MAZE_COLS + p.c));
  for (let i = 1; i < path.length - 1; i++) {
    const { c, r } = path[i];
    const next = path[i + 1];
    const forward: [number, number] = [next.c - c, next.r - r];
    const wrong: QuizJunction['wrong'] = [];
    for (const [dc, dr] of openNeighbors(m, c, r)) {
      if (onPath.has((r + dr) * MAZE_COLS + c + dc)) continue;
      const size = branchCells(m, c, r, dc, dr).length;
      if (size >= minBranch) wrong.push({ dir: [dc, dr], size });
    }
    if (wrong.length) out.push({ cell: { c, r }, pathIndex: i, forward, wrong });
  }
  return out;
}

/** Pick k candidates spread along the path, at least 2 path cells apart. Null if impossible. */
function spread(cands: QuizJunction[], k: number, pathLen: number): QuizJunction[] | null {
  const out: QuizJunction[] = [];
  let last = -Infinity;
  for (let j = 0; j < k; j++) {
    const target = ((j + 1) / (k + 1)) * (pathLen - 1);
    let best: QuizJunction | null = null;
    for (const c of cands) {
      if (c.pathIndex < last + 2) continue;
      // leave room for the junctions still to place
      const later = cands.filter((x) => x.pathIndex >= c.pathIndex + 2).length;
      if (later < k - j - 1) continue;
      if (!best || Math.abs(c.pathIndex - target) < Math.abs(best.pathIndex - target)) best = c;
    }
    if (!best) return null;
    out.push(best);
    last = best.pathIndex;
  }
  return out;
}

/**
 * Crossroads quiz maze (P0-A): a perfect maze (no braiding, so a wrong branch can never
 * reconnect past a later junction) with k junctions on the solution path. Regenerates from the
 * same stream until k junctions fit; falls back to the best attempt.
 */
export function generateQuizMaze(rows: number, k: number, rng: Rng, exitC: number, minBranch: number, maxTries: number): QuizMaze {
  let best: QuizMaze | null = null;
  for (let t = 0; t < maxTries; t++) {
    const maze = generateMaze(rows, 0, rng, exitC);
    const path = solutionPath(maze);
    const cands = junctionCandidates(maze, path, minBranch);
    for (let n = Math.min(k, cands.length); n >= 1; n--) {
      const picked = spread(cands, n, path.length);
      if (!picked) continue;
      const qm = { maze, path, junctions: picked };
      if (n === k) return qm;
      if (!best || picked.length > best.junctions.length) best = qm;
      break;
    }
  }
  if (!best) throw new Error(`no quiz maze with a junction (rows ${rows})`);
  return best;
}
