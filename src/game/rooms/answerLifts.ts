import type { McqQuestion } from '../../content/schema';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { RoomRuntime, RunState } from '../runtime';
import { surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';

/**
 * Answer Lifts (F4-8). The exit stands on a ledge 6 m up. Below it, 3-4 lifts carry the answers. Stand on a
 * lift for LIFT_BOARD_S and it goes: the right one rises to the ledge; a wrong one stops halfway, sinks into
 * the slime pond, and the bean wades out up the steps between the lifts, takes a surge, and that lift is marked X.
 *
 * Every lift is a moving floor (`FloorRect.moving`): its `top` is a pure function of the lift's state and the
 * time in that state, advanced by the fixed step, so the controller carries the rider (`rideFloors`).
 */

export type LiftState = 'idle' | 'rising' | 'up' | 'lowering' | 'stalling' | 'holding' | 'sinking' | 'wrong';

export interface LiftRT {
  i: number;
  x: number;
  floorId: number;
  label: string;
  correct: boolean;
  state: LiftState;
  /** Seconds in the current state. */
  t: number;
  /** 0..1 while the bean stands on an idle lift. */
  charge: number;
  top: number;
}

/** X of each lift centre (local to the lane) for `n` lifts. */
export function liftXs(n: number): number[] {
  if (n === 4) return [-7.5, -2.5, 2.5, 7.5];
  if (n === 3) return [-6, 0, 6];
  throw new Error(`unsupported lift count ${n}`);
}

const smooth = (s: number): number => { const k = Math.min(1, Math.max(0, s)); return k * k * (3 - 2 * k); };

/** Height of a lift: a pure function of its state and the time in it. */
export function liftTop(l: Pick<LiftRT, 'state' | 't' | 'top'>): number {
  switch (l.state) {
    case 'idle': return 0;
    case 'rising': return T.LIFT_TOP * smooth(l.t / T.LIFT_RISE_S);
    case 'up': return T.LIFT_TOP;
    case 'lowering': return T.LIFT_TOP * (1 - smooth(l.t / T.LIFT_LOWER_S));
    case 'stalling': return T.LIFT_STALL_Y * smooth(l.t / T.LIFT_STALL_RISE_S);
    case 'holding': return T.LIFT_STALL_Y;
    case 'sinking': return T.LIFT_STALL_Y + (T.LIFT_PIT - T.LIFT_STALL_Y) * smooth(l.t / T.LIFT_SINK_S);
    case 'wrong': return l.top;
  }
}

export function activate(room: RoomRuntime): void {
  const run = needRun();
  const L = room.layout.lifts!;
  beginRoom(room);
  const q = pickQuestion(room, 'mcq', 0) as McqQuestion;
  room.question = q;
  room.wrongCount = 0;
  const n = L.xs.length;
  const wrong = shuffle(q.distractors, run.qRng).slice(0, n - 1).map((label) => ({ label, correct: false }));
  const labels = shuffle([{ label: q.answer, correct: true }, ...wrong], run.qRng);
  room.lifts = labels.map((l, i): LiftRT => ({
    i, x: L.xs[i], floorId: L.floorIds[i], label: l.label, correct: l.correct, state: 'idle', t: 0, charge: 0, top: 0,
  }));
}

function onLift(l: LiftRT, half: number, z: number): boolean {
  const p = G.player.pos;
  return G.player.grounded && Math.abs(p.x - l.x) < half && Math.abs(p.z - z) < half && Math.abs(p.y - l.top) < 0.15;
}

const MOVING: LiftState[] = ['rising', 'lowering', 'stalling', 'holding', 'sinking', 'up'];

/** Wade zone: the pond slows the bean while it is down in the pit. */
export function liftPondFactor(run: RunState): number {
  const p = G.player.pos;
  if (p.y > -0.1) return 1;
  for (const room of run.rooms) {
    const L = room.layout.lifts;
    if (!L || room.state === 'idle') continue;
    const r = L.pond;
    if (p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ) return T.POND_SLOW;
  }
  return 1;
}

export function step(room: RoomRuntime, h: number): void {
  const run = needRun();
  const lifts = room.lifts;
  const L = room.layout.lifts;
  if (!lifts || !L) return;
  const q = room.question as McqQuestion | null;
  const playing = room.state === 'active' && run.phase === 'playing' && !run.detour && !G.player.inputLocked;
  const busy = lifts.some((l) => MOVING.includes(l.state));
  for (const l of lifts) {
    // boarding
    if (l.state === 'idle' && playing && !busy && onLift(l, L.half, L.z)) {
      l.charge += h / T.LIFT_BOARD_S;
      if (l.charge >= 1) { l.charge = 0; board(room, l); }
    } else if (l.charge > 0) l.charge = Math.max(0, l.charge - h * T.LIFT_BOARD_DECAY);
    // motion
    if (l.state === 'idle' || l.state === 'wrong' || l.state === 'up') {
      // nothing to advance
    } else {
      l.t += h;
      advance(room, l, q);
    }
    l.top = liftTop(l);
    const f = run.world.floors[l.floorId];
    f.top = l.top;
  }
}

function board(room: RoomRuntime, l: LiftRT): void {
  const q = room.question;
  if (!q) return;
  l.t = 0;
  if (l.correct) {
    if (room.wrongCount === 0 && !room.record) room.record = startRecord(room, q, true, room.activatedAtMs);
    room.feedback = { text: 'Going up!', tone: 'good' };
    l.state = 'rising';
  } else {
    room.wrongCount++;
    if (room.wrongCount === 1 && !room.record) room.record = startRecord(room, q, false, room.activatedAtMs);
    else if (room.record) room.record.wrongCount++;
    room.feedback = { text: `"${l.label}" is not it. ${q.hint}`, tone: 'bad' };
    l.state = 'stalling';
  }
  syncRoomPanel();
}

function advance(room: RoomRuntime, l: LiftRT, q: McqQuestion | null): void {
  const pl = G.player.pos;
  const at = { x: pl.x, y: 1.2 + Math.max(0, pl.y), z: pl.z };
  const L = room.layout.lifts!;
  switch (l.state) {
    case 'rising':
      if (l.t >= T.LIFT_RISE_S) {
        l.t = 0;
        if (onLift(l, L.half, L.z) || (G.player.grounded && Math.abs(pl.y - T.LIFT_TOP) < 0.3 && Math.abs(pl.x - l.x) < L.half + 0.5)) {
          l.state = 'up';
          room.feedback = { text: 'Correct!', tone: 'good' };
          celebrate(room, at, room.wrongCount === 0);
          resolveRoom(room, room.wrongCount === 0 ? 'correct' : 'remediated');
        } else {
          l.state = 'lowering';
          room.feedback = { text: 'Missed the ride! Step on again.', tone: 'bad' };
          syncRoomPanel();
        }
      }
      break;
    case 'lowering':
      if (l.t >= T.LIFT_LOWER_S) { l.state = 'idle'; l.t = 0; l.charge = 0; }
      break;
    case 'stalling':
      if (l.t >= T.LIFT_STALL_RISE_S) {
        l.state = 'holding'; l.t = 0;
        // the lift stops, and the surge lands
        if (q) {
          if (room.wrongCount === 1) surge(1); else surge(0.5);
          G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: room.wrongCount === 1, ...at });
        }
      }
      break;
    case 'holding':
      if (l.t >= T.LIFT_HOLD_S) { l.state = 'sinking'; l.t = 0; }
      break;
    case 'sinking':
      if (l.t >= T.LIFT_SINK_S) { l.state = 'wrong'; l.t = 0; l.top = T.LIFT_PIT; }
      break;
    default: break;
  }
}

/** 50/50: one wrong lift is marked X and disabled where it stands. */
export function crossOut(room: RoomRuntime, pick: number): boolean {
  const wrong = (room.lifts ?? []).filter((l) => !l.correct && l.state === 'idle');
  if (!wrong.length) return false;
  const l = wrong[Math.min(wrong.length - 1, pick)];
  l.state = 'wrong'; l.top = 0;
  return true;
}

export function canCross(room: RoomRuntime): boolean {
  const lifts = room.lifts ?? [];
  return !lifts.some((l) => MOVING.includes(l.state)) && lifts.some((l) => !l.correct && l.state === 'idle');
}
