import type { McqQuestion, TfQuestion } from '../../content/schema';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { RoomRuntime } from '../runtime';
import { fadeRespawn, surgeAmount } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel, timerSeconds } from '../loop/roomCommon';

/**
 * Hex Finale (F4-X). A disc of hex tiles over the slime. Each round: a question appears and its answers are
 * painted on colour clusters (pie slices of the disc). When the timer ends, every tile outside the correct
 * cluster shakes and sinks. Every second round the edge ring crumbles for good. A fall costs a large surge and
 * puts the bean back on the rim. Survive HEX_ROUNDS rounds to qualify (the slime still decides elimination).
 *
 * Everything runs from the fixed step (`h`), never wall time, so the rounds are deterministic. Tiles are moving
 * floors (`FloorRect.moving`): a bean on a sinking tile rides it down.
 */

export type HexTileState = 'solid' | 'shaking' | 'sinking' | 'gone' | 'rising';
export type HexPhase = 'ask' | 'fall' | 'rest' | 'restore' | 'won';

export interface HexTileRT {
  i: number;
  floorId: number;
  ring: number;
  angle: number;
  cx: number; cz: number; sx: number; sz: number;
  cluster: number;
  state: HexTileState;
  /** Seconds in the current state. */
  t: number;
  /** How long it shakes before it sinks (the edge ring warns for longer). */
  shakeDur: number;
  /** Lost to the shrinking edge: does not come back until the finale is won. */
  removed: boolean;
  top: number;
}

export interface HexCluster { label: string; correct: boolean; color: number; cx: number; cz: number }

export interface HexRT {
  tiles: HexTileRT[];
  round: number;
  phase: HexPhase;
  t: number;
  remaining: number;
  total: number;
  clusters: HexCluster[];
  correct: number;
  /** Rings still standing (the outermost ring index). */
  rings: number;
  roundStartMs: number;
  /** Rounds in which the bean was not on the right cluster. */
  misses: number;
  /** The edge will crumble after this round. */
  shrinking: boolean;
  /** The bean was on the right cluster when the last timer ended. */
  lastOk: boolean | null;
}

const smooth = (s: number): number => { const k = Math.min(1, Math.max(0, s)); return k * k * (3 - 2 * k); };

/** Question time for round `n` (1-based), before the Relaxed-timers setting. */
export function roundSeconds(n: number): number {
  return Math.max(T.HEX_TIMER_MIN, T.HEX_TIMER_S - T.HEX_TIMER_STEP * (n - 1));
}

/** Rings standing during round `n`. */
export function ringsForRound(n: number): number {
  return Math.max(1, T.HEX_RINGS - Math.floor((n - 1) / T.HEX_SHRINK_EVERY));
}

export function makeHex(room: RoomRuntime): HexRT | undefined {
  const L = room.layout.hex;
  if (!L) return undefined;
  return {
    tiles: L.cells.map((c, i): HexTileRT => ({
      i, floorId: c.floorId, ring: c.ring, angle: c.angle, cx: c.cx, cz: c.cz, sx: c.sx, sz: c.sz,
      cluster: 0, state: 'solid', t: 0, shakeDur: T.HEX_SHAKE_S, removed: false, top: 0,
    })),
    round: 0, phase: 'ask', t: 0, remaining: 0, total: 0, clusters: [], correct: 0, rings: L.rings, roundStartMs: 0,
    misses: 0, shrinking: false, lastOk: null,
  };
}

export function activate(room: RoomRuntime): void {
  const run = needRun();
  const L = room.layout.hex!;
  beginRoom(room);
  room.wrongCount = 0;
  room.hex = room.hex ?? makeHex(room);
  run.world.floors[L.doorstepFloorId].enabled = false; // the doorstep is not a safe place to wait
  startRound(room, 1);
}

