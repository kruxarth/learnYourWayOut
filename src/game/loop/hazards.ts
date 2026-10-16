import { T } from '../tuning';
import type { PlayerState, Hazard } from '../types';
import type { RunState } from '../runtime';
import { G } from '../state';
import { pushToast } from '../../ui/store';
import { surgeAmount } from './progression';

/**
 * Hazards at run time (F4-4). All motion is a pure function of `run.hazardMs`, the hazard clock:
 * it follows the run clock and stands still while Slime Freeze lasts. Hits are never lethal.
 */

const R = T.PLAYER_RADIUS;

/** Squared distance from point (px, pz) to the segment a-b. The rotating-segment collision test. */
export function segDistSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.min(1, Math.max(0, t));
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return cx * cx + cz * cz;
}

/** Sweeper angle (rad) at hazard time `ms`. */
export function sweeperAngle(h: Hazard, ms: number, omega: number): number {
  return h.phase + h.dir * omega * (ms / 1000);
}

/** Hammer head x offset from its rest position at hazard time `ms`. */
export function hammerOffset(h: Hazard, ms: number, period: number): number {
  return h.hw * Math.sin(h.phase + (2 * Math.PI * ms) / (period * 1000));
}

export function inIce(h: Hazard, x: number, z: number): boolean {
  return h.kind === 'ice' && Math.abs(x - h.x) <= h.hw && Math.abs(z - h.z) <= h.hd;
}

export function onIce(run: RunState, x: number, z: number): boolean {
  const hs = run.course.hazards;
  for (let i = 0; i < hs.length; i++) if (hs[i].kind === 'ice' && inIce(hs[i], x, z)) return true;
  return false;
}

/** Put the hammer heads where the hazard clock says they are. Call before the player step. */
export function moveHazards(run: RunState): void {
  const hs = run.course.hazards;
  const period = T.HAMMER_PERIOD[run.selection.difficulty];
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    if (!h.head) continue;
    const cx = h.x + hammerOffset(h, run.hazardMs, period);
    h.head.minX = cx - T.HAMMER_HW; h.head.maxX = cx + T.HAMMER_HW;
  }
}

export interface HitProbe { hit: boolean; nx: number; nz: number }
const probe: HitProbe = { hit: false, nx: 0, nz: 0 };

/** Is the player touching this hazard right now? Returns a shared probe with the push direction. */
export function probeHazard(run: RunState, h: Hazard, p: PlayerState): HitProbe {
  const diff = run.selection.difficulty;
  probe.hit = false; probe.nx = 0; probe.nz = 0;
  const px = p.pos.x, pz = p.pos.z;
  if (h.kind === 'sweeper') {
    if (p.pos.y >= T.SWEEPER_H) return probe;
    const a = sweeperAngle(h, run.hazardMs, T.SWEEPER_OMEGA[diff]);
    const ca = Math.cos(a) * h.hw, sa = Math.sin(a) * h.hw;
    const r = R + T.SWEEPER_THICK / 2;
    if (segDistSq(px, pz, h.x - ca, h.z - sa, h.x + ca, h.z + sa) < r * r) {
      probe.hit = true;
      // push along the bar's normal, to the side the player is on
      const nx = -Math.sin(a), nz = Math.cos(a);
      const side = (px - h.x) * nx + (pz - h.z) * nz >= 0 ? 1 : -1;
      probe.nx = nx * side; probe.nz = nz * side;
    }
  } else if (h.kind === 'hammer' && h.head) {
    const w = h.head;
    if (p.pos.y >= w.maxY - 0.05) return probe;
    const cx = Math.min(Math.max(px, w.minX), w.maxX), cz = Math.min(Math.max(pz, w.minZ), w.maxZ);
    const dx = px - cx, dz = pz - cz;
    if (dx * dx + dz * dz < (R + 0.1) * (R + 0.1)) {
      probe.hit = true;
      const mx = (w.minX + w.maxX) / 2, mz = (w.minZ + w.maxZ) / 2;
      const ox = px - mx, oz = pz - mz, l = Math.hypot(ox, oz);
      probe.nx = l > 1e-6 ? ox / l : 1; probe.nz = l > 1e-6 ? oz / l : 0;
    }
  }
  return probe;
}

/** A hazard hit. Shield blocks it; otherwise knockback, a spin, a stun and a small slime cost. */
export function hitPlayer(run: RunState, p: PlayerState, nx: number, nz: number): boolean {
  if (run.hazardIFrames > 0) return false;
  if (run.shield) {
    run.shield = false;
    run.hazardIFrames = T.HAZARD_SHIELD_IFRAMES;
    pushToast('Shield blocked it!', 'good');
    G.events.emit({ type: 'lifeline', kind: 'fifty', ok: true });
    return false;
  }
  run.hazardIFrames = T.HAZARD_IFRAMES;
  run.hazardHits++;
  p.vel.x = nx * T.HAZARD_KNOCK; p.vel.z = nz * T.HAZARD_KNOCK;
  if (p.grounded) { p.vel.y = T.HAZARD_HOP; p.grounded = false; }
  p.stun = T.HAZARD_STUN;
  p.spin = 0.5;
  p.speedBoost = 0;
  surgeAmount(T.HAZARD_SLIME[run.selection.difficulty]);
  G.events.emit({ type: 'bounce' });
  return true;
}

/** After the player step: advance the hazard clock, then test hits. Frozen hazards stand still and do no harm. */
export function stepHazards(run: RunState, p: PlayerState, h: number): void {
  if (run.phase !== 'playing') return;
  if (run.hazardIFrames > 0) run.hazardIFrames = Math.max(0, run.hazardIFrames - h);
  if (run.freezeT > 0) return;
  run.hazardMs += h * 1000;
  if (run.godMode || run.detour) return;
  const hs = run.course.hazards;
  for (let i = 0; i < hs.length; i++) {
    const hz = hs[i];
    if (hz.kind === 'ice') continue;
    if (Math.abs(p.pos.x - hz.x) > T.HAZARD_NEAR || Math.abs(p.pos.z - hz.z) > T.HAZARD_NEAR) continue;
    const pr = probeHazard(run, hz, p);
    if (pr.hit && hitPlayer(run, p, pr.nx, pr.nz)) return;
  }
}
