import { engine } from '../game/engine';
import { panelCenter } from '../game/rooms/doorCarousel';
import { hammerOffset, segDistSq, sweeperAngle } from '../game/loop/hazards';
import { pathBetween } from '../game/loop/maze';
import { exitCell } from '../game/loop/shiftPlan';
import { cellAt, liveMaze } from '../game/rooms/shiftMaze';
import { mulberry32, type Rng } from '../game/rng';
import type { RoomRuntime, RunState, TileRT } from '../game/runtime';
import { G } from '../game/state';
import { T } from '../game/tuning';
import { params } from '../game/urlParams';
import type { Difficulty, DomainId, SegmentInfo } from '../game/types';
import { boot, steer, update } from './helpers';

/**
 * A headless player for whole runs, driving the real controller. Used by the full-run test
 * (perfect play) and the balance harness (p-accuracy players and pure guessers).
 */

export class Eliminated extends Error {}

export interface BotOpts {
  /** Chance of answering a question right (ignored when `guess`). */
  accuracy?: number;
  /** Pick uniformly among the options instead. */
  guess?: boolean;
  /** Free fork (Easy): which lane to take. Junction Halls pick the lane from the answer. */
  route?: 'short' | 'long';
  /** Force the Junction Hall answer (full-run test): right → short, wrong → long. */
  junctionRight?: boolean;
  /** Seconds spent reading each question before moving. */
  thinkSec?: number;
  /** Clamp the slime to 0.4 after every segment (tests that only check the walk). */
  keepAlive?: boolean;
  rng?: Rng;
  domain?: DomainId;
  /** Run mode, e.g. 'gauntlet'. */
  mode?: 'gauntlet';
  /** Last room: 'hex' plays the Hex Finale instead of the Slime Gate. */
  finale?: 'gate' | 'hex';
  /** Build the pinned `?demo=1` course instead of the pool-resolved one. */
  demo?: boolean;
  /** Build the fixed pre-pool recipe. */
  classic?: boolean;
  /** Gold Door: 'take' runs into the star door after a right Door Rush answer and answers its bonus question (right or wrong like any question). Default: skip. */
  gold?: 'take' | 'skip';
  /** Room kinds the bot answers wrongly first (when it has the choice), whatever its accuracy. */
  wrongFirst?: string[];
  /** Walk straight through sweepers and hammers (eats hits) instead of waiting for a safe moment. */
  ignoreHazards?: boolean;
}

export interface BotResult {
  run: RunState;
  eliminated: boolean;
  timeS: number;
  slime: number;
  route: 'short' | 'long' | null;
  /** Bot time (s) spent in each segment, including the walk to the next one. Indexed by segment. */
  segTimes: number[];
}

const RES = 0.25;
const R = T.PLAYER_RADIUS + 0.07;
const DT = 1 / 60;

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

declare const process: { env: Record<string, string | undefined> };

function run(): RunState { return G.run!; }

function alive(): void {
  if (run().phase === 'lost') { steer(0, 0); throw new Eliminated(); }
}

function tick(): void {
  update(DT);
  alive();
}

function wait(sec: number): void {
  steer(0, 0);
  for (let i = 0; i < Math.round(sec / DT); i++) tick();
}

/** Wait until input is unlocked and the run is playing (after falls, fades and detours). */
function settle(maxSec = 10): void {
  steer(0, 0);
  for (let i = 0; i < maxSec / DT; i++) {
    if (run().phase === 'won') return;
    if (run().phase === 'playing' && !G.player.inputLocked) return;
    tick();
  }
  throw new Error('bot: never settled');
}

/** Walk toward a point. Returns false early when input gets locked (a wrong door, a fall, a fade). */
function walk(x: number, z: number, maxSec = 20, tol = 0.25): boolean {
  const p = G.player.pos;
  for (let i = 0; i < maxSec / DT; i++) {
    if (G.player.inputLocked || run().phase !== 'playing') { steer(0, 0); return false; }
    const dx = x - p.x, dz = z - p.z, len = Math.hypot(dx, dz);
    if (len < tol) { steer(0, 0); return true; }
    steer(dx / len, -dz / len);
    tick();
  }
  steer(0, 0);
  return false;
}

/** Ease onto a small target (a pressure plate): slow down near it so the bean stops on it instead of sliding past. */
function creepTo(x: number, z: number, maxSec = 4): void {
  const p = G.player.pos, v = G.player.vel;
  for (let i = 0; i < maxSec / DT; i++) {
    if (G.player.inputLocked || run().phase !== 'playing') break;
    const dx = x - p.x, dz = z - p.z, len = Math.hypot(dx, dz);
    if (len < 0.15 && Math.hypot(v.x, v.z) < 0.5) break;
    const k = Math.min(1, len * 1.2) / Math.max(len, 1e-6);
    steer(dx * k, -dz * k);
    tick();
  }
  steer(0, 0);
}

/** Sideways first (staying in the current row), then ahead: avoids stepping on neighbouring tiles. */
function walkLateral(x: number, z: number, tol = 0.35): void {
  if (walk(x, G.player.pos.z, 10, tol)) walk(x, z, 10, tol);
}

// ───────────────────────── grid path finding ─────────────────────────

interface Grid { run: RunState; minX: number; minZ: number; W: number; H: number; blockedStatic: Uint8Array; floorStatic: Uint8Array }