function startRound(room: RoomRuntime, n: number): void {
  const run = needRun();
  const hx = room.hex!;
  const q = pickQuestion(room, ['mcq', 'truefalse'], 0) as McqQuestion | TfQuestion;
  room.question = q;
  const d = run.selection.difficulty;
  let labels: { label: string; correct: boolean }[];
  if (q.type === 'truefalse') {
    labels = [{ label: 'TRUE', correct: q.answer }, { label: 'FALSE', correct: !q.answer }];
    if (run.qRng() < 0.5) labels.reverse();
  } else {
    const k = T.HEX_CLUSTERS[d];
    const wrong = shuffle(q.distractors, run.qRng).slice(0, k - 1).map((label) => ({ label, correct: false }));
    labels = shuffle([{ label: q.answer, correct: true }, ...wrong], run.qRng);
  }
  const k = labels.length;
  const rot = run.qRng() * Math.PI * 2;
  hx.round = n;
  hx.rings = ringsForRound(n);
  hx.shrinking = n % T.HEX_SHRINK_EVERY === 0 && n < T.HEX_ROUNDS;
  hx.correct = labels.findIndex((l) => l.correct);
  const centre = Math.floor(run.qRng() * k);
  for (const t of hx.tiles) {
    if (t.removed || t.ring > hx.rings) continue;
    if (t.ring === 0) t.cluster = centre;
    else {
      const a = (((t.angle - rot) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      t.cluster = Math.min(k - 1, Math.floor((a / (Math.PI * 2)) * k));
    }
  }
  // cluster centres (for the floating labels)
  hx.clusters = labels.map((l, ci) => {
    const mine = hx.tiles.filter((t) => !t.removed && t.ring <= hx.rings && t.cluster === ci && t.ring > 0);
    const list = mine.length ? mine : hx.tiles.filter((t) => !t.removed && t.ring <= hx.rings && t.cluster === ci);
    let sx = 0, sz = 0;
    for (const t of list) { sx += t.cx; sz += t.cz; }
    const n2 = Math.max(1, list.length);
    return { label: l.label, correct: l.correct, color: ci, cx: sx / n2, cz: sz / n2 };
  });
  hx.phase = 'ask';
  hx.t = 0;
  hx.total = timerSeconds(roundSeconds(n));
  hx.remaining = hx.total;
  hx.roundStartMs = run.elapsedMs;
  hx.lastOk = null;
  room.feedback = null;
  room.hintShown = null; room.hintUsed = false; room.fiftyUsed = false;
  room.activatedAtMs = run.elapsedMs;
  syncRoomPanel();
}

/** The live tile under the bean, if any. */
export function tileUnderPlayer(room: RoomRuntime): HexTileRT | null {
  const hx = room.hex;
  if (!hx) return null;
  const p = G.player.pos;
  if (p.y < -0.5) return null;
  for (const t of hx.tiles) {
    if (t.state === 'gone') continue;
    if (Math.abs(p.x - t.cx) <= t.sx / 2 && Math.abs(p.z - t.cz) <= t.sz / 2) return t;
  }
  return null;
}

function evaluate(room: RoomRuntime): void {
  const hx = room.hex!;
  const q = room.question!;
  const pl = G.player.pos;
  const at = { x: pl.x, y: 1.2, z: pl.z };
  const under = tileUnderPlayer(room);
  const ok = !!under && under.cluster === hx.correct && under.state === 'solid';
  hx.lastOk = ok;
  for (const t of hx.tiles) {
    if (t.removed || t.state !== 'solid' || t.ring > hx.rings) continue;
    if (t.cluster !== hx.correct) { t.state = 'shaking'; t.t = 0; t.shakeDur = T.HEX_SHAKE_S; }
  }
  if (hx.shrinking) {
    for (const t of hx.tiles) {
      if (t.ring !== hx.rings || t.removed) continue;
      t.removed = true;
      t.state = 'shaking'; t.t = 0; t.shakeDur = T.HEX_EDGE_WARN_S;
    }
  }
  room.record = startRecord(room, q, ok, hx.roundStartMs);
  if (ok) {
    room.feedback = { text: hx.shrinking ? 'Safe! The edge is crumbling...' : 'Safe!', tone: 'good' };
    celebrate(room, at, true);
  } else {
    hx.misses++;
    room.wrongCount++;
    room.feedback = { text: `Wrong tiles! The answer was "${hx.clusters[hx.correct].label}". ${q.hint}`, tone: 'bad' };
    G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: true, ...at });
  }
  hx.phase = 'fall';
  hx.t = 0;
  hx.remaining = 0;
  G.events.emit({ type: 'tileShake' });
  syncRoomPanel();
}

