import type { McqQuestion } from '../../content/schema';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { KeyRT, RoomRuntime } from '../runtime';
import { surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';

/**
 * Key Hunt (F4-3). The exit of the maze is a locked gate (the question is in the HUD card). Keys lie in dead
 * ends, each labelled with an answer. Walk over a key to carry it (one at a time, F drops it) and bring
 * it to the gate. The right key opens the gate; a wrong key zaps the bean back about 3 m, goes home
 * marked with an X, and costs a surge (the first a full one, later ones x0.5).
 */

export function activate(room: RoomRuntime): void {
  const run = needRun();
  const H = room.layout.hunt!;
  beginRoom(room);
  const q = pickQuestion(room, 'mcq', 0) as McqQuestion;
  room.question = q;
  const n = H.spots.length;
  const wrong = shuffle(q.distractors, run.qRng).slice(0, n - 1).map((label) => ({ label, correct: false }));
  const labels = shuffle([{ label: q.answer, correct: true }, ...wrong], run.qRng);
  room.keys = labels.map((l, i): KeyRT => ({
    id: `${room.id}:k${i}`, label: l.label, correct: l.correct, state: 'home', home: { x: H.spots[i].x, z: H.spots[i].z }, cool: 0,
  }));
  room.wrongCount = 0;
  room.lockT = 0;
  G.player.carrying = null;
}

function carried(room: RoomRuntime): KeyRT | undefined {
  return room.keys.find((k) => k.id === G.player.carrying);
}

export function drop(room: RoomRuntime): void {
  const k = carried(room);
  if (!k) return;
  G.player.carrying = null;
  k.state = 'home'; k.cool = 0.7;
  syncRoomPanel();
}

export function step(room: RoomRuntime, h: number): void {
  const run = needRun();
  for (const k of room.keys) if (k.cool > 0) k.cool -= h;
  if (room.lockT > 0) {
    room.lockT -= h;
    if (room.lockT <= 0) { room.lockT = 0; G.player.inputLocked = false; }
  }
  if (room.state !== 'active' || run.phase !== 'playing') return;
  const p = G.player.pos;

  if (!G.player.carrying && room.lockT <= 0) {
    for (const k of room.keys) {
      if (k.state !== 'home' || k.cool > 0) continue;
      const dx = p.x - k.home.x, dz = p.z - k.home.z;
      if (dx * dx + dz * dz <= T.PICKUP_RADIUS * T.PICKUP_RADIUS) {
        k.state = 'carried'; G.player.carrying = k.id;
        G.events.emit({ type: 'blockPickup' });
        syncRoomPanel();
        break;
      }
    }
  }

  const key = carried(room);
  if (key) {
    const gate = room.layout.hunt!.gate;
    if (Math.hypot(p.x - gate.x, p.z - gate.z) <= T.HUNT_GATE_R) deliver(room, key);
  }
}

function deliver(room: RoomRuntime, key: KeyRT): void {
  const run = needRun();
  const q = room.question as McqQuestion;
  const H = room.layout.hunt!;
  const pl = G.player;
  const at = { x: pl.pos.x, y: 1.2, z: pl.pos.z };
  pl.carrying = null;
  if (key.correct) {
    key.state = 'used';
    run.world.walls[H.gateWallId].enabled = false;
    const firstTry = room.wrongCount === 0;
    if (firstTry) room.record = startRecord(room, q, true, room.activatedAtMs);
    room.feedback = { text: 'The gate opens!', tone: 'good' };
    celebrate(room, at, firstTry);
    resolveRoom(room, firstTry ? 'correct' : 'remediated');
    return;
  }
  key.state = 'wrong';
  if (room.wrongCount === 0) {
    room.record = startRecord(room, q, false, room.activatedAtMs);
    surge(1);
  } else {
    if (room.record) room.record.wrongCount++;
    surge(0.5);
  }
  room.wrongCount++;
  room.feedback = { text: `Zap! "${key.label}" is not the key. ${q.hint}`, tone: 'bad' };
  // push the bean about 3 m away from the gate (collision keeps it inside the maze)
  const dx = pl.pos.x - H.gate.x, dz = pl.pos.z - H.gate.z;
  const len = Math.hypot(dx, dz) || 1;
  pl.vel.x = (dx / len) * T.HUNT_ZAP_SPEED;
  pl.vel.z = (dz / len) * T.HUNT_ZAP_SPEED;
  pl.inputLocked = true;
  room.lockT = T.HUNT_ZAP_LOCK;
  pl.spin = 0.4;
  G.events.emit({ type: 'stepWrong' });
  syncRoomPanel();
}

function crossable(room: RoomRuntime): KeyRT[] {
  return room.keys.filter((k) => !k.correct && k.state === 'home');
}

/** A 50/50 (or X-ray) crosses out one wrong key that is still lying in its dead end. */
export function canFifty(room: RoomRuntime): boolean {
  return crossable(room).length > 0;
}

export function applyFifty(room: RoomRuntime): boolean {
  const list = crossable(room);
  if (!list.length) return false;
  list[Math.floor(needRun().qRng() * list.length)].state = 'wrong';
  return true;
}
