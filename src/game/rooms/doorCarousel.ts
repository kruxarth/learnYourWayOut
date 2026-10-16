import type { McqQuestion } from '../../content/schema';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { RoomRuntime } from '../runtime';
import { surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';
import { wrapX } from '../loop/segmentsDoorMemory';
import { registerReturnAction, startDetour } from './detour';
import { labelDoors, setPanelState, stepDoorWall, stepPanel } from './doors';
import { offerGold } from './goldDoor';

/**
 * Door Carousel (F4-5). One 4 m opening in a wall; behind it a contiguous train of labelled door
 * panels slides sideways in a loop (dynamic WallBoxes, moved every step). Run into the panel that is
 * in the opening: a right one bursts (and may offer the Gold Door), a wrong one follows Door Rush
 * (swing, trapdoor, surge, detour).
 */

/** Centre x of panel `i`, relative to the lane. */
export function panelCenter(room: RoomRuntime, i: number): number {
  const c = room.layout.carousel!, rt = room.carousel!;
  return wrapX(rt.offset + i * c.panelW, c.loopLen);
}

/** Move every panel's WallBox to the train position. */
function place(room: RoomRuntime): void {
  const run = needRun();
  const c = room.layout.carousel!;
  room.doorWalls[0].panels.forEach((p, i) => {
    const w = run.world.walls[p.wallId];
    const cx = room.layout.laneX + panelCenter(room, i);
    w.minX = cx - c.panelW / 2; w.maxX = cx + c.panelW / 2;
    w.minZ = c.minZ; w.maxZ = c.maxZ;
  });
}

/** Put panel `index` exactly in the opening (the train stops there). */
function alignTo(room: RoomRuntime, index: number): void {
  const c = room.layout.carousel!, rt = room.carousel!;
  rt.offset = wrapX(-index * c.panelW, c.loopLen);
  rt.frozen = true;
  place(room);
}

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
  // a different starting phase every run (question stream, so it is deterministic per seed)
  room.carousel!.offset = run.qRng() * room.layout.carousel!.loopLen;
  room.carousel!.frozen = false;
  place(room);
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
    alignTo(room, panelIndex);
    setPanelState(run, panel, 'burst');
    G.events.emit({ type: 'doorBurst', ...at });
    room.record = startRecord(room, q, true, room.activatedAtMs);
    room.feedback = { text: 'Correct!', tone: 'good' };
    celebrate(room, at, true);
    resolveRoom(room, 'correct');
    offerGold(run, room);
    return;
  }
  // wrong panel: swing open, trapdoor, fall into the detour
  alignTo(room, panelIndex);
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
  const run = needRun();
  const rt = room.carousel!;
  if (room.state === 'active' && !rt.frozen && !room.wrongDoor && run.phase === 'playing' && !run.detour) {
    const c = room.layout.carousel!;
    rt.offset = wrapX(rt.offset + T.CAROUSEL_SPEED[run.selection.difficulty] * h, c.loopLen);
    place(room);
  }
  stepDoorWall(room.doorWalls[0], h);
  if (room.gold) stepPanel(room.gold, h);
  if (room.wrongDoor) {
    room.wrongDoor.t += h;
    if (room.wrongDoor.t >= T.WRONG_DOOR_FALL_TIME || G.player.pos.y < -3) {
      room.wrongDoor.t = -999;
      startDetour(room);
    }
  }
}

/** Back from the detour: the right panel is brought to the opening and bursts; the wrong one gets a red X. */
export function onReturn(room: RoomRuntime, remediated: boolean): void {
  const run = needRun();
  const dw = room.doorWalls[0];
  const ci = dw.panels.findIndex((p) => p.isCorrect);
  alignTo(room, ci);
  for (const p of dw.panels) {
    if (p.isCorrect) setPanelState(run, p, 'burst');
    else if (p.state === 'swing') setPanelState(run, p, 'wrongX');
  }
  dw.panels[ci].anim = 1;
  room.wrongDoor = null;
  if (room.record) room.record.remediated = remediated;
  resolveRoom(room, remediated ? 'remediated' : 'wrongCompleted');
}

registerReturnAction('doorCarousel', onReturn);
