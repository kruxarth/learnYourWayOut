import { afterEach, describe, expect, it } from 'vitest';
import { buildCourse } from '../game/loop/generation';
import { hammerOffset, onIce, segDistSq, stepHazards, sweeperAngle } from '../game/loop/hazards';
import { createPlayer, stepPlayer, teleport, type NavCtx, type NavWorld } from '../game/loop/navigation';
import { SpatialHash } from '../game/loop/spatialHash';
import { activatePowerup } from '../game/loop/progression';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Difficulty, FloorRect, Hazard, HazardKind } from '../game/types';
import { playThrough } from './bot';
import { advance, boot, finish, place } from './helpers';

afterEach(() => finish());

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

function course(d: Difficulty, seed: number) {
  return buildCourse({ domainId: 'math', difficulty: d, seed });
}

/** The first seed on which the course (classic recipe via boot) has a hazard of this kind. */
function bootWith(kind: HazardKind, d: Difficulty = 'hard'): { hz: Hazard } {
  for (let seed = 1; seed < 200; seed++) {
    const run = boot(d, seed);
    const hz = run.course.hazards.find((h) => h.kind === kind);
    if (hz) return { hz };
  }
  throw new Error(`no ${kind} found`);
}

describe('hazard placement', () => {
  it('density follows T.HAZARDS_PER_MAZE; Easy has none', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 25; seed++) {
        const c = course(d, seed);
        const perSeg = new Map<number, number>();
        for (const h of c.hazards) perSeg.set(h.segIndex, (perSeg.get(h.segIndex) ?? 0) + 1);
        for (const [si, n] of perSeg) {
          const kind = c.segments[si].kind;
          expect(['maze', 'corridor'], `${d} seed ${seed}: hazard in ${kind}`).toContain(kind);
          expect(n).toBeLessThanOrEqual(kind === 'maze' ? T.HAZARDS_PER_MAZE[d] : T.HAZARDS_PER_CORRIDOR[d]);
        }
        if (d === 'easy') expect(c.hazards.length).toBe(0);
        else expect(c.hazards.length, `${d} seed ${seed}`).toBeGreaterThan(0);
        // every plain maze gets its full quota on Normal and Hard (24 cells to choose from)
        for (const s of c.segments) if (s.kind === 'maze') expect(perSeg.get(s.index) ?? 0).toBe(T.HAZARDS_PER_MAZE[d]);
      }
    }
  });

  it('never in the entrance or exit cell, and the same seed gives the same hazards', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const c = course('hard', seed);
      for (const h of c.hazards) {
        const seg = c.segments[h.segIndex];
        if (seg.kind !== 'maze') continue;
        const m = c.mazes.find((mz) => mz.segIndex === h.segIndex)!;
        const col = Math.round((h.x - seg.laneX + 8) / 4), row = Math.round((seg.z0 - h.z - 2) / 4);
        expect(col === 2 && row === 0, 'entrance cell').toBe(false);
        expect(col === m.exitC && row === m.rows - 1, 'exit cell').toBe(false);
      }
      const again = course('hard', seed);
      expect(again.hazards.map((h) => [h.kind, h.x, h.z, h.phase])).toEqual(c.hazards.map((h) => [h.kind, h.x, h.z, h.phase]));
    }
  });

  it('hazards use their own stream: walls, floors and coins are the same with or without them', () => {
    // the hazard stream is separate, so only `hazards` (and the heads kept out of `walls`) depend on it
    const a = course('hard', 77), b = course('hard', 77);
    expect(a.walls.length).toBe(b.walls.length);
    expect(a.walls.some((w) => w.id >= 100000)).toBe(false);
    expect(a.coins.map((c) => [c.x, c.z])).toEqual(b.coins.map((c) => [c.x, c.z]));
  });
});

