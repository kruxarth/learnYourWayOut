import { T } from '../tuning';
import type { FloorRect, PlayerState, WallBox } from '../types';
import type { GameEvent } from '../events';
import type { SpatialHash } from './spatialHash';

export interface NavWorld {
  wallHash: SpatialHash<WallBox>;
  floorHash: SpatialHash<FloorRect>;
  dynWalls: WallBox[];
  dynFloors: FloorRect[];
}

export interface NavHooks {
  onTouch(touchId: string, approachSpeed: number): void;
  onFall(): void;
  emit(e: GameEvent): void;
}

export interface NavCtx {
  world: NavWorld;
  yaw: number;
  wade: number;               // speed factor from slime (1 = none)
  speedMult: number;          // combo speed (1 = none)
  now: number;                // seconds, for touch debounce
  hubRadius: number | null;   // clamp distance from the origin in the hub
  /** On an ice patch: acceleration and braking are scaled by `T.ICE_FRICTION` while grounded. */
  ice?: boolean;
  hooks: NavHooks;
}

export function createPlayer(): PlayerState {
  return {
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    grounded: false, coyote: 0, jumpBuffer: 0, facing: 0, speedBoost: 0, carrying: null,
    forcedFall: false, inputLocked: false, lastTouch: {}, spin: 0, stun: 0, flight: null,
  };
}

const wallScratch: WallBox[] = [];
const floorScratch: FloorRect[] = [];
const R = T.PLAYER_RADIUS;

/** Move a player to `x,y,z` with zero velocity (teleport). */
export function teleport(p: PlayerState, x: number, y: number, z: number): void {
  p.pos.x = x; p.pos.y = y; p.pos.z = z;
  p.vel.x = 0; p.vel.y = 0; p.vel.z = 0;
  p.forcedFall = false;
  p.stun = 0;
  p.flight = null;
  p.grounded = false;
  p.coyote = 0;
  p.jumpBuffer = 0;
}

function resolveWall(p: PlayerState, w: WallBox, ctx: NavCtx): void {
  const pos = p.pos, vel = p.vel;
  if (!w.enabled) return;
  if (pos.y >= w.maxY - 0.05 || pos.y + T.PLAYER_HEIGHT <= w.minY) return;
  const cx = Math.min(Math.max(pos.x, w.minX), w.maxX);
  const cz = Math.min(Math.max(pos.z, w.minZ), w.maxZ);
  const dx = pos.x - cx, dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return;
  let nx: number, nz: number, push: number;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    nx = dx / d; nz = dz / d; push = R - d;
  } else {
    // center inside the box: exit through the axis with least penetration
    const l = pos.x - w.minX, r = w.maxX - pos.x, s = pos.z - w.minZ, n = w.maxZ - pos.z;
    const m = Math.min(l, r, s, n);
    nx = 0; nz = 0;
    if (m === l) nx = -1; else if (m === r) nx = 1; else if (m === s) nz = -1; else nz = 1;
    push = m + R;
  }
  const vn = vel.x * nx + vel.z * nz;
  pos.x += nx * push; pos.z += nz * push;
  if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
  if (w.touchId) {
    const approach = -vn;
    if (approach >= T.DOOR_TOUCH_MIN_SPEED) {
      const last = p.lastTouch[w.touchId];
      if (last === undefined || ctx.now - last >= T.TOUCH_DEBOUNCE) {
        p.lastTouch[w.touchId] = ctx.now;
        ctx.hooks.onTouch(w.touchId, approach);
      }
    }
  }
}

function resolveWalls(p: PlayerState, ctx: NavCtx): void {
  const w = ctx.world;
  const m = R + 0.15;
  const n = w.wallHash.query(p.pos.x - m, p.pos.x + m, p.pos.z - m, p.pos.z + m, wallScratch);
  for (let i = 0; i < n; i++) resolveWall(p, wallScratch[i], ctx);
  const dyn = w.dynWalls;
  for (let i = 0; i < dyn.length; i++) resolveWall(p, dyn[i], ctx);
}

function floorContains(f: FloorRect, x: number, z: number): boolean {
  return f.enabled && x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ;
}

function resolveFloors(p: PlayerState, ctx: NavCtx): void {
  const pos = p.pos, vel = p.vel;
  if (p.forcedFall) { p.grounded = false; return; }
  let best = -Infinity;
  const w = ctx.world;
  const n = w.floorHash.query(pos.x, pos.x, pos.z, pos.z, floorScratch);
  for (let i = 0; i < n; i++) {
    const f = floorScratch[i];
    if (floorContains(f, pos.x, pos.z) && f.top <= pos.y + T.STEP_UP && f.top > best) best = f.top;
  }
  const dyn = w.dynFloors;
  for (let i = 0; i < dyn.length; i++) {
    const f = dyn[i];
    if (floorContains(f, pos.x, pos.z) && f.top <= pos.y + T.STEP_UP && f.top > best) best = f.top;
  }
  if (best > -Infinity && pos.y <= best && vel.y <= 0) {
    if (!p.grounded) ctx.hooks.emit({ type: 'land', impact: -vel.y });
    pos.y = best; vel.y = 0; p.grounded = true; p.coyote = T.COYOTE_TIME;
  } else {
    p.grounded = false;
  }
}

/**
 * Moving floors (F4-8, reused by the Hex Finale). A room moves a floor by changing `top` each step
 * (from the run clock or its own state) and sets `moving`. A grounded player standing on it, at the
 * height the controller last applied (`prevTop`), is carried by the change. `prevTop` is brought up
 * to date for every moving floor, so it is correct on the next step whatever happens to the player.
 */
