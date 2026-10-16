import type { McqQuestion } from '../../content/schema';
import { pushToast } from '../../ui/store';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { MemoryRT, RoomRuntime } from '../runtime';
import { fadeRespawn, surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';

/**
 * Memory Floor (F4-7). A 3x3 field of big tiles; 4 of them flip up and show answer labels for a few
 * seconds, then flip face down and the question appears. Stand on the tile you remember for a second.
 *   right: a bridge to the exit rises          wrong: the tile drops, you respawn at the room start and take a surge
 * Easy and Normal show the labels again briefly after a wrong tile; Hard does not. The dropped tile comes back
 * blank (an X) once you respawn, so the field can never be cut in two. Tiles reuse Tile Drop's states.
 */

function tileIndexUnderPlayer(room: RoomRuntime): number {
  const p = G.player.pos;
  for (let i = 0; i < room.tiles.length; i++) {
    const t = room.tiles[i];
    if (t.state === 'gone') continue;
    if (Math.abs(p.x - t.cx) <= t.sx / 2 && Math.abs(p.z - t.cz) <= t.sz / 2) return i;
  }
  return -1;
}

function showLabels(room: RoomRuntime, on: boolean): void {
  const m = room.memory!;
  room.tiles.forEach((t, i) => { t.revealed = m.dead[i] || (on && m.labelled[i]); });
}

export function activate(room: RoomRuntime): void {
  const run = needRun();
  beginRoom(room);
  const q = pickQuestion(room, 'mcq', room.layout.tierMod) as McqQuestion;
  room.question = q;
  room.wrongCount = 0;
  const n = T.MEMORY_LABELS;
  const labels = shuffle([q.answer, ...shuffle(q.distractors, run.qRng).slice(0, n - 1)], run.qRng);
  const spots = shuffle(room.tiles.map((_, i) => i), run.qRng).slice(0, n);
  const m: MemoryRT = {
    phase: 'reveal', t: 0, reflash: 0, labelled: room.tiles.map(() => false), dead: room.tiles.map(() => false), dropIdx: -1, standIdx: -1, stand: 0, pendingFall: false, bridge: 0,
  };
  room.memory = m;
  room.tiles.forEach((t) => {
    t.label = ''; t.correct = false; t.state = 'solid'; t.t = 0; t.glow = false; t.visible = true; t.revealed = false;
  });
  spots.forEach((idx, k) => {
    const t = room.tiles[idx];
    m.labelled[idx] = true;
    t.label = labels[k];
    t.correct = labels[k] === q.answer;
  });
  showLabels(room, true);
  pushToast('Memorise the answers!', 'info', T.MEMORY_REVEAL_S[run.selection.difficulty] * 1000);
}

/** Is the question on screen (labels are down)? Used by the panel and the think zone. */
export function asking(room: RoomRuntime): boolean {
  return room.memory?.phase === 'ask';
}

/** True when a 50/50 would still remove a wrong answer tile. */
export function canFifty(room: RoomRuntime): boolean {
  return asking(room) && !room.memory!.pendingFall && wrongInPlay(room).length > 0;
}

function wrongInPlay(room: RoomRuntime): number[] {
  const m = room.memory!;
  const under = tileIndexUnderPlayer(room);
  return room.tiles.map((_, i) => i).filter((i) => m.labelled[i] && !room.tiles[i].correct && room.tiles[i].state === 'solid' && i !== under);
}

/** Rule a tile out: it turns blank and shows an X (it stays solid, so the floor never gets cut in two). */
function kill(room: RoomRuntime, i: number): void {
  const m = room.memory!;
  m.labelled[i] = false;
  m.dead[i] = true;
  room.tiles[i].label = 'X';
  room.tiles[i].revealed = true;
}

/** 50/50: two wrong answer tiles are ruled out. Returns false when there is nothing to remove. */
export function applyFifty(room: RoomRuntime): boolean {
  const run = needRun();
  const pool = wrongInPlay(room);
  const count = Math.min(pool.length, Math.floor(T.MEMORY_LABELS / 2));
  if (count <= 0) return false;
  for (let k = 0; k < count; k++) {
    const j = Math.floor(run.qRng() * pool.length);
    const i = pool.splice(j, 1)[0];
    kill(room, i);
  }
  return true;
}

function choose(room: RoomRuntime, idx: number): void {
  const m = room.memory!;
  const q = room.question!;
  const tile = room.tiles[idx];
  const pl = G.player.pos;
  const at = { x: pl.x, y: 1.2, z: pl.z };
  m.stand = 0; m.standIdx = -1;
  if (tile.correct) {
    m.phase = 'done';
    m.bridge = 0;
    tile.revealed = true; tile.glow = false;
    const first = room.wrongCount === 0;
    if (first) room.record = startRecord(room, q, true, room.activatedAtMs);
    else if (room.record) room.record.remediated = true;
    room.feedback = { text: 'Correct! A bridge rises.', tone: 'good' };
    celebrate(room, at, first);
    resolveRoom(room, first ? 'correct' : 'remediated');
    return;
  }
  room.wrongCount++;
  if (room.wrongCount === 1) { room.record = startRecord(room, q, false, room.activatedAtMs); surge(1); }
  else { if (room.record) room.record.wrongCount++; surge(0.5); }
  tile.state = 'shaking'; tile.t = 0; tile.glow = false;
  m.dropIdx = idx;
  m.pendingFall = true;
  m.t = 0;
  G.player.inputLocked = true;
  room.feedback = { text: `"${tile.label}" is not it. ${q.hint}`, tone: 'bad' };
  G.events.emit({ type: 'tileShake' });
  G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: room.wrongCount === 1, ...at });
  syncRoomPanel();
}