function inflate(arr: Uint8Array, g: Grid, minX: number, maxX: number, minZ: number, maxZ: number, margin: number): void {
  const x0 = Math.max(0, Math.floor((minX - margin - g.minX) / RES)), x1 = Math.min(g.W - 1, Math.ceil((maxX + margin - g.minX) / RES));
  const z0 = Math.max(0, Math.floor((minZ - margin - g.minZ) / RES)), z1 = Math.min(g.H - 1, Math.ceil((maxZ + margin - g.minZ) / RES));
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
    const px = g.minX + ix * RES, pz = g.minZ + iz * RES;
    const cx = Math.min(Math.max(px, minX), maxX), cz = Math.min(Math.max(pz, minZ), maxZ);
    if ((px - cx) ** 2 + (pz - cz) ** 2 < margin * margin) arr[iz * g.W + ix] = 1;
  }
}

function fill(arr: Uint8Array, g: Grid, minX: number, maxX: number, minZ: number, maxZ: number): void {
  const x0 = Math.max(0, Math.floor((minX - g.minX) / RES)), x1 = Math.min(g.W - 1, Math.ceil((maxX - g.minX) / RES));
  const z0 = Math.max(0, Math.floor((minZ - g.minZ) / RES)), z1 = Math.min(g.H - 1, Math.ceil((maxZ - g.minZ) / RES));
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) arr[iz * g.W + ix] = 1;
}

function makeGrid(r: RunState): Grid {
  const b = r.course.bounds;
  const g: Grid = {
    run: r, minX: b.minX - 2, minZ: b.minZ - 2, W: Math.ceil((b.maxX - b.minX + 4) / RES), H: Math.ceil((b.maxZ - b.minZ + 4) / RES),
    blockedStatic: new Uint8Array(0), floorStatic: new Uint8Array(0),
  };
  g.blockedStatic = new Uint8Array(g.W * g.H); g.floorStatic = new Uint8Array(g.W * g.H);
  for (const w of r.world.walls) if (w.isStatic && w.minX < b.maxX + 10) inflate(g.blockedStatic, g, w.minX, w.maxX, w.minZ, w.maxZ, R);
  for (const f of r.world.floors) if (f.isStatic && f.minX < b.maxX + 10) fill(g.floorStatic, g, f.minX, f.maxX, f.minZ, f.maxZ);
  return g;
}

/** 8-neighbour BFS on the current wall/floor state. Returns waypoints (world coords). */
interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

function findPath(g: Grid, from: { x: number; z: number }, to: { x: number; z: number }, avoid: Box[] = []): { x: number; z: number }[] | null {
  const blocked = g.blockedStatic.slice(), floor = g.floorStatic.slice();
  for (const a of avoid) inflate(blocked, g, a.minX, a.maxX, a.minZ, a.maxZ, 0.3);
  const maxX = g.run.course.bounds.maxX + 10;
  for (const w of g.run.world.walls) if (!w.isStatic && w.enabled && w.minX < maxX) inflate(blocked, g, w.minX, w.maxX, w.minZ, w.maxZ, R);
  for (const f of g.run.world.floors) if (!f.isStatic && f.enabled && f.minX < maxX) fill(floor, g, f.minX, f.maxX, f.minZ, f.maxZ);
  const cell = (x: number, z: number) => ({ ix: Math.round((x - g.minX) / RES), iz: Math.round((z - g.minZ) / RES) });
  const s = cell(from.x, from.z), t = cell(to.x, to.z);
  const prev = new Int32Array(g.W * g.H).fill(-1);
  const q = [s.iz * g.W + s.ix];
  prev[q[0]] = q[0];
  const ok = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < g.W && iz < g.H && floor[iz * g.W + ix] === 1 && blocked[iz * g.W + ix] === 0;
  let found = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi], cx = cur % g.W, cz = (cur - cx) / g.W;
    if (Math.abs(cx - t.ix) <= 1 && Math.abs(cz - t.iz) <= 1) { found = cur; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (!ok(nx, nz)) continue;
      if (dx !== 0 && dz !== 0 && (!ok(cx + dx, cz) || !ok(cx, cz + dz))) continue;
      const k = nz * g.W + nx;
      if (prev[k] !== -1) continue;
      prev[k] = cur; q.push(k);
    }
  }
  if (found < 0) return null;
  const cells: number[] = [];
  for (let c = found; c !== prev[c]; c = prev[c]) cells.push(c);
  cells.push(q[0]);
  cells.reverse();
  return cells.map((c) => { const ix = c % g.W, iz = (c - ix) / g.W; return { x: g.minX + ix * RES, z: g.minZ + iz * RES }; });
}

// ───────────────────────── hazards: wait for a safe phase ─────────────────────────

const LOOK_S = 0.9;
/** How far ahead (s) the bot looks for a clean moment to start walking. */
const WAIT_S = 4;
let dodge = true;

function hazardHitAt(x: number, z: number, ms: number): boolean {
  const r = run();
  const d = r.selection.difficulty;
  for (const h of r.course.hazards) {
    if (h.kind === 'ice' || Math.abs(x - h.x) > 6 || Math.abs(z - h.z) > 6) continue;
    if (h.kind === 'sweeper') {
      const a = sweeperAngle(h, r.hazardMs + ms, T.SWEEPER_OMEGA[d]);
      const ca = Math.cos(a) * h.hw, sa = Math.sin(a) * h.hw;
      const rr = T.PLAYER_RADIUS + T.SWEEPER_THICK / 2 + 0.15;
      if (segDistSq(x, z, h.x - ca, h.z - sa, h.x + ca, h.z + sa) < rr * rr) return true;
    } else if (h.head) {
      const cx = h.x + hammerOffset(h, r.hazardMs + ms, T.HAMMER_PERIOD[d]);
      const px = Math.min(Math.max(x, cx - T.HAMMER_HW), cx + T.HAMMER_HW), pz = Math.min(Math.max(z, h.z - T.HAMMER_HD), h.z + T.HAMMER_HD);
      if ((x - px) ** 2 + (z - pz) ** 2 < (T.PLAYER_RADIUS + 0.3) ** 2) return true;
    }
  }
  return false;
}