export function rideFloors(p: PlayerState, ctx: NavCtx): void {
  const dyn = ctx.world.dynFloors;
  let carried = false;
  for (let i = 0; i < dyn.length; i++) {
    const f = dyn[i];
    if (!f.moving) continue;
    const prev = f.prevTop ?? f.top;
    if (!carried && p.grounded && !p.flight && f.enabled && f.top !== prev && floorContains(f, p.pos.x, p.pos.z) && Math.abs(p.pos.y - prev) < 0.06) {
      p.pos.y = f.top;
      carried = true;
    }
    f.prevTop = f.top;
  }
}

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Launch Pads: follow the scripted arc. Linear in X/Z, a parabola in Y (height `apex` above the
 * straight line at the middle). No input and no collision; fully deterministic in `h`.
 */
function stepFlight(p: PlayerState, ctx: NavCtx, h: number): void {
  const f = p.flight!;
  f.t += h;
  const s = Math.min(1, f.t / f.dur);
  const pos = p.pos;
  pos.x = f.from.x + (f.to.x - f.from.x) * s;
  pos.z = f.from.z + (f.to.z - f.from.z) * s;
  pos.y = f.from.y + (f.to.y - f.from.y) * s + 4 * f.apex * s * (1 - s);
  p.vel.x = 0; p.vel.y = 0; p.vel.z = 0;
  p.grounded = false;
  p.jumpBuffer = 0;
  p.spin = 0.4;
  const dx = f.to.x - f.from.x, dz = f.to.z - f.from.z;
  if (Math.hypot(dx, dz) > 0.1) p.facing = Math.atan2(-dx, -dz);
  if (s >= 1) {
    pos.x = f.to.x; pos.y = f.to.y; pos.z = f.to.z;
    p.flight = null;
    p.grounded = true;
    p.coyote = T.COYOTE_TIME;
    p.spin = 0;
    ctx.hooks.emit({ type: 'land', impact: 8 });
  }
}

/** One fixed step of the player controller (spec §8.3). */
export function stepPlayer(p: PlayerState, ctx: NavCtx, moveX: number, moveY: number, h: number): void {
  const pos = p.pos, vel = p.vel;
  rideFloors(p, ctx);
  if (p.flight) { stepFlight(p, ctx, h); return; }
  // 1. locked input
  if (p.inputLocked || p.stun > 0) { moveX = 0; moveY = 0; p.jumpBuffer = 0; }

  // 2-4. wish direction and target velocity
  const s = Math.sin(ctx.yaw), c = Math.cos(ctx.yaw);
  let wx = -s * moveY + c * moveX;
  let wz = -c * moveY - s * moveX;
  const wl = Math.hypot(wx, wz);
  const wishLen = Math.min(1, Math.hypot(moveX, moveY));
  if (wl > 1e-6) { wx /= wl; wz /= wl; } else { wx = 0; wz = 0; }
  let mult = 1;
  if (p.speedBoost > 0) mult *= T.SPEED_PAD_MULT;
  if (p.carrying) mult *= T.CARRY_SPEED_MULT;
  mult *= ctx.wade * ctx.speedMult;
  const tx = wx * T.MAX_SPEED * mult * wishLen;
  const tz = wz * T.MAX_SPEED * mult * wishLen;

  // 5. accelerate toward target
  const hasInput = wishLen > 0.001;
  let accel = hasInput ? (p.grounded ? T.ACCEL_GROUND : T.ACCEL_AIR) : (p.grounded ? T.DECEL_GROUND : T.DECEL_AIR);
  if (ctx.ice && p.grounded) accel *= T.ICE_FRICTION;
  const dvx = tx - vel.x, dvz = tz - vel.z;
  const dl = Math.hypot(dvx, dvz);
  const maxDv = accel * h;
  if (dl <= maxDv) { vel.x = tx; vel.z = tz; } else { vel.x += (dvx / dl) * maxDv; vel.z += (dvz / dl) * maxDv; }

  // 6. jump
  if (p.jumpBuffer > 0 && (p.grounded || p.coyote > 0) && !p.forcedFall) {
    vel.y = T.JUMP_VELOCITY; p.grounded = false; p.coyote = 0; p.jumpBuffer = 0;
    ctx.hooks.emit({ type: 'jump' });
  }

  // 7. gravity
  vel.y -= T.GRAVITY * h;
  if (vel.y < -T.MAX_FALL_SPEED) vel.y = -T.MAX_FALL_SPEED;

  // 8. integrate X/Z and resolve walls (2 passes)
  pos.x += vel.x * h; pos.z += vel.z * h;
  resolveWalls(p, ctx);
  resolveWalls(p, ctx);

  // 9. integrate Y and resolve floors
  pos.y += vel.y * h;
  resolveFloors(p, ctx);

  // 10. hub clamp
  if (ctx.hubRadius !== null) {
    const d = Math.hypot(pos.x, pos.z);
    if (d > ctx.hubRadius) { const k = ctx.hubRadius / d; pos.x *= k; pos.z *= k; }
  }

  // 11. fall
  if (pos.y < T.FALL_Y) ctx.hooks.onFall();

  // 12. facing
  const hs = Math.hypot(vel.x, vel.z);
  if (hs > 0.5) {
    const target = Math.atan2(-vel.x, -vel.z);
    const d = angleDiff(p.facing, target);
    const maxTurn = T.TURN_RATE * h;
    p.facing += Math.abs(d) <= maxTurn ? d : Math.sign(d) * maxTurn;
  }

  // 13. timers
  if (p.coyote > 0) p.coyote -= h;
  if (p.jumpBuffer > 0) p.jumpBuffer -= h;
  if (p.speedBoost > 0) p.speedBoost -= h;
  if (p.spin > 0) p.spin -= h;
  if (p.stun > 0) p.stun -= h;
}
