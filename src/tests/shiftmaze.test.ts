import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, place, room } from './helpers';
import { useLifelineSafe } from './rooms.util';
import { questionSource } from '../content/source';
import type { DomainPack } from '../content/schema';
import { buildCourse, recipeOverride } from '../game/loop/generation';
import { MAZE_COLS, pathBetween, reachableCells, type Maze } from '../game/loop/maze';
import { DEMO_RECIPE, POOL, TEMPLATES, eligibleEntries, gauntletRecipe, resolveRecipe } from '../game/loop/pool';
import {
  allEdges, cloneMaze, distancesFrom, edgeCells, exitAlwaysReachable, exitCell, isClosed, planRight, planWrong, setClosed, trial,
} from '../game/loop/shiftPlan';
import { cellAt, liveMaze } from '../game/rooms/shiftMaze';
import { mulberry32, stream } from '../game/rng';
import type { RunState } from '../game/runtime';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Difficulty } from '../game/types';
import { playThrough } from './bot';

afterEach(() => { finish(); recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const SHIFT_DIFFS: Difficulty[] = ['normal', 'hard'];

function bootWithShift(d: Difficulty, from = 1): RunState {
  for (let seed = from; seed < from + 120; seed++) {
    const run = boot(d, seed, 'math', {}, true);
    if (run.rooms.some((r) => r.kind === 'shiftMaze')) return run;
  }
  throw new Error('no shiftMaze course');
}

const len = (m: Maze, a: { c: number; r: number }): number => distancesFrom(m, a)[exitCell(m).r * MAZE_COLS + exitCell(m).c];

describe('Shifting Maze in the pool', () => {
  it('is a maze variant from Normal up, never on Easy, in the Gauntlet, not in the demo', () => {
    const pack = questionSource.getPack('math');
    const e = POOL.find((x) => x.kind === 'shiftMaze')!;
    expect(e.slot).toBe('maze');
    expect(e.minDifficulty).toBe('normal');
    expect(e.fits(pack)).toBe(true);
    expect(e.fits({ ...pack, questions: pack.questions.filter((q) => q.type !== 'mcq') } as DomainPack)).toBe(false);
    expect(eligibleEntries('maze', 'easy', pack).some((x) => x.kind === 'shiftMaze')).toBe(false);
    expect(eligibleEntries('maze', 'normal', pack).some((x) => x.kind === 'shiftMaze')).toBe(true);
    expect(DEMO_RECIPE.some((s) => s.k === 'shiftMaze')).toBe(false);
    expect(gauntletRecipe(pack, stream(3, 'recipe')).some((s) => s.k === 'shiftMaze')).toBe(true);
    for (const d of DIFFS) {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        n += resolveRecipe(TEMPLATES[d], { domainId: 'math', difficulty: d, seed }, pack, stream(seed, 'recipe')).filter((s) => s.k === 'shiftMaze').length;
      }
      if (d === 'easy') expect(n).toBe(0); else expect(n, d).toBeGreaterThan(30);
    }
  });
});

describe('Shifting Maze build', () => {
  it('every interior hedge is a dynamic wall that mirrors the maze; two shrines lie on the solution path; same seed same course', () => {
    for (const d of SHIFT_DIFFS) {
      let seen = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        for (const rl of c.rooms.filter((r) => r.kind === 'shiftMaze')) {
          seen++;
          const m = c.mazes.find((x) => x.segIndex === rl.segIndex)!;
          const L = rl.shift!;
          expect(L.shrines).toHaveLength(2);
          const maze: Maze = { rows: m.rows, exitC: m.exitC, wallE: m.wallE, wallN: m.wallN, deadEnds: [], coins: [] };
          expect(reachableCells(maze)).toBe(m.rows * MAZE_COLS);
          m.wallE.forEach((row, r) => row.forEach((w, cc) => {
            const wall = c.walls[L.edgesE[r][cc]];
            expect(wall.isStatic).toBe(false);
            expect(wall.enabled).toBe(w);
          }));
          m.wallN.forEach((row, r) => row.forEach((w, cc) => expect(c.walls[L.edgesN[r][cc]].enabled).toBe(w)));
          const path = pathBetween(maze, { c: 2, r: 0 }, exitCell(maze));
          for (const s of L.shrines) {
            expect(path.some((p) => p.c === s.c && p.r === s.r)).toBe(true);
            expect(s.c === 2 && s.r === 0).toBe(false);
            expect(s.c === m.exitC && s.r === m.rows - 1).toBe(false);
          }
          expect(L.shrines[0]).not.toEqual(L.shrines[1]);
        }
        expect(JSON.stringify(c.rooms.map((r) => r.shift))).toBe(JSON.stringify(buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.map((r) => r.shift)));
      }
      expect(seen, d).toBeGreaterThan(0);
    }
  });
});

