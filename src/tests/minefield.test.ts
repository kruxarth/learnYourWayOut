import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, room, steer, walkTo } from './helpers';
import { useLifelineSafe } from './rooms.util';
import { questionSource } from '../content/source';
import type { ClassifyQuestion, DomainPack } from '../content/schema';
import { validateDomainPack } from '../content/validate';
import { buildCourse, recipeOverride } from '../game/loop/generation';
import { POOL, eligibleEntries } from '../game/loop/pool';
import { dealItems } from '../game/rooms/ruleMinefield';
import { mulberry32 } from '../game/rng';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Difficulty } from '../game/types';
import { playThrough } from './bot';
import { EXAMPLE_PACKS } from '../content/examples';

afterEach(() => { finish(); recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

function bootWithMine(d: Difficulty) {
  for (let seed = 1; seed < 60; seed++) {
    const run = boot(d, seed, 'math', {}, true);
    if (run.rooms.some((r) => r.kind === 'ruleMinefield')) return run;
  }
  throw new Error('no ruleMinefield course');
}

describe('classify content', () => {
  it('every built-in domain and example pack has >= 4 classify questions, >= 2 concepts, mixed tiers, valid labels', () => {
    const packs: DomainPack[] = [...questionSource.allPacks(), ...EXAMPLE_PACKS.map((e) => e.pack)];
    for (const p of packs) {
      const cls = p.questions.filter((q): q is ClassifyQuestion => q.type === 'classify');
      expect(cls.length, p.id + ' ' + p.name).toBeGreaterThanOrEqual(4);
      expect(new Set(cls.map((q) => q.concept)).size, p.name).toBeGreaterThanOrEqual(2);
      expect(new Set(cls.map((q) => q.tier)).size, p.name).toBeGreaterThanOrEqual(2);
      for (const q of cls) {
        expect(q.items.length).toBeGreaterThanOrEqual(8);
        expect(q.items.length).toBeLessThanOrEqual(10);
        expect(q.items.filter((i) => i.fits).length).toBeGreaterThanOrEqual(3);
        expect(q.items.filter((i) => !i.fits).length).toBeGreaterThanOrEqual(3);
        for (const i of q.items) { expect(i.label.length).toBeGreaterThanOrEqual(1); expect(i.label.length).toBeLessThanOrEqual(22); }
      }
    }
  });

  it('the validator rejects bad classify questions but leaves classify optional in the quotas', () => {
    const pack = questionSource.getPack('math');
    const good = pack.questions.find((q): q is ClassifyQuestion => q.type === 'classify')!;
    const bad = (patch: Partial<ClassifyQuestion>): string[] => validateDomainPack({ ...pack, questions: pack.questions.map((q) => (q === good ? { ...good, ...patch } : q)) });
    expect(bad({})).toEqual([]);
    expect(bad({ items: good.items.slice(0, 7) }).join()).toContain('8-10 items');
    expect(bad({ items: good.items.map((i, k) => ({ ...i, fits: k < 2 })) }).join()).toContain('>= 3 items that fit');
    expect(bad({ items: good.items.map((i, k) => (k === 0 ? { ...i, label: 'x'.repeat(23) } : i)) }).join()).toContain('1-22');
    expect(bad({ items: good.items.map((i, k) => (k === 1 ? { ...i, label: good.items[0].label } : i)) }).join()).toContain('must all differ');
    // no classify at all: still a valid pack
    expect(validateDomainPack({ ...pack, questions: pack.questions.filter((q) => q.type !== 'classify') })).toEqual([]);
  });

  it('the pool only offers the room to packs with at least 4 classify questions', () => {
    const pack = questionSource.getPack('math');
    const few: DomainPack = { ...pack, questions: pack.questions.filter((q) => q.type !== 'classify' || q.id.endsWith('001')) };
    const kinds = (p: DomainPack) => eligibleEntries('room', 'normal', p).map((e) => e.kind);
    expect(kinds(pack)).toContain('ruleMinefield');
    expect(kinds(few)).not.toContain('ruleMinefield');
    expect(POOL.find((e) => e.kind === 'ruleMinefield')!.classic).toBe(false);
  });
});

describe('Rule Minefield geometry', () => {
  it('has 4 rows of 3 tiles with 1 or 2 safe, solid walkways between rows, and is deterministic', () => {
    for (const d of DIFFS) {
      let seen = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        for (const rl of c.rooms.filter((r) => r.kind === 'ruleMinefield')) {
          seen++;
          const mine = rl.mine!;
          expect(rl.stepRows).toHaveLength(4);
          expect(mine.walks).toHaveLength(5);
          mine.safe.forEach((row) => {
            expect(row).toHaveLength(3);
            const n = row.filter(Boolean).length;
            expect(n === 1 || n === 2).toBe(true);
            if (d === 'easy') expect(n).toBe(2);
          });
          const flat = (a: typeof c) => JSON.stringify(a.rooms.filter((r) => r.kind === 'ruleMinefield').map((r) => r.mine));
          expect(flat(c)).toBe(flat(buildCourse({ domainId: 'math', difficulty: d, seed })));
          // every walkway is solid floor, in order down the room, and the tile rows lie between them
          mine.walks.forEach((w, k) => {
            expect(c.floors.some((f) => f.isStatic && f.minZ <= w.cz && f.maxZ >= w.cz && f.minX <= rl.laneX && f.maxX >= rl.laneX), `walk ${k}`).toBe(true);
            if (k > 0) expect(w.cz).toBeLessThan(mine.walks[k - 1].cz);
          });
          rl.stepRows.forEach((row, k) => {
            expect(row.z0).toBeCloseTo(mine.walks[k].minZ, 6);
            expect(row.z1).toBeCloseTo(mine.walks[k + 1].maxZ, 6);
            for (const id of row.slotFloorIds) expect(c.floors[id].isStatic).toBe(false);
          });
        }
      }
      expect(seen, d).toBeGreaterThan(0);
    }
  });

  it('dealing: safe tiles get fitting items, the rest do not, and no label repeats within a row', () => {
    const pack = questionSource.getPack('math');
    const qs = pack.questions.filter((q): q is ClassifyQuestion => q.type === 'classify');
    const safe = [[true, false, false], [false, true, true], [true, false, true], [false, false, true]];
    for (const q of qs) {
      const rng = mulberry32(7);
      const dealt = dealItems(q, safe, rng);
      dealt.forEach((row, r) => {
        row.forEach((t, c) => {
          expect(t.safe).toBe(safe[r][c]);
          expect(q.items.find((i) => i.label === t.label)!.fits).toBe(t.safe);
        });
        expect(new Set(row.map((t) => t.label)).size).toBe(3);
      });
    }
  });
});

describe('Rule Minefield in the pool and the demo', () => {
  it('appears often in Normal and Hard runs and is in the pinned demo course', () => {
    // the pool now holds several non-classic rooms, so no single one is in every run
    for (const d of ['normal', 'hard'] as const) {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        if (buildCourse({ domainId: 'science', difficulty: d, seed }).rooms.some((r) => r.kind === 'ruleMinefield')) n++;
      }
      expect(n, d).toBeGreaterThanOrEqual(15);
    }
    const demo = buildCourse({ domainId: 'math', difficulty: 'normal', seed: 4242 }, { demo: true });
    expect(demo.rooms.some((r) => r.kind === 'ruleMinefield')).toBe(true);
  });
});