/** Would walking on along the path, starting `delay` seconds from now, run into a hazard within LOOK_S? */
function walkHitsAfter(path: { x: number; z: number }[], idx: number, delay: number): boolean {
  const p = G.player.pos;
  const sp = T.MAX_SPEED * 0.85;
  for (let t = 0; t <= LOOK_S; t += 0.1) {
    let x = p.x, z = p.z, left = sp * t;
    for (let k = idx; k < path.length && left > 0; k++) {
      const dx = path[k].x - x, dz = path[k].z - z, len = Math.hypot(dx, dz);
      if (len <= left) { x = path[k].x; z = path[k].z; left -= len; } else { x += (dx / len) * left; z += (dz / len) * left; left = 0; }
    }
    if (hazardHitAt(x, z, (delay + t) * 1000)) return true;
  }
  return false;
}

/**
 * Hold still when walking on along the path would run into a hazard, but a later start is clean and standing
 * here until then is safe. (A bean in a doorway the bar sweeps through has no safe wait: it runs for it.)
 */
function shouldWait(path: { x: number; z: number }[], idx: number): boolean {
  if (!dodge || run().freezeT > 0 || G.player.pos.y > 0.5) return false;
  const p = G.player.pos;
  if (!walkHitsAfter(path, idx, 0)) return false;
  for (let d = 0.1; d <= WAIT_S; d += 0.1) {
    if (hazardHitAt(p.x, p.z, d * 1000)) return false; // standing is unsafe before a clean start comes: run for it
    if (!walkHitsAfter(path, idx, d)) return true;
  }
  return false;
}

/** Keep the path out of the middle of a hammer's cell, so the bean slips by on one side while the head is on the other. */
function hammerLanes(): Box[] {
  if (!dodge) return [];
  return run().course.hazards.filter((h) => h.kind === 'hammer').map((h) => ({
    minX: h.x - 0.35, maxX: h.x + 0.35, minZ: h.z - T.HAMMER_HD, maxZ: h.z + T.HAMMER_HD,
  }));
}

/** 'lost' = knocked off the path (a hazard hit): the caller plans again from where the bean stands. */
function follow(path: { x: number; z: number }[], maxSec = 90): 'ok' | 'lost' | 'failed' {
  const p = G.player.pos;
  if (path.length < 2) { steer(0, 0); return 'ok'; } // already at the target
  let idx = 1;
  let waited = 0, commit = 0;
  for (let f = 0; f < maxSec / DT; f++) {
    while (idx < path.length - 1 && Math.hypot(path[idx].x - p.x, path[idx].z - p.z) < 0.6) idx++;
    const tgt = path[idx];
    const dx = tgt.x - p.x, dz = tgt.z - p.z, len = Math.hypot(dx, dz);
    if (idx === path.length - 1 && len < 0.4) { steer(0, 0); return 'ok'; }
    if (run().phase === 'won') { steer(0, 0); return 'ok'; }
    if (G.player.inputLocked) { steer(0, 0); return 'failed'; }
    if (len > 1.8) { steer(0, 0); return 'lost'; }
    if (commit > 0) commit--;
    else if (shouldWait(path, idx)) {
      if (++waited > 3 / DT) { waited = 0; commit = 1.5 / DT; } // waited long enough: go for it
      else { steer(0, 0); tick(); continue; }
    }
    steer(dx / len, -dz / len);
    tick();
  }
  steer(0, 0);
  return 'failed';
}

function goTo(g: Grid, x: number, z: number, label: string, avoid: Box[] = []): void {
  for (let attempt = 0; attempt < 12; attempt++) {
    settle();
    if (run().phase === 'won') return;
    const lanes = attempt < 3 ? hammerLanes() : []; // after repeated knock-backs, stop being clever
    const path = findPath(g, { x: G.player.pos.x, z: G.player.pos.z }, { x, z }, [...avoid, ...lanes]);
    check(path, `${label}: no path from (${G.player.pos.x.toFixed(1)}, ${G.player.pos.z.toFixed(1)}) to (${x.toFixed(1)}, ${z.toFixed(1)})`);
    const res = follow(path);
    if (res === 'ok') return;
    if (process.env.BOT_DEBUG) console.log('lost', label, attempt, G.player.pos.x.toFixed(2), G.player.pos.z.toFixed(2), 'ice', run().course.hazards.filter((h) => h.kind === 'ice' && Math.abs(h.x - G.player.pos.x) < 4 && Math.abs(h.z - G.player.pos.z) < 4).length, 'hits', run().hazardHits);
    check(res === 'lost', `${label}: not reached`);
    // a hazard hit: let the stun and the slide end, then plan again
    for (let i = 0; i < 0.6 / DT; i++) tick();
  }
  check(false, `${label}: knocked off the path too often`);
}

// ───────────────────────── the player ─────────────────────────

class Player {
  readonly o: BotOpts;
  readonly rng: Rng;
  readonly g: Grid;
  constructor(o: BotOpts, g: Grid) {
    this.o = o;
    this.rng = o.rng ?? mulberry32(1);
    this.g = g;
  }