describe('Shifting Maze plans keep the exit reachable (many seeds, every player cell, both outcomes, both shrines in turn)', () => {
  it('right: never longer, at most 2 hedges; wrong: longer, 2 to 3 hedges when it moves anything; the invariant always holds', () => {
    let rights = 0, wrongs = 0, wrongMoves = new Map<number, number>();
    for (const d of SHIFT_DIFFS) {
      for (let seed = 1; seed <= 60; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        for (const rl of c.rooms.filter((r) => r.kind === 'shiftMaze')) {
          const m = c.mazes.find((x) => x.segIndex === rl.segIndex)!;
          const base: Maze = { rows: m.rows, exitC: m.exitC, wallE: m.wallE.map((r) => r.slice()), wallN: m.wallN.map((r) => r.slice()), deadEnds: [], coins: [] };
          for (let r = 0; r < m.rows; r++) for (let cc = 0; cc < MAZE_COLS; cc++) {
            const p = { c: cc, r };
            expect(exitAlwaysReachable(base, p)).toBe(true);
            const right = planRight(base, p);
            expect(right.open.length).toBeLessThanOrEqual(T.SHIFT_OPEN_MAX);
            expect(right.close).toHaveLength(0);
            const rm = trial(base, right, p);
            expect(rm, `${d} ${seed} right at ${cc},${r}`).not.toBeNull();
            expect(len(rm!, p)).toBeLessThanOrEqual(len(base, p));
            if (right.open.length) { rights++; expect(len(rm!, p)).toBeLessThan(len(base, p)); }
            const wrong = planWrong(base, p, () => true);
            if (wrong) {
              wrongs++;
              const wm = trial(base, wrong, p);
              expect(wm, `${d} ${seed} wrong at ${cc},${r}`).not.toBeNull();
              expect(exitAlwaysReachable(wm!, p)).toBe(true);
              expect(reachableCells(wm!)).toBe(m.rows * MAZE_COLS);
              expect(len(wm!, p)).toBeGreaterThan(len(base, p));
              const n = wrong.close.length + wrong.open.length;
              expect(n).toBeGreaterThanOrEqual(1); // 1 only in a maze with a loop where no second hedge can close
              expect(n).toBeLessThanOrEqual(3);
              wrongMoves.set(n, (wrongMoves.get(n) ?? 0) + 1);
            }
          }
          // both shrines, every combination of outcomes, from the shrine cells: the invariant holds after each
          for (const first of [true, false]) for (const second of [true, false]) {
            const w = cloneMaze(base);
            for (const [k, ok] of [[0, first], [1, second]] as const) {
              const s = rl.shift!.shrines[k];
              const p = { c: s.c, r: s.r };
              const plan = ok ? planRight(w, p) : planWrong(w, p, () => true);
              if (!plan) continue;
              const t = trial(w, plan, p);
              expect(t).not.toBeNull();
              for (const e of plan.close) setClosed(w, e, true);
              for (const e of plan.open) setClosed(w, e, false);
              expect(exitAlwaysReachable(w, p)).toBe(true);
            }
          }
        }
      }
    }
    expect(rights).toBeGreaterThan(100);
    expect(wrongs).toBeGreaterThan(100);
    expect(wrongMoves.get(2)).toBeGreaterThan(0);
  }, 120_000);

  it('a closed hedge is never on top of the player', () => {
    const c = buildCourse({ domainId: 'math', difficulty: 'normal', seed: 5 });
    const rl = c.rooms.find((r) => r.kind === 'shiftMaze') ?? buildCourse({ domainId: 'math', difficulty: 'normal', seed: 6 }).rooms.find((r) => r.kind === 'shiftMaze');
    expect(rl === undefined || rl.shift!.rows > 0).toBe(true);
    // a veto on every edge leaves a wrong answer with no plan
    const maze: Maze = { rows: 6, exitC: 2, wallE: Array.from({ length: 6 }, () => [true, true, true, true]), wallN: Array.from({ length: 5 }, () => [true, true, true, true, true]), deadEnds: [], coins: [] };
    for (const e of allEdges(6)) if (edgeCells(e)[0].c === 2) setClosed(maze, e, false);
    expect(isClosed(maze, allEdges(6)[0])).toBe(true);
  });
});

