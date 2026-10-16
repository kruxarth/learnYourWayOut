import { pushToast } from '../../ui/store';
import { G } from '../state';
import { T } from '../tuning';
import type { RunState } from '../runtime';
import type { MazeInfo, PowerKind } from '../types';
import { pathBetween, type Maze } from './maze';
import { huntCompassTarget } from './huntCompass';

/** Knowledge Power-Ups (P2-A) and combo speed (P2-B). */

export const POWER_KINDS: PowerKind[] = ['lantern', 'compass', 'freeze', 'xray', 'shield'];
export const POWER_NAMES: Record<PowerKind, string> = { lantern: 'Lantern', compass: 'Compass', freeze: 'Slime Freeze', xray: 'X-ray', shield: 'Shield' };
export const POWER_KEYS: Record<PowerKind, string> = { lantern: '1', compass: '2', freeze: '3', xray: '4', shield: '5' };

export function emptyPowerups(): Record<PowerKind, number> {
  return { lantern: 0, compass: 0, freeze: 0, xray: 0, shield: 0 };
}

/** Called for every main answer. Every COMBO_FOR_POWERUP first-try answers in a row grant a power-up. */
export function onAnswered(run: RunState, firstTryCorrect: boolean): void {
  if (!firstTryCorrect) {
    if (run.combo >= 2) pushToast('Combo lost', 'bad');
    run.combo = 0;
    return;
  }
  run.combo++;
  if (run.combo % T.COMBO_FOR_POWERUP === 0) grantPowerup(run);
}

export function grantPowerup(run: RunState): PowerKind | null {
  const d = run.selection.difficulty;
  const pool = POWER_KINDS.filter((k) => run.powerups[k] < T.POWERUP_MAX && !(k === 'lantern' && T.VIS_RADIUS[d] <= 0) && !(k === 'shield' && T.HAZARDS_PER_MAZE[d] <= 0));
  if (!pool.length) return null;
  const k = pool[Math.floor(run.puRng() * pool.length)];
  run.powerups[k]++;
  pushToast(`${run.combo} in a row! Power-up: ${POWER_NAMES[k]} (key ${POWER_KEYS[k]})`, 'good', 2600);
  return k;
}

/** Combo speed: +5% max speed per answer in the streak, up to +20%. */
export function comboSpeedMult(run: RunState): number {
  return 1 + Math.min(T.COMBO_SPEED_MAX, T.COMBO_SPEED_STEP * run.combo);
}

// ───────────────────────── maze helpers ─────────────────────────

export function mazeAt(run: RunState, x: number, z: number): MazeInfo | null {
  for (const m of run.course.mazes) {
    if (x >= m.laneX - 10 && x <= m.laneX + 10 && z <= m.z0 && z >= m.z0 - m.depth) return m;
  }
  return null;
}

function asMaze(m: MazeInfo): Maze {
  return { rows: m.rows, exitC: m.exitC, wallE: m.wallE, wallN: m.wallN, deadEnds: [], coins: [] };
}

const target = { x: 0, z: 0 };

/**
 * Compass: the next point on the way out of the current maze (centre of the next cell on the
 * shortest path, then the exit gap, then the next segment's entrance). Null outside mazes.
 * Returns a shared object.
 */
export function compassTarget(run: RunState, x: number, z: number): { x: number; z: number } | null {
  const m = mazeAt(run, x, z);
  if (!m) return null;
  const hunt = huntCompassTarget(run, m, x, z);
  if (hunt) return hunt;
  const lx = x - m.laneX, d = m.z0 - z;
  const c = Math.min(4, Math.max(0, Math.floor((lx + 10) / 4)));
  const r = Math.floor(d / 4);
  const toWorld = (cc: number, rr: number) => { target.x = m.laneX - 8 + 4 * cc; target.z = m.z0 - (2 + 4 * rr); return target; };
  if (r >= m.rows) { target.x = m.laneX; target.z = m.z0 - m.depth - 1; return target; }
  if (r < 0) return toWorld(2, 0);
  const maze = asMaze(m);
  if (c === m.exitC && r === m.rows - 1) { target.x = m.laneX - 8 + 4 * c; target.z = m.z0 - 4 * m.rows - 1.5; return target; }
  const path = pathBetween(maze, { c, r }, { c: m.exitC, r: m.rows - 1 });
  if (path.length < 2) return toWorld(m.exitC, m.rows - 1);
  return toWorld(path[1].c, path[1].r);
}

/** Can this power-up be used right now? */
export function canUsePowerup(run: RunState, k: PowerKind, fiftyAvailable: boolean): boolean {
  if (run.powerups[k] <= 0 || run.phase !== 'playing' || run.paused || run.detour) return false;
  const p = G.player.pos;
  switch (k) {
    case 'lantern': return T.VIS_RADIUS[run.selection.difficulty] > 0 && !!mazeAt(run, p.x, p.z) && run.lanternSeg !== run.segIndex;
    case 'compass': return !!mazeAt(run, p.x, p.z) && run.compassT <= 0;
    case 'freeze': return run.freezeT <= 0;
    case 'xray': return fiftyAvailable;
    case 'shield': return !run.shield;
  }
}

