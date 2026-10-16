import type { TfQuestion } from '../../content/schema';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { RoomRuntime, TileRT } from '../runtime';
import { surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';
import { registerReturnAction, startDetour } from './detour';

function tileUnderPlayer(room: RoomRuntime): TileRT | null {
  const p = G.player.pos;
  for (const t of room.tiles) {
    if (t.state === 'gone') continue;
    if (Math.abs(p.x - t.cx) <= t.sx / 2 && Math.abs(p.z - t.cz) <= t.sz / 2) return t;
  }
  return null;
}

export function activate(room: RoomRuntime): void {
  const run = needRun();
  beginRoom(room);
  const q = pickQuestion(room, 'truefalse', room.layout.tierMod) as TfQuestion;
  room.question = q;
  const flip = run.qRng() < 0.5 ? 0 : 1;
  for (const t of room.tiles) {
    t.label = (t.slot + t.row + flip) % 2 === 0 ? 'TRUE' : 'FALSE';
    t.correct = (t.label === 'TRUE') === q.answer;
    t.state = 'solid'; t.t = 0; t.glow = false; t.visible = true; t.revealed = true;
  }
  const total = T.TILE_TIMER[run.selection.difficulty];
  room.timer = { started: false, remaining: total, total, ended: false, shakeT: 0, evaluated: false, correct: null, pendingDetour: false };
}

function evaluate(room: RoomRuntime): void {
  const q = room.question!;
  const tile = tileUnderPlayer(room);
  const ok = !!tile && tile.correct;
  room.timer.ended = true;
  room.timer.evaluated = true;
  room.timer.correct = ok;
  room.timer.remaining = 0;
  for (const t of room.tiles) {
    if (!t.correct && t.state === 'solid') { t.state = 'shaking'; t.t = 0; }
  }
  G.events.emit({ type: 'tileShake' });
  const pl = G.player.pos;
  const at = { x: pl.x, y: 1.2, z: pl.z };
  if (ok) {
    room.record = startRecord(room, q, true, room.activatedAtMs);
    room.feedback = { text: 'Correct!', tone: 'good' };
    celebrate(room, at, true);
    resolveRoom(room, 'correct');
  } else {
    room.wrongCount++;
    room.record = startRecord(room, q, false, room.activatedAtMs);
    surge(1);
    room.timer.pendingDetour = true;
    room.feedback = { text: tile ? 'Not that one!' : 'Time is up!', tone: 'bad' };
    G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: true, ...at });
  }
  syncRoomPanel();
}

export function step(room: RoomRuntime, h: number): void {
  // activation-independent tile animation
  for (const t of room.tiles) {
    if (t.state === 'shaking') {
      t.t += h;
      if (t.t >= T.TILE_SHAKE_TIME) {
        t.state = 'falling'; t.t = 0;
        needRun().world.floors[t.floorId].enabled = false;
      }
    } else if (t.state === 'falling') {
      t.t += h;
      if (t.t >= T.TILE_FALL_TIME) { t.state = 'gone'; t.visible = false; }
    }
  }
  if (room.state === 'active' && !room.timer.ended) {
    const t = room.timer;
    if (!t.started && G.player.grounded && tileUnderPlayer(room)) { t.started = true; syncRoomPanel(); }
    if (t.started) {
      t.remaining -= h;
      if (t.remaining <= 0) evaluate(room);
    }
  }
  if (room.timer.evaluated) {
    room.timer.shakeT += h;
    // the exit gate opens when shaking ends if the answer was right
    if (room.timer.correct && room.timer.shakeT >= T.TILE_SHAKE_TIME) {
      needRun().world.walls[room.layout.exitGateWallId!].enabled = false;
    }
    if (room.timer.pendingDetour) {
      const onWrong = (() => { const tile = tileUnderPlayer(room); return !!tile && !tile.correct; })();
      const shakeDone = room.timer.shakeT >= T.TILE_SHAKE_TIME;
      // player on a wrong tile falls through (fall handler starts the detour); otherwise start it now,
      // with a fallback so nobody gets stuck
      if ((shakeDone && !onWrong) || room.timer.shakeT >= T.TILE_SHAKE_TIME + T.TILE_FALL_TIME + 1) {
        room.timer.pendingDetour = false;
        startDetour(room);
      }
    }
  }
}

/** A fall while the wrong answer is pending: go to the detour. */
export function onFall(room: RoomRuntime): boolean {
  if (!room.timer.pendingDetour) return false;
  room.timer.pendingDetour = false;
  startDetour(room);
  return true;
}

export function onReturn(room: RoomRuntime, remediated: boolean): void {
  const run = needRun();
  run.world.walls[room.layout.exitGateWallId!].enabled = false;
  room.timer.pendingDetour = false;
  if (room.record) room.record.remediated = remediated;
  resolveRoom(room, remediated ? 'remediated' : 'wrongCompleted');
}

registerReturnAction('tileDrop', onReturn);
