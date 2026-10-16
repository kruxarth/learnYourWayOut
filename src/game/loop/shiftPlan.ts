import { T } from '../tuning';
import { DIRS, MAZE_COLS, hasWall, inBounds, pathBetween, reachableCells, type Cell, type Maze } from './maze';

/**
 * Shifting Maze (F4-9), the pure part: which hedges to move. A hedge is an edge between two neighbouring
 * cells: 'E' between (c, r) and (c + 1, r), 'N' between (c, r) and (c, r + 1). Every plan is checked before it
 * is applied: afterwards the exit must still be reachable from the player's cell and from every cell, i.e. the
 * cell graph stays connected (`reachableCells` from the entrance sees every cell too).
 */

export interface Edge { kind: 'E' | 'N'; c: number; r: number }
export interface ShiftPlan { close: Edge[]; open: Edge[] }

export const edgeKey = (e: Edge): string => `${e.kind}${e.c},${e.r}`;
const cellKey = (c: number, r: number): number => r * MAZE_COLS + c;

export function allEdges(rows: number): Edge[] {
  const out: Edge[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < MAZE_COLS - 1; c++) out.push({ kind: 'E', c, r });
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < MAZE_COLS; c++) out.push({ kind: 'N', c, r });
  return out;
}

export function edgeCells(e: Edge): [Cell, Cell] {
  return e.kind === 'E' ? [{ c: e.c, r: e.r }, { c: e.c + 1, r: e.r }] : [{ c: e.c, r: e.r }, { c: e.c, r: e.r + 1 }];
}

/** The edge between two neighbouring cells. */
export function edgeBetween(a: Cell, b: Cell): Edge {
  if (a.r === b.r) return { kind: 'E', c: Math.min(a.c, b.c), r: a.r };
  return { kind: 'N', c: a.c, r: Math.min(a.r, b.r) };
}

export function isClosed(m: Maze, e: Edge): boolean {
  return e.kind === 'E' ? m.wallE[e.r][e.c] : m.wallN[e.r][e.c];
}

export function setClosed(m: Maze, e: Edge, closed: boolean): void {
  if (e.kind === 'E') m.wallE[e.r][e.c] = closed; else m.wallN[e.r][e.c] = closed;
}

export function cloneMaze(m: Maze): Maze {
  return { ...m, wallE: m.wallE.map((r) => r.slice()), wallN: m.wallN.map((r) => r.slice()), deadEnds: [], coins: [] };
}

/** BFS distances (in cells) from `from` over open edges. -1 = unreachable. Indexed by `r * 5 + c`. */
export function distancesFrom(m: Maze, from: Cell): Int16Array {
  const dist = new Int16Array(m.rows * MAZE_COLS).fill(-1);
  const q: Cell[] = [from];
  dist[cellKey(from.c, from.r)] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (!inBounds(m, nc, nr) || hasWall(m, cur.c, cur.r, dc, dr)) continue;
      const k = cellKey(nc, nr);
      if (dist[k] >= 0) continue;
      dist[k] = dist[cellKey(cur.c, cur.r)] + 1;
      q.push({ c: nc, r: nr });
    }
  }
  return dist;
}

/** Number of cells reachable from `from`. */
export function reachableFrom(m: Maze, from: Cell): number {
  let n = 0;
  for (const d of distancesFrom(m, from)) if (d >= 0) n++;
  return n;
}

export const exitCell = (m: Maze): Cell => ({ c: m.exitC, r: m.rows - 1 });

/**
 * The invariant: the exit is reachable from the player's cell and from every cell. Equivalent to the cell graph
 * being connected; `reachableCells` (the entrance's view) must agree.
 */
export function exitAlwaysReachable(m: Maze, player: Cell): boolean {
  const all = m.rows * MAZE_COLS;
  const fromExit = distancesFrom(m, exitCell(m));
  for (const d of fromExit) if (d < 0) return false; // some cell cannot reach the exit
  return fromExit[cellKey(player.c, player.r)] >= 0 && reachableCells(m) === all;
}

/** Apply a plan to a copy; null when the result would break the invariant. */
export function trial(m: Maze, plan: ShiftPlan, player: Cell): Maze | null {
  const w = cloneMaze(m);
  for (const e of plan.close) setClosed(w, e, true);
  for (const e of plan.open) setClosed(w, e, false);
  return exitAlwaysReachable(w, player) ? w : null;
}