  /** Does the player get this question right? `n` = number of options. */
  knows(n: number): boolean {
    if (this.o.guess) return this.rng() < 1 / n;
    return this.rng() < (this.o.accuracy ?? 1);
  }

  think(): void {
    if (this.o.thinkSec) wait(this.o.thinkSec);
  }

  pickWrong<X>(items: X[]): X {
    return items[Math.floor(this.rng() * items.length)];
  }

  /** Walk through door `i` of a door wall (approach from the front, then push through). */
  door(laneZ: number, cx: number): void {
    walk(cx, laneZ + 3, 10, 0.3);
    walk(cx, laneZ - 2.5, 10, 0.4);
  }

  detour(): void {
    settle();
    const r = run();
    if (!r.detour) return;
    const dl = r.course.detour;
    walk(dl.spawn.x, dl.spawn.z - 19, 15, 0.5);
    for (let tries = 0; tries < 8 && r.detour && !r.detour.solved; tries++) {
      const d = r.detour;
      const n = d.retryWall.panels.filter((p) => p.state === 'closed').length;
      // a player who has just read the boards gets it within two tries
      const right = tries >= 2 || this.knows(Math.max(1, n));
      const closed = d.retryWall.panels.filter((p) => p.state === 'closed' && !p.isCorrect);
      const panel = right || !closed.length ? d.retryWall.panels.find((p) => p.isCorrect)! : this.pickWrong(closed);
      const cx = dl.retryWall.doors[panel.index].cx;
      walk(cx, dl.retryWall.z + 3, 10, 0.3);
      walk(cx, dl.retryWall.z - 2, 4, 0.4);
      if (!panel.isCorrect) wait(1.2);
    }
    check(r.detour?.solved, 'bot: detour not solved');
    walk(dl.portal.x, dl.portal.z, 15, 1.2);
    for (let i = 0; i < 10 / DT && r.detour; i++) tick();
    settle();
  }

  solve(room: RoomRuntime): void {
    switch (room.kind) {
      case 'doorRush': return this.doorRush(room);
      case 'tileDrop': return this.tileDrop(room);
      case 'stepStones': return this.stepStones(room);
      case 'bridgeBuilder': return this.bridge(room);
      case 'slimeGate': return this.slimeGate(room);
      case 'quizMaze': return this.quizMaze(room);
      case 'junctionHall': return this.junctionHall(room);
      case 'launchPads': return this.launchPads(room);
      case 'ruleMinefield': return this.ruleMinefield(room);
      case 'keyHunt': return this.keyHunt(room);
      case 'doorCarousel': return this.doorCarousel(room);
      case 'memoryFloor': return this.memoryFloor(room);
      case 'answerLifts': return this.answerLifts(room);
      case 'hexFinale': return this.hexFinale(room);
      case 'boulderRun': return this.boulderRun(room);
      case 'shiftMaze': return this.shiftMaze(room);
    }
  }

  doorRush(r: RoomRuntime): void {
    const L = r.layout, dw = r.doorWalls[0];
    this.think();
    const right = this.knows(dw.panels.length);
    const panel = right ? dw.panels.find((p) => p.isCorrect)! : this.pickWrong(dw.panels.filter((p) => !p.isCorrect));
    this.door(L.doorWalls[0].z, L.doorWalls[0].doors[panel.index].cx);
    if (!right) this.detour();
    else if (this.o.gold === 'take') this.gold(r);
  }

  /** Run into the gold door, then answer its bonus question. */
  gold(r: RoomRuntime): void {
    const gl = r.layout.gold!;
    check(r.gold?.state === 'closed', 'bot: gold door not offered');
    walk(gl.cx, gl.z + 1.8, 10, 0.3);
    steer(0, 1);
    for (let i = 0; i < 3 / DT && !run().gold; i++) tick();
    steer(0, 0);
    const g = run().gold;
    check(g && g.phase === 'asking', 'bot: gold question did not open');
    this.think();
    const right = this.knows(g.options.length);
    const wrong = g.options.map((_, i) => i).filter((i) => i !== g.correct);
    engine.answerGold(right ? g.correct : this.pickWrong(wrong));
    wait(0.3);
  }

  tileDrop(r: RoomRuntime): void {
    this.think();
    const right = this.knows(2);
    const tile = r.tiles.find((t) => t.correct === right)!;
    walkLateral(tile.cx, tile.cz, 0.5);
    for (let i = 0; i < 15 / DT && r.result === null && !run().detour; i++) tick();
    if (!right || r.result !== 'correct') { this.detour(); return; }
    wait(T.TILE_SHAKE_TIME + 0.3);
    // cross diagonally through the corner to a surviving tile of the far row
    const survivors = r.tiles.filter((t) => t.correct && t.row === 1);
    const a = r.tiles.find((t) => t.correct && t.row === 0);
    if (a && survivors.length) {
      const b = survivors[0];
      walk((a.cx + b.cx) / 2, (a.cz + b.cz) / 2, 5, 0.3);
      walk(b.cx, b.cz, 5, 0.5);
    }
  }

