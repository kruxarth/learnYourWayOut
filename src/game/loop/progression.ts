import { T } from '../tuning';
import { G, needRun } from '../state';
import type { RunState } from '../runtime';
import type { RoomRuntime } from '../runtime';
import type { Vec3, Zone } from '../types';
import { pushToast, useUI } from '../../ui/store';
import { syncHud } from '../../ui/sync';
import { teleport } from './navigation';
import { POWER_NAMES, canUsePowerup } from './powerups';
import type { PowerKind } from '../types';
import * as ruleMinefield from '../rooms/ruleMinefield';
import * as keyHunt from '../rooms/keyHunt';
import * as memoryFloor from '../rooms/memoryFloor';
import * as answerLifts from '../rooms/answerLifts';
import * as boulderRun from '../rooms/boulderRun';
import * as shiftMaze from '../rooms/shiftMaze';

// ───────────────────────── slime ─────────────────────────

/** Zone for the current step (spec §13.1). */
export function computeZone(run: RunState): Zone {
  if (run.phase !== 'playing' || run.godMode || run.paused || run.freezeT > 0) return 'frozen';
  if (run.detour) return 'detour';
  if (run.gold?.phase === 'asking') return 'think';
  const seg = run.course.segments[run.segIndex];
  if (seg && seg.kind === 'slimeGate' && seg.roomId) {
    const room = run.roomMap.get(seg.roomId);
    if (room && room.state !== 'resolved') return 'boss';
  }
  const active = run.activeRoomId ? run.roomMap.get(run.activeRoomId) : null;
  // Key Hunt is a search, not a think zone: the slime keeps its normal pace
  if (active && active.state === 'active' && active.kind !== 'keyHunt' && questionPending(active)) return 'think';
  return 'normal';
}

/** Quiz mazes stay active between junctions; only an unanswered junction is a think zone. */
export function questionPending(room: RoomRuntime): boolean {
  if (room.kind === 'memoryFloor') return memoryFloor.asking(room);
  if (room.kind === 'shiftMaze') return room.question !== null; // only while a shrine is asking
  if (room.kind !== 'quizMaze') return true;
  return room.currentWall >= 0 && !room.wallDone[room.currentWall];
}

/** Slime surface height (world Y). The slime covers the floor when slime > 0.48. */
export function slimeY(slime: number): number {
  return T.SLIME_Y_MIN + (T.SLIME_Y_MAX - T.SLIME_Y_MIN) * slime;
}

export function wadeFactor(run: RunState): number {
  const y = slimeY(run.slime);
  if (y <= 0) return 1;
  return 1 - T.WADE_SLOW * Math.min(1, Math.max(0, y / T.SLIME_Y_MAX));
}

export function stepSlime(run: RunState, h: number): void {
  if (run.freezeT > 0 && run.phase === 'playing' && !run.paused) run.freezeT = Math.max(0, run.freezeT - h);
  run.zone = computeZone(run);
  const mode = run.selection.mode === 'gauntlet' ? T.GAUNTLET_SLIME_MULT : 1;
  const rate = T.SLIME_RATE[run.selection.difficulty] * T.ZONE_MULT[run.zone] * accelFactor(run) * mode;
  run.slime = Math.min(1, run.slime + rate * h);
}

/** Late-course acceleration: 1 at the start, 1 + SLIME_ACCEL at the last segment. */
export function accelFactor(run: RunState): number {
  const n = run.course.segments.length;
  return 1 + T.SLIME_ACCEL[run.selection.difficulty] * (n > 1 ? run.segIndex / (n - 1) : 0);
}

/** Wrong-answer surge. `scale` 1 for the first wrong try, 0.5 for extra tries. */
export function surge(scale = 1): void {
  const run = needRun();
  const amount = T.SLIME_SURGE[run.selection.difficulty] * scale;
  run.slime = Math.min(1, run.slime + amount);
  G.events.emit({ type: 'slimeSurge', amount });
}

export function surgeAmount(amount: number): void {
  const run = needRun();
  run.slime = Math.min(1, run.slime + amount);
  G.events.emit({ type: 'slimeSurge', amount });
}

/** Lowest level pushback can reach: banked answers stop erasing all pressure late in the run. */
export function slimeFloor(run: RunState): number {
  const resolved = run.rooms.reduce((n, r) => n + (r.state === 'resolved' ? 1 : 0), 0);
  return T.SLIME_FLOOR_PER_ROOM[run.selection.difficulty] * resolved;
}

export function pushback(): void {
  const run = needRun();
  const floor = slimeFloor(run);
  run.slime = Math.max(Math.min(run.slime, floor), run.slime - T.SLIME_PUSHBACK[run.selection.difficulty]);
}

// ───────────────────────── coins ─────────────────────────

