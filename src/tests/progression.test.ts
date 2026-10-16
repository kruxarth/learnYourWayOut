import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, place, room, walkTo } from './helpers';
import { engine } from '../game/engine';
import { accelFactor, computeZone, slimeFloor, slimeY, stepSlime, surge, pushback, wadeFactor } from '../game/loop/progression';
import { G } from '../game/state';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';

afterEach(() => finish());

describe('slime', () => {
  it('rises at the base rate in the normal zone', () => {
    const run = boot('normal');
    run.slime = 0;
    for (let i = 0; i < 120; i++) stepSlime(run, T.STEP);
    expect(run.zone).toBe('normal');
    expect(run.slime).toBeCloseTo(T.SLIME_RATE.normal, 6);
  });

  it('zone multipliers: think 0.35, detour 0.5, boss 2, frozen 0', () => {
    const run = boot('normal');
    const base = T.SLIME_RATE.normal;
    const rate = () => { run.slime = 0; stepSlime(run, 1); return run.slime / base / accelFactor(run); };
    expect(rate()).toBeCloseTo(1, 6);
    // think zone: an active room
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    expect(computeZone(run)).toBe('think');
    expect(rate()).toBeCloseTo(0.35, 6);
    // paused → frozen
    run.paused = true;
    expect(rate()).toBeCloseTo(0, 6);
    run.paused = false;
    run.godMode = true;
    expect(rate()).toBe(0);
    run.godMode = false;
    // detour
    run.detour = { roomId: r.id } as never;
    expect(rate()).toBeCloseTo(0.5, 6);
    run.detour = null;
    // transition → frozen
    run.phase = 'transition';
    expect(rate()).toBe(0);
    run.phase = 'playing';
  });

  it('boss zone doubles the rate inside the Slime Gate until it resolves', () => {
    const run = boot('normal');
    const r = room(run, 'slimeGate', 0);
    place(r.layout.laneX, r.layout.z0 - 4);
    advance(0.2);
    expect(computeZone(run)).toBe('boss');
    run.slime = 0;
    stepSlime(run, 1);
    expect(run.slime).toBeCloseTo(T.SLIME_RATE.normal * 2 * accelFactor(run), 6);
  });

  it('the slime speeds up late in the course', () => {
    const run = boot('hard');
    expect(accelFactor(run)).toBe(1);
    run.segIndex = run.course.segments.length - 1;
    expect(accelFactor(run)).toBeCloseTo(1 + T.SLIME_ACCEL.hard, 6);
    expect(accelFactor({ ...run, selection: { ...run.selection, difficulty: 'easy' } })).toBe(1);
  });

  it('pushback cannot go below the per-room floor', () => {
    const run = boot('hard');
    for (const r of run.rooms.slice(0, 3)) r.state = 'resolved';
    expect(slimeFloor(run)).toBeCloseTo(3 * T.SLIME_FLOOR_PER_ROOM.hard, 6);
    run.slime = slimeFloor(run) + 0.005;
    pushback();
    expect(run.slime).toBeCloseTo(slimeFloor(run), 6);
    run.slime = 0.05; // already below the floor: pushback leaves it alone
    pushback();
    expect(run.slime).toBeCloseTo(0.05, 6);
  });

  it('rate and surge depend on the difficulty', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const run = boot(d);
      run.slime = 0;
      stepSlime(run, 1);
      expect(run.slime).toBeCloseTo(T.SLIME_RATE[d], 6);
      run.slime = 0;
      surge(1);
      expect(run.slime).toBeCloseTo(T.SLIME_SURGE[d], 6);
    }
  });

  it('surge, pushback and clamping to [0, 1]', () => {
    const run = boot('normal');
    run.slime = 0.5;
    surge(1);
    expect(run.slime).toBeCloseTo(0.58, 6);
    surge(0.5);
    expect(run.slime).toBeCloseTo(0.62, 6);
    pushback();
    expect(run.slime).toBeCloseTo(0.62 - T.SLIME_PUSHBACK.normal, 6);
    run.slime = 0.01;
    pushback();
    expect(run.slime).toBe(0);
    run.slime = 0.99;
    surge(1);
    expect(run.slime).toBe(1);
  });

  it('surface height and wading factor', () => {
    expect(slimeY(0)).toBeCloseTo(T.SLIME_Y_MIN, 6);
    expect(slimeY(1)).toBeCloseTo(T.SLIME_Y_MAX, 6);
    const run = boot('normal');
    run.slime = 0.3;
    expect(wadeFactor(run)).toBe(1);
    run.slime = 1;
    expect(wadeFactor(run)).toBeCloseTo(1 - T.WADE_SLOW, 6);
    expect(slimeY(0.48)).toBeLessThan(0.01); // covers the floor at about 0.48
  });
});

