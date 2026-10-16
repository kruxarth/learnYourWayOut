import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, room, steer, walkTo } from './helpers';
import { buildCourse, recipeOverride } from '../game/loop/generation';
import { liftTop, liftXs } from '../game/rooms/answerLifts';
import { createPlayer, rideFloors } from '../game/loop/navigation';
import { useLifeline } from '../game/loop/progression';
import { SpatialHash } from '../game/loop/spatialHash';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Difficulty, FloorRect } from '../game/types';
import { playThrough } from './bot';
import { mulberry32 } from '../game/rng';

afterEach(() => { finish(); recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['normal', 'hard'];

/** A pool run whose course has Answer Lifts (the room is big, so most Normal and Hard seeds have it). */
function bootWithLifts(d: Difficulty, from = 1) {
  for (let seed = from; seed < from + 80; seed++) {
    const run = boot(d, seed, 'math', {}, true);
    if (run.rooms.some((r) => r.kind === 'answerLifts')) return run;
  }
  throw new Error('no answerLifts course');
}

describe('moving floors (navigation)', () => {
  function world(f: FloorRect) {
    return { wallHash: new SpatialHash([]), floorHash: new SpatialHash([]), dynWalls: [], dynFloors: [f] };
  }
  const hooks = { onTouch() {}, onFall() {}, emit() {} };

  it('carries a grounded player standing on a floor that rises and sinks, and not one beside it', () => {
    const f: FloorRect = { id: 0, minX: -2, maxX: 2, minZ: -2, maxZ: 2, top: 0, enabled: true, isStatic: false, color: '#fff', moving: true, prevTop: 0 };
    const ctx = { world: world(f), yaw: 0, wade: 1, speedMult: 1, now: 0, hubRadius: null, hooks };
    const on = createPlayer(); on.grounded = true;
    const beside = createPlayer(); beside.grounded = true; beside.pos.x = 5;
    const air = createPlayer(); air.grounded = false; air.pos.y = 0;
    for (const top of [0.5, 1.5, 3, 1, -0.75]) {
      f.top = top;
      rideFloors(on, ctx); rideFloors(beside, ctx);
      // each step is applied once: the second call sees no change
      rideFloors(air, ctx);
      expect(on.pos.y).toBeCloseTo(top, 9);
      expect(beside.pos.y).toBe(0);
    }
    expect(air.pos.y).toBe(0);
    expect(f.prevTop).toBe(-0.75);
  });
});

describe('Answer Lifts geometry', () => {
  it('has 3 lifts on Normal and 4 on Hard, a ledge 6 m up with a way down, and a pond with steps', () => {
    for (const d of DIFFS) {
      let seen = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        for (const r of c.rooms.filter((x) => x.kind === 'answerLifts')) {
          seen++;
          const L = r.lifts!;
          expect(L.xs).toHaveLength(T.LIFT_COUNT[d]);
          expect(L.floorIds).toHaveLength(T.LIFT_COUNT[d]);
          expect(L.xs.map((x) => x - r.laneX)).toEqual(liftXs(T.LIFT_COUNT[d]));
          const ledge = c.floors.find((f) => f.top === T.LIFT_TOP)!;
          expect(ledge.minZ).toBeLessThan(L.ledgeZ + 1e-6);
          // lifts are moving floors that start flush with the dock
          for (const id of L.floorIds) { expect(c.floors[id].moving).toBe(true); expect(c.floors[id].top).toBe(0); }
          // the steps out of the pond rise by at most STEP_UP
          const steps = [...new Set(c.floors.filter((f) => f.top < 0 && f.top > T.LIFT_PIT && f.minZ >= L.pond.minZ - 1e-6 && f.maxZ <= L.pond.maxZ + 1e-6).map((f) => f.top))].sort((a, b) => a - b);
          expect(steps).toEqual([-0.6, -0.4, -0.2]);
          const chain = [T.LIFT_PIT, ...steps, 0];
          for (let k = 1; k < chain.length; k++) expect(chain[k] - chain[k - 1], 'riser').toBeLessThan(T.STEP_UP - 0.02);
          // lifts are wide enough to stand on and the gap between them wide enough to walk
          const gap = L.xs[1] - L.xs[0] - 2 * L.half;
          expect(gap).toBeGreaterThan(2 * T.PLAYER_RADIUS + 0.4);
          // the lift row fits the room
          expect(L.xs[L.xs.length - 1] + L.half).toBeLessThanOrEqual(r.laneX + 10);
        }
      }
      expect(seen, d).toBeGreaterThan(0);
    }
  });

  it('lift height is a pure function of state and time: right to the ledge, wrong to halfway and into the pit', () => {
    const at = (state: string, t: number) => liftTop({ state: state as never, t, top: T.LIFT_PIT });
    expect(at('idle', 0)).toBe(0);
    expect(at('rising', 0)).toBe(0);
    expect(at('rising', T.LIFT_RISE_S)).toBeCloseTo(T.LIFT_TOP, 9);
    expect(at('stalling', T.LIFT_STALL_RISE_S)).toBeCloseTo(T.LIFT_STALL_Y, 9);
    expect(at('holding', 5)).toBe(T.LIFT_STALL_Y);
    expect(at('sinking', T.LIFT_SINK_S)).toBeCloseTo(T.LIFT_PIT, 9);
    expect(at('wrong', 9)).toBe(T.LIFT_PIT);
    expect(T.LIFT_STALL_Y).toBeLessThan(T.LIFT_TOP);
    // monotone on the way up
    let last = -1;
    for (let t = 0; t <= T.LIFT_RISE_S; t += 0.1) { const y = at('rising', t); expect(y).toBeGreaterThanOrEqual(last); last = y; }
  });

  it('is in the pool on Normal and Hard only, and never twice in a run', () => {
    for (const d of ['normal', 'hard'] as const) {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        const k = c.rooms.filter((r) => r.kind === 'answerLifts').length;
        expect(k).toBeLessThanOrEqual(1);
        n += k;
      }
      expect(n, d).toBeGreaterThan(10);
    }
    for (let seed = 1; seed <= 80; seed++) {
      expect(buildCourse({ domainId: 'math', difficulty: 'easy', seed }).rooms.some((r) => r.kind === 'answerLifts')).toBe(false);
    }
  });
});