export function addCoins(n: number): void {
  const run = needRun();
  run.coins += n;
  run.coinsCollected += Math.max(0, n);
}

export function stepCoins(run: RunState): void {
  const p = G.player.pos;
  for (const c of run.course.coins) {
    if (c.taken) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    if (dx * dx + dz * dz < T.COIN_RADIUS * T.COIN_RADIUS && Math.abs(p.y + 0.8 - c.y) < 1.5) {
      c.taken = true;
      run.coins += 1;
      run.coinsCollected += 1;
      G.events.emit({ type: 'coin', x: c.x, y: c.y, z: c.z });
      pushToast('+1 coin', 'good', T.TOAST_TIME * 1000);
    }
  }
}

// ───────────────────────── lifelines ─────────────────────────

function activeDoorWall(room: RoomRuntime) {
  if (room.kind === 'doorRush' || room.kind === 'junctionHall' || room.kind === 'doorCarousel') return room.doorWalls[0];
  if (room.kind === 'slimeGate' && room.currentWall >= 0) return room.doorWalls[room.currentWall];
  return null;
}

/** True when a 50/50 (or an X-ray) would remove something on the active question. */
export function canFiftyRoom(room: RoomRuntime): boolean {
  if (room.kind === 'ruleMinefield') return ruleMinefield.canFifty(room);
  if (room.kind === 'keyHunt') return keyHunt.canFifty(room);
  if (room.kind === 'memoryFloor') return memoryFloor.canFifty(room);
  if (room.kind === 'boulderRun') return boulderRun.canFifty(room);
  if (room.kind === 'shiftMaze') return shiftMaze.canFifty(room);
  if (room.kind === 'launchPads') return room.launching === null && room.pads.some((p) => !p.correct && p.state === 'idle');
  if (room.kind === 'answerLifts') return answerLifts.canCross(room);
  if (room.kind === 'hexFinale') return false;
  if (room.kind === 'quizMaze') {
    const j = room.junctions[room.currentWall];
    return !!j && !room.wallDone[room.currentWall] && j.branches.some((b) => !b.correct && b.state === 'open');
  }
  const dw = activeDoorWall(room);
  return !!dw && dw.panels.some((p) => !p.isCorrect && p.state === 'closed');
}

/** Remove floor(N/2) wrong doors that are still closed (they become smashed); one wrong sign in a quiz maze. */
export function applyFifty(room: RoomRuntime): boolean {
  const run = needRun();
  if (room.kind === 'quizMaze') {
    const j = room.junctions[room.currentWall];
    const wrong = j ? j.branches.filter((b) => !b.correct && b.state === 'open') : [];
    if (!wrong.length) return false;
    wrong[Math.floor(run.qRng() * wrong.length)].state = 'crossed';
    return true;
  }
  if (room.kind === 'ruleMinefield') return ruleMinefield.applyFifty(room);
  if (room.kind === 'keyHunt') return keyHunt.applyFifty(room);
  if (room.kind === 'memoryFloor') return memoryFloor.applyFifty(room);
  if (room.kind === 'answerLifts') return answerLifts.crossOut(room, Math.floor(run.qRng() * 3));
  if (room.kind === 'boulderRun') return boulderRun.applyFifty(room);
  if (room.kind === 'shiftMaze') return shiftMaze.applyFifty(room);
  if (room.kind === 'launchPads') {
    // one wrong pad turns red and is disabled
    const wrong = room.pads.filter((p) => !p.correct && p.state === 'idle');
    if (!wrong.length) return false;
    wrong[Math.floor(run.qRng() * wrong.length)].state = 'wrong';
    return true;
  }
  const dw = activeDoorWall(room);
  if (!dw) return false;
  const wrong = dw.panels.filter((p) => !p.isCorrect && p.state === 'closed');
  const count = Math.min(wrong.length, Math.floor(dw.panels.length / 2));
  if (count <= 0) return false;
  // deterministic choice from the question stream
  const pool = wrong.slice();
  for (let i = 0; i < count; i++) {
    const j = Math.floor(run.qRng() * pool.length);
    const panel = pool.splice(j, 1)[0];
    panel.state = 'smashed';
    panel.anim = 0;
    run.world.walls[panel.wallId].enabled = true;
  }
  return true;
}

