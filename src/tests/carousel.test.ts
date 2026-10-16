import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, place, room, steer } from './helpers';
import { buildCourse, recipeOverride } from '../game/loop/generation';
import { panelCenter } from '../game/rooms/doorCarousel';
import { wrapX } from '../game/loop/segmentsDoorMemory';
import type { RunState } from '../game/runtime';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Difficulty } from '../game/types';
import { useUI } from '../ui/store';
import { playThrough } from './bot';
import { mulberry32 } from '../game/rng';

afterEach(() => { finish(); recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

function bootWithCarousel(d: Difficulty, from = 1): RunState {
  for (let seed = from; seed < from + 200; seed++) {
    const run = boot(d, seed, 'math', {}, true);
    if (run.rooms.some((r) => r.kind === 'doorCarousel')) return run;
  }
  throw new Error('no doorCarousel course');
}

/** Advance until the panel is centred in the opening (+ `lead` metres of travel). */
function waitFor(run: RunState, index: number, lead = 0): void {
  const r = room(run, 'doorCarousel');
  for (let i = 0; i < 40 * 60 && Math.abs(panelCenter(r, index) + lead) > 0.3; i++) advance(1 / 60);
}

describe('Door Carousel geometry', () => {
  it('has one 4 m opening, and the train covers it at every position with no gap to slip through', () => {
    for (const d of DIFFS) {
      const run = bootWithCarousel(d);
      const r = room(run, 'doorCarousel');
      const c = r.layout.carousel!;
      const n = r.doorWalls[0].panels.length;
      expect(n).toBe(d === 'easy' ? 3 : 4);
      expect(c.panelW * n).toBeCloseTo(c.loopLen, 6);
      const walls = run.world.walls.filter((w) => w.kind === 'doorWall' && Math.abs((w.minZ + w.maxZ) / 2 - r.layout.doorWalls[0].z) < 0.1
        && w.maxX > r.layout.laneX - 11 && w.minX < r.layout.laneX + 11);
      const gap = walls.length === 2 ? Math.min(...walls.map((w) => w.minX)) : 0;
      void gap;
      expect(walls).toHaveLength(2);
      const left = walls.find((w) => w.maxX < r.layout.laneX)!, right = walls.find((w) => w.minX > r.layout.laneX)!;
      expect(right.minX - left.maxX).toBeCloseTo(4, 6);
      for (let off = 0; off < c.loopLen; off += 0.25) {
        r.carousel!.offset = off;
        const spans = r.doorWalls[0].panels.map((_, i) => {
          const cx = wrapX(off + i * c.panelW, c.loopLen);
          return [cx - c.panelW / 2, cx + c.panelW / 2];
        });
        for (let x = -T.CAROUSEL_OPEN_HALF; x <= T.CAROUSEL_OPEN_HALF; x += 0.05) {
          expect(spans.some(([a, b]) => x >= a - 1e-9 && x <= b + 1e-9), `${d} offset ${off} x ${x}`).toBe(true);
        }
      }
    }
  });

  it('builds a path through the static walls on every difficulty', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 20; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        for (const r of c.rooms.filter((x) => x.kind === 'doorCarousel')) {
          const wall = r.doorWalls[0];
          // the panels are dynamic, so the opening is open for the static path check
          expect(c.walls.filter((w) => !w.isStatic && wall.doors.some((dr) => dr.wallId === w.id))).toHaveLength(wall.doors.length);
        }
      }
    }
  });
});