  /** Step onto a tile by path finding, keeping off every other unsolved tile (and the holes). */
  stepOn(r: RoomRuntime, tile: TileRT): void {
    // wait for a fallen wrong tile to rise back
    for (let i = 0; i < 4 / DT && r.stepRows.some((row) => row.some((t) => t.state !== 'solid' && t.state !== 'locked' && t.visible !== false)); i++) tick();
    for (let i = 0; i < 4 / DT && r.stepRows.some((row) => row.some((t) => t.state === 'gone')); i++) tick();
    const avoid: Box[] = [];
    for (const row of r.stepRows) for (const t of row) {
      if (t === tile || !t.visible || t.state === 'locked' || t.row < r.currentRow) continue;
      avoid.push({ minX: t.cx - t.sx / 2, maxX: t.cx + t.sx / 2, minZ: t.cz - t.sz / 2, maxZ: t.cz + t.sz / 2 });
    }
    goTo(this.g, tile.cx, tile.cz, `step row ${tile.row}`, avoid);
    wait(0.2);
  }

  stepStones(r: RoomRuntime): void {
    this.think();
    const wrongRow = this.knows(3) ? -1 : Math.floor(this.rng() * 4);
    for (let guard = 0; guard < 20 && r.state !== 'resolved'; guard++) {
      const k = r.currentRow;
      const bad = r.stepRows[k].find((x) => x.visible && !x.correct && x.state === 'solid');
      if (k === wrongRow && r.wrongCount === 0 && bad) {
        walkLateral(bad.cx, bad.cz);
        wait(T.STEP_SHAKE_TIME + 0.4);
        settle();
        continue;
      }
      const t = r.stepRows[k].find((x) => x.visible && x.correct && x.state === 'solid');
      check(t, `bot: no step tile in row ${k}`);
      this.stepOn(r, t);
    }
    check(r.state === 'resolved', 'bot: step stones not finished');
  }

  /** Fetch block i without passing through the pickup radius of another block. */
  fetch(r: RoomRuntime, i: number): void {
    const b = r.blocks[i];
    const pr = T.PICKUP_RADIUS + 0.2;
    const avoid: Box[] = r.blocks.filter((x) => x !== b && x.state === 'home')
      .map((x) => ({ minX: x.home.x - pr, maxX: x.home.x + pr, minZ: x.home.z - pr, maxZ: x.home.z + pr }));
    goTo(this.g, b.home.x, b.home.z, `block ${i}`, avoid);
    for (let t = 0; t < 2 / DT && G.player.carrying !== b.id; t++) tick();
    check(G.player.carrying === b.id, `bot: block ${i} not picked up`);
  }

  bridge(r: RoomRuntime): void {
    const bz = r.layout.buildZone!;
    const zx = (bz.minX + bz.maxX) / 2, zz = (bz.minZ + bz.maxZ) / 2;
    this.think();
    if (!this.knows(4)) {
      this.fetch(r, 1 + Math.floor(this.rng() * 3));
      walk(zx, zz, 10, 0.3);
      wait(1.8);
    }
    for (let i = r.nextIndex; i < 4; i++) {
      this.fetch(r, i);
      walk(zx, zz, 10, 0.3);
      wait(0.2);
    }
    check(r.state === 'resolved', 'bot: bridge not finished');
  }

  slimeGate(r: RoomRuntime): void {
    const L = r.layout;
    for (let k = 0; k < r.doorWalls.length; k++) {
      const wz = L.doorWalls[k].z;
      walk(L.laneX, wz + 4, 10, 0.5);
      wait(0.3);
      this.think();
      const dw = r.doorWalls[k];
      if (!this.knows(dw.panels.length)) {
        const p = this.pickWrong(dw.panels.filter((x) => !x.isCorrect && x.state === 'closed'));
        this.door(wz, L.doorWalls[k].doors[p.index].cx);
        wait(1 + r.lockT);
      }
      const ci = dw.panels.findIndex((p) => p.isCorrect);
      this.door(wz, L.doorWalls[k].doors[ci].cx);
      check(r.wallDone[k], `bot: gate ${k} not passed`);
    }
  }

  quizMaze(r: RoomRuntime): void {
    for (const jl of r.layout.junctions) {
      goTo(this.g, jl.x, jl.z, `junction ${jl.index}`);
      wait(0.2);
      check(r.currentWall === jl.index, `bot: junction ${jl.index} not active`);
      this.think();
      const jr = r.junctions[jl.index];
      if (!this.knows(jl.branches.length)) {
        const wrong = this.pickWrong(jl.branches.map((b, i) => ({ b, i })).filter((x) => !x.b.correct));
        walk(wrong.b.signX + wrong.b.dx * 2, wrong.b.signZ + wrong.b.dz * 2, 10, 0.5);
        check(jr.branches[wrong.i].state === 'wrong', 'bot: wrong pick not registered');
        walk(jl.x, jl.z, 10, 0.5);
      }
      const right = jl.branches.find((b) => b.correct)!;
      walk(right.signX + right.dx * 2, right.signZ + right.dz * 2, 10, 0.5);
      check(r.wallDone[jl.index], `bot: junction ${jl.index} not passed`);
    }
  }

  /** Walk to a pad (keeping off the others) and wait for the ring to fill and the arc to land. */
  stepOnPad(r: RoomRuntime, i: number): void {
    const avoid: Box[] = r.pads.filter((_, j) => j !== i).map((x) => ({ minX: x.x - 1.3, maxX: x.x + 1.3, minZ: x.z - 1.3, maxZ: x.z + 1.3 }));
    goTo(this.g, r.pads[i].x, r.pads[i].z, `pad ${i}`, avoid);
    for (let t = 0; t < 3 / DT && !r.launching; t++) tick();
    check(r.launching, `bot: pad ${i} did not launch`);
    for (let t = 0; t < 6 / DT && r.launching; t++) tick();
    check(!r.launching, 'bot: never landed');
    settle();
  }

