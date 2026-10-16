import { describe, expect, it } from 'vitest';
import { createPlayer, stepPlayer, teleport, type NavCtx, type NavWorld } from '../game/loop/navigation';
import { SpatialHash } from '../game/loop/spatialHash';
import { cameraClearance } from '../game/loop/cameraClip';
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

describe('chase-cam steering (mazes)', () => {
  const open = () => world([], [floor(0, -50, -50, 50, 50)]);
  const grounded = () => { const p = createPlayer(); teleport(p, 0, 0, 0); p.grounded = true; return p; };

  it('A/D turn the bean on the spot without moving it', () => {
    const p = grounded(), c = ctx(open(), { steer: true });
    for (let i = 0; i < 60; i++) stepPlayer(p, c, -1, 0, T.STEP); // A for 0.5 s
    expect(p.facing).toBeCloseTo(T.CHASE_TURN_RATE * 0.5, 5); // left = facing up
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeLessThan(1e-6);
    for (let i = 0; i < 120; i++) stepPlayer(p, c, 1, 0, T.STEP); // D for 1 s
    expect(p.facing).toBeCloseTo(-T.CHASE_TURN_RATE * 0.5, 5);
  });

  it('W drives along the facing whatever the camera yaw; S backs up without turning round', () => {
    const p = grounded();
    p.facing = Math.PI / 2; // facing −X
    const c = ctx(open(), { steer: true, yaw: 1.2 });
    for (let i = 0; i < 120; i++) stepPlayer(p, c, 0, 1, T.STEP);
    expect(p.pos.x).toBeLessThan(-5);
    expect(Math.abs(p.pos.z)).toBeLessThan(1e-6);
    const x1 = p.pos.x;
    for (let i = 0; i < 240; i++) stepPlayer(p, c, 0, -1, T.STEP);
    expect(p.pos.x).toBeGreaterThan(x1 + 5);
    expect(p.facing).toBeCloseTo(Math.PI / 2, 9);
  });

  it('W+D (clipped to the unit circle by the input) still drives at full speed and turns at the full rate', () => {
    const p = grounded(), c = ctx(open(), { steer: true });
    const k = Math.SQRT1_2;
    for (let i = 0; i < 12; i++) stepPlayer(p, c, k, k, T.STEP);
    expect(p.facing).toBeCloseTo(-T.CHASE_TURN_RATE * 12 * T.STEP, 5);
    for (let i = 0; i < 120; i++) { p.facing = 0; stepPlayer(p, c, k, k, T.STEP); }
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeGreaterThan(T.MAX_SPEED * 0.99);
  });

  it('without steering, input stays camera-relative and the facing follows the velocity', () => {
    const p = grounded(), c = ctx(open());
    for (let i = 0; i < 120; i++) stepPlayer(p, c, 1, 0, T.STEP); // D = strafe right (+X at yaw 0)
    expect(p.pos.x).toBeGreaterThan(5);
    expect(p.facing).toBeCloseTo(-Math.PI / 2, 2);
  });
});

describe('camera clearance', () => {
  it('pulls the camera in front of a wall between it and the bean', () => {
    const w = world([wall(0, -5, 2, 5, 2.6)], []);
    // bean at z 0, camera 4 m behind at z 4: the wall face (grown by 0.3) is at z 1.7
    expect(cameraClearance(w, 0, 0, 0, 4, 0.3)).toBeCloseTo(1.7 / 4, 6);
    // a clear line, an invisible wall and a disabled wall leave it alone
    expect(cameraClearance(w, 0, 0, 4, 0, 0.3)).toBe(1);
    expect(cameraClearance(world([wall(0, -5, 2, 5, 2.6, { kind: 'invisible' })], []), 0, 0, 0, 4, 0.3)).toBe(1);
    expect(cameraClearance(world([wall(0, -5, 2, 5, 2.6, { enabled: false })], []), 0, 0, 0, 4, 0.3)).toBe(1);
  });

  it('ignores the wall the bean is hugging', () => {
    const w = world([wall(0, -5, 0.5, 5, 1.1)], []);
    expect(cameraClearance(w, 0, 0.3, 4, 0.3, 0.3)).toBe(1);
  });
});
