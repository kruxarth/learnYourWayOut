import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, room, steer, walkTo } from './helpers';
import { useLifelineSafe } from './rooms.util';
import { buildCourse, recipeOverride } from '../game/loop/generation';
import { padXs } from '../game/rooms/launchPads';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Course, Difficulty } from '../game/types';
import { playThrough } from './bot';
import { mulberry32 } from '../game/rng';

afterEach(() => { finish(); recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

function solidFloorAt(c: Course, x: number, z: number): boolean {
  return c.floors.some((f) => f.enabled && f.top === 0 && x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ);
}
function insideWall(c: Course, x: number, z: number): boolean {
  const r = T.PLAYER_RADIUS;
  return c.walls.some((w) => w.enabled && x > w.minX - r && x < w.maxX + r && z > w.minZ - r && z < w.maxZ + r);
}

/** A run whose course has Launch Pads (every Normal and Hard run does; Easy may need a few tries). */
function bootWithPads(d: Difficulty) {
  for (let seed = 1; seed < 60; seed++) {
    const run = boot(d, seed, 'math', {}, true);
    if (run.rooms.some((r) => r.kind === 'launchPads')) return run;
  }
  throw new Error('no launchPads course');
}

/** Stand on a pad until it launches (charge + a little extra). */
function standOn(i: number): void {
  const r = room(G.run!, 'launchPads');
  walkTo(r.pads[i].x, r.pads[i].z, 15, 0.2);
  advance(T.LAUNCH_CHARGE_S + 0.2);
}

describe('Launch Pads geometry', () => {
  it('every landing point is solid floor away from walls, and the arc clears the hedge', () => {
    for (const d of DIFFS) {
      let seen = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        for (const room of c.rooms.filter((r) => r.kind === 'launchPads')) {
          seen++;
          const L = room.launch!;
          expect(L.trapLanding !== null, `${d} trap maze only on hard`).toBe(d === 'hard');
          for (const n of [2, 3, 4]) {
            for (const x of padXs(room.laneX, n)) {
              // the pad itself and the landings
              expect(solidFloorAt(c, x, L.padZ), `${d} pad (${x})`).toBe(true);
              expect(insideWall(c, x, L.padZ)).toBe(false);
              expect(solidFloorAt(c, x, L.correctZ), `${d} landing`).toBe(true);
              expect(insideWall(c, x, L.correctZ)).toBe(false);
              const wrong = L.trapLanding ?? { x, z: L.pondZ };
              expect(solidFloorAt(c, wrong.x, wrong.z), `${d} pond landing`).toBe(true);
              expect(insideWall(c, wrong.x, wrong.z)).toBe(false);
              // clearance over the whole thickness of the hedge
              for (const dz of [-0.3, 0, 0.3]) {
                const s = (L.padZ - (L.hedgeZ + dz)) / (L.padZ - L.correctZ);
                const y = 4 * T.LAUNCH_APEX_OK * s * (1 - s);
                expect(y, `${d} arc height over the hedge`).toBeGreaterThanOrEqual(L.hedgeH + 0.3);
              }
            }
          }
          // the pond lies in front of the hedge, the landing beyond it
          for (const p of L.pond) expect(p.minZ).toBeLessThanOrEqual(L.hedgeZ + 4.1);
          expect(L.correctZ).toBeLessThan(L.hedgeZ);
        }
      }
      expect(seen, d).toBeGreaterThan(0);
    }
  });

  it('Hard has a trap maze whose landing is walled off from the pads except through the gap', () => {
    const c = buildCourse({ domainId: 'math', difficulty: 'hard', seed: 3 });
    const room = c.rooms.find((r) => r.kind === 'launchPads')!;
    const t = room.launch!.trapLanding!;
    // a divider wall stands between the landing and the pads
    const divider = c.walls.find((w) => w.isStatic && w.kind === 'hedge' && t.x > w.minX && t.x < w.maxX && w.minZ > t.z && w.maxZ < t.z + 3.5);
    expect(divider).toBeDefined();
    expect(divider!.maxX).toBeLessThan(room.laneX + 10);
  });

  it('is part of the pool: it turns up on Normal and Hard (with more new rooms in the pool it is no longer in every run), and in the pinned demo course', () => {
    for (const d of ['normal', 'hard'] as const) {
      let n = 0;
      for (let seed = 1; seed <= 30; seed++) {
        if (buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.some((r) => r.kind === 'launchPads')) n++;
      }
      expect(n, d).toBeGreaterThan(5);
    }
    expect(buildCourse({ domainId: 'math', difficulty: 'normal', seed: 4242 }, { demo: true }).rooms.some((r) => r.kind === 'launchPads')).toBe(true);
  });
});

describe('Launch Pads play', () => {
  it('activates with 2 pads for true/false or 3-4 for mcq; the entrance gate closes', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const run = bootWithPads(d);
      const r = room(run, 'launchPads');
      enterRoom(run, r);
      expect(r.state).toBe('active');
      expect(run.world.walls[r.layout.gateWallId!].enabled).toBe(true);
      const tf = r.question!.type === 'truefalse';
      expect(r.pads).toHaveLength(tf ? 2 : T.LAUNCH_MCQ_PADS[d]);
      expect(r.pads.filter((p) => p.correct)).toHaveLength(1);
      expect(new Set(r.pads.map((p) => p.label)).size).toBe(r.pads.length);
      for (const p of r.pads) expect(p.label.length).toBeLessThanOrEqual(22);
    }
  });

  it('a pad needs a full charge: a quick pass does nothing, standing launches', () => {
    const run = bootWithPads('normal');
    const r = room(run, 'launchPads');
    enterRoom(run, r);
    const pad = r.pads.findIndex((p) => p.correct);
    // run straight across the pad without stopping: no launch, and the ring drains again
    walkTo(r.pads[pad].x, r.pads[pad].z + 3, 10, 0.2);
    walkTo(r.pads[pad].x, r.pads[pad].z - 3, 5, 0.3);
    advance(0.6);
    expect(r.launching).toBeNull();
    expect(r.pads[pad].charge).toBe(0);
    // standing on it fills the ring and launches
    walkTo(r.pads[pad].x, r.pads[pad].z, 10, 0.2);
    advance(0.1);
    expect(r.pads[pad].charge).toBeGreaterThan(0);
    advance(T.LAUNCH_CHARGE_S + 0.2);
    expect(r.launching).not.toBeNull();
  });

  it('the right pad flies over the hedge, locks input during the flight and resolves on landing', () => {
    const run = bootWithPads('normal');
    const r = room(run, 'launchPads');
    enterRoom(run, r);
    const pad = r.pads.findIndex((p) => p.correct);
    const L = r.layout.launch!;
    walkTo(r.pads[pad].x, r.pads[pad].z, 10, 0.2);
    let maxY = 0, locked = false;
    for (let i = 0; i < 3 * 60 && r.state !== 'resolved'; i++) {
      advance(1 / 60);
      if (G.player.flight) { locked = locked || G.player.inputLocked; maxY = Math.max(maxY, G.player.pos.y); }
    }
    expect(locked).toBe(true);
    expect(maxY).toBeGreaterThan(L.hedgeH + 1);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    expect(G.player.flight).toBeNull();
    expect(G.player.inputLocked).toBe(false);
    expect(G.player.pos.z).toBeLessThan(L.hedgeZ);
    expect(G.player.pos.y).toBeCloseTo(0, 2);
    expect(G.player.grounded).toBe(true);
    expect(run.records).toHaveLength(1);
    expect(run.records[0].correctFirstTry).toBe(true);
    // the flight cannot be walked through: the hedge still stands
    expect(run.world.walls[L.hedgeWallId].enabled).toBe(true);
  });

  it('a wrong pad splashes into the pond; the pad turns red; the right pad then resolves it as remediated', () => {
    const run = bootWithPads('normal');
    const r = room(run, 'launchPads');
    enterRoom(run, r);
    const L = r.layout.launch!;
    const wrong = r.pads.findIndex((p) => !p.correct);
    const s0 = run.slime;
    standOn(wrong);
    advance(T.LAUNCH_DUR_WRONG + 0.3);
    expect(r.pads[wrong].state).toBe('wrong');
    expect(r.state).toBe('active');
    expect(run.slime).toBeGreaterThan(s0 + T.SLIME_SURGE.normal * 0.9);
    const p = G.player.pos;
    expect(L.pond.some((q) => p.x >= q.minX && p.x <= q.maxX && p.z >= q.minZ && p.z <= q.maxZ)).toBe(true);
    expect(G.player.inputLocked).toBe(false);
    // the pond is slow
    steer(0, 1);
    advance(0.5);
    const v = Math.hypot(G.player.vel.x, G.player.vel.z);
    steer(0, 0);
    expect(v).toBeLessThan(T.MAX_SPEED * T.POND_SLOW * 1.05);
    // a disabled pad never launches
    walkTo(r.pads[wrong].x, r.pads[wrong].z, 15, 0.2);
    advance(1);
    expect(r.launching).toBeNull();
    // the right one
    standOn(r.pads.findIndex((q) => q.correct));
    advance(T.LAUNCH_DUR_OK + 0.3);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('remediated');
    expect(run.records).toHaveLength(1);
    expect(run.records[0].correctFirstTry).toBe(false);
  });

  it('50/50 turns exactly one wrong pad red', () => {
    const run = bootWithPads('normal');
    const r = room(run, 'launchPads');
    enterRoom(run, r);
    run.coins = 5;
    useLifelineSafe('fifty');
    expect(r.pads.filter((p) => p.state === 'wrong')).toHaveLength(1);
    expect(r.pads.find((p) => p.state === 'wrong')!.correct).toBe(false);
    expect(r.fiftyUsed).toBe(true);
  });

  it('Hard: a wrong pad lands in the trap maze; walking out through the gap leads back to the pads', () => {
    const run = bootWithPads('hard');
    const r = room(run, 'launchPads');
    enterRoom(run, r);
    const L = r.layout.launch!;
    standOn(r.pads.findIndex((p) => !p.correct));
    advance(T.LAUNCH_DUR_WRONG + 0.3);
    const t = L.trapLanding!;
    expect(Math.hypot(G.player.pos.x - t.x, G.player.pos.z - t.z)).toBeLessThan(0.5);
    // out through the gap on the right-hand side, then back to the right pad
    const gapX = r.layout.laneX + 10 - T.TRAP_GAP / 2;
    expect(walkTo(gapX, t.z, 20, 0.4)).toBe(true);
    expect(walkTo(gapX, t.z + 4, 20, 0.4)).toBe(true);
    standOn(r.pads.findIndex((p) => p.correct));
    advance(T.LAUNCH_DUR_OK + 0.3);
    expect(r.state).toBe('resolved');
  });

  it('wrong guesses never trap the bot (random answers on all difficulties)', () => {
    for (const d of DIFFS) {
      for (let i = 0; i < 4; i++) {
        const res = playThrough(d, 270 + i, { guess: true, rng: mulberry32(i + 5), keepAlive: true, route: 'short', junctionRight: true });
        expect(['won', 'lost'], `${d} ${270 + i}`).toContain(res.run.phase);
      }
    }
  }, 120_000);
});