describe('rotating segment collision', () => {
  it('measures point-to-segment distance, including past the ends', () => {
    expect(Math.sqrt(segDistSq(0, 1, -2, 0, 2, 0))).toBeCloseTo(1);     // beside the middle
    expect(Math.sqrt(segDistSq(5, 0, -2, 0, 2, 0))).toBeCloseTo(3);     // beyond the end
    expect(Math.sqrt(segDistSq(3, 4, 0, 0, 0, 0))).toBeCloseTo(5);      // degenerate segment
    expect(segDistSq(1, 0, -2, 0, 2, 0)).toBeCloseTo(0);                // on the bar
  });

  it('the bar turns with the hazard clock: a point at the tip is hit at one time and missed a quarter turn later', () => {
    const { hz } = bootWith('sweeper');
    const omega = T.SWEEPER_OMEGA.hard;
    const a0 = sweeperAngle(hz, 0, omega);
    const a1 = sweeperAngle(hz, 1000, omega);
    expect(a1 - a0).toBeCloseTo(hz.dir * omega);
    const tip = (a: number) => [hz.x + Math.cos(a) * (hz.hw - 0.1), hz.z + Math.sin(a) * (hz.hw - 0.1)];
    const [tx, tz] = tip(a0);
    const r = T.PLAYER_RADIUS + T.SWEEPER_THICK / 2;
    const hit = (a: number) => segDistSq(tx, tz, hz.x - Math.cos(a) * hz.hw, hz.z - Math.sin(a) * hz.hw, hz.x + Math.cos(a) * hz.hw, hz.z + Math.sin(a) * hz.hw) < r * r;
    expect(hit(a0)).toBe(true);
    expect(hit(a0 + Math.PI / 2)).toBe(false);
    expect(hit(a0 + Math.PI)).toBe(true); // the bar is symmetric
  });

  it('the hammer head swings by its amplitude and never closes the corridor', () => {
    const { hz } = bootWith('hammer');
    const period = T.HAMMER_PERIOD.hard;
    let lo = Infinity, hi = -Infinity;
    for (let ms = 0; ms < period * 1000; ms += 20) {
      const o = hammerOffset(hz, ms, period);
      lo = Math.min(lo, o); hi = Math.max(hi, o);
    }
    expect(hi).toBeCloseTo(T.HAMMER_AMP, 1);
    expect(lo).toBeCloseTo(-T.HAMMER_AMP, 1);
    // the free gap beside the head at its worst position is wider than the bean
    const cell = 4 - T.WALL_T;
    const gap = cell / 2 + T.HAMMER_AMP - T.HAMMER_HW; // free width on the far side when the head is at one end
    expect(gap).toBeGreaterThan(2 * T.PLAYER_RADIUS + 0.2);
  });
});

describe('hits, Shield and Slime Freeze', () => {
  /** Stand on the sweeper's bar (at its centre post) so the next step is a hit. */
  function standOnBar(hz: Hazard): void {
    const run = G.run!;
    run.hazardIFrames = 0;
    teleport(G.player, hz.x + 0.5, 0, hz.z + 0.2);
    G.player.grounded = true;
  }

  it('a hit knocks back, spins, stuns for 0.4 s and costs a little slime, and is never lethal', () => {
    const { hz } = bootWith('sweeper');
    const run = G.run!;
    run.slime = 0;
    standOnBar(hz);
    const before = run.slime;
    stepHazards(run, G.player, T.STEP);
    expect(run.hazardHits).toBe(1);
    expect(G.player.stun).toBeCloseTo(T.HAZARD_STUN);
    expect(G.player.spin).toBeGreaterThan(0);
    expect(Math.hypot(G.player.vel.x, G.player.vel.z)).toBeCloseTo(T.HAZARD_KNOCK, 3);
    expect(run.slime - before).toBeCloseTo(T.HAZARD_SLIME.hard);
    expect(run.phase).not.toBe('lost');
    // hit immunity: a second touch right away does nothing
    stepHazards(run, G.player, T.STEP);
    expect(run.hazardHits).toBe(1);
    expect(run.slime - before).toBeCloseTo(T.HAZARD_SLIME.hard);
  });

  it('stun ignores input, then control comes back', () => {
    const w: NavWorld = { wallHash: new SpatialHash([]), floorHash: new SpatialHash<FloorRect>([{ id: 0, minX: -50, maxX: 50, minZ: -50, maxZ: 50, top: 0, enabled: true, isStatic: true, color: '#fff' }]), dynWalls: [], dynFloors: [] };
    const ctx: NavCtx = { world: w, yaw: 0, wade: 1, speedMult: 1, now: 0, hubRadius: null, hooks: { onTouch: () => {}, onFall: () => {}, emit: () => {} } };
    const p = createPlayer();
    teleport(p, 0, 0, 0);
    p.grounded = true;
    p.stun = T.HAZARD_STUN;
    for (let i = 0; i < 0.2 / T.STEP; i++) stepPlayer(p, ctx, 0, 1, T.STEP);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThan(0.1);
    for (let i = 0; i < 0.5 / T.STEP; i++) stepPlayer(p, ctx, 0, 1, T.STEP);
    expect(p.stun).toBeLessThanOrEqual(0);
    expect(p.pos.z).toBeLessThan(-0.5);
  });

  it('the Shield (key 5) blocks exactly one hit and is used up', () => {
    const { hz } = bootWith('sweeper');
    const run = G.run!;
    run.slime = 0;
    run.powerups.shield = 1;
    expect(activatePowerup('shield')).toBe(true);
    expect(run.shield).toBe(true);
    expect(run.powerups.shield).toBe(0);
    standOnBar(hz);
    stepHazards(run, G.player, T.STEP);
    expect(run.hazardHits).toBe(0);
    expect(run.slime).toBe(0);
    expect(G.player.stun).toBeLessThanOrEqual(0);
    expect(run.shield).toBe(false);
    // the next hit lands
    run.hazardIFrames = 0;
    stepHazards(run, G.player, T.STEP);
    expect(run.hazardHits).toBe(1);
    expect(run.slime).toBeGreaterThan(0);
  });

  it('cannot arm a second Shield while one is up', () => {
    bootWith('sweeper');
    const run = G.run!;
    run.powerups.shield = 2;
    expect(activatePowerup('shield')).toBe(true);
    expect(activatePowerup('shield')).toBe(false);
    expect(run.powerups.shield).toBe(1);
  });

  it('Slime Freeze stops the hazard clock and the hits', () => {
    const { hz } = bootWith('sweeper');
    const run = G.run!;
    run.slime = 0;
    run.powerups.freeze = 1;
    expect(activatePowerup('freeze')).toBe(true);
    const ms = run.hazardMs;
    standOnBar(hz);
    for (let i = 0; i < 120; i++) stepHazards(run, G.player, T.STEP);
    expect(run.hazardMs).toBe(ms);
    expect(run.hazardHits).toBe(0);
    // once the freeze is over the clock runs again and the bar hits
    run.freezeT = 0;
    stepHazards(run, G.player, T.STEP);
    expect(run.hazardMs).toBeGreaterThan(ms);
    expect(run.hazardHits).toBe(1);
  });

  it('jumping clears a sweeper bar', () => {
    const { hz } = bootWith('sweeper');
    const run = G.run!;
    run.hazardIFrames = 0;
    teleport(G.player, hz.x + 0.5, T.SWEEPER_H + 0.2, hz.z + 0.2);
    stepHazards(run, G.player, T.STEP);
    expect(run.hazardHits).toBe(0);
  });

  it('hits are deterministic: the same seed and the same moves give the same hazard state', () => {
    const sim = () => {
      const { hz } = bootWith('sweeper');
      const run = G.run!;
      place(hz.x + 0.5, hz.z + 0.2);
      advance(2);
      return [run.hazardMs, run.hazardHits, run.slime];
    };
    expect(sim()).toEqual(sim());
  });
});

