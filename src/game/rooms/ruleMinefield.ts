import type { ClassifyItem, ClassifyQuestion } from '../../content/schema';
import { shuffle, type Rng } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { RoomRuntime, TileRT } from '../runtime';
import type { Vec3 } from '../types';
import { fadeRespawn, surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';

/**
 * Rule Minefield (F4-2). A rule ("Step only on prime numbers") and a grid of 4 rows x 3 tiles over the
 * slime, with a solid walkway before, between and after the rows. Stepping on a tile that fits the rule is
 * safe; a tile that does not fit shakes, drops and comes back as a red X with its label. The player lands
 * back at the start of the previous row (Normal) or the start of the room (Hard). The room counts as
 * correct only with zero wrong tiles. The tiles are the `stepRows` of the room.
 */

/** Deal labels onto the tiles: safe tiles get items that fit the rule, the rest get items that do not. */
export function dealItems(q: ClassifyQuestion, safe: boolean[][], rng: Rng): { label: string; safe: boolean }[][] {
  const fits: ClassifyItem[] = shuffle(q.items.filter((i) => i.fits), rng);
  const nots: ClassifyItem[] = shuffle(q.items.filter((i) => !i.fits), rng);
  let fi = 0, ni = 0;
  // items repeat to fill the grid; each pool holds >= 3, so the (at most 2) draws of one row always differ
  return safe.map((row) => row.map((s) => (s
    ? { label: fits[fi++ % fits.length].label, safe: true }
    : { label: nots[ni++ % nots.length].label, safe: false })));
}

export function activate(room: RoomRuntime): void {
  const run = needRun();
  beginRoom(room);
  const q = pickQuestion(room, 'classify', 0) as ClassifyQuestion;
  room.question = q;
  const dealt = dealItems(q, room.layout.mine!.safe, run.qRng);
  room.stepRows.forEach((row, ri) => row.forEach((t, si) => {
    t.label = dealt[ri][si].label;
    t.correct = dealt[ri][si].safe;
    t.state = 'solid'; t.t = 0; t.glow = false; t.visible = true; t.revealed = true; t.marked = false;
    run.world.floors[t.floorId].enabled = true;
  }));
  room.currentRow = 0;
  room.rowWrong = [0, 0, 0, 0];
  room.wrongCount = 0;
  room.resetT = -1;
  room.lastSafe = walkPos(room, 0);
}

function walkPos(room: RoomRuntime, k: number): Vec3 {
  const w = room.layout.mine!.walks[k];
  return { x: room.layout.laneX, y: 0, z: w.cz };
}

function tileUnderPlayer(room: RoomRuntime): TileRT | null {
  const p = G.player.pos;
  for (const row of room.stepRows) {
    for (const t of row) {
      if (!t.visible) continue;
      if (Math.abs(p.x - t.cx) <= t.sx / 2 && Math.abs(p.z - t.cz) <= t.sz / 2) return t;
    }
  }
  return null;
}

export function step(room: RoomRuntime, h: number): void {
  const run = needRun();
  for (const row of room.stepRows) {
    for (const t of row) {
      if (t.state === 'shaking') {
        t.t += h;
        if (t.t >= T.MINE_SHAKE_TIME) { t.state = 'falling'; t.t = 0; run.world.floors[t.floorId].enabled = false; }
      } else if (t.state === 'falling') {
        t.t += h;
        // it resurfaces as a red X with its label, so the player learns from it
        if (t.t >= T.TILE_FALL_TIME) { t.state = 'gone'; t.t = 0; t.marked = true; }
      }
    }
  }
  if (room.resetT >= 0 && run.phase === 'playing') {
    room.resetT -= h;
    if (room.resetT < 0) dropBack(room);
  }
  if (room.state !== 'active' || run.phase !== 'playing' || !G.player.grounded || room.resetT >= 0) return;
  const q = room.question as ClassifyQuestion | null;
  const mine = room.layout.mine!;
  if (!q) return;
  const p = G.player.pos;

  // reaching a walkway banks the rows before it
  for (let k = room.currentRow + 1; k < mine.walks.length; k++) {
    const w = mine.walks[k];
    if (p.z <= w.maxZ && p.z >= w.minZ) {
      room.currentRow = k;
      room.lastSafe = walkPos(room, k);
      if (k === mine.walks.length - 1) { complete(room, q); return; }
      break;
    }
  }

  const tile = tileUnderPlayer(room);
  if (!tile || tile.state !== 'solid') return;
  if (tile.correct) {
    tile.state = 'locked';
    room.feedback = { text: 'Yes! That one fits the rule.', tone: 'good' };
    G.events.emit({ type: 'stepCorrect' });
    syncRoomPanel();
    return;
  }
  wrongTile(room, q, tile);
}

function wrongTile(room: RoomRuntime, q: ClassifyQuestion, tile: TileRT): void {
  const d = needRun().selection.difficulty;
  tile.state = 'shaking'; tile.t = 0;
  room.rowWrong[tile.row]++;
  if (room.wrongCount === 0) {
    room.record = startRecord(room, q, false, room.activatedAtMs);
    surge(1);
  } else {
    if (room.record) room.record.wrongCount++;
    surge(0.5);
  }
  room.wrongCount++;
  // where the player lands: Normal the start of the previous row, Hard the start of the room
  const target = Math.max(0, tile.row - T.MINE_BACK_ROWS[d]);
  room.currentRow = target;
  room.lastSafe = walkPos(room, target);
  room.resetT = T.MINE_SHAKE_TIME + 0.2;
  room.feedback = { text: `"${tile.label}" does not fit the rule. ${q.hint}`, tone: 'bad' };
  G.events.emit({ type: 'stepWrong' });
  syncRoomPanel();
}

function complete(room: RoomRuntime, q: ClassifyQuestion): void {
  const firstTry = room.wrongCount === 0;
  if (firstTry) room.record = startRecord(room, q, true, room.activatedAtMs);
  const p = G.player.pos;
  room.feedback = { text: 'Across the minefield!', tone: 'good' };
  celebrate(room, { x: p.x, y: 1.2, z: p.z }, firstTry);
  resolveRoom(room, firstTry ? 'correct' : 'remediated');
}

/** Fade and respawn at the walkway the wrong tile sent the player back to. */
function dropBack(room: RoomRuntime): void {
  room.resetT = -1;
  fadeRespawn(room.lastSafe, () => syncRoomPanel());
}

/** A fall: after a wrong tile go to the penalty spot; otherwise (a jump into a hole) back to the last walkway. */
export function onFall(room: RoomRuntime): boolean {
  if (room.resetT >= 0) { dropBack(room); return true; }
  fadeRespawn(room.lastSafe);
  return true;
}

function fiftyTargets(room: RoomRuntime): TileRT[] {
  const out: TileRT[] = [];
  for (let r = room.currentRow; r < room.stepRows.length; r++) {
    const wrong = room.stepRows[r].filter((t) => t.visible && !t.correct && t.state === 'solid');
    if (wrong.length >= 2) out.push(wrong[0]);
  }
  return out;
}

/** True when a 50/50 would cross out a wrong tile: some row ahead still has two or more wrong tiles. */
export function canFifty(room: RoomRuntime): boolean {
  return fiftyTargets(room).length > 0;
}

/** 50/50: one wrong tile in every row still to cross (of the rows with two wrong tiles) is crossed out and sinks. */
export function applyFifty(room: RoomRuntime): boolean {
  const run = needRun();
  const list = fiftyTargets(room);
  if (!list.length) return false;
  for (const t of list) {
    t.state = 'gone'; t.marked = true; t.t = 0;
    run.world.floors[t.floorId].enabled = false;
  }
  return true;
}