describe('Answer Lifts play', () => {
  function enter(d: Difficulty) {
    const run = bootWithLifts(d);
    const r = room(run, 'answerLifts');
    enterRoom(run, r);
    return { run, r };
  }

  it('activates with labelled lifts (one right), and the entrance gate closes', () => {
    for (const d of DIFFS) {
      const { run, r } = enter(d);
      expect(r.state).toBe('active');
      expect(run.world.walls[r.layout.gateWallId!].enabled).toBe(true);
      expect(r.lifts).toHaveLength(T.LIFT_COUNT[d]);
      expect(r.lifts!.filter((l) => l.correct)).toHaveLength(1);
      expect(new Set(r.lifts!.map((l) => l.label)).size).toBe(r.lifts!.length);
      for (const l of r.lifts!) expect(l.label.length).toBeLessThanOrEqual(22);
      finish();
    }
  });

  it('a right lift carries the bean to the ledge, 6 m up, and resolves the room', () => {
    const { r } = enter('normal');
    const L = r.layout.lifts!;
    const i = r.lifts!.findIndex((l) => l.correct);
    walkTo(L.xs[i], L.dockZ + 1.5, 10, 0.3);
    walkTo(L.xs[i], L.z, 5, 0.3);
    advance(T.LIFT_BOARD_S + 0.3);
    expect(r.lifts![i].state).toBe('rising');
    // riding along: the bean is on the lift all the way
    for (let k = 0; k < 4; k++) {
      advance(0.5);
      const l = r.lifts![i];
      expect(G.player.pos.y).toBeCloseTo(l.top, 1);
    }
    advance(T.LIFT_RISE_S);
    expect(G.player.pos.y).toBeCloseTo(T.LIFT_TOP, 2);
    expect(G.player.grounded).toBe(true);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    // onto the ledge: the face wall does not stop a bean at ledge height
    walkTo(L.xs[i], L.ledgeEndZ + 1, 6, 0.3);
    expect(G.player.pos.z).toBeLessThan(L.ledgeZ - 0.5);
    expect(G.player.pos.y).toBeCloseTo(T.LIFT_TOP, 2);
  });

  it('a wrong lift stops halfway, sinks into the pond, surges the slime, and is marked wrong; the bean can wade out', () => {
    const { run, r } = enter('normal');
    const L = r.layout.lifts!;
    const i = r.lifts!.findIndex((l) => !l.correct);
    const before = run.slime;
    walkTo(L.xs[i], L.dockZ + 1.5, 10, 0.3);
    walkTo(L.xs[i], L.z, 5, 0.3);
    advance(T.LIFT_BOARD_S + T.LIFT_STALL_RISE_S + 0.1);
    expect(r.lifts![i].state).toBe('holding');
    expect(G.player.pos.y).toBeCloseTo(T.LIFT_STALL_Y, 1);
    expect(run.slime).toBeGreaterThan(before + T.SLIME_SURGE.normal * 0.9);
    advance(T.LIFT_HOLD_S + T.LIFT_SINK_S + 0.2);
    expect(r.lifts![i].state).toBe('wrong');
    expect(G.player.pos.y).toBeCloseTo(T.LIFT_PIT, 2);
    expect(r.state).toBe('active');
    expect(run.records.at(-1)!.correctFirstTry).toBe(false);
    // wade out along the steps between the lifts
    const gapX = L.xs[i] + (i === r.lifts!.length - 1 ? -1 : 1) * (L.half + 0.8);
    walkTo(gapX, L.z, 6, 0.3);
    walkTo(gapX, L.dockZ + 1, 10, 0.3);
    expect(G.player.pos.y).toBeCloseTo(0, 2);
    expect(G.player.pos.z).toBeGreaterThan(L.dockZ);
    // that lift stays marked, the right one still works
    expect(r.lifts![i].state).toBe('wrong');
  });

  it('50/50 marks a wrong lift without moving it', () => {
    const { run, r } = enter('hard');
    run.coins = 10;
    steer(0, 0);
    useLifeline('fifty');
    expect(r.lifts!.filter((l) => l.state === 'wrong')).toHaveLength(1);
    expect(r.lifts!.find((l) => l.state === 'wrong')!.correct).toBe(false);
  });
});