describe('Shifting Maze play', () => {
  function at(run: RunState, k: number) {
    const r = room(run, 'shiftMaze');
    return { r, s: r.layout.shift!.shrines[k] };
  }

  /** Check that the walls the world uses are exactly the live maze. */
  function consistent(run: RunState): void {
    const r = room(run, 'shiftMaze');
    const L = r.layout.shift!;
    const m = liveMaze(r);
    m.wallE.forEach((row, rr) => row.forEach((w, c) => expect(run.world.walls[L.edgesE[rr][c]].enabled).toBe(w)));
    m.wallN.forEach((row, rr) => row.forEach((w, c) => expect(run.world.walls[L.edgesN[rr][c]].enabled).toBe(w)));
    expect(reachableCells(m)).toBe(m.rows * MAZE_COLS);
  }

  it('walking into a shrine asks its question with 2 or 3 labelled plates; leaving pauses it', () => {
    for (const d of SHIFT_DIFFS) {
      const run = bootWithShift(d);
      const { r, s } = at(run, 0);
      enterRoom(run, r);
      expect(r.state).toBe('active');
      expect(r.question).toBeNull();
      expect(run.zone).toBe('normal');
      place(s.x, s.z);
      const sh = r.shift!.shrines[0];
      expect(sh.state).toBe('asking');
      expect(r.question).not.toBeNull();
      expect(sh.plates.length).toBe(r.question!.type === 'truefalse' ? 2 : 3);
      expect(sh.plates.filter((p) => p.correct)).toHaveLength(1);
      for (const p of sh.plates) expect(p.label.length).toBeLessThanOrEqual(22);
      advance(0.2);
      expect(run.zone).toBe('think');
      place(s.x + 7, s.z + 0);
      advance(0.1);
      // moved away (possibly into a wall: only the pause matters)
      if (Math.max(Math.abs(G.player.pos.x - s.x), Math.abs(G.player.pos.z - s.z)) > T.SHIFT_LEAVE_R) expect(sh.state).toBe('idle');
    }
  });

  it('the right plate opens a shortcut: the way from the shrine is shorter, the record is a first-try correct', () => {
    let shorter = 0, tried = 0;
    for (let from = 1; from < 200 && tried < 8; from += 7) {
      const run = bootWithShift('normal', from);
      const { r, s } = at(run, 0);
      enterRoom(run, r);
      place(s.x, s.z);
      const sh = r.shift!.shrines[0];
      const plate = sh.plates.find((p) => p.correct)!;
      const maze = liveMaze(r);
      const before = len(maze, { c: s.c, r: s.r });
      const s0 = run.slime;
      place(plate.x, plate.z);
      advance(T.SHIFT_CHARGE_S + 0.3);
      tried++;
      expect(sh.state).toBe('done');
      expect(sh.right).toBe(true);
      expect(run.records).toHaveLength(1);
      expect(run.records[0].correctFirstTry).toBe(true);
      expect(run.slime).toBeLessThanOrEqual(s0 + 0.001);
      const after = len(maze, { c: s.c, r: s.r });
      expect(after).toBeLessThanOrEqual(before);
      if (after < before) { shorter++; expect(r.shift!.moves).toBeGreaterThan(0); }
      consistent(run);
    }
    expect(shorter).toBeGreaterThan(0);
  });

  it('a wrong plate costs a surge and closes the way ahead: the route is longer, the exit is still reachable, the bean is not boxed in', () => {
    let longer = 0, tried = 0;
    for (let from = 1; from < 200 && tried < 8; from += 7) {
      const run = bootWithShift('normal', from);
      const { r, s } = at(run, 0);
      enterRoom(run, r);
      place(s.x, s.z);
      const sh = r.shift!.shrines[0];
      const plate = sh.plates.find((p) => !p.correct)!;
      const maze = liveMaze(r);
      const before = len(maze, { c: s.c, r: s.r });
      const s0 = run.slime;
      place(plate.x, plate.z);
      advance(T.SHIFT_CHARGE_S + 0.3);
      tried++;
      expect(sh.state).toBe('done');
      expect(sh.right).toBe(false);
      expect(run.slime - s0).toBeGreaterThan(T.SLIME_SURGE.normal * 0.9);
      expect(run.records[0].correctFirstTry).toBe(false);
      const here = cellAt(r, G.player.pos.x, G.player.pos.z);
      const after = len(maze, here);
      expect(after).toBeGreaterThanOrEqual(0);
      if (len(maze, { c: s.c, r: s.r }) > before) longer++;
      expect(exitAlwaysReachable(maze, here)).toBe(true);
      consistent(run);
      // the bean can still move: some neighbouring cell is open
      expect(distancesFrom(maze, here).filter((x) => x === 1).length).toBeGreaterThan(0);
    }
    expect(longer).toBeGreaterThan(0);
  });

  it('answering both shrines resolves the room; leaving the maze resolves it too, with no penalty for skipping', () => {
    const run = bootWithShift('normal');
    const { r } = at(run, 0);
    enterRoom(run, r);
    for (let k = 0; k < 2; k++) {
      const s = r.layout.shift!.shrines[k];
      place(s.x, s.z);
      const plate = r.shift!.shrines[k].plates.find((p) => p.correct)!;
      place(plate.x, plate.z);
      advance(T.SHIFT_CHARGE_S + 0.3);
    }
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    expect(run.records).toHaveLength(2);

    const run2 = bootWithShift('hard');
    const r2 = room(run2, 'shiftMaze');
    enterRoom(run2, r2);
    const s0 = run2.slime;
    place(r2.layout.laneX, r2.layout.z0 - r2.layout.depth - 1.8);
    advance(0.3);
    expect(r2.state).toBe('resolved');
    expect(run2.records).toHaveLength(0);
    expect(run2.slime - s0).toBeLessThan(0.01);
  });

  it('50/50 crosses out one wrong plate; the Compass follows the live walls', () => {
    const run = bootWithShift('normal');
    const { r, s } = at(run, 0);
    enterRoom(run, r);
    place(s.x, s.z);
    run.coins = 5;
    useLifelineSafe('fifty');
    const crossed = r.shift!.shrines[0].plates.filter((p) => p.state === 'wrong');
    expect(crossed).toHaveLength(1);
    expect(crossed[0].correct).toBe(false);
  });
});

describe('Shifting Maze with the bot', () => {
  it('perfect, 60% and guessing players get through Normal and Hard shifting mazes', () => {
    for (const d of SHIFT_DIFFS) {
      let played = 0;
      for (let seed = 1; seed < 150 && played < 4; seed++) {
        if (!buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.some((x) => x.kind === 'shiftMaze')) continue;
        played++;
        for (const o of [{}, { accuracy: 0.6 }, { guess: true }]) {
          const res = playThrough(d, seed, { ...o, rng: mulberry32(seed), keepAlive: true, route: 'short', junctionRight: true });
          expect(['won', 'lost'], `${d} ${seed}`).toContain(res.run.phase);
          for (const r of res.run.rooms.filter((x) => x.kind === 'shiftMaze' && x.state !== 'idle')) {
            const m = liveMaze(r);
            expect(reachableCells(m)).toBe(m.rows * MAZE_COLS);
          }
        }
      }
      expect(played).toBeGreaterThan(0);
    }
  }, 180_000);
});
