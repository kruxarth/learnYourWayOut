import { shuffle } from '../rng';
import type { StepsQuestion } from '../../content/schema';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { RoomRuntime, TileRT } from '../runtime';
import { fadeRespawn, surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';

/** Lay out row i: shuffled labels across the row's slots, all tiles solid again. */
function layRow(room: RoomRuntime, q: StepsQuestion, i: number, revealed: boolean): void {
  const run = needRun();
  const row = q.steps[i];
  const labels = shuffle([row.correct, ...row.wrong], run.qRng);
  const n = labels.length;
  const w = T.STEP_ROW_WIDTH / n;
  for (let s = 0; s < 3; s++) {
    const tile = room.stepRows[i][s];
    const floor = run.world.floors[tile.floorId];
    if (s < n) {
      floor.minX = room.layout.laneX - T.STEP_ROW_WIDTH / 2 + s * w;
      floor.maxX = room.layout.laneX - T.STEP_ROW_WIDTH / 2 + (s + 1) * w;
      floor.enabled = true;
      tile.cx = (floor.minX + floor.maxX) / 2;
      tile.sx = w;
      tile.label = labels[s];
      tile.correct = labels[s] === row.correct;
      tile.state = 'solid'; tile.t = 0; tile.glow = false; tile.visible = true; tile.revealed = revealed;
    } else {
      floor.enabled = false;
      tile.visible = false;
    }
  }
}

export function activate(room: RoomRuntime): void {
  beginRoom(room);
  const q = pickQuestion(room, 'steps', 0) as StepsQuestion;
  room.question = q;
  for (let i = 0; i < 4; i++) layRow(room, q, i, i === 0);
  room.resetT = -1;
  room.currentRow = 0;
  room.rowWrong = [0, 0, 0, 0];
  room.wrongCount = 0;
  room.working = [];
  room.lastSafe = { x: room.layout.laneX, y: 0, z: room.layout.z0 - 2 };
}

function tileUnderPlayer(room: RoomRuntime, row: number): TileRT | null {
  const p = G.player.pos;
  for (const t of room.stepRows[row]) {
    if (!t.visible) continue;
    if (Math.abs(p.x - t.cx) <= t.sx / 2 && Math.abs(p.z - t.cz) <= t.sz / 2) return t;
  }
  return null;
}

export function step(room: RoomRuntime, h: number): void {
  const run = needRun();
  for (const row of room.stepRows) {
    for (const t of row) {
      if (t.state === 'shaking') {
        t.t += h;
        if (t.t >= T.STEP_SHAKE_TIME) { t.state = 'falling'; t.t = 0; run.world.floors[t.floorId].enabled = false; }
      } else if (t.state === 'falling') {
        t.t += h;
        if (t.t >= T.TILE_FALL_TIME) { t.state = 'gone'; t.visible = false; t.t = 0; }
      } else if (t.state === 'gone' && room.state === 'active') {
        // the wrong tile rises back, so a hole never cuts the way to the next row
        t.t += h;
        if (t.t >= T.STEP_RISE_TIME) { t.state = 'solid'; t.t = 0; t.visible = true; run.world.floors[t.floorId].enabled = true; }
      }
    }
  }
  if (room.resetT >= 0 && run.phase === 'playing') {
    room.resetT -= h;
    if (room.resetT < 0) dropToStart(room);
  }
  if (room.state !== 'active' || run.phase !== 'playing' || !G.player.grounded || room.resetT >= 0) return;
  const q = room.question as StepsQuestion | null;
  if (!q || room.currentRow >= 4) return;
  const tile = tileUnderPlayer(room, room.currentRow);
  if (!tile || tile.state !== 'solid') return;
  const r = room.currentRow;
  const row = q.steps[r];
  const at = { x: tile.cx, y: 1.2, z: tile.cz };
  if (tile.correct) {
    tile.state = 'locked';
    room.working.push(tile.label);
    room.lastSafe = { x: tile.cx, y: 0, z: tile.cz };
    room.currentRow++;
    room.feedback = { text: row.why ? `Yes! ${row.why}` : 'Yes!', tone: 'good' };
    if (room.currentRow < 4) for (const t of room.stepRows[room.currentRow]) t.revealed = true;
    G.events.emit({ type: 'stepCorrect' });
    if (room.currentRow === 4) complete(room, q, at);
  } else {
    tile.state = 'shaking'; tile.t = 0;
    room.rowWrong[r]++;
    if (room.wrongCount === 0) {
      room.record = startRecord(room, q, false, room.activatedAtMs);
      surge(1);
    } else {
      if (room.record) room.record.wrongCount++;
      surge(0.5);
    }
    room.wrongCount++;
    const reset = T.STEP_RESET_ON_WRONG[run.selection.difficulty];
    room.feedback = { text: `"${tile.label}" is not the next step. ${row.why ?? q.hint}${reset ? ' Back to the start!' : ''}`, tone: 'bad' };
    if (room.rowWrong[r] >= T.GLOW_AFTER_WRONG[run.selection.difficulty]) for (const t of room.stepRows[r]) if (t.correct) t.glow = true;
    if (reset) room.resetT = T.STEP_SHAKE_TIME + 0.15;
    G.events.emit({ type: 'stepWrong' });
  }
  syncRoomPanel();
}

function complete(room: RoomRuntime, q: StepsQuestion, at: { x: number; y: number; z: number }): void {
  const firstTry = room.wrongCount === 0;
  if (firstTry) room.record = startRecord(room, q, true, room.activatedAtMs);
  celebrate(room, at, firstTry);
  resolveRoom(room, firstTry ? 'correct' : 'remediated');
}

/**
 * Hard: a wrong step sends the player back to the start platform. Locked rows stay solved; the
 * rows still to solve reshuffle, so trial-and-error memory doesn't carry over.
 */
function dropToStart(room: RoomRuntime): void {
  room.resetT = -1;
  const q = room.question as StepsQuestion;
  fadeRespawn(room.layout.startSpawn, () => {
    for (let i = room.currentRow; i < 4; i++) layRow(room, q, i, i === room.currentRow);
    room.lastSafe = { ...room.layout.startSpawn };
    syncRoomPanel();
  });
}

/** Falling off Step Stones: fade and respawn on the last safe tile (Hard: back to the start). */
export function onFall(room: RoomRuntime): boolean {
  if (room.resetT >= 0) { dropToStart(room); return true; }
  fadeRespawn(room.lastSafe);
  return true;
}
