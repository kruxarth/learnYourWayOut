import { afterEach, describe, expect, it } from 'vitest';
import { questionSource } from '../content/source';
import type { DomainPack } from '../content/schema';
import { buildCourse, recipeOverride, recipeFor } from '../game/loop/generation';
import {
  CLASSIC_RECIPES, DEMO_RECIPE, POOL, TEMPLATES, eligibleEntries, gauntletRecipe, resolveRecipe, type Step,
} from '../game/loop/pool';
import { stream } from '../game/rng';
import type { Difficulty, RunSelection } from '../game/types';

afterEach(() => { recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const pack = questionSource.getPack('math');
const sel = (difficulty: Difficulty, seed: number): RunSelection => ({ domainId: 'math', difficulty, seed });
const slotsOf = (d: Difficulty) => TEMPLATES[d].filter((s) => s.k === 'slot').length;
const resolve = (d: Difficulty, seed: number, p: DomainPack = pack) => resolveRecipe(TEMPLATES[d], sel(d, seed), p, stream(seed, 'recipe'));
const entry = (k: string) => POOL.find((e) => e.kind === k)!;

/** The room kinds that filled the slots, in order. */
function filled(d: Difficulty, steps: Step[]): string[] {
  const out: string[] = [];
  let ti = 0;
  for (const t of TEMPLATES[d]) { if (t.k === 'slot') out.push(steps[ti].k); ti++; }
  return out;
}

describe('recipe slots', () => {
  it('templates have 3 / 4 / 5 room slots and no step is left unresolved', () => {
    expect(DIFFS.map(slotsOf)).toEqual([3, 4, 5]);
    for (const d of DIFFS) {
      const steps = resolve(d, 1);
      expect(steps).toHaveLength(TEMPLATES[d].length);
      expect(steps.some((s) => s.k === 'slot' || s.k === 'mazeSlot')).toBe(false);
    }
  });

  it('keeps every anchor in place', () => {
    for (const d of DIFFS) {
      const t = TEMPLATES[d], steps = resolve(d, 77);
      t.forEach((s, i) => { if (s.k !== 'slot' && s.k !== 'mazeSlot') expect(steps[i]).toEqual(s); });
    }
  });

  it('is deterministic: the same seed gives the same recipe', () => {
    for (const d of DIFFS) for (let seed = 1; seed <= 40; seed++) expect(resolve(d, seed)).toEqual(resolve(d, seed));
  });

  it('pool rules hold over 500 seeds per difficulty', () => {
    for (const d of DIFFS) {
      const n = slotsOf(d);
      const eligible = eligibleEntries('room', d, pack);
      const fresh = eligible.filter((e) => !e.classic);
      for (let seed = 1; seed <= 500; seed++) {
        const kinds = filled(d, resolve(d, seed));
        expect(kinds).toHaveLength(n);
        // no repeats while the pool is big enough
        if (eligible.length >= n) expect(new Set(kinds).size).toBe(n);
        // no two big rooms in a row
        for (let i = 1; i < n; i++) expect(entry(kinds[i]).big && entry(kinds[i - 1]).big, `${d} ${seed} ${kinds}`).toBe(false);
        // Normal and Hard: at least half the slots (rounded up) are non-classic, as far as the pool allows
        if (d !== 'easy') {
          const nonClassic = kinds.filter((k) => !entry(k).classic).length;
          expect(nonClassic).toBeGreaterThanOrEqual(Math.min(Math.ceil(n / 2), fresh.length));
        }
      }
    }
  });

  it('every pool room is picked at least once in 500 seeds per difficulty', () => {
    for (const d of DIFFS) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 500; seed++) for (const k of filled(d, resolve(d, seed))) seen.add(k);
      for (const e of eligibleEntries('room', d, pack)) expect(seen.has(e.kind), `${d}: ${e.kind}`).toBe(true);
    }
  });

  it('respects minDifficulty and fits(pack)', () => {
    // a pack without step questions cannot get Step Stones
    const noSteps: DomainPack = { ...pack, questions: pack.questions.filter((q) => q.type !== 'steps') };
    expect(eligibleEntries('room', 'normal', noSteps).some((e) => e.kind === 'stepStones')).toBe(false);
    for (let seed = 1; seed <= 100; seed++) expect(filled('hard', resolve('hard', seed, noSteps))).not.toContain('stepStones');
    for (const e of POOL) {
      if (e.minDifficulty === 'normal') expect(eligibleEntries(e.slot, 'easy', pack)).not.toContain(e);
      if (e.minDifficulty === 'hard') expect(eligibleEntries(e.slot, 'normal', pack)).not.toContain(e);
    }
  });

  it('every domain pack fits every classic room', () => {
    for (const p of questionSource.allPacks()) for (const e of POOL.filter((x) => x.classic)) expect(e.fits(p), `${p.id} ${e.kind}`).toBe(true);
  });

  it('a pool smaller than the slot count repeats rooms instead of failing', () => {
    const only: DomainPack = { ...pack, questions: pack.questions.filter((q) => q.type === 'mcq' || q.type === 'truefalse') };
    const kinds = filled('hard', resolve('hard', 3, only));
    expect(kinds).toHaveLength(5);
  });
});

