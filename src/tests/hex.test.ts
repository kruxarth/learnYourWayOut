import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, place, room } from './helpers';
import { engine } from '../game/engine';
import { DEFAULT_SETTINGS, loadSave } from '../game/persistence';
import { buildCourse, recipeFor, recipeOverride } from '../game/loop/generation';
import { CLASSIC_RECIPES, DEMO_RECIPE, applyFinale, gauntletRecipe, TEMPLATES } from '../game/loop/pool';
import { ringsForRound, roundSeconds, type HexRT } from '../game/rooms/hexFinale';
import { hexCells } from '../game/loop/bigRoomsBuild';
import { finaleFor } from '../net/race';
import { questionSource } from '../content/source';
import { stream } from '../game/rng';
import { G } from '../game/state';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';
import type { Difficulty, RoomLayout } from '../game/types';
import { playThrough } from './bot';

beforeEach(() => { useUI.setState({ settings: { ...DEFAULT_SETTINGS } }); });
afterEach(() => { finish(); recipeOverride.mode = 'pool'; useUI.setState({ settings: { ...DEFAULT_SETTINGS } }); });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

function hexRun(d: Difficulty = 'normal', seed = 4242) {
  const run = boot(d, seed, 'math', { finale: 'hex' }, true);
  return { run, r: room(run, 'hexFinale') };
}

/** Put the bean on a tile of the right colour, away from the edge ring that is about to crumble. */
function standCorrect(r: ReturnType<typeof room>): void {
  const hx = r.hex!;
  const keep = hx.shrinking ? hx.rings - 1 : hx.rings;
  const t = hx.tiles.filter((x) => !x.removed && x.state === 'solid' && x.cluster === hx.correct && x.ring <= keep)[0];
  place(t.cx, t.cz);
}

function runUntil(hx: HexRT, phase: HexRT['phase'], round: number, maxSec = 40): void {
  for (let i = 0; i < maxSec * 60 && !(hx.phase === phase && hx.round === round); i++) advance(1 / 60);
}

describe('Hex Finale: layout', () => {
  it('is a disc of 37 hex cells whose rects tile the arena with no gaps or overlaps, inside the walls', () => {
    expect(hexCells(T.HEX_RINGS)).toHaveLength(37);
    for (const d of DIFFS) {
      const c = buildCourse({ domainId: 'math', difficulty: d, seed: 5, finale: 'hex' });
      const rl = c.rooms.find((x) => x.kind === 'hexFinale') as RoomLayout;
      const L = rl.hex!;
      expect(L.cells).toHaveLength(37);
      const f = L.cells.map((x) => c.floors[x.floorId]);
      for (const a of f) {
        expect(a.minX).toBeGreaterThanOrEqual(rl.laneX - 10 + T.PLAYER_RADIUS);
        expect(a.maxX).toBeLessThanOrEqual(rl.laneX + 10 - T.PLAYER_RADIUS);
        expect(a.moving).toBe(true);
        expect(a.isStatic).toBe(false);
      }
      // sample points: inside the union -> exactly one cell, so rects tile
      for (let x = rl.laneX - 9; x <= rl.laneX + 9; x += 0.37) {
        for (let z = rl.z0 - 20; z <= rl.z0 - 1; z += 0.37) {
          const hits = f.filter((a) => x >= a.minX && x < a.maxX && z >= a.minZ && z < a.maxZ).length;
          expect(hits, `${x.toFixed(2)},${z.toFixed(2)}`).toBeLessThanOrEqual(1);
        }
      }
      // doorstep + arena + exit platform are contiguous along the room
      const step = c.floors[L.doorstepFloorId], exit = c.floors[L.exitFloorId];
      expect(step.maxZ).toBeCloseTo(rl.z0, 6);
      expect(step.minZ).toBeCloseTo(rl.z0 - T.HEX_STEP_D, 6);
      expect(Math.min(...f.map((a) => a.minZ))).toBeCloseTo(exit.maxZ, 6);
      expect(Math.max(...f.map((a) => a.maxZ))).toBeCloseTo(step.minZ, 6);
      expect(exit.enabled).toBe(false);
      expect(exit.minZ).toBeCloseTo(rl.z0 - rl.depth, 6);
    }
  });

  it('replaces only the Slime Gate: every other step and every earlier segment is unchanged', () => {
    for (const d of DIFFS) {
      for (const seed of [1, 7, 42]) {
        const a = buildCourse({ domainId: 'math', difficulty: d, seed });
        const b = buildCourse({ domainId: 'math', difficulty: d, seed, finale: 'hex' });
        expect(a.segments.at(-2)!.kind).toBe('slimeGate');
        expect(b.segments.at(-2)!.kind).toBe('hexFinale');
        expect(b.segments.slice(0, -2)).toEqual(a.segments.slice(0, -2));
        expect(b.segments.at(-1)!.kind).toBe('exit');
        expect(b.rooms.filter((r) => r.kind === 'slimeGate')).toHaveLength(0);
        expect(b.rooms.length).toBe(a.rooms.length);
        // the rest of the room list is the same kinds in the same order
        expect(b.rooms.slice(0, -1).map((r) => r.kind)).toEqual(a.rooms.slice(0, -1).map((r) => r.kind));
      }
    }
  });

  it('applyFinale swaps the gate only when asked; the demo and the Gauntlet never get it', () => {
    for (const d of DIFFS) {
      expect(applyFinale(TEMPLATES[d], undefined)).toBe(TEMPLATES[d]);
      expect(applyFinale(TEMPLATES[d], 'gate')).toBe(TEMPLATES[d]);
      const hex = applyFinale(CLASSIC_RECIPES[d], 'hex');
      expect(hex.filter((s) => s.k === 'hexFinale')).toHaveLength(1);
      expect(hex.filter((s) => s.k === 'slimeGate')).toHaveLength(0);
      expect(hex).toHaveLength(CLASSIC_RECIPES[d].length);
    }
    expect(recipeFor({ domainId: 'math', difficulty: 'normal', seed: 4242, finale: 'hex' }, { demo: true })).toBe(DEMO_RECIPE);
    expect(DEMO_RECIPE.some((s) => s.k === 'hexFinale' || s.k === 'answerLifts')).toBe(false);
    const g = recipeFor({ domainId: 'math', difficulty: 'normal', seed: 3, mode: 'gauntlet', finale: 'hex' });
    expect(g).toEqual(gauntletRecipe(questionSource.getPack('math'), stream(3, 'recipe')));
    expect(g.some((s) => s.k === 'hexFinale')).toBe(false);
  });
});

