import { describe, expect, it } from 'vitest';
import { createPlayer, stepPlayer, teleport, type NavCtx, type NavWorld } from '../game/loop/navigation';
import { SpatialHash } from '../game/loop/spatialHash';
import type { FloorRect, WallBox } from '../game/types';
import { T } from '../game/tuning';

function wall(id: number, minX: number, minZ: number, maxX: number, maxZ: number, extra: Partial<WallBox> = {}): WallBox {
  return { id, minX, minY: 0, minZ, maxX, maxY: 1.8, maxZ, kind: 'hedge', enabled: true, isStatic: true, ...extra };
}
function floor(id: number, minX: number, minZ: number, maxX: number, maxZ: number): FloorRect {
  return { id, minX, maxX, minZ, maxZ, top: 0, enabled: true, isStatic: true, color: '#fff' };
}
function world(walls: WallBox[], floors: FloorRect[]): NavWorld {
  return { wallHash: new SpatialHash(walls), floorHash: new SpatialHash(floors), dynWalls: [], dynFloors: [] };
}
function ctx(w: NavWorld, extra: Partial<NavCtx> = {}): NavCtx {
  return { world: w, yaw: 0, wade: 1, speedMult: 1, now: 0, hubRadius: null, hooks: { onTouch: () => {}, onFall: () => {}, emit: () => {} }, ...extra };
}

describe('navigation', () => {
  it('does not tunnel through a wall at 50 m/s with dt 0.1 split into fixed steps', () => {
    const w = world([wall(0, -10, -5.3, 10, -4.7)], [floor(0, -20, -20, 20, 20)]);
    const p = createPlayer();
    teleport(p, 0, 0, 0);
    p.grounded = true;
    p.vel.z = -50; // forward
    const c = ctx(w);
    // simulate one 0.1 s frame, in 12 capped steps (as the engine would)
    for (let i = 0; i < 12; i++) { p.vel.z = -50; stepPlayer(p, c, 0, 0, T.STEP); }
    expect(p.pos.z).toBeGreaterThan(-4.7);
  });

  it('pushes the player out of a wall', () => {
    const w = world([wall(0, -5, -1, 5, 1)], [floor(0, -20, -20, 20, 20)]);
    const p = createPlayer();
    teleport(p, 0.2, 0, 0.9);
    p.grounded = true;
    stepPlayer(p, ctx(w), 0, 0, T.STEP);
    stepPlayer(p, ctx(w), 0, 0, T.STEP);
    const dist = Math.min(Math.abs(p.pos.z - 1), Math.abs(p.pos.z + 1));
    expect(Math.abs(p.pos.z) >= 1 + T.PLAYER_RADIUS - 1e-6 || dist >= T.PLAYER_RADIUS - 1e-6).toBe(true);
  });

  it('falls when there is no floor', () => {
    const w = world([], []);
    const p = createPlayer();
    teleport(p, 0, 0, 0);
    let fell = 0;
    const c = ctx(w, { hooks: { onTouch: () => {}, onFall: () => { fell++; }, emit: () => {} } });
    for (let i = 0; i < 600 && !fell; i++) stepPlayer(p, c, 0, 0, T.STEP);
    expect(fell).toBeGreaterThan(0);
    expect(p.grounded).toBe(false);
  });

  it('stays grounded on a floor', () => {
    const w = world([], [floor(0, -20, -20, 20, 20)]);
    const p = createPlayer();
    teleport(p, 0, 0, 0);
    const c = ctx(w);
    for (let i = 0; i < 120; i++) stepPlayer(p, c, 0, 0, T.STEP);
    expect(p.grounded).toBe(true);
    expect(p.pos.y).toBe(0);
  });

  it('jump peak is below the hedge height', () => {
    const w = world([], [floor(0, -20, -20, 20, 20)]);
    const p = createPlayer();
    teleport(p, 0, 0, 0);
    const c = ctx(w);
    for (let i = 0; i < 10; i++) stepPlayer(p, c, 0, 0, T.STEP);
    p.jumpBuffer = T.JUMP_BUFFER;
    let peak = 0;
    for (let i = 0; i < 240; i++) { stepPlayer(p, c, 0, 0, T.STEP); peak = Math.max(peak, p.pos.y); }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(T.H_HEDGE);
  });

  it('walking forward for 1 s moves 5-7.5 m and does not fall', () => {
    const w = world([], [floor(0, -50, -50, 50, 50)]);
    const p = createPlayer();
    teleport(p, 0, 0, 0);
    const c = ctx(w);
    for (let i = 0; i < 20; i++) stepPlayer(p, c, 0, 0, T.STEP);
    const z0 = p.pos.z;
    for (let i = 0; i < 120; i++) stepPlayer(p, c, 0, 1, T.STEP);
    const moved = z0 - p.pos.z;
    expect(moved).toBeGreaterThan(5);
    expect(moved).toBeLessThan(7.5);
    expect(p.grounded).toBe(true);
  });

  it('reports door touches once per debounce window', () => {
    const w = world([wall(0, -5, -5.3, 5, -4.7, { touchId: 'door:r0:0:1' })], [floor(0, -20, -20, 20, 20)]);
    const p = createPlayer();
    teleport(p, 0, 0, -3);
    p.grounded = true;
    const touches: string[] = [];
    let now = 0;
    const c = ctx(w, { hooks: { onTouch: (id) => touches.push(id), onFall: () => {}, emit: () => {} } });
    for (let i = 0; i < 240; i++) { now += T.STEP; c.now = now; stepPlayer(p, c, 0, 1, T.STEP); }
    expect(touches.length).toBeGreaterThanOrEqual(1);
    expect(touches.length).toBeLessThanOrEqual(8);
  });
});
