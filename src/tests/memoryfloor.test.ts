import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, place, room, steer, walkTo } from './helpers';
import { useLifelineSafe } from './rooms.util';
import { buildCourse, recipeOverride } from '../game/loop/generation';
import type { RoomRuntime, RunState } from '../game/runtime';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Difficulty } from '../game/types';
import { useUI } from '../ui/store';
import { playThrough } from './bot';
import { mulberry32 } from '../game/rng';

afterEach(() => { finish(); recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

function bootWithMemory(d: Difficulty): RunState {
  for (let seed = 1; seed < 200; seed++) {
    const run = boot(d, seed, 'math', {}, true);
    if (run.rooms.some((r) => r.kind === 'memoryFloor')) return run;
  }
  throw new Error('no memoryFloor course');
}

/** Enter the room and let the labels flip down. */
function enterAndAsk(d: Difficulty): { run: RunState; r: RoomRuntime } {
  const run = bootWithMemory(d);
  const r = room(run, 'memoryFloor');
  enterRoom(run, r);
  advance(T.MEMORY_REVEAL_S[d] + 0.2);
  return { run, r };
}

function stand(r: RoomRuntime, idx: number, secs = T.MEMORY_STAND_S + 0.3): void {
  const t = r.tiles[idx];
  walkTo(t.cx, t.cz, 15, 0.25);
  steer(0, 0);
  advance(secs);
}

describe('Memory Floor', () => {
  it('builds a 3x3 field with an exit gate on every difficulty', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 20; seed++) {
        for (const l of buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.filter((x) => x.kind === 'memoryFloor')) {
          expect(l.tiles).toHaveLength(9);
          expect(l.exitGateWallId).not.toBeNull();
          expect(new Set(l.tiles.map((t) => t.floorId)).size).toBe(9);
        }
      }
    }
  });

  it('flips 4 labelled tiles up for the reveal time (Easy 7, Normal 5, Hard 3 s), with no question yet', () => {
    for (const d of DIFFS) {
      const run = bootWithMemory(d);
      const r = room(run, 'memoryFloor');
      enterRoom(run, r);
      expect(r.state).toBe('active');
      expect(r.memory!.phase).toBe('reveal');
      const lab = r.tiles.filter((_, i) => r.memory!.labelled[i]);
      expect(lab).toHaveLength(4);
      expect(lab.filter((t) => t.correct)).toHaveLength(1);
      expect(new Set(lab.map((t) => t.label)).size).toBe(4);
      for (const t of lab) { expect(t.revealed).toBe(true); expect(t.label.length).toBeLessThanOrEqual(22); }
      expect(r.tiles.filter((t) => t.revealed)).toHaveLength(4);
      expect(useUI.getState().room).toBeNull(); // the question is not shown yet
      expect(run.zone).toBe('normal');
      advance(T.MEMORY_REVEAL_S[d] - 0.5);
      expect(r.memory!.phase).toBe('reveal');
      advance(1);
      expect(r.memory!.phase).toBe('ask');
      expect(r.tiles.some((t) => t.revealed)).toBe(false); // face down again
      expect(useUI.getState().room?.title).toBe('MEMORY FLOOR');
      expect(useUI.getState().room?.prompt).toBe(r.question!.prompt);
      expect(run.zone).toBe('think');
    }
  });

  it('standing on the right tile for a second resolves it: a bridge rises and the exit gate opens', () => {
    const { run, r } = enterAndAsk('normal');
    const ci = r.tiles.findIndex((t) => t.correct);
    const gate = run.world.walls[r.layout.exitGateWallId!];
    expect(gate.enabled).toBe(true);
    stand(r, ci, 0.5);
    expect(r.state).toBe('active');            // not yet: half a second is not enough
    advance(T.MEMORY_STAND_S);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    expect(run.records).toHaveLength(1);
    expect(run.records[0].correctFirstTry).toBe(true);
    expect(gate.enabled).toBe(true);            // the bridge is still rising
    advance(T.MEMORY_BRIDGE_S + 0.2);
    expect(r.memory!.bridge).toBe(1);
    expect(gate.enabled).toBe(false);
    steer(0, 1);
    advance(3);
    steer(0, 0);
    expect(G.player.pos.z).toBeLessThan(r.layout.z0 - 17);
  });

  it('running across a tile is not a choice: only standing still counts', () => {
    const { r } = enterAndAsk('normal');
    const ci = r.tiles.findIndex((t) => t.correct);
    const t = r.tiles[ci];
    place(t.cx - t.sx / 2 + 0.5, t.cz);
    walkTo(t.cx + t.sx / 2 - 0.5, t.cz, 5, 0.3);
    steer(0, 0);
    expect(r.state).toBe('active');
    expect(r.memory!.stand).toBeLessThan(T.MEMORY_STAND_S);
  });

  it('a blank tile does nothing', () => {
    const { r } = enterAndAsk('normal');
    const blank = r.tiles.findIndex((_, i) => !r.memory!.labelled[i]);
    stand(r, blank, 2);
    expect(r.state).toBe('active');
    expect(r.wrongCount).toBe(0);
  });

  it('a wrong tile drops, you respawn at the room start with a surge; labels re-flash on Easy/Normal but not on Hard', () => {
    for (const d of DIFFS) {
      const { run, r } = enterAndAsk(d);
      const wi = r.tiles.findIndex((t, i) => r.memory!.labelled[i] && !t.correct);
      const s0 = run.slime;
      stand(r, wi);
      expect(r.memory!.pendingFall).toBe(true);
      expect(r.tiles[wi].state === 'shaking' || r.tiles[wi].state === 'falling').toBe(true);
      expect(run.records[0].correctFirstTry).toBe(false);
      for (let i = 0; i < 8 * 60 && r.memory!.dropIdx !== -1; i++) advance(1 / 60); // until the respawn
      advance(0.3);
      expect(r.memory!.pendingFall).toBe(false);
      expect(run.slime).toBeGreaterThan(s0 + T.SLIME_SURGE[d] * 0.9);
      expect(G.player.inputLocked).toBe(false);
      // back at the room start
      expect(Math.hypot(G.player.pos.x - r.layout.startSpawn.x, G.player.pos.z - r.layout.startSpawn.z)).toBeLessThan(2);
      // the tile is back, ruled out (X), and cannot be chosen again
      expect(r.tiles[wi].state).toBe('solid');
      expect(r.tiles[wi].label).toBe('X');
      expect(run.world.floors[r.tiles[wi].floorId].enabled).toBe(true);
      if (d === 'hard') expect(r.memory!.reflash).toBe(0);
      else expect(r.memory!.reflash).toBeGreaterThan(0);
      // the labels (other than X) show during a re-flash only
      const live = r.tiles.filter((_, i) => r.memory!.labelled[i]);
      if (d === 'hard') expect(live.some((t) => t.revealed)).toBe(false);
      else expect(live.every((t) => t.revealed)).toBe(true);
      advance(T.MEMORY_REFLASH_S.easy + 0.2);
      expect(live.some((t) => t.revealed)).toBe(false);
      // the right tile now resolves it as remediated
      stand(r, r.tiles.findIndex((t) => t.correct));
      expect(r.state).toBe('resolved');
      expect(r.result).toBe('remediated');
      expect(run.records).toHaveLength(1);
      expect(run.records[0].remediated).toBe(true);
    }
  });

  it('50/50 rules out two wrong tiles; labels cannot be bought during the reveal', () => {
    const run = bootWithMemory('normal');
    const r = room(run, 'memoryFloor');
    run.coins = 9;
    enterRoom(run, r);
    useLifelineSafe('fifty');
    useLifelineSafe('hint');
    expect(r.fiftyUsed).toBe(false);
    expect(r.hintUsed).toBe(false);
    expect(run.coins).toBe(9);
    advance(T.MEMORY_REVEAL_S.normal + 0.2);
    useLifelineSafe('fifty');
    expect(r.fiftyUsed).toBe(true);
    expect(r.memory!.dead.filter(Boolean)).toHaveLength(2);
    expect(r.tiles.filter((t, i) => r.memory!.dead[i] && t.correct)).toHaveLength(0);
    expect(r.memory!.labelled.filter(Boolean)).toHaveLength(2);
  });

  it('a perfect bot solves it on every difficulty; wrong guesses never trap the bot', () => {
    for (const d of DIFFS) {
      const seeds: number[] = [];
      for (let seed = 1; seeds.length < 3 && seed < 300; seed++) {
        if (buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.some((x) => x.kind === 'memoryFloor')) seeds.push(seed);
      }
      expect(seeds).toHaveLength(3);
      for (const seed of seeds) {
        const res = playThrough(d, seed, { route: 'short', junctionRight: true, keepAlive: true });
        expect(res.run.phase, `${d} ${seed}`).toBe('won');
        const rec = res.run.records.filter((x) => x.roomKind === 'memoryFloor');
        expect(rec.length).toBeGreaterThan(0);
        expect(rec.every((x) => x.correctFirstTry)).toBe(true);
      }
      for (const seed of seeds) {
        const g = playThrough(d, seed, { guess: true, rng: mulberry32(seed), keepAlive: true, route: 'short', junctionRight: true });
        expect(['won', 'lost'], `${d} ${seed}`).toContain(g.run.phase);
      }
    }
  }, 120_000);
});
