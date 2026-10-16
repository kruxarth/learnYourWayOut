import type { McqQuestion, TfQuestion } from '../../content/schema';
import { pushToast } from '../../ui/store';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { AlcoveRT, BoulderRT, BoulderWaveRT, RoomRuntime, RunState } from '../runtime';
import { fadeRespawn, surge, wadeFactor } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';

/**
 * Boulder Run (F4-6). A 40 m corridor. The question appears on entry and the ground rumbles; then a boulder
 * is released behind the player and rolls at 0.8 x MAX_SPEED (0.9 on Hard). Alcoves near the end carry the
 * answers: duck into one and the boulder rolls past. The right alcove opens a gate to a channel that leads
 * round the end wall to the exit; a wrong one is a dead end, marked X, that costs a surge (the boulder
 * smashes into the end wall, then a new one is released after a short rumble). A boulder that catches the
 * player flattens them: surge x0.5, back to the room start, and the same question again. A Shield blocks one
 * squash. Hard has two waves: pockets halfway (a first question), the real alcoves at the end (a second).
 *
 * Everything is a function of the run: the boulder advances by speed x h each step (speed follows the slime
 * wade slow-down, so it is always 0.8 of what the player can do), and stands still during Slime Freeze.
 */

/** Boulder speed (m/s) now: a fraction of what the player runs at on this slime level. */
export function boulderSpeed(run: RunState): number {
  return T.BOULDER_SPEED[run.selection.difficulty] * T.MAX_SPEED * wadeFactor(run);
}

export function rumbleSeconds(run: RunState): number {
  return T.BOULDER_RUMBLE_S[run.selection.difficulty];
}

export function activate(room: RoomRuntime): void {
  beginRoom(room);
  room.wrongCount = 0;
  const B: BoulderRT = { waves: [], wave: -1, phase: 'rumble', t: 0, d: T.BOULDER_START, shielded: false, squashes: 0 };
  room.boulder = B;
  startWave(room, 0);
}

/** Pick the wave's question, deal the labels onto its alcove slots and start the rumble. */
function startWave(room: RoomRuntime, wi: number): void {
  const run = needRun();
  const B = room.boulder!;
  const L = room.layout.boulder!;
  const slots = L.waves[wi];
  const last = wi === L.waves.length - 1;
  // the real alcoves are 3 (an mcq); the mid-run pockets are 2 (true/false, or an mcq with one distractor)
  const q = pickQuestion(room, last ? 'mcq' : ['truefalse', 'mcq'], 0) as McqQuestion | TfQuestion;
  let labels: { label: string; correct: boolean }[];
  if (q.type === 'truefalse') {
    labels = [{ label: 'TRUE', correct: q.answer }, { label: 'FALSE', correct: !q.answer }];
    if (run.qRng() < 0.5) labels.reverse();
  } else {
    const wrong = shuffle(q.distractors, run.qRng).slice(0, slots.length - 1).map((label) => ({ label, correct: false }));
    labels = shuffle([{ label: q.answer, correct: true }, ...wrong], run.qRng);
  }
  const wave: BoulderWaveRT = {
    question: q, passed: false, wrong: 0, startMs: run.elapsedMs, record: null,
    alcoves: labels.map((l, i): AlcoveRT => ({ slot: slots[i], label: l.label, correct: l.correct, state: 'open' })),
  };
  B.waves[wi] = wave;
  B.wave = wi;
  B.phase = 'rumble'; B.t = 0; B.d = T.BOULDER_START; B.shielded = false;
  room.question = q;
  room.fiftyUsed = false; room.hintUsed = false; room.hintShown = null;
  room.feedback = null;
  room.activatedAtMs = run.elapsedMs;
  syncRoomPanel();
}

function rearm(room: RoomRuntime, seconds: number): void {
  const B = room.boulder!;
  // a shorter rumble than the first one: t starts below zero so the same limit applies
  B.phase = 'rumble'; B.d = T.BOULDER_START; B.shielded = false;
  B.t = rumbleSeconds(needRun()) - seconds;
  syncRoomPanel();
}

/** Seconds of rumble left (for the HUD footer and the render). */
export function rumbleLeft(room: RoomRuntime): number {
  const B = room.boulder;
  if (!B || B.phase !== 'rumble') return 0;
  return Math.max(0, rumbleSeconds(needRun()) - B.t);
}

function inAlcove(room: RoomRuntime, slot: number): boolean {
  const L = room.layout.boulder!;
  const a = L.alcoves[slot];
  const p = G.player.pos;
  const dx = (p.x - L.axisX) * a.side;
  return dx >= T.BOULDER_ENTER_X && dx <= T.BOULDER_CW + T.BOULDER_ALC_DEPTH + 0.1 && p.z >= a.minZ && p.z <= a.maxZ;
}