describe('Hex Finale: rules', () => {
  it('question time is 12 s, 1 s less per round, never under 6 s; the edge loses a ring every 2 rounds', () => {
    expect([1, 2, 3, 4, 5].map(roundSeconds)).toEqual([12, 11, 10, 9, 8]);
    expect([6, 7, 8, 9, 20].map(roundSeconds)).toEqual([7, 6, 6, 6, 6]);
    expect([1, 2, 3, 4, 5].map(ringsForRound)).toEqual([3, 3, 2, 2, 1]);
    expect(T.HEX_ROUNDS).toBe(5);
  });

  it('paints one cluster per answer (2 for true/false), every cluster has tiles, exactly one is right', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 6; seed++) {
        const { run, r } = hexRun(d, seed);
        enterRoom(run, r);
        const hx = r.hex!;
        expect(r.state).toBe('active');
        for (let round = 1; round <= T.HEX_ROUNDS; round++) {
          runUntil(hx, 'ask', round);
          expect(hx.round).toBe(round);
          const k = hx.clusters.length;
          expect(k).toBe(r.question!.type === 'truefalse' ? 2 : T.HEX_CLUSTERS[d]);
          expect(hx.clusters.filter((c) => c.correct)).toHaveLength(1);
          expect(new Set(hx.clusters.map((c) => c.label)).size).toBe(k);
          for (const c of hx.clusters) expect(c.label.length).toBeLessThanOrEqual(22);
          const live = hx.tiles.filter((t) => !t.removed && t.ring <= hx.rings);
          for (let ci = 0; ci < k; ci++) expect(live.some((t) => t.cluster === ci), `${d} ${seed} round ${round} cluster ${ci}`).toBe(true);
          expect(hx.total).toBeCloseTo(roundSeconds(round), 9);
          standCorrect(r);
          run.slime = 0;
          if (round < T.HEX_ROUNDS) runUntil(hx, 'ask', round + 1);
        }
      }
    }
  });

  it('after the timer every tile outside the correct cluster falls; the others stay', () => {
    const { run, r } = hexRun('normal');
    enterRoom(run, r);
    const hx = r.hex!;
    standCorrect(r);
    const wrongBefore = hx.tiles.filter((t) => t.cluster !== hx.correct);
    const rightFloors = hx.tiles.filter((t) => t.cluster === hx.correct);
    advance(hx.total + T.HEX_SHAKE_S + 0.1);
    expect(hx.phase).toBe('fall');
    for (const t of wrongBefore) expect(t.state === 'shaking' || t.state === 'sinking').toBe(true);
    advance(T.HEX_SINK_S + 0.1);
    for (const t of wrongBefore) expect(run.world.floors[t.floorId].enabled, 'fallen tile has no floor').toBe(false);
    for (const t of rightFloors) { expect(t.state).toBe('solid'); expect(run.world.floors[t.floorId].enabled).toBe(true); }
    // the bean stood on a right tile: it is still up, grounded, with no surge from a fall
    expect(G.player.pos.y).toBeGreaterThan(-0.1);
    expect(r.record!.correctFirstTry).toBe(true);
  });

  it('a tile sinking under the bean carries it down (moving floor), then it falls: a large surge and a respawn on the rim', () => {
    const { run, r } = hexRun('normal');
    enterRoom(run, r);
    const hx = r.hex!;
    const wrong = hx.tiles.filter((t) => t.cluster !== hx.correct && t.ring === 1)[0];
    place(wrong.cx, wrong.cz);
    run.slime = 0;
    advance(hx.total + T.HEX_SHAKE_S + 0.5);
    // riding down with the tile
    const floor = run.world.floors[wrong.floorId];
    expect(floor.top).toBeLessThan(-0.05);
    expect(G.player.pos.y).toBeCloseTo(floor.top, 1);
    const s0 = run.slime;
    advance(T.HEX_SINK_S + 3);
    expect(run.slime - s0).toBeGreaterThanOrEqual(T.HEX_FALL_SURGE.normal * 0.95);
    expect(run.slime - s0).toBeLessThan(0.3);
    expect(r.record!.correctFirstTry).toBe(false);
    expect(hx.misses).toBe(1);
    // back on the rim: a standing tile of the outermost remaining ring
    const p = G.player.pos;
    const on = hx.tiles.find((t) => Math.abs(p.x - t.cx) <= t.sx / 2 && Math.abs(p.z - t.cz) <= t.sz / 2 && t.state !== 'gone')!;
    expect(on).toBeDefined();
    expect(on.state === 'solid' || on.state === 'rising').toBe(true);
    expect(on.ring).toBe(Math.max(...hx.tiles.filter((t) => t.state === 'solid' && !t.removed).map((t) => t.ring)));
    expect(G.player.grounded).toBe(true);
    expect(run.phase).toBe('playing');
  });

  it('the edge shrinks one ring after rounds 2 and 4, and everything comes back when the finale is won', () => {
    const { run, r } = hexRun('normal');
    enterRoom(run, r);
    const hx = r.hex!;
    const removed = () => hx.tiles.filter((t) => t.removed).length;
    for (let round = 1; round <= T.HEX_ROUNDS; round++) {
      runUntil(hx, 'ask', round);
      expect(removed(), `round ${round}`).toBe(round <= 2 ? 0 : round <= 4 ? 18 : 30);
      standCorrect(r);
      run.slime = 0;
    }
    runUntil(hx, 'won', 5);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    advance(T.HEX_RISE_S + 0.2);
    for (const t of hx.tiles) { expect(t.state).toBe('solid'); expect(run.world.floors[t.floorId].enabled).toBe(true); }
    expect(run.world.floors[r.layout.hex!.exitFloorId].enabled).toBe(true);
  });

  it('the doorstep and the exit platform are no place to wait: the doorstep goes at the start, the exit comes at the end', () => {
    const { run, r } = hexRun('normal');
    const L = r.layout.hex!;
    expect(run.world.floors[L.doorstepFloorId].enabled).toBe(true);
    enterRoom(run, r);
    expect(run.world.floors[L.doorstepFloorId].enabled).toBe(false);
    expect(run.world.floors[L.exitFloorId].enabled).toBe(false);
    expect(run.world.walls[r.layout.gateWallId!].enabled).toBe(true);
  });

  it('a fall with the slime nearly full eliminates the bean', () => {
    const { run, r } = hexRun('normal');
    enterRoom(run, r);
    const hx = r.hex!;
    const wrong = hx.tiles.filter((t) => t.cluster !== hx.correct && t.ring === 1)[0];
    place(wrong.cx, wrong.cz);
    run.slime = 0.95;
    G.run!.godMode = false;
    advance(hx.total + T.HEX_SHAKE_S + T.HEX_SINK_S + 6);
    expect(run.phase).toBe('lost');
    advance(T.RESULT_DELAY + 0.5);
    expect(useUI.getState().results?.outcome).toBe('eliminated');
  });

  it('is deterministic: the same seed paints the same questions and clusters', () => {
    const play = () => {
      const { run, r } = hexRun('hard', 99);
      enterRoom(run, r);
      const hx = r.hex!;
      const log: string[] = [];
      for (let round = 1; round <= T.HEX_ROUNDS; round++) {
        runUntil(hx, 'ask', round);
        log.push(`${r.question!.id}|${hx.clusters.map((c) => c.label + (c.correct ? '*' : '')).join(',')}|${hx.tiles.map((t) => t.cluster).join('')}`);
        standCorrect(r);
        run.slime = 0;
      }
      finish();
      return log;
    };
    expect(play()).toEqual(play());
  });
});

