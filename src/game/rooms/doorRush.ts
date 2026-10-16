import type { McqQuestion } from '../../content/schema';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { RoomRuntime } from '../runtime';
import { surge } from '../loop/progression';
import {
  armAnswerTimer, beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, stepAnswerTimer, syncRoomPanel,
} from '../loop/roomCommon';
import { registerReturnAction, startDetour } from './detour';
import { labelDoors, setPanelState, stepDoorWall, stepPanel } from './doors';
import { offerGold } from './goldDoor';

export function activate(room: RoomRuntime): void {
  const run = needRun();
  beginRoom(room);
  const q = pickQuestion(room, 'mcq', room.layout.tierMod) as McqQuestion;
  room.question = q;
  const dw = room.doorWalls[0];
  const n = dw.panels.length;
  const distractors = shuffle(q.distractors, run.qRng).slice(0, n - 1);
  const labels = shuffle([q.answer, ...distractors], run.qRng);
  labelDoors(run, dw, labels, labels.indexOf(q.answer), q.id);
  armAnswerTimer(room);
}

export function onTouch(room: RoomRuntime, panelIndex: number): void {
  const run = needRun();
  if (room.state !== 'active' || room.wrongDoor || run.phase !== 'playing') return;
  const dw = room.doorWalls[0];
  const panel = dw.panels[panelIndex];
  const q = room.question;
  if (!panel || !q) return;
  const pl = G.player;

  if (panel.state === 'smashed' || panel.state === 'wrongX') {
    pl.vel.y = 3; pl.vel.z = 4;
    return;
  }
  const at = { x: pl.pos.x, y: 1.2, z: pl.pos.z };
  if (panel.isCorrect) {
    setPanelState(run, panel, 'burst');
    G.events.emit({ type: 'doorBurst', ...at });
    room.record = startRecord(room, q, true, room.activatedAtMs);
    room.feedback = { text: 'Correct!', tone: 'good' };
    celebrate(room, at, true);
    resolveRoom(room, 'correct');
    offerGold(run, room);
    return;
  }
  // wrong door: swing open, trapdoor, fall into the detour
  setPanelState(run, panel, 'swing');
  const right = dw.panels.find((p) => p.isCorrect);
  if (right) right.glow = false;
  room.wrongCount++;
  pl.forcedFall = true;
  pl.inputLocked = true;
  pl.vel.x = 0; pl.vel.y = 2; pl.vel.z = -3;
  room.record = startRecord(room, q, false, room.activatedAtMs);
  surge(1);
  room.wrongDoor = { t: 0, panel: panelIndex };
  G.events.emit({ type: 'doorWrong', ...at });
  G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: true, ...at });
  syncRoomPanel();
}

export function step(room: RoomRuntime, h: number): void {
  for (const dw of room.doorWalls) stepDoorWall(dw, h);
  if (room.gold) stepPanel(room.gold, h);
  if (!room.wrongDoor && stepAnswerTimer(room, h)) timeUp(room);
  if (room.wrongDoor) {
    room.wrongDoor.t += h;
    if (room.wrongDoor.t >= T.WRONG_DOOR_FALL_TIME || G.player.pos.y < -3) {
      room.wrongDoor.t = -999;
      startDetour(room);
    }
  }
}

/** The countdown ran out: the doors lock and it counts as wrong, so the detour starts. */
function timeUp(room: RoomRuntime): void {
  const q = room.question;
  if (!q) return;
  const pl = G.player.pos;
  const at = { x: pl.x, y: 1.2, z: pl.z };
  room.wrongCount++;
  room.record = startRecord(room, q, false, room.activatedAtMs);
  surge(1);
  room.feedback = { text: 'Time is up!', tone: 'bad' };
  G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: true, ...at });
  syncRoomPanel();
  startDetour(room);
}

/** Back from the detour: open the right door, close the wrong one with a red X (spec §10.2). */
export function onReturn(room: RoomRuntime, remediated: boolean): void {
  const run = needRun();
  const dw = room.doorWalls[0];
  for (const p of dw.panels) {
    if (p.isCorrect) setPanelState(run, p, 'burst');
    else if (p.state === 'swing') setPanelState(run, p, 'wrongX');
  }
  const right = dw.panels.find((p) => p.isCorrect);
  if (right) right.anim = 1;
  room.wrongDoor = null;
  if (room.record) room.record.remediated = remediated;
  resolveRoom(room, remediated ? 'remediated' : 'wrongCompleted');
}

registerReturnAction('doorRush', onReturn);
