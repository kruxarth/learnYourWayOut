import { afterEach, describe, expect, it } from 'vitest';
import { finish } from './helpers';
import { playThrough } from './bot';
import { parTimeMs } from '../game/loop/evaluation';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';

afterEach(() => finish());

const SEEDS = 20;

describe('full course walk with the real controller', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: walks from spawn to QUALIFIED on ${SEEDS} seeds, on both lanes`, () => {
      for (let i = 0; i < SEEDS; i++) {
        // alternate lanes; Junction Halls (Normal, Hard) pick the lane from the answer: the long lane needs a wrong one
        const route = i % 2 ? 'long' : 'short';
        const junction = T.JUNCTION_HALL[d];
        const seed = 31 + d.length + 101 * i;
        const res = playThrough(d, seed, { route, junctionRight: route === 'short', keepAlive: true });
        const run = res.run;
        const kinds = run.course.segments.filter((s) => s.roomId).map((s) => s.kind).join(',');
        expect(run.phase, `${d} seed ${seed}: ${kinds}`).toBe('won');
        expect(run.route).toBe(route);
        expect(useUI.getState().banner?.text).toBe('QUALIFIED!');
        // every question on the route was answered right on the first try (except the deliberate junction miss)
        const misses = run.records.filter((r) => !r.correctFirstTry);
        expect(misses.map((r) => r.roomKind), `${d} seed ${seed}`).toEqual(junction && route === 'long' ? ['junctionHall'] : []);
        expect(run.records.length).toBeGreaterThanOrEqual(d === 'easy' ? 6 : 9);
        // every room on the route resolved
        const onRoute = run.course.segments.filter((s) => s.roomId && (s.lane === 'main' || s.lane === route));
        for (const s of onRoute) expect(run.roomMap.get(s.roomId!)!.state, `${d} seed ${seed}: ${s.kind} resolved`).toBe('resolved');
      }
    }, 300_000);
  }

  it('par time is built from the course: the perfect bot beats it with room to spare', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let i = 0; i < 6; i++) {
        const route = i % 2 ? 'long' : 'short';
        const res = playThrough(d, 900 + 31 * i, { route, junctionRight: route === 'short', keepAlive: true });
        const par = parTimeMs(d, res.run.course.segments, res.route);
        const ratio = par / 1000 / res.timeS;
        expect(ratio, `${d} ${route}: bot ${res.timeS.toFixed(0)} s, par ${par / 1000} s`).toBeGreaterThan(1.4);
        expect(ratio, `${d} ${route}`).toBeLessThan(2.8);
      }
    }
  }, 120_000);

  it('the ?demo=1 run (math · normal · seed 4242) is winnable both ways', () => {
    for (const right of [true, false]) {
      const res = playThrough('normal', 4242, { junctionRight: right, demo: true });
      expect(res.run.phase).toBe('won');
      expect(res.slime).toBeLessThan(0.5);
      expect(res.route).toBe(right ? 'short' : 'long');
    }
  });

  it('the Gauntlet (every room once) is winnable and shows a per-room breakdown', () => {
    for (let i = 0; i < 6; i++) {
      const seed = 500 + 17 * i;
      const res = playThrough('normal', seed, { mode: 'gauntlet', junctionRight: i % 2 === 0, keepAlive: true });
      const run = res.run;
      expect(run.phase, `gauntlet seed ${seed}`).toBe('won');
      const kinds = new Set(run.course.segments.filter((s) => s.roomId).map((s) => s.kind));
      for (const k of ['doorRush', 'tileDrop', 'stepStones', 'bridgeBuilder', 'quizMaze', 'junctionHall', 'slimeGate']) expect(kinds.has(k as never), k).toBe(true);
      expect(run.selection.mode).toBe('gauntlet');
    }
  }, 300_000);
});