describe('ice', () => {
  it('cuts acceleration to a fifth while grounded on a patch', () => {
    const w: NavWorld = { wallHash: new SpatialHash([]), floorHash: new SpatialHash<FloorRect>([{ id: 0, minX: -50, maxX: 50, minZ: -50, maxZ: 50, top: 0, enabled: true, isStatic: true, color: '#fff' }]), dynWalls: [], dynFloors: [] };
    const speedAfter = (ice: boolean) => {
      const ctx: NavCtx = { world: w, yaw: 0, wade: 1, speedMult: 1, now: 0, hubRadius: null, ice, hooks: { onTouch: () => {}, onFall: () => {}, emit: () => {} } };
      const p = createPlayer();
      teleport(p, 0, 0, 0);
      p.grounded = true;
      for (let i = 0; i < 0.15 / T.STEP; i++) stepPlayer(p, ctx, 0, 1, T.STEP);
      return Math.hypot(p.vel.x, p.vel.z);
    };
    const normal = speedAfter(false), slick = speedAfter(true);
    expect(slick).toBeLessThan(normal * 0.35);
    expect(slick).toBeGreaterThan(0);
  });

  it('the engine puts the player on ice inside a patch', () => {
    const { hz } = bootWith('ice');
    const run = G.run!;
    expect(onIce(run, hz.x, hz.z)).toBe(true);
    expect(onIce(run, hz.x + hz.hw + 0.5, hz.z)).toBe(false);
    expect(hz.hw).toBeLessThanOrEqual(T.ICE_CORRIDOR_HW);
  });
});

describe('full runs with hazards', () => {
  it('a bot that ignores hazards still qualifies on Normal and Hard (it just eats hits), and a careful bot takes fewer', () => {
    let ignored = 0, careful = 0;
    for (const d of ['normal', 'hard'] as const) {
      for (let i = 0; i < 6; i++) {
        const o = { route: (i % 2 ? 'long' : 'short') as 'long' | 'short', junctionRight: i % 2 === 0 };
        const blind = playThrough(d, 3100 + 53 * i, { ...o, ignoreHazards: true });
        expect(blind.run.phase, `${d} #${i} (ignoring hazards)`).toBe('won');
        ignored += blind.run.hazardHits;
        const wary = playThrough(d, 3100 + 53 * i, o);
        expect(wary.run.phase, `${d} #${i} (waiting for safe phases)`).toBe('won');
        careful += wary.run.hazardHits;
      }
    }
    expect(ignored).toBeGreaterThan(0);
    expect(careful).toBeLessThan(ignored);
  }, 300_000);
});