function dist(m: Maze, a: Cell, b: Cell): number {
  return distancesFrom(m, a)[cellKey(b.c, b.r)];
}

/**
 * Right answer: open up to `T.SHIFT_OPEN_MAX` hedges, each the one that shortens the way from `player` to the exit
 * the most (at least `T.SHIFT_MIN_SAVING` cells). Empty when the way is already as short as it gets.
 */
export function planRight(m: Maze, player: Cell): ShiftPlan {
  const plan: ShiftPlan = { close: [], open: [] };
  let work = cloneMaze(m);
  const exit = exitCell(m);
  for (let n = 0; n < T.SHIFT_OPEN_MAX; n++) {
    const dp = distancesFrom(work, player), de = distancesFrom(work, exit);
    const base = dp[cellKey(exit.c, exit.r)];
    let best: Edge | null = null, bestSave = 0;
    for (const e of allEdges(m.rows)) {
      if (!isClosed(work, e)) continue;
      const [a, b] = edgeCells(e);
      const via = Math.min(dp[cellKey(a.c, a.r)] + 1 + de[cellKey(b.c, b.r)], dp[cellKey(b.c, b.r)] + 1 + de[cellKey(a.c, a.r)]);
      const save = base - via;
      if (save > bestSave) { bestSave = save; best = e; }
    }
    if (!best || bestSave < T.SHIFT_MIN_SAVING) break;
    setClosed(work, best, false);
    plan.open.push(best);
    work = cloneMaze(work);
  }
  return plan;
}

/**
 * Wrong answer: close the way ahead (a hedge two or more cells along the shortest path to the exit, at least
 * `T.SHIFT_MARGIN` m from the player, said by `canClose`) and open a hedge that reconnects the maze by a longer
 * route (at most `T.SHIFT_MAX_DETOUR` cells longer when one exists). In a maze with loops the closed hedge may
 * leave a detour already; a second hedge on the new shortest path then closes too (2 to 3 moves in all).
 * Null when the player is too close to the exit for there to be anything to close.
 */
export function planWrong(m: Maze, player: Cell, canClose: (e: Edge) => boolean): ShiftPlan | null {
  const exit = exitCell(m);
  const path = pathBetween(m, player, exit);
  const L0 = path.length - 1;
  if (L0 < 3) return null;
  const order: number[] = [];
  for (let i = 2; i <= L0 - 1; i++) order.push(i);
  order.push(1);
  for (const i of order) {
    if (i > L0 - 1) continue;
    const e1 = edgeBetween(path[i], path[i + 1]);
    if (!canClose(e1)) continue;
    const plan: ShiftPlan = { close: [e1], open: [] };
    let work = cloneMaze(m);
    setClosed(work, e1, true);
    if (reachableFrom(work, player) < m.rows * MAZE_COLS) {
      // cut: reconnect with the hedge that makes the way longest within the allowed detour
      let best: Edge | null = null, bestLen = -1, fallback: Edge | null = null, fallbackLen = Infinity;
      for (const f of allEdges(m.rows)) {
        if (!isClosed(work, f)) continue;
        setClosed(work, f, false);
        if (reachableFrom(work, player) === m.rows * MAZE_COLS) {
          const len = dist(work, player, exit);
          if (len > L0 && len <= L0 + T.SHIFT_MAX_DETOUR && len > bestLen) { best = f; bestLen = len; }
          if (len > L0 && len < fallbackLen) { fallback = f; fallbackLen = len; }
        }
        setClosed(work, f, true);
      }
      const pickOpen = best ?? fallback;
      if (!pickOpen) continue;
      plan.open.push(pickOpen);
      setClosed(work, pickOpen, false);
    }
    // a second hedge across the new way, when the maze has a loop to take instead
    const path2 = pathBetween(work, player, exit);
    for (let j = 1; j < path2.length - 1 && plan.close.length + plan.open.length < 3; j++) {
      const e2 = edgeBetween(path2[j], path2[j + 1]);
      if (!canClose(e2) || edgeKey(e2) === edgeKey(e1)) continue;
      setClosed(work, e2, true);
      if (reachableFrom(work, player) === m.rows * MAZE_COLS) { plan.close.push(e2); break; }
      setClosed(work, e2, false);
    }
    if (trial(m, plan, player) && dist(work, player, exit) > L0) return plan;
  }
  return null;
}