function animateTiles(room: RoomRuntime, h: number): boolean {
  const run = needRun();
  const hx = room.hex!;
  let moving = false;
  for (const t of hx.tiles) {
    const f = run.world.floors[t.floorId];
    switch (t.state) {
      case 'shaking':
        moving = true;
        t.t += h;
        if (t.t >= t.shakeDur) { t.state = 'sinking'; t.t = 0; }
        break;
      case 'sinking':
        moving = true;
        t.t += h;
        t.top = -T.HEX_SINK_Y * smooth(t.t / T.HEX_SINK_S);
        if (t.t >= T.HEX_SINK_S) { t.state = 'gone'; t.t = 0; f.enabled = false; }
        break;
      case 'rising':
        moving = true;
        t.t += h;
        t.top = -T.HEX_SINK_Y * (1 - smooth(t.t / T.HEX_RISE_S));
        if (t.t >= T.HEX_RISE_S) { t.state = 'solid'; t.t = 0; t.top = 0; }
        break;
      default: break;
    }
    f.top = t.top;
  }
  return moving;
}

/** Bring every tile that is not lost to the edge back up. */
function restore(room: RoomRuntime, all: boolean): void {
  const run = needRun();
  const hx = room.hex!;
  for (const t of hx.tiles) {
    if (all) t.removed = false;
    if (t.removed || t.state !== 'gone') continue;
    t.state = 'rising'; t.t = 0; t.top = -T.HEX_SINK_Y;
    const f = run.world.floors[t.floorId];
    f.top = t.top; f.prevTop = t.top; f.enabled = true;
  }
}

export function step(room: RoomRuntime, h: number): void {
  const run = needRun();
  const hx = room.hex;
  if (!hx) return;
  const busy = animateTiles(room, h);
  if (room.state !== 'active' || run.phase === 'won' || run.phase === 'lost') return;
  switch (hx.phase) {
    case 'ask':
      hx.remaining = Math.max(0, hx.remaining - h);
      if (hx.remaining <= 0) evaluate(room);
      break;
    case 'fall':
      hx.t += h;
      if (!busy && hx.t >= T.HEX_SHAKE_S) { hx.phase = 'rest'; hx.t = 0; syncRoomPanel(); }
      break;
    case 'rest':
      hx.t += h;
      if (hx.t >= T.HEX_REST_S) {
        if (hx.round >= T.HEX_ROUNDS) win(room);
        else { hx.phase = 'restore'; hx.t = 0; restore(room, false); }
      }
      break;
    case 'restore':
      hx.t += h;
      if (hx.t >= T.HEX_RISE_S) startRound(room, hx.round + 1);
      break;
    case 'won': break;
  }
}

function win(room: RoomRuntime): void {
  const run = needRun();
  const hx = room.hex!;
  hx.phase = 'won';
  hx.t = 0;
  restore(room, true);
  run.world.floors[room.layout.hex!.exitFloorId].enabled = true;
  room.feedback = { text: 'You survived the Hex Finale!', tone: 'good' };
  resolveRoom(room, hx.misses === 0 ? 'correct' : 'remediated');
}

/** The tile a fallen bean comes back on: the outermost standing tile nearest to where it fell. */
export function rimSpawn(room: RoomRuntime): { x: number; z: number } {
  const hx = room.hex!;
  const p = G.player.pos;
  const alive = hx.tiles.filter((t) => t.state === 'solid' && !t.removed);
  const pool = alive.length ? alive : hx.tiles.filter((t) => t.state === 'solid' || t.state === 'rising');
  const outer = pool.reduce((m, t) => Math.max(m, t.ring), 0);
  let best: HexTileRT | null = null, bd = Infinity;
  for (const t of pool) {
    if (t.ring !== outer) continue;
    const d = (t.cx - p.x) ** 2 + (t.cz - p.z) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best ? { x: best.cx, z: best.cz } : { x: room.layout.hex!.centerX, z: room.layout.hex!.centerZ };
}

/** A fall during the finale: a large surge and a respawn on the rim. */
export function onFall(room: RoomRuntime): boolean {
  const hx = room.hex;
  if (!hx || room.state !== 'active') return false;
  const run = needRun();
  surgeAmount(T.HEX_FALL_SURGE[run.selection.difficulty]);
  const at = rimSpawn(room);
  fadeRespawn({ x: at.x, y: 0, z: at.z });
  if (hx.phase === 'ask') room.feedback = { text: 'You fell! Back on the rim.', tone: 'bad' };
  syncRoomPanel();
  return true;
}