describe('outcome', () => {
  it('reaching 100% slime eliminates the player and shows the results', () => {
    const run = boot('normal');
    run.slime = 0.999999;
    advance(0.5);
    expect(run.phase).toBe('lost');
    expect(useUI.getState().banner?.text).toBe('ELIMINATED');
    expect(useUI.getState().lost).toBe(true);
    advance(T.RESULT_DELAY + 0.5);
    expect(useUI.getState().screen).toBe('results');
    expect(useUI.getState().results?.outcome).toBe('eliminated');
  });

  it('touching the exit portal qualifies', () => {
    const run = boot('normal');
    const p = run.course.exitPortal;
    place(p.x, p.z + 4);
    walkTo(p.x, p.z, 5, 0.3);
    advance(0.2);
    expect(run.phase).toBe('won');
    expect(useUI.getState().banner?.text).toBe('QUALIFIED!');
    advance(T.RESULT_DELAY + 0.5);
    const res = useUI.getState().results!;
    expect(res.outcome).toBe('qualified');
    expect(res.stars).toBeGreaterThanOrEqual(1);
  });

  it('the staircase moves the tier up after 2 first-try correct answers and down after a wrong one', () => {
    const run = boot('normal');
    expect(run.tier).toBe(2);
    const d0 = room(run, 'doorRush', 0);
    enterRoom(run, d0);
    const ci = d0.doorWalls[0].panels.findIndex((p) => p.isCorrect);
    walkTo(d0.layout.doorWalls[0].doors[ci].cx, d0.layout.doorWalls[0].z - 3, 10);
    expect(run.tier).toBe(2);
    expect(run.streak).toBe(1);
    // second Door Rush (hard has two before the fork; use step stones as the second correct)
    const s = room(run, 'stepStones', 0);
    enterRoom(run, s);
    for (let i = 0; i < 4; i++) {
      const t = s.stepRows[i].find((x) => x.visible && x.correct)!;
      walkTo(t.cx, G.player.pos.z, 10, 0.35);
      walkTo(t.cx, t.cz, 10, 0.35);
      advance(0.3);
    }
    expect(s.result).toBe('correct');
    expect(run.tier).toBe(3);
    expect(run.streak).toBe(0);
  });

  it('results: mastery, weak concepts, review and the weak-spot run', () => {
    const run = boot('normal');
    const d0 = room(run, 'doorRush', 0);
    enterRoom(run, d0);
    const wi = d0.doorWalls[0].panels.findIndex((p) => !p.isCorrect);
    walkTo(d0.layout.doorWalls[0].doors[wi].cx, d0.layout.doorWalls[0].z - 3, 10);
    advance(1.5);
    const concept = d0.question!.concept;
    engine.debug.win();
    advance(T.RESULT_DELAY + 0.5);
    const res = useUI.getState().results!;
    expect(res.weakConcepts).toEqual([concept]);
    expect(res.review).toHaveLength(1);
    expect(res.review[0].prompt).toBe(d0.question!.prompt);
    expect(res.mastery[0]).toMatchObject({ conceptId: concept, asked: 1, correct: 0 });
    expect(res.stars).toBe(1 + 0 + (res.timeMs <= res.parMs ? 1 : 0));
    // "Run my weak spots": same domain/difficulty, new seed, focusConcepts = weak concepts
    engine.startRun({ domainId: res.selection.domainId, difficulty: res.selection.difficulty, seed: 777, focusConcepts: res.weakConcepts });
    const run2 = G.run!;
    advance(3.3);
    const d = room(run2, 'doorRush', 0);
    enterRoom(run2, d);
    expect(d.question!.concept).toBe(concept);
    expect(useUI.getState().selection?.focusConcepts).toEqual([concept]);
  });

  it('pause freezes the game and the slime', () => {
    const run = boot('normal');
    engine.setPaused(true);
    const s0 = run.slime, t0 = run.elapsedMs;
    advance(2);
    expect(run.slime).toBe(s0);
    expect(run.elapsedMs).toBe(t0);
    engine.setPaused(false);
    advance(1);
    expect(run.elapsedMs).toBeGreaterThan(t0);
  });

  it('coins are collected by walking into them', () => {
    const run = boot('normal');
    const c = run.course.coins[0];
    const before = run.coins;
    place(c.x, c.z);
    advance(0.2);
    expect(c.taken).toBe(true);
    expect(run.coins).toBe(before + 1);
    expect(run.coinsCollected).toBeGreaterThanOrEqual(1);
  });

  it('the free fork (Easy) records the chosen route', () => {
    const run = boot('easy');
    expect(run.course.segments.some((s) => s.kind === 'forkHall')).toBe(true);
    const lane = run.course.segments.find((s) => s.lane === 'short')!;
    place(lane.laneX, lane.z0 + 1);
    walkTo(lane.laneX, lane.z0 - 3, 5, 0.4);
    expect(run.route).toBe('short');
  });

  it('a fall respawns the player at the last checkpoint', () => {
    const run = boot('normal');
    const seg = run.course.segments[1];
    place(seg.laneX, seg.z0 - 1);
    advance(0.2);
    expect(run.checkpoint.z).toBeCloseTo(seg.z0 - 2, 5);
    place(seg.laneX, seg.z0 - 6, -7);
    advance(1.2);
    expect(G.player.pos.y).toBeGreaterThan(-1);
    expect(Math.abs(G.player.pos.z - run.checkpoint.z)).toBeLessThan(1.5);
  });
});
