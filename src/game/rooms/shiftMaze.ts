import type { McqQuestion, TfQuestion } from '../../content/schema';
import { pushToast } from '../../ui/store';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { MazeInfo } from '../types';
import type { PlateRT, RoomRuntime, ShiftRT, ShrineRT } from '../runtime';
import type { Cell, Maze } from '../loop/maze';
import { pushback, surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';
import { planRight, planWrong, setClosed, trial, type Edge, type ShiftPlan } from '../loop/shiftPlan';

/**
 * Shifting Maze (F4-9). Two switch shrines stand on cells of the solution path. Walking into a shrine's cell
 * asks its question; the answers are 2 or 3 pressure plates inside the cell (stand on one for a moment). A right
 * plate slides hedges away to open a shortcut toward the exit. A wrong plate slides 2 or 3 hedges to close the way
 * ahead and open a longer one, and costs a surge. A shrine works once. The shrines are optional: walk past and
 * nothing happens. Every change is checked first (`shiftPlan.ts`): the exit stays reachable from the player's cell
 * and from every cell. The hedges are dynamic walls; the maze's wall arrays (shared with the minimap and the
 * compass) are updated with them.
 */

// plate offsets from the cell centre (world x, z): two side by side, a third behind; 2-plate shrines use the first two
const PLATE_OFFSETS: [number, number][] = [[-0.95, 0.7], [0.95, 0.7], [0, -0.95]];

function mazeOf(room: RoomRuntime): MazeInfo {
  const m = needRun().course.mazes.find((x) => x.segIndex === room.layout.segIndex);
  if (!m) throw new Error('shifting maze has no maze info');
  return m;
}

/** The live maze: shares the wall arrays with the MazeInfo (minimap, compass). */
export function liveMaze(room: RoomRuntime): Maze {
  const m = mazeOf(room);
  return { rows: m.rows, exitC: m.exitC, wallE: m.wallE, wallN: m.wallN, deadEnds: [], coins: [] };
}

/** The maze cell under a world position. */
export function cellAt(room: RoomRuntime, x: number, z: number): Cell {
  const L = room.layout;
  const c = Math.min(4, Math.max(0, Math.floor((x - L.laneX + 10) / 4)));
  const r = Math.min(L.shift!.rows - 1, Math.max(0, Math.floor((L.z0 - z) / 4)));
  return { c, r };
}

export function activate(room: RoomRuntime): void {
  beginRoom(room);
  room.question = null;
  room.wrongCount = 0;
  const shift: ShiftRT = {
    moves: 0,
    shrines: room.layout.shift!.shrines.map((): ShrineRT => ({ state: 'idle', question: null, plates: [], right: null })),
  };
  room.shift = shift;
}

function startAsking(room: RoomRuntime, k: number): void {
  const run = needRun();
  const S = room.shift!, sh = S.shrines[k], at = room.layout.shift!.shrines[k];
  if (!sh.question) {
    // two plates for a true/false, three for an mcq
    const q = pickQuestion(room, ['mcq', 'truefalse'], 0) as McqQuestion | TfQuestion;
    sh.question = q;
    let labels: { label: string; correct: boolean }[];
    if (q.type === 'truefalse') {
      labels = [{ label: 'TRUE', correct: q.answer }, { label: 'FALSE', correct: !q.answer }];
      if (run.qRng() < 0.5) labels.reverse();
    } else {
      const wrong = shuffle(q.distractors, run.qRng).slice(0, T.SHIFT_MCQ_PLATES - 1).map((label) => ({ label, correct: false }));
      labels = shuffle([{ label: q.answer, correct: true }, ...wrong], run.qRng);
    }
    sh.plates = labels.map((l, i): PlateRT => ({
      x: at.x + PLATE_OFFSETS[i][0], z: at.z + PLATE_OFFSETS[i][1], label: l.label, correct: l.correct, state: 'idle', charge: 0,
    }));
    room.activatedAtMs = run.elapsedMs;
    room.fiftyUsed = false; room.hintUsed = false; room.hintShown = null;
  }
  sh.state = 'asking';
  room.question = sh.question;
  room.feedback = null;
  run.activeRoomId = room.id;
  syncRoomPanel();
}

function pause(room: RoomRuntime, sh: ShrineRT): void {
  sh.state = 'idle';
  for (const p of sh.plates) p.charge = 0;
  room.question = null;
  room.feedback = null;
  syncRoomPanel();
}

/** Hedges to world wall boxes: close = enabled. */
function applyPlan(room: RoomRuntime, plan: ShiftPlan): void {
  const run = needRun();
  const L = room.layout.shift!;
  const maze = liveMaze(room);
  const wall = (e: Edge) => run.world.walls[e.kind === 'E' ? L.edgesE[e.r][e.c] : L.edgesN[e.r][e.c]];
  for (const e of plan.close) { setClosed(maze, e, true); wall(e).enabled = true; }
  for (const e of plan.open) { setClosed(maze, e, false); wall(e).enabled = false; }
  room.shift!.moves += plan.close.length + plan.open.length;
}

/** Is a hedge far enough from the player to close it without squashing them? */
function farFromPlayer(room: RoomRuntime, e: Edge): boolean {
  const L = room.layout;
  const p = G.player.pos;
  const h = T.WALL_T / 2;
  // the hedge box in world coordinates (mirrors shiftBuild.ts)
  let lx0: number, lx1: number, d0: number, d1: number;
  if (e.kind === 'E') { const x = -6 + 4 * e.c; lx0 = x - h; lx1 = x + h; d0 = 4 * e.r + h; d1 = 4 * e.r + 4 - h; }
  else { const d = 4 * e.r + 4; lx0 = -10 + 4 * e.c + h; lx1 = -6 + 4 * e.c - h; d0 = d - h; d1 = d + h; }
  const minX = L.laneX + lx0, maxX = L.laneX + lx1, minZ = L.z0 - d1, maxZ = L.z0 - d0;
  const cx = Math.min(Math.max(p.x, minX), maxX), cz = Math.min(Math.max(p.z, minZ), maxZ);
  return Math.hypot(p.x - cx, p.z - cz) >= T.PLAYER_RADIUS + T.SHIFT_MARGIN;
}

function choose(room: RoomRuntime, k: number, plate: PlateRT): void {
  const run = needRun();
  const sh = room.shift!.shrines[k];
  const q = sh.question as McqQuestion | TfQuestion;
  const pl = G.player.pos;
  const at = { x: pl.x, y: 1.2, z: pl.z };
  const maze = liveMaze(room);
  const here = cellAt(room, pl.x, pl.z);
  for (const p of sh.plates) p.charge = 0;
  sh.state = 'done';
  sh.right = plate.correct;
  plate.state = plate.correct ? 'right' : 'wrong';
  room.question = null;
  if (plate.correct) {
    const rec = startRecord(room, q, true, room.activatedAtMs);
    room.record = rec;
    const plan = planRight(maze, here);
    const ok = plan.open.length > 0 && trial(maze, plan, here) !== null;
    if (ok) applyPlan(room, plan);
    celebrate(room, at, true);
    if (!ok) pushback(); // no shortcut left to open: a little extra slime pushback instead
    pushToast(ok ? 'Right! The hedges slide open.' : 'Right! Already the shortest way - slime pushed back.', 'good', 2200);
    room.feedback = null;
  } else {
    const rec = startRecord(room, q, false, room.activatedAtMs);
    room.record = rec;
    room.wrongCount++;
    surge(T.SHIFT_WRONG_SURGE);
    for (const p of sh.plates) if (p.correct) p.state = 'right'; // show the answer
    const plan = planWrong(maze, here, (e) => farFromPlayer(room, e));
    const ok = !!plan && trial(maze, plan, here) !== null;
    if (ok && plan) applyPlan(room, plan);
    G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: true, ...at });
    pushToast(ok ? `Wrong! "${plate.label}" - the hedges close in.` : `Wrong! "${plate.label}" is not it.`, 'bad', 2400);
    pushToast(`It was "${q.type === 'truefalse' ? (q.answer ? 'TRUE' : 'FALSE') : q.answer}". ${q.hint}`, 'info', 4200);
  }
  run.activeRoomId = room.id;
  if (room.shift!.shrines.every((s) => s.state === 'done')) {
    resolveRoom(room, room.wrongCount === 0 ? 'correct' : 'remediated');
  }
  syncRoomPanel();
}

