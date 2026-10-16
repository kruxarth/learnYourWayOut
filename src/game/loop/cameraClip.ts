import type { WallBox } from '../types';
import type { NavWorld } from './navigation';

const scratch: WallBox[] = [];

let t0 = 0, t1 = 1;

/** Clip [t0, t1] to one slab; false when the segment misses it. */
function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const t = a; a = b; b = t; }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  return t0 <= t1;
}

/** Entry fraction of the XZ segment (ax,az)+(dx,dz) into `w` grown by `pad`, or 1 if it misses or starts inside. */
function enterAt(w: WallBox, pad: number, ax: number, az: number, dx: number, dz: number): number {
  const x0 = w.minX - pad, x1 = w.maxX + pad, z0 = w.minZ - pad, z1 = w.maxZ + pad;
  // starting inside the grown box (the bean hugging a wall) does not count: only walls behind it do
  if (ax > x0 && ax < x1 && az > z0 && az < z1) return 1;
  t0 = 0; t1 = 1;
  if (!slab(ax, dx, x0, x1) || !slab(az, dz, z0, z1)) return 1;
  return t0;
}

/**
 * How far along the line from the look target (a) to the camera (b) the camera may sit without entering
 * a wall, as a fraction 0..1 (XZ only: maze walls are drawn taller than the camera). Invisible and
 * disabled walls are ignored.
 */
export function cameraClearance(world: NavWorld, ax: number, az: number, bx: number, bz: number, pad: number): number {
  const dx = bx - ax, dz = bz - az;
  let t = 1;
  const test = (w: WallBox): void => {
    if (!w.enabled || w.kind === 'invisible') return;
    t = Math.min(t, enterAt(w, pad, ax, az, dx, dz));
  };
  if (world.wallHash) {
    const n = world.wallHash.query(Math.min(ax, bx) - pad, Math.max(ax, bx) + pad, Math.min(az, bz) - pad, Math.max(az, bz) + pad, scratch);
    for (let i = 0; i < n; i++) test(scratch[i]);
  }
  for (let i = 0; i < world.dynWalls.length; i++) test(world.dynWalls[i]);
  return t;
}
