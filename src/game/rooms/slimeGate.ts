import type { McqQuestion } from '../../content/schema';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import type { RoomRuntime } from '../runtime';
import { surge } from '../loop/progression';
import {
  armAnswerTimer, beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, stepAnswerTimer, syncRoomPanel,
} from '../loop/roomCommon';
import { T } from '../tuning';
import { labelDoors, setPanelState, stepDoorWall, usableDoors } from './doors';

/** Slime Gate: K door walls in a row, each one a main question. No detour. */
export function activateWall(room: RoomRuntime, wall: number): void {
  const run = needRun();
  if (room.wallQuestions[wall] || wall >= room.doorWalls.length) return;
  if (room.state === 'idle') beginRoom(room);
  else {
    room.fiftyUsed = false; room.hintUsed = false; room.hintShown = null; room.feedback = null;
    room.activatedAtMs = run.elapsedMs;
  }
  room.currentWall = wall;
  const q = pickQuestion(room, 'mcq', 0) as McqQuestion;
  room.question = q;
  room.wallQuestions[wall] = q;
  const dw = room.doorWalls[wall];
  const n = dw.panels.length;
  const labels = shuffle([q.answer, ...shuffle(q.distractors, run.qRng).slice(0, n - 1)], run.qRng);
  labelDoors(run, dw, labels, labels.indexOf(q.answer), q.id);
  room.lockT = 0;
  armAnswerTimer(room);
}

export function onTouch(room: RoomRuntime, wallIndex: number, panelIndex: number): void {
  const run = needRun();
  const pl = G.player;
  if (run.phase !== 'playing') return;
  const dw = room.doorWalls[wallIndex];
  const panel = dw?.panels[panelIndex];
  const q = room.wallQuestions[wallIndex];
  if (!panel || !q || room.state !== 'active' || wallIndex !== room.currentWall || room.wallDone[wallIndex]) {
    pl.vel.y = 3; pl.vel.z = 4;
    return;
  }
  if (panel.state === 'smashed' || panel.state === 'wrongX' || room.lockT > 0) {
    pl.vel.y = 3; pl.vel.z = 4;
    return;
  }
  const at = { x: pl.pos.x, y: 1.2, z: pl.pos.z };
  if (panel.isCorrect) {
    room.answerTimer = null;
    setPanelState(run, panel, 'burst');
    G.events.emit({ type: 'doorBurst', ...at });
    const firstTry = room.wallWrong[wallIndex] === 0;
    if (firstTry) room.wallRecords[wallIndex] = startRecord(room, q, true, room.activatedAtMs);
    room.wallDone[wallIndex] = true;
    room.feedback = { text: 'Correct!', tone: 'good' };
    celebrate(room, at, firstTry);
    if (room.wallDone.every(Boolean)) resolveRoom(room, 'correct');
    return;
  }
  // wrong: red X, bounce back, big surge
  setPanelState(run, panel, 'wrongX');
  pl.vel.y = 5; pl.vel.z = 7;
  pl.spin = 0.5;
  G.events.emit({ type: 'bounce' });
  wrongAnswer(room, wallIndex, `Not "${panel.label}"!`, at);
}

function wrongAnswer(room: RoomRuntime, wallIndex: number, text: string, at: { x: number; y: number; z: number }): void {
  const run = needRun();
  const d = run.selection.difficulty;
  const q = room.wallQuestions[wallIndex]!;
  if (room.wallWrong[wallIndex] === 0) room.wallRecords[wallIndex] = startRecord(room, q, false, room.activatedAtMs);
  else room.wallRecords[wallIndex]!.wrongCount++;
  room.wallWrong[wallIndex]++;
  room.wrongCount++;
  surge(1);
  room.lockT = T.GATE_LOCK_TIME[d];
  room.feedback = { text: room.lockT > 0 ? `${text} Gate locked for ${room.lockT} s.` : text, tone: 'bad' };
  G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: room.wallWrong[wallIndex] === 1, ...at });
  const usable = usableDoors(room.doorWalls[wallIndex]);
  if (usable.length <= 1 && T.SLIME_GATE_LAST_GLOW[d]) for (const p of usable) p.glow = true;
  // a fresh clock for the next try
  if (room.answerTimer) { room.answerTimer.remaining = room.answerTimer.total; room.answerTimer.done = false; }
}

export function step(room: RoomRuntime, h: number): void {
  for (const dw of room.doorWalls) stepDoorWall(dw, h);
  if (room.lockT > 0) {
    room.lockT = Math.max(0, room.lockT - h);
    if (room.lockT === 0) syncRoomPanel();
  }
  if (room.currentWall >= 0 && !room.wallDone[room.currentWall] && stepAnswerTimer(room, h)) {
    const pl = G.player.pos;
    wrongAnswer(room, room.currentWall, 'Time is up!', { x: pl.x, y: 1.2, z: pl.z });
    syncRoomPanel();
  }
}