export function step(room: RoomRuntime, h: number): void {
  const S = room.shift;
  if (!S || room.state !== 'active') return;
  const run = needRun();
  if (run.phase !== 'playing') return;
  // leaving the maze ends the room, answered or not
  if (run.segIndex > room.layout.segIndex) {
    for (const sh of S.shrines) if (sh.state === 'asking') pause(room, sh);
    resolveRoom(room, room.wrongCount === 0 ? 'correct' : 'remediated');
    return;
  }
  const p = G.player.pos;
  const L = room.layout.shift!;
  for (let k = 0; k < S.shrines.length; k++) {
    const sh = S.shrines[k], at = L.shrines[k];
    if (sh.state === 'done') continue;
    const d = Math.max(Math.abs(p.x - at.x), Math.abs(p.z - at.z));
    if (sh.state === 'idle') {
      if (d <= T.SHIFT_CELL_R && !run.detour && !S.shrines.some((o) => o.state === 'asking')) startAsking(room, k);
    } else if (d > T.SHIFT_LEAVE_R) {
      pause(room, sh);
    } else if (!G.player.inputLocked && G.player.grounded) {
      for (const pl of sh.plates) {
        if (pl.state !== 'idle') continue;
        if (Math.hypot(p.x - pl.x, p.z - pl.z) <= T.SHIFT_PLATE_R) pl.charge += h / T.SHIFT_CHARGE_S;
        else pl.charge = Math.max(0, pl.charge - h * T.SHIFT_DECAY);
        if (pl.charge >= 1) { choose(room, k, pl); return; }
      }
    }
  }
}

function asking(room: RoomRuntime): ShrineRT | undefined {
  return room.shift?.shrines.find((s) => s.state === 'asking');
}

/** A 50/50 (or X-ray) crosses out one wrong plate of the shrine that is asking. */
export function canFifty(room: RoomRuntime): boolean {
  const sh = asking(room);
  return !!sh && sh.plates.some((p) => !p.correct && p.state === 'idle');
}

export function applyFifty(room: RoomRuntime): boolean {
  const sh = asking(room);
  if (!sh) return false;
  const wrong = sh.plates.filter((p) => !p.correct && p.state === 'idle');
  if (!wrong.length) return false;
  wrong[Math.floor(needRun().qRng() * wrong.length)].state = 'wrong';
  return true;
}
