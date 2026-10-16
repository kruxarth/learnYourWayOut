import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, place, room } from './helpers';
import { useLifelineSafe } from './rooms.util';
import { questionSource } from '../content/source';
import type { DomainPack } from '../content/schema';
import { engine } from '../game/engine';
import { buildCourse, recipeOverride } from '../game/loop/generation';
import { huntCompassTarget } from '../game/loop/huntCompass';
import { MAZE_COLS, openSides, pathBetween, type Maze } from '../game/loop/maze';
import { DEMO_RECIPE, POOL, TEMPLATES, eligibleEntries, gauntletRecipe, resolveRecipe } from '../game/loop/pool';
import { mulberry32, stream } from '../game/rng';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Difficulty } from '../game/types';
import { playThrough } from './bot';

afterEach(() => { finish(); recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

function bootWithHunt(d: Difficulty) {
  for (let seed = 1; seed < 80; seed++) {
    const run = boot(d, seed, 'math', {}, true);
    if (run.rooms.some((r) => r.kind === 'keyHunt')) return run;
  }
  throw new Error('no keyHunt course');
}

/** Pick up key `i` by standing on its dead end. */
function grab(r: ReturnType<typeof room>, i: number): void {
  place(r.keys[i].home.x, r.keys[i].home.z);
  advance(0.3);
}

describe('Key Hunt in the pool', () => {
  it('fits packs with mcq questions, is a maze variant, and shows up in mazeSlots on every difficulty', () => {
    const pack = questionSource.getPack('math');
    const e = POOL.find((x) => x.kind === 'keyHunt')!;
    expect(e.slot).toBe('maze');
    expect(e.fits(pack)).toBe(true);
    expect(e.fits({ ...pack, questions: pack.questions.filter((q) => q.type !== 'mcq') } as DomainPack)).toBe(false);
    for (const d of DIFFS) {
      let hunts = 0, plain = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const steps = resolveRecipe(TEMPLATES[d], { domainId: 'math', difficulty: d, seed }, pack, stream(seed, 'recipe'));
        hunts += steps.filter((s) => s.k === 'keyHunt').length;
        plain += TEMPLATES[d].filter((s, i) => s.k === 'mazeSlot' && steps[i].k === 'maze').length;
      }
      expect(hunts, d).toBeGreaterThan(30);
      expect(plain, d).toBeGreaterThan(30);
    }
    expect(eligibleEntries('maze', 'easy', pack).map((x) => x.kind).sort()).toEqual(['keyHunt', 'maze']);
  });

  it('is pinned in the demo course, and the Gauntlet ends with it before the Slime Gate', () => {
    expect(DEMO_RECIPE.some((s) => s.k === 'keyHunt')).toBe(true);
    const pack = questionSource.getPack('math');
    const g = gauntletRecipe(pack, stream(3, 'recipe'));
    expect(g.at(-3)!.k).toBe('keyHunt');
  });
});

describe('Key Hunt geometry', () => {
  it('keys lie in dead ends (not the entrance or exit cell); the gate fills the exit gap; same seed same course', () => {
    for (const d of DIFFS) {
      let seen = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        for (const rl of c.rooms.filter((r) => r.kind === 'keyHunt')) {
          seen++;
          const m = c.mazes.find((x) => x.segIndex === rl.segIndex)!;
          const maze: Maze = { rows: m.rows, exitC: m.exitC, wallE: m.wallE, wallN: m.wallN, deadEnds: [], coins: [] };
          const H = rl.hunt!;
          expect(H.spots.length).toBeGreaterThanOrEqual(2);
          expect(H.spots.length).toBeLessThanOrEqual(T.HUNT_KEYS[d]);
          expect(new Set(H.spots.map((s) => `${s.c},${s.r}`)).size).toBe(H.spots.length);
          for (const s of H.spots) {
            expect(openSides(maze, s.c, s.r), `${d} ${seed} dead end`).toBe(1);
            expect(s.c === 2 && s.r === 0).toBe(false);
            expect(s.c === m.exitC && s.r === m.rows - 1).toBe(false);
            // reachable from the entrance
            expect(pathBetween(maze, { c: 2, r: 0 }, { c: s.c, r: s.r }).length).toBeGreaterThan(0);
            // no coin lies on a key
            const cx = rl.laneX - 8 + 4 * s.c, cz = rl.z0 - (2 + 4 * s.r);
            expect(c.coins.some((k) => Math.abs(k.x - cx) < 0.1 && Math.abs(k.z - cz) < 0.1)).toBe(false);
          }
          const gate = c.walls[H.gateWallId];
          expect(gate.kind).toBe('gate');
          expect(gate.isStatic).toBe(false);
          expect(gate.enabled).toBe(true);
          const colX = rl.laneX - 8 + 4 * m.exitC;
          expect(gate.minX).toBeCloseTo(colX - 2 + T.WALL_T / 2, 6);
          expect(gate.maxX).toBeCloseTo(colX + 2 - T.WALL_T / 2, 6);
          expect(gate.minZ).toBeGreaterThan(rl.z0 - 4 * m.rows - 0.01);
          expect(rl.z0 - 4 * m.rows).toBeLessThan(gate.minZ);
          expect(MAZE_COLS).toBe(5);
        }
        expect(JSON.stringify(c.rooms.map((r) => r.hunt))).toBe(JSON.stringify(buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.map((r) => r.hunt)));
      }
      expect(seen, d).toBeGreaterThan(0);
    }
  });
});