describe('Door Carousel play', () => {
  it('activates with labelled panels and a train that slides at the difficulty speed', () => {
    for (const d of DIFFS) {
      const run = bootWithCarousel(d);
      const r = room(run, 'doorCarousel');
      enterRoom(run, r);
      expect(r.state).toBe('active');
      const panels = r.doorWalls[0].panels;
      expect(panels.filter((p) => p.isCorrect)).toHaveLength(1);
      expect(new Set(panels.map((p) => p.label)).size).toBe(panels.length);
      for (const p of panels) expect(p.label.length).toBeLessThanOrEqual(22);
      const a = r.carousel!.offset;
      advance(0.5);
      const moved = wrapX(r.carousel!.offset - a, r.layout.carousel!.loopLen);
      expect(moved).toBeGreaterThan(T.CAROUSEL_SPEED[d] * 0.5 - 0.1);
      expect(moved).toBeLessThan(T.CAROUSEL_SPEED[d] * 0.5 + 0.2 + 0.3);
      // the wall boxes follow the train
      const w = run.world.walls[panels[0].wallId];
      expect((w.minX + w.maxX) / 2).toBeCloseTo(r.layout.laneX + panelCenter(r, 0), 3);
    }
  });

  it('is deterministic: the same seed gives the same train', () => {
    const pos = () => {
      const run = bootWithCarousel('normal');
      const r = room(run, 'doorCarousel');
      enterRoom(run, r);
      advance(2);
      return [r.carousel!.offset, ...r.doorWalls[0].panels.map((p) => p.label)];
    };
    expect(pos()).toEqual(pos());
  });

  it('running into the right panel bursts it, resolves the room and offers the gold door', () => {
    const run = bootWithCarousel('normal');
    const r = room(run, 'doorCarousel');
    enterRoom(run, r);
    const ci = r.doorWalls[0].panels.findIndex((p) => p.isCorrect);
    const zw = r.layout.doorWalls[0].z;
    place(r.layout.laneX, zw + 3);
    steer(0, 0);
    waitFor(run, ci, T.CAROUSEL_SPEED.normal * 0.6);
    steer(0, 1);
    for (let i = 0; i < 120 && r.state !== 'resolved'; i++) advance(1 / 60);
    steer(0, 0);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    expect(run.records[0].correctFirstTry).toBe(true);
    expect(r.gold!.state).toBe('closed');
    expect(r.carousel!.frozen).toBe(true);
    // the way through is open: walk past the wall
    steer(0, 1);
    advance(1.5);
    steer(0, 0);
    expect(G.player.pos.z).toBeLessThan(zw - 1);
  });

  it('a wrong panel swings open and drops you into the detour; the right one is then opened', () => {
    const run = bootWithCarousel('normal');
    const r = room(run, 'doorCarousel');
    enterRoom(run, r);
    const wi = r.doorWalls[0].panels.findIndex((p) => !p.isCorrect);
    const zw = r.layout.doorWalls[0].z;
    const s0 = run.slime;
    place(r.layout.laneX, zw + 3);
    waitFor(run, wi, T.CAROUSEL_SPEED.normal * 0.6);
    steer(0, 1);
    for (let i = 0; i < 90 && !r.wrongDoor; i++) advance(1 / 60);
    steer(0, 0);
    expect(r.wrongDoor).not.toBeNull();
    expect(run.slime).toBeGreaterThan(s0 + T.SLIME_SURGE.normal * 0.9);
    expect(run.records[0].correctFirstTry).toBe(false);
    expect(r.gold!.state).toBe('burst');
    advance(3);
    expect(run.detour).not.toBeNull();
    expect(useUI.getState().room).toBeNull();
  });

  it('a perfect bot solves it on every difficulty and a guesser never gets trapped', () => {
    for (const d of DIFFS) {
      const seeds: number[] = [];
      for (let seed = 1; seeds.length < 3 && seed < 300; seed++) {
        recipeOverride.mode = 'pool';
        if (buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.some((r) => r.kind === 'doorCarousel')) seeds.push(seed);
      }
      expect(seeds).toHaveLength(3);
      seeds.forEach((seed, i) => {
        const res = playThrough(d, seed, { route: 'short', junctionRight: true, keepAlive: true, gold: i === 0 ? 'take' : 'skip' });
        expect(res.run.phase, `${d} ${seed}`).toBe('won');
        const rec = res.run.records.filter((x) => x.roomKind === 'doorCarousel');
        expect(rec.length).toBeGreaterThan(0);
        expect(rec.every((x) => x.correctFirstTry)).toBe(true);
      });
      const g = playThrough(d, seeds[0], { guess: true, rng: mulberry32(5), keepAlive: true, route: 'short', junctionRight: true });
      expect(['won', 'lost']).toContain(g.run.phase);
    }
  }, 120_000);
});