describe('Rule Minefield play', () => {
  it('activates with 12 labelled tiles that match the rule; the entrance gate closes', () => {
    for (const d of DIFFS) {
      const run = bootWithMine(d);
      const r = room(run, 'ruleMinefield');
      enterRoom(run, r);
      expect(r.state).toBe('active');
      expect(r.question!.type).toBe('classify');
      expect(run.world.walls[r.layout.gateWallId!].enabled).toBe(true);
      const q = r.question as ClassifyQuestion;
      const tiles = r.stepRows.flat();
      expect(tiles).toHaveLength(12);
      for (const t of tiles) {
        expect(t.visible && t.revealed).toBe(true);
        expect(t.label.length).toBeLessThanOrEqual(22);
        expect(q.items.find((i) => i.label === t.label)!.fits).toBe(t.correct);
        expect(run.world.floors[t.floorId].enabled).toBe(true);
      }
    }
  });

  it('crossing only fitting tiles resolves the room as correct, with no surge', () => {
    for (const d of DIFFS) {
      const run = bootWithMine(d);
      const r = room(run, 'ruleMinefield');
      enterRoom(run, r);
      const s0 = run.slime;
      const mine = r.layout.mine!;
      for (let k = 0; k < 4; k++) {
        const t = r.stepRows[k].find((x) => x.correct)!;
        expect(walkTo(t.cx, mine.walks[k].cz, 10, 0.3)).toBe(true);
        expect(walkTo(t.cx, mine.walks[k + 1].cz, 10, 0.3)).toBe(true);
        advance(0.1);
      }
      expect(r.state, d).toBe('resolved');
      expect(r.result).toBe('correct');
      expect(r.wrongCount).toBe(0);
      expect(run.slime).toBeLessThanOrEqual(s0 + 0.001);
      expect(run.records).toHaveLength(1);
      expect(run.records[0].correctFirstTry).toBe(true);
      expect(run.records[0].type).toBe('classify');
    }
  });

  /** Step on the first wrong tile of row `k`, starting from the walkway before it. Returns the tile. */
  function stepWrong(r: ReturnType<typeof room>, k: number) {
    const t = r.stepRows[k].find((x) => !x.correct && x.state === 'solid')!;
    walkTo(t.cx, r.layout.mine!.walks[k].cz, 10, 0.3);
    walkTo(t.cx, t.cz, 5, 0.3);
    return t;
  }

  it('a wrong tile shakes, drops and comes back as a red X; Normal lands at the start of the previous row', () => {
    const run = bootWithMine('normal');
    const r = room(run, 'ruleMinefield');
    enterRoom(run, r);
    const mine = r.layout.mine!;
    // cross rows 0 and 1 properly, then step wrong in row 2
    for (let k = 0; k < 2; k++) {
      const t = r.stepRows[k].find((x) => x.correct)!;
      walkTo(t.cx, mine.walks[k].cz, 10, 0.3);
      walkTo(t.cx, mine.walks[k + 1].cz, 10, 0.3);
    }
    expect(r.currentRow).toBe(2);
    const s0 = run.slime;
    const bad = stepWrong(r, 2);
    advance(0.05);
    expect(bad.state).toBe('shaking');
    expect(run.slime).toBeGreaterThan(s0 + T.SLIME_SURGE.normal * 0.9);
    advance(T.MINE_SHAKE_TIME + 0.3);
    // the floor is gone and the player was sent back to walkway 1 (start of the previous row)
    expect(run.world.floors[bad.floorId].enabled).toBe(false);
    advance(1.5);
    expect(G.player.pos.z).toBeCloseTo(mine.walks[1].cz, 0);
    expect(r.currentRow).toBe(1);
    advance(T.TILE_FALL_TIME + 0.5);
    expect(bad.state).toBe('gone');
    expect(bad.marked).toBe(true);
    expect(r.state).toBe('active');
    // finish: re-cross row 1 (a locked tile), then row 2 and 3 on safe tiles
    for (let k = 1; k < 4; k++) {
      const t = r.stepRows[k].find((x) => x.correct)!;
      walkTo(t.cx, mine.walks[k].cz, 10, 0.3);
      walkTo(t.cx, mine.walks[k + 1].cz, 10, 0.3);
    }
    advance(0.2);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('remediated');
    expect(run.records).toHaveLength(1);
    expect(run.records[0].correctFirstTry).toBe(false);
  });

  it('Hard sends you back to the start of the room; Easy to the start of the row you were in', () => {
    for (const [d, back] of [['hard', 0], ['easy', 2]] as const) {
      const run = bootWithMine(d);
      const r = room(run, 'ruleMinefield');
      enterRoom(run, r);
      const mine = r.layout.mine!;
      // get to walkway 2
      for (let k = 0; k < 2; k++) {
        const t = r.stepRows[k].find((x) => x.correct)!;
        walkTo(t.cx, mine.walks[k].cz, 10, 0.3);
        walkTo(t.cx, mine.walks[k + 1].cz, 10, 0.3);
      }
      const hasWrong = r.stepRows[2].some((x) => !x.correct);
      expect(hasWrong).toBe(true);
      stepWrong(r, 2);
      advance(T.MINE_SHAKE_TIME + 1.5);
      expect(r.currentRow, d).toBe(back);
      expect(G.player.pos.z).toBeCloseTo(mine.walks[back].cz, 0);
    }
  });

  it('only the first wrong tile is a full surge; later ones cost half, and every wrong tile keeps counting', () => {
    const run = bootWithMine('easy');
    const r = room(run, 'ruleMinefield');
    enterRoom(run, r);
    const mine = r.layout.mine!;
    let s = run.slime;
    stepWrong(r, 0);
    advance(0.05);
    expect(run.slime - s).toBeCloseTo(T.SLIME_SURGE.easy, 2);
    advance(T.MINE_SHAKE_TIME + 1.5);
    s = run.slime;
    expect(G.player.pos.z).toBeCloseTo(mine.walks[0].cz, 0);
    // cross row 0 on a safe tile, then step wrong in row 1
    const safe = r.stepRows[0].find((x) => x.correct)!;
    walkTo(safe.cx, mine.walks[0].cz, 10, 0.3);
    walkTo(safe.cx, mine.walks[1].cz, 10, 0.3);
    s = run.slime;
    stepWrong(r, 1);
    advance(0.05);
    expect(run.slime - s).toBeCloseTo(T.SLIME_SURGE.easy * 0.5, 2);
    expect(r.wrongCount).toBe(2);
    expect(run.records[0].wrongCount).toBe(2);
  });

  it('a jump into a hole (no wrong tile pending) costs no surge and returns to the last walkway', () => {
    const run = bootWithMine('normal');
    const r = room(run, 'ruleMinefield');
    enterRoom(run, r);
    const s0 = run.slime;
    const t = r.stepRows[0].find((x) => x.correct)!;
    walkTo(t.cx, r.layout.mine!.walks[0].cz, 10, 0.3);
    // sink a (wrong) tile by 50/50 style removal, then walk into the hole
    const hole = r.stepRows[0].find((x) => !x.correct)!;
    run.world.floors[hole.floorId].enabled = false;
    hole.state = 'gone'; hole.marked = true;
    walkTo(hole.cx, r.layout.mine!.walks[0].cz, 10, 0.3);
    walkTo(hole.cx, hole.cz, 5, 0.3);
    advance(3);
    expect(G.player.pos.z).toBeCloseTo(r.layout.mine!.walks[0].cz, 0);
    expect(run.slime).toBeLessThanOrEqual(s0 + 0.01);
    expect(r.wrongCount).toBe(0);
  });

  it('50/50 crosses out one wrong tile in each row that has two', () => {
    const run = bootWithMine('normal');
    const r = room(run, 'ruleMinefield');
    enterRoom(run, r);
    run.coins = 5;
    const twoWrong = r.stepRows.filter((row) => row.filter((t) => !t.correct).length >= 2).length;
    useLifelineSafe('fifty');
    const sunk = r.stepRows.flat().filter((t) => t.marked);
    expect(sunk).toHaveLength(twoWrong);
    for (const t of sunk) { expect(t.correct).toBe(false); expect(run.world.floors[t.floorId].enabled).toBe(false); }
    expect(r.fiftyUsed).toBe(twoWrong > 0);
    steer(0, 0);
  });
});

describe('Rule Minefield with the bot', () => {
  it('imperfect players who step on wrong tiles still finish the room (all difficulties)', () => {
    for (const d of DIFFS) {
      for (let i = 0; i < 4; i++) {
        const res = playThrough(d, 80 + i, { guess: true, rng: mulberry32(i + 11), keepAlive: true, route: 'short', junctionRight: true });
        expect(['won', 'lost'], `${d} ${80 + i}`).toContain(res.run.phase);
      }
    }
  });
});