  launchPads(r: RoomRuntime): void {
    this.think();
    if (!this.knows(r.pads.length)) {
      const wrong = this.pickWrong(r.pads.map((_, i) => i).filter((i) => !r.pads[i].correct));
      this.stepOnPad(r, wrong);
    }
    this.stepOnPad(r, r.pads.findIndex((p) => p.correct && p.state === 'idle'));
    check(r.state === 'resolved', 'bot: launch pads not resolved');
  }

  /** Cross the minefield along the safe tiles; a player who does not know the rule steps on one wrong tile first. */
  ruleMinefield(r: RoomRuntime): void {
    const mine = r.layout.mine!;
    this.think();
    const wrongRow = this.knows(3) ? -1 : Math.floor(this.rng() * T.MINE_ROWS);
    for (let guard = 0; guard < 40 && r.state !== 'resolved'; guard++) {
      settle();
      const k = r.currentRow;
      if (k >= T.MINE_ROWS) break;
      const row = r.stepRows[k];
      const here = mine.walks[k].cz;
      let tile: TileRT | undefined;
      if (k === wrongRow && r.wrongCount === 0) tile = row.find((t) => !t.correct && t.state === 'solid');
      tile ??= row.find((t) => t.correct && (t.state === 'solid' || t.state === 'locked'));
      check(tile, `bot: no tile to step on in row ${k}`);
      // along the walkway to the tile's column, then straight across the tile onto the next walkway
      walk(tile.cx, here, 10, 0.3);
      walk(tile.cx, mine.walks[k + 1].cz, 10, 0.3);
      if (!tile.correct) { wait(T.MINE_SHAKE_TIME + 1.5); settle(); }
    }
    check(r.state === 'resolved', 'bot: rule minefield not finished');
  }

  /** Walk to key `i` (a dead end), pick it up, carry it to the gate. A wrong key is zapped back; the bot then settles. */
  carryKey(r: RoomRuntime, i: number): void {
    const k = r.keys[i], H = r.layout.hunt!;
    goTo(this.g, k.home.x, k.home.z, `key ${i}`);
    for (let t = 0; t < 2 / DT && G.player.carrying !== k.id; t++) tick();
    check(G.player.carrying === k.id, `bot: key ${i} not picked up`);
    settle();
    const path = findPath(this.g, { x: G.player.pos.x, z: G.player.pos.z }, { x: H.gate.x, z: H.gate.z + 1.1 });
    check(path, 'bot: no path to the gate');
    follow(path);
    settle();
  }

  keyHunt(r: RoomRuntime): void {
    this.think();
    if (!this.knows(r.keys.length)) {
      const wrong = this.pickWrong(r.keys.map((_, i) => i).filter((i) => !r.keys[i].correct && r.keys[i].state === 'home'));
      this.carryKey(r, wrong);
      check(r.keys[wrong].state === 'wrong', 'bot: wrong key not zapped');
    }
    this.carryKey(r, r.keys.findIndex((k) => k.correct));
    check(r.state === 'resolved', 'bot: key hunt not resolved');
  }

  /** Door Carousel: wait in front of the opening until the wanted panel is about to be centred, then run at it. */
  doorCarousel(r: RoomRuntime): void {
    const L = r.layout, dw = r.doorWalls[0];
    const zWall = L.doorWalls[0].z;
    this.think();
    const right = this.knows(dw.panels.length);
    const panel = right ? dw.panels.find((p) => p.isCorrect)! : this.pickWrong(dw.panels.filter((p) => !p.isCorrect));
    walk(L.laneX, zWall + 3, 10, 0.3);
    const lead = T.CAROUSEL_SPEED[run().selection.difficulty] * 0.6; // the train moves while the bean runs the last metres
    steer(0, 0);
    for (let i = 0; i < 40 / DT && Math.abs(panelCenter(r, panel.index) + lead) > 0.4; i++) tick();
    walk(L.laneX, zWall - 3, 6, 0.4);
    if (!right) { this.detour(); return; }
    check(r.state === 'resolved', 'bot: door carousel not resolved');
    if (this.o.gold === 'take') this.gold(r);
  }

  /** Memory Floor: wait for the labels to flip down, then stand on a tile (the right one, or a wrong one first). */
  memoryFloor(r: RoomRuntime): void {
    const m = r.memory!;
    for (let i = 0; i < 20 / DT && m.phase !== 'ask'; i++) tick();
    check(m.phase === 'ask', 'bot: memory floor never asked');
    this.think();
    const stand = (idx: number) => {
      const t = r.tiles[idx];
      goTo(this.g, t.cx, t.cz, `memory tile ${idx}`);
      for (let i = 0; i < 4 / DT && r.state !== 'resolved' && !m.pendingFall; i++) tick();
    };
    if (!this.knows(T.MEMORY_LABELS)) {
      const wrong = this.pickWrong(r.tiles.map((_, i) => i).filter((i) => m.labelled[i] && !r.tiles[i].correct));
      stand(wrong);
      check(m.pendingFall || r.wrongCount > 0, 'bot: wrong memory tile not registered');
      for (let i = 0; i < 8 / DT && (m.pendingFall || G.player.inputLocked || run().phase !== 'playing'); i++) tick();
      settle();
    }
    stand(r.tiles.findIndex((t) => t.correct));
    check(r.state === 'resolved', 'bot: memory floor not resolved');
    for (let i = 0; i < 4 / DT && run().world.walls[r.layout.exitGateWallId!].enabled; i++) tick();
  }

