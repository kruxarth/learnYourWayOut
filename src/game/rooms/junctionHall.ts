import type { McqQuestion } from '../../content/schema';
import { pushToast, showBanner } from '../../ui/store';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import type { RoomRuntime } from '../runtime';
import { surge } from '../loop/progression';
import {
  armAnswerTimer, beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, stepAnswerTimer, syncRoomPanel,
} from '../loop/roomCommon';
import { labelDoors, setPanelState, stepDoorWall } from './doors';

/**
 * Junction Hall (P1-D): the fork as a question. The right door opens the gate to the shortcut
 * (harder questions), a wrong one the gate to the scenic lane (easier questions, an extra room,
 * remediation boards at its start). No teleport: the penalty is the longer road.
 */

export function activate(room: RoomRuntime): void {
  const run = needRun();
  beginRoom(room);
  const q = pickQuestion(room, 'mcq', room.layout.tierMod) as McqQuestion;
  room.question = q;
  const dw = room.doorWalls[0];
  const n = dw.panels.length;
  const labels = shuffle([q.answer, ...shuffle(q.distractors, run.qRng).slice(0, n - 1)], run.qRng);
  labelDoors(run, dw, labels, labels.indexOf(q.answer), q.id);
  armAnswerTimer(room);
}

function openLane(room: RoomRuntime, lane: 'short' | 'long'): void {
  const run = needRun();
  const gates = room.layout.laneGates!;
  run.world.walls[gates[lane]].enabled = false;
}

export function onTouch(room: RoomRuntime, panelIndex: number): void {
  const run = needRun();
  if (room.state !== 'active' || run.phase !== 'playing') return;
  const panel = room.doorWalls[0].panels[panelIndex];
  const q = room.question;
  const pl = G.player;
  if (!panel || !q) return;
  if (panel.state !== 'closed') return;
  const at = { x: pl.pos.x, y: 1.2, z: pl.pos.z };
  if (panel.isCorrect) {
    setPanelState(run, panel, 'burst');
    G.events.emit({ type: 'doorBurst', ...at });
    room.record = startRecord(room, q, true, room.activatedAtMs);
    celebrate(room, at, true);
    openLane(room, 'short');
    showBanner('SHORTCUT OPEN!', 'good', 1200);
    resolveRoom(room, 'correct');
    return;
  }
  setPanelState(run, panel, 'swing');
  wrong(room, at, `Not "${panel.label}". Scenic route — read the boards on the way.`);
}

function wrong(room: RoomRuntime, at: { x: number; y: number; z: number }, toast: string): void {
  const q = room.question!;
  room.wrongCount++;
  room.record = startRecord(room, q, false, room.activatedAtMs);
  surge(1);
  G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: true, ...at });
  openLane(room, 'long');
  showBanner('SCENIC ROUTE', 'info', 1200);
  pushToast(toast, 'bad', 2600);
  resolveRoom(room, 'wrongCompleted');
}

export function step(room: RoomRuntime, h: number): void {
  for (const dw of room.doorWalls) stepDoorWall(dw, h);
  if (stepAnswerTimer(room, h)) {
    const run = needRun();
    // time is up: the wrong doors swing open and lead to the scenic lane
    for (const p of room.doorWalls[0].panels) if (!p.isCorrect && p.state === 'closed') setPanelState(run, p, 'swing');
    const pl = G.player.pos;
    wrong(room, { x: pl.x, y: 1.2, z: pl.z }, 'Time is up! Scenic route — read the boards on the way.');
    syncRoomPanel();
  }
}