describe('Hex Finale: choosing it', () => {
  it('solo: the setting picks it (default gate); the choice is part of the run selection', () => {
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 12 });
    expect(G.run!.selection.finale).toBeUndefined();
    expect(G.run!.course.segments.at(-2)!.kind).toBe('slimeGate');
    useUI.setState({ settings: { ...DEFAULT_SETTINGS, finale: 'hex' } });
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 12 });
    expect(G.run!.selection.finale).toBe('hex');
    expect(G.run!.course.segments.at(-2)!.kind).toBe('hexFinale');
    // Play again keeps the same last room
    engine.restartRun();
    expect(G.run!.course.segments.at(-2)!.kind).toBe('hexFinale');
    // a daily course is the same for everyone, an online race follows the player count: neither reads the setting
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 12, mode: 'daily' });
    expect(G.run!.course.segments.at(-2)!.kind).toBe('slimeGate');
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 12, mode: 'online', finale: finaleFor(2) });
    expect(G.run!.course.segments.at(-2)!.kind).toBe('slimeGate');
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 12, mode: 'online', finale: finaleFor(3) });
    expect(G.run!.course.segments.at(-2)!.kind).toBe('hexFinale');
  });

  it('online: three or more racers play it, fewer do not, and every laptop builds the identical course', () => {
    expect([undefined, 0, 1, 2].map(finaleFor)).toEqual(['gate', 'gate', 'gate', 'gate']);
    expect([3, 4, 8].map(finaleFor)).toEqual(['hex', 'hex', 'hex']);
    expect(finaleFor(Number.NaN)).toBe('gate');
    const sel = { domainId: 'science' as const, difficulty: 'hard' as const, seed: 777, mode: 'online' as const, finale: finaleFor(5) };
    expect(buildCourse(sel)).toEqual(buildCourse({ ...sel }));
  });

  it('loadSave only ever accepts gate or hex', () => {
    expect(loadSave().settings.finale).toBe('gate');
    expect(DEFAULT_SETTINGS.finale).toBe('gate');
  });
});