  /** Board lift `i` (straight in from the dock, so no other lift is touched) and wait until it has finished moving. */
  rideLift(r: RoomRuntime, i: number): void {
    const L = r.layout.lifts!, l = r.lifts![i];
    walk(l.x, L.dockZ + 1.5, 10, 0.4);
    walk(l.x, L.z, 6, 0.3);
    for (let t = 0; t < 4 / DT && l.state === 'idle'; t++) tick();
    check(l.state !== 'idle', `bot: lift ${i} did not start`);
    steer(0, 0);
    for (let t = 0; t < 12 / DT && (l.state as string) !== 'up' && (l.state as string) !== 'wrong' && (l.state as string) !== 'idle'; t++) tick();
  }

  /** Out of the pit: sideways into the gap between the lifts, then south up the steps to the dock. */
  leavePit(r: RoomRuntime, from: number): void {
    const L = r.layout.lifts!;
    const gapX = L.xs[from] + (from === r.lifts!.length - 1 ? -1 : 1) * (L.half + 0.8);
    walk(gapX, L.z, 6, 0.3);
    walk(gapX, L.dockZ + 1, 10, 0.3);
  }

  answerLifts(r: RoomRuntime): void {
    const L = r.layout.lifts!;
    this.think();
    if (this.o.wrongFirst?.includes('answerLifts') || !this.knows(r.lifts!.length)) {
      const wrong = this.pickWrong(r.lifts!.map((_, i) => i).filter((i) => !r.lifts![i].correct));
      this.rideLift(r, wrong);
      check(r.lifts![wrong].state === 'wrong', 'bot: wrong lift did not sink');
      this.leavePit(r, wrong);
      settle();
    }
    const right = r.lifts!.findIndex((l) => l.correct);
    this.rideLift(r, right);
    check(r.state === 'resolved', 'bot: answer lifts not resolved');
    // up on the ledge: walk to its edge and drop to the landing
    walk(L.xs[right], L.ledgeEndZ + 1, 10, 0.4);
    walk(L.xs[right], L.ledgeEndZ - 1.5, 10, 0.5);
    settle();
  }

  /** Hex Finale: every round, stand on a tile of the right colour (inside the ring that survives), and wait it out. */
  hexFinale(r: RoomRuntime): void {
    const hx = r.hex!;
    const done = () => (r.state as string) === 'resolved';
    for (let guard = 0; guard < 400 && !done(); guard++) {
      settle();
      for (let t = 0; t < 20 / DT && hx.phase !== 'ask' && !done(); t++) tick(); // between rounds
      if (done()) break;
      const round = hx.round;
      this.think();
      const k = hx.clusters.length;
      // `wrongFirst` makes round 1 a wrong one
      const right = round === 1 && this.o.wrongFirst?.includes('hexFinale') ? false : this.knows(k);
      const keep = hx.shrinking ? hx.rings - 1 : hx.rings;
      const want = right ? [hx.correct] : hx.clusters.map((_, i) => i).filter((i) => i !== hx.correct);
      const cluster = right ? hx.correct : this.pickWrong(want);
      const p = G.player.pos;
      const cands = hx.tiles.filter((t) => !t.removed && t.state === 'solid' && t.cluster === cluster && t.ring <= (right ? keep : hx.rings));
      check(cands.length, `bot: no tile for cluster ${cluster}`);
      const tile = cands.reduce((a, b) => ((a.cx - p.x) ** 2 + (a.cz - p.z) ** 2 <= (b.cx - p.x) ** 2 + (b.cz - p.z) ** 2 ? a : b));
      walk(tile.cx, tile.cz, 8, 0.3);
      // wait until this round is over (a fall puts the bean back on the rim: stand still there)
      for (let t = 0; t < 40 / DT && hx.round === round && hx.phase !== 'won' && !done(); t++) {
        if (!right && G.player.inputLocked) settle();
        tick();
      }
    }
    check(done(), 'bot: hex finale not finished');
    wait(T.HEX_RISE_S + 0.3); // the lost tiles rise again
  }

  /**
   * Boulder Run: run up the corridor and duck into an alcove. A player who does not know the answer ducks into a
   * wrong alcove first (once per wave), waits for the boulder to smash into the end wall, then takes the right one.
   * A squash (a slow player) sends the bean back to the start; the bot just runs again.
   */
  boulderRun(r: RoomRuntime): void {
    const L = r.layout.boulder!;
    const B = () => r.boulder!;
    this.think();
    const resolved = () => r.state === 'resolved';
    let rolled = -1, goWrong = false;
    for (let guard = 0; guard < 30 && !resolved(); guard++) {
      const wi = B().wave, w = B().waves[wi];
      if (w.passed) { // waiting for the boulder to pass and the next wave to start
        for (let t = 0; t < 20 / DT && B().wave === wi && !resolved(); t++) tick();
        continue;
      }
      if (rolled !== wi) { rolled = wi; goWrong = !this.knows(w.alcoves.length); }
      const open = w.alcoves.filter((a) => !a.correct && a.state === 'open');
      const useWrong = goWrong && w.wrong === 0 && open.length > 0;
      const al = useWrong ? this.pickWrong(open) : w.alcoves.find((a) => a.correct)!;
      const a = L.alcoves[al.slot];
      if (!walk(L.axisX, a.cz, 20, 0.3) || !walk(L.axisX + a.side * (T.BOULDER_CW + 2.2), a.cz, 6, 0.3)) { settle(); continue; }
      if (useWrong) {
        // hide until the boulder has smashed into the end wall and the next rumble has begun
        for (let t = 0; t < 30 / DT && B().phase !== 'smash' && B().phase !== 'squash'; t++) tick();
        for (let t = 0; t < 5 / DT && B().phase === 'smash'; t++) tick();
        settle();
      }
    }
    settle();
    check(resolved(), 'bot: boulder run not resolved');
  }

