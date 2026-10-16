import type { McqQuestion, TfQuestion } from '../../content/schema';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { PadRT, RoomRuntime, RunState } from '../runtime';
import type { Vec3 } from '../types';
import { surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';

/**
 * Launch Pads (F4-1). A tall hedge with no door stands across the room; the answers are pads in
 * front of it. Stand on a pad for LAUNCH_CHARGE_S and the bean flies a scripted arc: a right pad
 * clears the hedge and lands on the far side; a wrong pad drops it in the pond (Hard: the trap
 * maze) in front of the hedge, where the pad turns red and stays disabled.
 */

/** Pad row positions for `n` pads, centred on the lane. */
export function padXs(laneX: number, n: number): number[] {
  const spacing = n === 2 ? 6 : n === 3 ? 4.2 : 3.2;
  return Array.from({ length: n }, (_, i) => laneX + (i - (n - 1) / 2) * spacing);
}

export function activate(room: RoomRuntime): void {
  const run = needRun();
  const L = room.layout.launch!;
  beginRoom(room);
  const q = pickQuestion(room, ['mcq', 'truefalse'], 0) as McqQuestion | TfQuestion;
  room.question = q;
  room.wrongCount = 0;
  room.launching = null;
  let labels: { label: string; correct: boolean }[];
  if (q.type === 'truefalse') {
    labels = [{ label: 'TRUE', correct: q.answer }, { label: 'FALSE', correct: !q.answer }];
    if (run.qRng() < 0.5) labels.reverse();
  } else {
    const n = T.LAUNCH_MCQ_PADS[run.selection.difficulty];
    const wrong = shuffle(q.distractors, run.qRng).slice(0, n - 1).map((label) => ({ label, correct: false }));
    labels = shuffle([{ label: q.answer, correct: true }, ...wrong], run.qRng);
  }
  const xs = padXs(room.layout.laneX, labels.length);
  room.pads = labels.map((l, i): PadRT => ({ x: xs[i], z: L.padZ, label: l.label, correct: l.correct, state: 'idle', charge: 0 }));
}

function onPad(pad: PadRT): boolean {
  const p = G.player.pos;
  return Math.hypot(p.x - pad.x, p.z - pad.z) < T.LAUNCH_PAD_R;
}

/** Wade zone: the pond slows the bean on top of the slime. */
export function pondFactor(run: RunState): number {
  const p = G.player.pos;
  for (const room of run.rooms) {
    const L = room.layout.launch;
    if (!L || room.state === 'idle' || G.player.flight) continue;
    for (const r of L.pond) if (p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ) return T.POND_SLOW;
  }
  return 1;
}

export function step(room: RoomRuntime, h: number): void {
  const run = needRun();
  if (room.launching && !G.player.flight) land(room);
  if (room.state !== 'active' || run.phase !== 'playing' || room.launching || G.player.inputLocked || run.detour) return;
  for (const pad of room.pads) {
    if (pad.state === 'idle' && G.player.grounded && onPad(pad)) pad.charge += h / T.LAUNCH_CHARGE_S;
    else pad.charge = Math.max(0, pad.charge - h * T.LAUNCH_DECAY);
    if (pad.charge >= 1) { launch(room, pad); return; }
  }
}

function launch(room: RoomRuntime, pad: PadRT): void {
  const q = room.question;
  const L = room.layout.launch;
  if (!q || !L) return;
  const pl = G.player;
  const at = { x: pl.pos.x, y: 1.2, z: pl.pos.z };
  for (const p of room.pads) p.charge = 0;
  room.launching = { right: pad.correct };
  let to: Vec3;
  if (pad.correct) {
    to = { x: pad.x, y: 0, z: L.correctZ };
    if (room.wrongCount === 0) room.record = startRecord(room, q, true, room.activatedAtMs);
    room.feedback = { text: 'Correct! Hold on tight!', tone: 'good' };
  } else {
    to = L.trapLanding ? { ...L.trapLanding, y: 0 } : { x: pad.x, y: 0, z: L.pondZ };
    pad.state = 'wrong';
    room.wrongCount++;
    if (room.wrongCount === 1) {
      room.record = startRecord(room, q, false, room.activatedAtMs);
      surge(1);
    } else {
      if (room.record) room.record.wrongCount++;
      surge(0.5);
    }
    room.feedback = { text: `Splash! "${pad.label}" is not it. ${q.hint}`, tone: 'bad' };
    G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: room.wrongCount === 1, ...at });
  }
  pl.inputLocked = true;
  pl.flight = {
    t: 0, from: { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z }, to,
    dur: pad.correct ? T.LAUNCH_DUR_OK : T.LAUNCH_DUR_WRONG, apex: pad.correct ? T.LAUNCH_APEX_OK : T.LAUNCH_APEX_WRONG,
  };
  G.events.emit({ type: 'launch', ...at });
  syncRoomPanel();
}

/** The arc ended: a right answer resolves the room; a wrong one hands control back in the pond. */
function land(room: RoomRuntime): void {
  const right = room.launching!.right;
  room.launching = null;
  const pl = G.player;
  pl.inputLocked = false;
  const at = { x: pl.pos.x, y: 1.2, z: pl.pos.z };
  if (right) {
    room.feedback = { text: 'Correct!', tone: 'good' };
    celebrate(room, at, room.wrongCount === 0);
    resolveRoom(room, room.wrongCount === 0 ? 'correct' : 'remediated');
  }
  syncRoomPanel();
}