describe('Hex Finale: bot', () => {
  it('a perfect bot qualifies on 8 seeds per difficulty, on both lanes, with every round survived', () => {
    for (const d of DIFFS) {
      for (let i = 0; i < 8; i++) {
        const route = i % 2 ? 'long' : 'short';
        const seed = 300 + 41 * i;
        const res = playThrough(d, seed, { finale: 'hex', route, junctionRight: route === 'short', keepAlive: true });
        const hexRoom = res.run.rooms.find((x) => x.kind === 'hexFinale')!;
        expect(res.run.phase, `${d} seed ${seed}`).toBe('won');
        expect(hexRoom.state).toBe('resolved');
        expect(hexRoom.result).toBe('correct');
        expect(hexRoom.hex!.misses).toBe(0);
        expect(res.run.records.filter((x) => x.roomKind === 'hexFinale')).toHaveLength(T.HEX_ROUNDS);
      }
    }
  }, 600_000);

  it('a bot that stands on the wrong colour in round 1 falls, is put back on the rim, and still finishes the rounds', () => {
    for (const d of DIFFS) {
      const res = playThrough(d, 410, { finale: 'hex', wrongFirst: ['hexFinale'], keepAlive: true, junctionRight: true, route: 'short' });
      const hexRoom = res.run.rooms.find((x) => x.kind === 'hexFinale')!;
      expect(hexRoom.state, d).toBe('resolved');
      expect(hexRoom.result).toBe('remediated');
      expect(hexRoom.hex!.misses).toBe(1);
      expect(res.run.phase).toBe('won');
    }
  }, 600_000);
});