function enterAlcove(room: RoomRuntime, wave: BoulderWaveRT, al: AlcoveRT): void {
  const run = needRun();
  const B = room.boulder!;
  const L = room.layout.boulder!;
  const q = wave.question;
  const pl = G.player.pos;
  const at = { x: pl.x, y: 1.2, z: pl.z };
  const last = B.wave === L.waves.length - 1;
  if (al.correct) {
    al.state = 'right';
    wave.passed = true;
    const firstTry = wave.wrong === 0;
    if (firstTry) wave.record = startRecord(room, q, true, wave.startMs);
    else if (wave.record) wave.record.remediated = true;
    room.feedback = { text: last ? 'Correct! The way on opens.' : 'Correct! Wait for it to pass.', tone: 'good' };
    celebrate(room, at, firstTry);
    if (last) {
      const gid = L.alcoves[al.slot].gateWallId;
      if (gid !== null) run.world.walls[gid].enabled = false;
      room.record = wave.record;
      resolveRoom(room, room.wrongCount === 0 ? 'correct' : 'remediated');
      if (B.phase === 'rumble') B.phase = 'idle'; // the boulder was never released
    } else if (B.phase === 'rumble') {
      startWave(room, B.wave + 1);
    }
    // a rolling boulder runs on to the end wall, then the next wave starts
  } else {
    al.state = 'wrong';
    if (wave.wrong === 0) {
      wave.record = startRecord(room, q, false, wave.startMs);
      surge(1);
    } else {
      if (wave.record) wave.record.wrongCount++;
      surge(0.5);
    }
    wave.wrong++;
    room.wrongCount++;
    room.feedback = { text: `Dead end! "${al.label}" is not it. ${q.hint}`, tone: 'bad' };
    G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: wave.wrong === 1, ...at });
  }
  syncRoomPanel();
}

function squash(room: RoomRuntime): void {
  const run = needRun();
  const B = room.boulder!;
  const L = room.layout.boulder!;
  if (run.shield) {
    run.shield = false;
    B.shielded = true;
    pushToast('Shield blocked the boulder!', 'good');
    G.events.emit({ type: 'lifeline', kind: 'fifty', ok: true });
    return;
  }
  B.phase = 'squash'; B.t = 0; B.squashes++;
  G.player.spin = 0.5;
  G.events.emit({ type: 'bounce' });
  surge(T.BOULDER_SQUASH_SURGE);
  room.feedback = { text: 'SQUASHED! Read faster and run for the right alcove.', tone: 'bad' };
  pushToast('Squashed!', 'bad');
  fadeRespawn(L.startSpawn, () => {
    if (room.state === 'active' && room.boulder === B) rearm(room, rumbleSeconds(run));
    syncRoomPanel();
  });
  syncRoomPanel();
}

export function step(room: RoomRuntime, h: number): void {
  const B = room.boulder;
  if (!B) return;
  const run = needRun();
  if (run.phase !== 'playing' || run.detour) return;
  const L = room.layout.boulder!;
  const wave = B.waves[B.wave];

  // alcoves: stepping in is the answer
  if (room.state === 'active' && wave && !wave.passed && B.phase !== 'squash' && !G.player.flight) {
    for (const al of wave.alcoves) {
      if (al.state === 'open' && inAlcove(room, al.slot)) { enterAlcove(room, wave, al); break; }
    }
  }
  if (B.phase === 'idle' || B.phase === 'squash') return;
  if (run.freezeT > 0) return; // Slime Freeze stops the boulder too

  if (B.phase === 'rumble') {
    B.t += h;
    if (room.state === 'active') G.camera.shake = Math.max(G.camera.shake, T.BOULDER_RUMBLE_SHAKE);
    if (B.t >= rumbleSeconds(run)) {
      B.phase = 'rolling'; B.t = 0; B.d = T.BOULDER_START;
      if (room.state === 'active') pushToast('The boulder is coming! RUN!', 'bad');
    }
  } else if (B.phase === 'rolling') {
    B.d += boulderSpeed(run) * h;
    const endD = T.BOULDER_LEN - T.BOULDER_R;
    if (room.state === 'active' && !B.shielded && !run.godMode) {
      const pl = G.player.pos;
      const dx = pl.x - L.axisX, dz = pl.z - (L.z0 - B.d);
      const r = T.BOULDER_R + T.PLAYER_RADIUS;
      if (dx * dx + dz * dz < r * r) { squash(room); return; }
    }
    if (B.d >= endD) { B.phase = 'smash'; B.t = 0; G.camera.shake = Math.max(G.camera.shake, 0.5); G.events.emit({ type: 'doorWrong', x: L.axisX, y: 1, z: L.endZ }); }
  } else if (B.phase === 'smash') {
    B.t += h;
    if (B.t < T.BOULDER_SMASH_S) return;
    if (room.state !== 'active') { B.phase = 'idle'; return; }
    if (wave && wave.passed) {
      const next = B.wave + 1;
      if (next < L.waves.length) startWave(room, next);
      else B.phase = 'idle';
    } else {
      rearm(room, T.BOULDER_REARM_S);
    }
  }
}

/** A 50/50 (or X-ray) crosses out one wrong alcove of the current wave. */
export function canFifty(room: RoomRuntime): boolean {
  const B = room.boulder;
  const w = B?.waves[B.wave];
  return !!w && !w.passed && w.alcoves.some((a) => !a.correct && a.state === 'open');
}

export function applyFifty(room: RoomRuntime): boolean {
  const B = room.boulder;
  const w = B?.waves[B.wave];
  if (!w) return false;
  const wrong = w.alcoves.filter((a) => !a.correct && a.state === 'open');
  if (!wrong.length) return false;
  wrong[Math.floor(needRun().qRng() * wrong.length)].state = 'wrong';
  return true;
}