describe('Key Hunt play', () => {
  it('activates with one labelled key per dead end, exactly one correct, and the gate closed', () => {
    for (const d of DIFFS) {
      const run = bootWithHunt(d);
      const r = room(run, 'keyHunt');
      enterRoom(run, r);
      expect(r.state).toBe('active');
      expect(r.question!.type).toBe('mcq');
      expect(r.keys).toHaveLength(r.layout.hunt!.spots.length);
      expect(r.keys.filter((k) => k.correct)).toHaveLength(1);
      expect(new Set(r.keys.map((k) => k.label)).size).toBe(r.keys.length);
      for (const k of r.keys) expect(k.label.length).toBeLessThanOrEqual(22);
      expect(run.world.walls[r.layout.hunt!.gateWallId].enabled).toBe(true);
      // the maze is not a think zone: the slime keeps its pace
      advance(0.2);
      expect(run.zone).toBe('normal');
    }
  });

  it('walking over a key carries it; only one at a time; F drops it; the key goes home', () => {
    const run = bootWithHunt('normal');
    const r = room(run, 'keyHunt');
    enterRoom(run, r);
    grab(r, 0);
    expect(r.keys[0].state).toBe('carried');
    expect(G.player.carrying).toBe(r.keys[0].id);
    grab(r, 1);
    expect(r.keys[1].state).toBe('home');
    expect(G.player.carrying).toBe(r.keys[0].id);
    engine.dropBlock();
    expect(G.player.carrying).toBeNull();
    expect(r.keys[0].state).toBe('home');
  });

  it('the right key opens the gate and resolves the room as correct', () => {
    const run = bootWithHunt('normal');
    const r = room(run, 'keyHunt');
    enterRoom(run, r);
    const s0 = run.slime;
    grab(r, r.keys.findIndex((k) => k.correct));
    const gate = r.layout.hunt!.gate;
    place(gate.x, gate.z + 1.2);
    advance(0.2);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    expect(run.world.walls[r.layout.hunt!.gateWallId].enabled).toBe(false);
    expect(run.slime).toBeLessThan(s0 + 0.01);
    expect(run.records).toHaveLength(1);
    expect(run.records[0].correctFirstTry).toBe(true);
  });

  it('a wrong key zaps the bean back about 3 m, goes home marked X, costs a surge, then the right key is remediated', () => {
    const run = bootWithHunt('normal');
    const r = room(run, 'keyHunt');
    enterRoom(run, r);
    const gate = r.layout.hunt!.gate;
    const wi = r.keys.findIndex((k) => !k.correct);
    grab(r, wi);
    const s0 = run.slime;
    place(gate.x, gate.z + 1.2);
    advance(0.05);
    expect(r.keys[wi].state).toBe('wrong');
    expect(G.player.carrying).toBeNull();
    expect(G.player.inputLocked).toBe(true);
    expect(run.slime - s0).toBeGreaterThan(T.SLIME_SURGE.normal * 0.9);
    advance(1);
    expect(G.player.inputLocked).toBe(false);
    const away = Math.hypot(G.player.pos.x - gate.x, G.player.pos.z - gate.z);
    expect(away).toBeGreaterThan(2.9);
    expect(r.state).toBe('active');
    // a crossed-out key cannot be picked up again
    grab(r, wi);
    expect(G.player.carrying).toBeNull();
    // the right one
    grab(r, r.keys.findIndex((k) => k.correct));
    place(gate.x, gate.z + 1.2);
    advance(0.2);
    expect(r.result).toBe('remediated');
    expect(run.records[0].correctFirstTry).toBe(false);
    expect(r.wrongCount).toBe(1);
  });

  it('50/50 crosses out exactly one wrong key', () => {
    const run = bootWithHunt('normal');
    const r = room(run, 'keyHunt');
    enterRoom(run, r);
    run.coins = 5;
    useLifelineSafe('fifty');
    const crossed = r.keys.filter((k) => k.state === 'wrong');
    expect(crossed).toHaveLength(1);
    expect(crossed[0].correct).toBe(false);
  });

  it('the Compass points to the nearest unchecked key, then to the gate once you carry one', () => {
    const run = bootWithHunt('normal');
    const r = room(run, 'keyHunt');
    enterRoom(run, r);
    const m = run.course.mazes.find((x) => x.segIndex === r.layout.segIndex)!;
    place(r.layout.laneX, r.layout.z0 - 2);
    const t0 = huntCompassTarget(run, m, G.player.pos.x, G.player.pos.z)!;
    expect(t0).not.toBeNull();
    // the target is the next cell on a shortest path to a key that is still at home
    const maze: Maze = { rows: m.rows, exitC: m.exitC, wallE: m.wallE, wallN: m.wallN, deadEnds: [], coins: [] };
    const cell = (x: number, z: number) => ({ c: Math.round((x - m.laneX + 8) / 4), r: Math.round((m.z0 - z - 2) / 4) });
    const next = cell(t0.x, t0.z);
    const best = Math.min(...r.layout.hunt!.spots.map((s) => pathBetween(maze, { c: 2, r: 0 }, { c: s.c, r: s.r }).length));
    const viaNext = Math.min(...r.layout.hunt!.spots.map((s) => {
      const p = pathBetween(maze, next, { c: s.c, r: s.r });
      return p.length ? p.length + 1 : Infinity;
    }));
    expect(viaNext).toBe(best);
    // cross out every wrong key: the compass then only knows the right one
    for (const k of r.keys) if (!k.correct) k.state = 'wrong';
    grab(r, r.keys.findIndex((k) => k.correct));
    const t1 = huntCompassTarget(run, m, G.player.pos.x, G.player.pos.z);
    // carrying: the target heads for the exit cell
    const goal = pathBetween(maze, cell(G.player.pos.x, G.player.pos.z), { c: m.exitC, r: m.rows - 1 });
    if (goal.length > 1) expect(cell(t1!.x, t1!.z)).toEqual(goal[1]);
  });
});

describe('Key Hunt with the bot', () => {
  it('guessers who carry wrong keys first still qualify or lose cleanly (all difficulties)', () => {
    for (const d of DIFFS) {
      for (let i = 0; i < 4; i++) {
        const res = playThrough(d, 90 + i, { guess: true, rng: mulberry32(i + 21), keepAlive: true, route: 'short', junctionRight: true });
        expect(['won', 'lost'], `${d} ${90 + i}`).toContain(res.run.phase);
      }
    }
  });

  it('the pinned demo course (which has a Key Hunt) is winnable', () => {
    const res = playThrough('normal', 4242, { demo: true, junctionRight: true });
    expect(res.run.phase).toBe('won');
    expect(res.run.rooms.some((r) => r.kind === 'keyHunt' && r.state === 'resolved')).toBe(true);
  });
});
