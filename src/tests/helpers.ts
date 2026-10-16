import { engine } from '../game/engine';
import { input } from '../game/input';
import { recipeOverride } from '../game/loop/generation';
import { teleport } from '../game/loop/navigation';
import type { RoomRuntime, RunState } from '../game/runtime';
import { G } from '../game/state';
import type { Difficulty, DomainId, RunResult, RunSelection } from '../game/types';

/** Headless helpers: drive the real engine in Node with simulated input. */

/**
 * Start a run and skip the countdown. By default it builds the fixed pre-pool recipes, so the room
 * tests keep their courses; pass `pool = true` for the real recipe (slots filled from the pool).
 */
export function boot(difficulty: Difficulty = 'normal', seed = 4242, domainId: DomainId = 'math', extra: Partial<RunSelection> = {}, pool = false): RunState {
  recipeOverride.mode = pool ? 'pool' : 'classic';
  engine.startRun({ domainId, difficulty, seed, ...extra });
  const run = G.run!;
  run.godMode = false;
  advance(3.3); // countdown
  return run;
}

export function advance(sec: number, dt = 1 / 60): void {
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) engine.update(dt);
}

export function steer(mx: number, my: number): void {
  input.setTouchMove(mx, my);
}

/** Walk (using the real controller) toward a world point until close or time runs out. */
export function walkTo(x: number, z: number, maxSec = 20, tol = 0.25): boolean {
  const p = G.player.pos;
  const steps = Math.round(maxSec * 60);
  for (let i = 0; i < steps; i++) {
    const dx = x - p.x, dz = z - p.z;
    if (Math.hypot(dx, dz) < tol) { steer(0, 0); return true; }
    const len = Math.hypot(dx, dz);
    steer(dx / len, -dz / len);
    engine.update(1 / 60);
  }
  steer(0, 0);
  return false;
}

export function place(x: number, z: number, y = 0): void {
  teleport(G.player, x, y, z);
  advance(0.1);
}

export function room(run: RunState, kind: string, nth = 0): RoomRuntime {
  return run.rooms.filter((r) => r.kind === kind)[nth];
}

/** Put the player at the room's checkpoint and walk in so the activation trigger fires. */
export function enterRoom(run: RunState, r: RoomRuntime): void {
  const seg = run.course.segments[r.layout.segIndex];
  // teleporting skips the room before: open the gate of a Key Hunt maze that may lie right in front of this room
  for (const kh of run.rooms) if (kh !== r && kh.layout.hunt) run.world.walls[kh.layout.hunt.gateWallId].enabled = false;
  place(seg.laneX, seg.z0 + 1.5);
  steer(0, 1);
  for (let i = 0; i < 240 && r.state === 'idle'; i++) engine.update(1 / 60);
  steer(0, 0);
}

export function finish(): void {
  steer(0, 0);
  input.clear();
}

/** Walk sideways first (staying in the current row), then straight ahead: avoids stepping on neighbouring tiles. */
export function walkLateralThenForward(x: number, z: number, maxSec = 10, tol = 0.35): boolean {
  const p = G.player.pos;
  if (!walkTo(x, p.z, maxSec, tol)) return false;
  return walkTo(x, z, maxSec, tol);
}

/** A hand-built RunResult for progress / unlock tests. */
export function fakeResult(o: {
  domainId?: string; difficulty?: Difficulty; outcome?: 'qualified' | 'eliminated'; stars?: 0 | 1 | 2 | 3; correct?: number; focus?: string[];
} = {}): RunResult {
  return {
    outcome: o.outcome ?? 'qualified',
    selection: { domainId: (o.domainId ?? 'math') as DomainId, difficulty: o.difficulty ?? 'normal', seed: 1, focusConcepts: o.focus },
    timeMs: 60000, parMs: 120000, route: null, coinsCollected: 0, slimeAtEnd: 0,
    stars: o.stars ?? 0, records: [], weakConcepts: [], review: [],
    mastery: [{ conceptId: 'c', name: 'c', asked: o.correct ?? 0, correct: o.correct ?? 0 }],
  };
}