  /**
   * Shifting Maze: walk to each shrine that is still on the way out, stand on a plate, then plan again after the
   * hedges have moved (every goTo plans on the current walls). A shrine that the shortcut left off the way is skipped.
   * Finally leave the maze, which ends the room.
   */
  shiftMaze(r: RoomRuntime): void {
    const L = r.layout.shift!;
    const S = r.shift!;
    const maze = liveMaze(r);
    for (let k = 0; k < S.shrines.length; k++) {
      const sh = S.shrines[k], at = L.shrines[k];
      if (sh.state === 'done') continue;
      const here = cellAt(r, G.player.pos.x, G.player.pos.z);
      if (!pathBetween(maze, here, exitCell(maze)).some((c) => c.c === at.c && c.r === at.r)) continue;
      goTo(this.g, at.x, at.z, `shrine ${k}`);
      wait(0.1);
      check(sh.state === 'asking', `bot: shrine ${k} not asking`);
      this.think();
      const right = this.knows(sh.plates.length);
      const plate = right ? sh.plates.find((p) => p.correct)! : this.pickWrong(sh.plates.filter((p) => !p.correct));
      goTo(this.g, plate.x, plate.z, `plate ${k}`);
      creepTo(plate.x, plate.z);
      const st = () => sh.state as string;
      for (let t = 0; t < 2 / DT && st() !== 'done'; t++) tick();
      check(st() === 'done', `bot: shrine ${k} not answered`);
      wait(T.SHIFT_ANIM_S);
    }
    const resolved = () => r.state === 'resolved';
    if (!resolved()) {
      goTo(this.g, r.layout.laneX, r.layout.z0 - r.layout.depth - 1.8, 'shifting maze exit');
      for (let t = 0; t < 2 / DT && !resolved(); t++) tick();
    }
    settle();
    check(resolved(), 'bot: shifting maze not resolved');
  }

  junctionHall(r: RoomRuntime): void {
    const L = r.layout, dw = r.doorWalls[0];
    this.think();
    const right = this.o.junctionRight ?? this.knows(dw.panels.length);
    const panel = right ? dw.panels.find((p) => p.isCorrect)! : this.pickWrong(dw.panels.filter((p) => !p.isCorrect));
    this.door(L.doorWalls[0].z, L.doorWalls[0].doors[panel.index].cx);
    check(r.state === 'resolved', 'bot: junction hall not resolved');
  }
}

function segsOf(r: RunState): SegmentInfo[] { return r.course.segments; }

/** Next segment on the route: main segments plus the chosen lane, in course order. */
function nextSeg(segs: SegmentInfo[], i: number, lane: 'short' | 'long' | null): number {
  for (let j = i + 1; j < segs.length; j++) if (segs[j].lane === 'main' || segs[j].lane === lane) return j;
  return -1;
}

export function playThrough(difficulty: Difficulty, seed: number, o: BotOpts = {}): BotResult {
  const wasDemo = params.demo;
  params.demo = !!o.demo;
  dodge = !o.ignoreHazards;
  const r = boot(difficulty, seed, o.domain ?? 'math', { ...(o.mode ? { mode: o.mode } : {}), ...(o.finale ? { finale: o.finale } : {}) }, !o.classic);
  params.demo = wasDemo;
  r.slime = 0;
  const segTimes: number[] = segsOf(r).map(() => 0);
  const g = makeGrid(r);
  const bot = new Player(o, g);
  const segs = r.course.segments;
  let lane: 'short' | 'long' | null = null;
  try {
    for (let i = 0; i >= 0; i = nextSeg(segs, i, lane)) {
      const seg = segs[i];
      const t0 = r.elapsedMs;
      if (seg.roomId) {
        const room = r.roomMap.get(seg.roomId)!;
        if (room.kind !== 'slimeGate' && room.kind !== 'quizMaze') check(room.state !== 'idle', `${seg.kind} ${seg.roomId} not active on entry`);
        bot.solve(room);
        settle();
        check(room.state === 'resolved', `${seg.kind} ${seg.roomId} not resolved`);
      }
      if (seg.kind === 'forkHall') lane = o.route ?? 'short';
      if (seg.kind === 'junctionHall') lane = r.roomMap.get(seg.roomId!)!.result === 'correct' ? 'short' : 'long';
      const ni = nextSeg(segs, i, lane);
      if (ni >= 0) goTo(g, segs[ni].laneX, segs[ni].z0 - 1.8, `${seg.kind} → ${segs[ni].kind}`);
      else goTo(g, r.course.exitPortal.x, r.course.exitPortal.z, 'exit portal');
      if (o.keepAlive) r.slime = Math.min(r.slime, 0.4);
      segTimes[i] = (r.elapsedMs - t0) / 1000;
    }
    wait(0.5);
  } catch (e) {
    if (!(e instanceof Eliminated)) throw e;
  }
  steer(0, 0);
  return { run: r, eliminated: r.phase === 'lost', timeS: r.elapsedMs / 1000, slime: r.slime, route: r.route, segTimes };
}