export function useLifeline(kind: 'fifty' | 'hint'): void {
  const run = G.run;
  if (!run || run.phase !== 'playing' || run.detour || run.paused) return;
  const room = run.activeRoomId ? run.roomMap.get(run.activeRoomId) : null;
  if (!room || room.state !== 'active' || !room.question) return; // no active question: deny quietly
  if ((room.kind === 'slimeGate' || room.kind === 'quizMaze') && room.wallDone[room.currentWall]) return;
  const cost = kind === 'fifty' ? T.COST_FIFTY : T.COST_HINT;
  const usedAlready = kind === 'fifty' ? room.fiftyUsed : room.hintUsed;
  if (usedAlready) return;
  if (room.kind === 'memoryFloor' && !questionPending(room)) return; // the labels are still showing
  if (kind === 'fifty' && !canFiftyRoom(room)) return;
  if (run.coins < cost) {
    G.events.emit({ type: 'lifeline', kind, ok: false });
    pushToast(`Need ${cost} coins — explore dead ends!`, 'bad');
    useUI.setState((s) => (kind === 'fifty' ? { fiftyShake: s.fiftyShake + 1 } : { hintShake: s.hintShake + 1 }));
    return;
  }
  if (kind === 'fifty') {
    if (!applyFifty(room)) return;
    room.fiftyUsed = true;
    markLifeline(room, 'fifty');
  } else {
    room.hintShown = room.question.hint;
    room.hintUsed = true;
    markLifeline(room, 'hint');
  }
  run.coins -= cost;
  G.events.emit({ type: 'lifeline', kind, ok: true });
  syncHud(run);
}

/** Use a power-up from the inventory (keys 1–5 or the HUD buttons). Denied quietly when not usable. */
export function activatePowerup(k: PowerKind): boolean {
  const run = G.run;
  if (!run) return false;
  const room = run.activeRoomId ? run.roomMap.get(run.activeRoomId) : null;
  const fiftyOk = !!room && room.state === 'active' && !room.fiftyUsed && canFiftyRoom(room);
  if (!canUsePowerup(run, k, fiftyOk)) {
    if (run.powerups[k] > 0 && run.phase === 'playing') pushToast(k === 'xray' ? 'X-ray works on a door or corridor question' : k === 'freeze' ? 'Already frozen' : k === 'shield' ? 'Shield is already up' : 'Use it inside a maze', 'info');
    return false;
  }
  run.powerups[k]--;
  switch (k) {
    case 'lantern': run.lanternSeg = run.segIndex; break;
    case 'compass': run.compassT = T.COMPASS_TIME; break;
    case 'freeze': run.freezeT = T.FREEZE_TIME; break;
    case 'shield': run.shield = true; break;
    case 'xray':
      applyFifty(room!);
      room!.fiftyUsed = true;
      markLifeline(room!, 'fifty');
      break;
  }
  pushToast(`${POWER_NAMES[k]}!`, 'good');
  G.events.emit({ type: 'lifeline', kind: 'fifty', ok: true });
  syncHud(run);
  return true;
}

/** Flag the record of the active question (per wall/junction in multi-question rooms). */
export function markLifeline(room: RoomRuntime, kind: 'fifty' | 'hint'): void {
  const rec = room.kind === 'slimeGate' || room.kind === 'quizMaze' ? room.wallRecords[room.currentWall] : room.record;
  if (!rec) return;
  if (kind === 'fifty') rec.usedFifty = true; else rec.usedHint = true;
}

// ───────────────────────── checkpoints ─────────────────────────

export function setCheckpoint(run: RunState, x: number, z: number): void {
  run.checkpoint = { x, y: 0, z };
}

// ───────────────────────── transitions & teleport ─────────────────────────

export function teleportPlayer(pos: Vec3): void {
  teleport(G.player, pos.x, pos.y, pos.z);
  G.camera.snapVersion++;
}

/** Fade out, run `onMidpoint` (usually a teleport), fade in. Spec §8.9. */
export function startTransition(onMidpoint: () => void, onEnd?: () => void): void {
  const run = needRun();
  if (run.phase === 'transition' || run.phase === 'won' || run.phase === 'lost') return;
  run.phase = 'transition';
  G.player.inputLocked = true;
  run.transition = { t: 0, midpointDone: false, onMidpoint, onEnd };
  useUI.setState({ fade: true });
}

export function stepTransition(run: RunState, h: number): void {
  const tr = run.transition;
  if (!tr) return;
  tr.t += h;
  if (!tr.midpointDone && tr.t >= T.FADE_TIME) {
    tr.midpointDone = true;
    tr.onMidpoint();
    useUI.setState({ fade: false });
  }
  if (tr.midpointDone && tr.t >= 2 * T.FADE_TIME) {
    run.transition = null;
    if (run.phase === 'transition') run.phase = 'playing';
    G.player.inputLocked = false;
    tr.onEnd?.();
  }
}

/** Fade and respawn at `pos` (falls). Ignored during transitions. */
export function fadeRespawn(pos: Vec3, after?: () => void): void {
  startTransition(() => { teleportPlayer(pos); after?.(); });
}

export function respawnAtCheckpoint(): void {
  const run = needRun();
  fadeRespawn(run.checkpoint);
}