describe('Answer Lifts bot', () => {
  it('a perfect bot rides the right lift on 12 seeds per difficulty and qualifies', () => {
    for (const d of DIFFS) {
      let met = 0;
      for (let i = 0; met < 12 && i < 60; i++) {
        const res = playThrough(d, 7000 + 37 * i, { keepAlive: true, junctionRight: true, route: 'short' });
        const lifts = res.run.rooms.find((r) => r.kind === 'answerLifts');
        if (!lifts || lifts.state === 'idle') continue;
        met++;
        expect(res.run.phase, `${d} seed ${7000 + 37 * i}`).toBe('won');
        expect(lifts.state).toBe('resolved');
        expect(lifts.result).toBe('correct');
      }
      expect(met, d).toBeGreaterThanOrEqual(6);
    }
  }, 600_000);

  it('a bot that always rides a wrong lift first wades out and still qualifies', () => {
    const rng = mulberry32(5);
    for (const d of DIFFS) {
      let met = 0;
      for (let i = 0; met < 5 && i < 40; i++) {
        const res = playThrough(d, 8000 + 29 * i, { wrongFirst: ['answerLifts'], rng, keepAlive: true, junctionRight: true, route: 'short' });
        const lifts = res.run.rooms.find((r) => r.kind === 'answerLifts');
        if (!lifts || lifts.state === 'idle') continue;
        met++;
        expect(res.run.phase, `${d} seed ${8000 + 29 * i}`).toBe('won');
        expect(lifts.result).toBe('remediated');
        expect(lifts.lifts!.filter((l) => l.state === 'wrong').length).toBeGreaterThanOrEqual(1);
      }
      expect(met, d).toBeGreaterThanOrEqual(3);
    }
  }, 600_000);
});