export function step(room: RoomRuntime, h: number): void {
  const run = needRun();
  // tile animation runs whether or not the room is live (a wrong tile drops)
  for (const t of room.tiles) {
    if (t.state === 'shaking') {
      t.t += h;
      if (t.t >= T.TILE_SHAKE_TIME) { t.state = 'falling'; t.t = 0; run.world.floors[t.floorId].enabled = false; }
    } else if (t.state === 'falling') {
      t.t += h;
      if (t.t >= T.TILE_FALL_TIME) { t.state = 'gone'; t.visible = false; }
    }
  }
  const m = room.memory;
  if (!m) return;
  if (m.phase === 'done') {
    if (m.bridge < 1) {
      m.bridge = Math.min(1, m.bridge + h / T.MEMORY_BRIDGE_S);
      if (m.bridge >= 1) run.world.walls[room.layout.exitGateWallId!].enabled = false;
    }
    return;
  }
  if (room.state !== 'active' || run.phase !== 'playing' || run.detour) return;
  const d = run.selection.difficulty;
  if (m.phase === 'reveal') {
    m.t += h;
    if (m.t >= T.MEMORY_REVEAL_S[d]) {
      m.phase = 'ask'; m.t = 0;
      showLabels(room, false);
      syncRoomPanel();
    }
    return;
  }
  // ask
  if (m.reflash > 0) {
    m.reflash -= h;
    if (m.reflash <= 0) { m.reflash = 0; showLabels(room, false); }
  }
  if (m.pendingFall) {
    // safety net: if the player somehow does not fall, send them to the start anyway
    m.t += h;
    if (m.t > T.TILE_SHAKE_TIME + T.TILE_FALL_TIME + 2) onFall(room);
    return;
  }
  const p = G.player;
  const idx = tileIndexUnderPlayer(room);
  const still = Math.hypot(p.vel.x, p.vel.z) < T.MEMORY_STAND_SPEED;
  for (const t of room.tiles) t.glow = false;
  if (idx >= 0 && m.labelled[idx] && p.grounded && still && !p.inputLocked && room.tiles[idx].state === 'solid') {
    if (idx !== m.standIdx) { m.standIdx = idx; m.stand = 0; }
    m.stand += h;
    room.tiles[idx].glow = true;
    if (m.stand >= T.MEMORY_STAND_S) choose(room, idx);
  } else {
    m.standIdx = -1; m.stand = 0;
  }
}

/** The wrong tile dropped (or the safety net fired): back to the room start, then show the labels again if the level allows. */
export function onFall(room: RoomRuntime): boolean {
  const m = room.memory;
  if (!m || !m.pendingFall) return false;
  m.pendingFall = false;
  m.t = 0;
  const flash = T.MEMORY_REFLASH_S[needRun().selection.difficulty];
  fadeRespawn(room.layout.startSpawn, () => {
    // the dropped tile is back, blank and ruled out
    const t = room.tiles[m.dropIdx];
    if (t) {
      needRun().world.floors[t.floorId].enabled = true;
      t.state = 'solid'; t.t = 0; t.visible = true;
      kill(room, m.dropIdx);
    }
    m.dropIdx = -1;
    if (flash > 0) { m.reflash = flash; showLabels(room, true); }
  });
  syncRoomPanel();
  return true;
}