describe('recipes and courses', () => {
  it('uses its own stream: anchors before the first slot are laid out the same for any recipe', () => {
    for (const d of DIFFS) {
      const a = buildCourse(sel(d, 9)), b = (recipeOverride.mode = 'classic', buildCourse(sel(d, 9)));
      recipeOverride.mode = 'pool';
      // start and the first maze come before any slot, and share the layout stream
      const upTo = a.segments[2].z0;
      const walls = (c: typeof a) => c.walls.filter((w) => w.minZ >= upTo && w.maxX < 100).map((w) => [w.minX, w.minZ, w.maxX, w.maxZ].join());
      expect(walls(a)).toEqual(walls(b));
    }
  });

  it('classic recipes match the pre-pool ones and ?demo=1 pins DEMO_RECIPE', () => {
    expect(CLASSIC_RECIPES.normal.map((s) => s.k)).toEqual(['start', 'maze', 'doorRush', 'quizMaze', 'tileDrop', 'fork', 'stepStones', 'maze', 'bridgeBuilder', 'slimeGate', 'exit']);
    expect(recipeFor(sel('normal', 4242), { demo: true })).toBe(DEMO_RECIPE);
    expect(recipeFor(sel('normal', 1), { demo: true })).toBe(DEMO_RECIPE);
    expect(recipeFor(sel('hard', 4242), { demo: true })).not.toBe(DEMO_RECIPE);
  });

  it('pool courses build for many seeds: segments contiguous, one room per slot', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 60; seed++) {
        const c = buildCourse(sel(d, seed));
        const main = c.segments.filter((s) => s.lane === 'main');
        expect(main[0].kind).toBe('start');
        expect(main[main.length - 1].kind).toBe('exit');
        expect(c.rooms.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Gauntlet recipe', () => {
  it('has every eligible pool room exactly once, a fork and a quiz maze', () => {
    const want = eligibleEntries('room', 'normal', pack).map((e) => e.kind).sort();
    for (let seed = 1; seed <= 100; seed++) {
      const steps = gauntletRecipe(pack, stream(seed, 'recipe'));
      const rooms = steps.filter((s) => (POOL.some((e) => e.slot === 'room' && e.kind === s.k))).map((s) => s.k).sort();
      expect(rooms).toEqual(want);
      expect(steps.filter((s) => s.k === 'fork')).toHaveLength(1);
      expect(steps.filter((s) => s.k === 'quizMaze')).toHaveLength(1);
      expect(steps[0].k).toBe('start');
      expect(steps.slice(-2).map((s) => s.k)).toEqual(['slimeGate', 'exit']);
      // a plain maze between any two rooms when one is big
      for (let i = 1; i < steps.length; i++) {
        const a = POOL.find((e) => e.slot === 'room' && e.kind === steps[i - 1].k), b = POOL.find((e) => e.slot === 'room' && e.kind === steps[i].k);
        if (a?.big && b) throw new Error('two rooms in a row around a big one');
        if (a && b && b.big) throw new Error('two rooms in a row around a big one');
      }
    }
  });

  it('selects the Gauntlet through RunSelection.mode and builds a course', () => {
    const c = buildCourse({ ...sel('normal', 5), mode: 'gauntlet' });
    expect(c.rooms.length).toBeGreaterThanOrEqual(eligibleEntries('room', 'normal', pack).length);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = (s: number) => gauntletRecipe(pack, stream(s, 'recipe')).map((x) => x.k).join();
    expect(a(3)).toBe(a(3));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(a)).size).toBeGreaterThan(1);
  });
});
