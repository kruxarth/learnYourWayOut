import { afterEach, describe, expect, it } from 'vitest';
import { finish } from './helpers';
import { playThrough, type BotOpts, type BotResult } from './bot';
import { mulberry32 } from '../game/rng';
import type { Difficulty } from '../game/types';

declare const process: { env: Record<string, string | undefined> };

afterEach(() => finish());

/**
 * Balance harness (plan M1): plays whole runs with no slime clamp and prints a table.
 * Bounds are loose on purpose; the table is the tuning tool. BALANCE_N=40 for a bigger sample.
 */

const N = Number(process.env.BALANCE_N ?? 8);
/** Perfect-bot runs per lane. The bot must qualify on every seed. */
const NP = Math.max(10, N / 2);
const DIFFS: Difficulty[] = process.env.BALANCE_DIFF ? [process.env.BALANCE_DIFF as Difficulty] : ['easy', 'normal', 'hard'];

interface Row { label: string; n: number; elim: number; slime: number; time: number }

function sample(d: Difficulty, label: string, opts: (i: number) => BotOpts, n: number): Row {
  const res: BotResult[] = [];
  for (let i = 0; i < n; i++) res.push(playThrough(d, 1000 + 37 * i, opts(i)));
  const done = res.filter((r) => !r.eliminated);
  return {
    label: `${d.padEnd(6)} ${label}`, n,
    elim: res.filter((r) => r.eliminated).length / n,
    slime: done.length ? done.reduce((s, r) => s + r.slime, 0) / done.length : NaN,
    time: done.length ? done.reduce((s, r) => s + r.timeS, 0) / done.length : NaN,
  };
}

function print(rows: Row[]): void {
  const lines = rows.map((r) => `${r.label.padEnd(28)} n=${String(r.n).padStart(3)}  P(elim)=${(r.elim * 100).toFixed(0).padStart(3)}%  `
    + `slime@end=${Number.isNaN(r.slime) ? '  -  ' : r.slime.toFixed(3)}  time=${Number.isNaN(r.time) ? '  -' : r.time.toFixed(0)} s`);
  console.log(`\n${lines.join('\n')}\n`);
}

const results = new Map<string, Row>();

describe('balance harness', () => {
  for (const d of DIFFS) {
    it(`${d}: perfect bot, 60%-accuracy player and pure guesser`, () => {
      const rows: Row[] = [
        sample(d, 'perfect short', () => ({ route: 'short', junctionRight: true }), NP),
        sample(d, 'perfect long', () => ({ route: 'long', junctionRight: false }), NP),
        sample(d, '60% (think 3 s)', (i) => ({ accuracy: 0.6, thinkSec: 3, rng: mulberry32(i + 1), route: i % 2 ? 'long' : 'short' }), N),
        sample(d, 'guesser (think 1 s)', (i) => ({ guess: true, thinkSec: 1, rng: mulberry32(i + 101), route: i % 2 ? 'long' : 'short' }), N),
      ];
      // the optional Hex Finale as the last room (F4-X): printed for the record, loosely checked below
      const hex = [
        sample(d, 'HEX perfect short', () => ({ route: 'short', junctionRight: true, finale: 'hex' }), NP),
        sample(d, 'HEX 60% (think 3 s)', (i) => ({ accuracy: 0.6, thinkSec: 3, rng: mulberry32(i + 1), route: i % 2 ? 'long' : 'short', finale: 'hex' }), N),
        sample(d, 'HEX guesser (think 1 s)', (i) => ({ guess: true, thinkSec: 1, rng: mulberry32(i + 101), route: i % 2 ? 'long' : 'short', finale: 'hex' }), N),
      ];
      print([...rows, ...hex]);
      for (const r of [...rows, ...hex]) results.set(r.label, r);
      expect(hex[0].elim, 'the perfect bot qualifies with the Hex Finale').toBe(0);
      const [short, , p60, guess] = rows;
      expect(short.elim).toBe(0);
      // loose versions of the plan's targets (tune with BALANCE_N=40)
      if (d === 'easy') {
        expect(short.slime).toBeLessThanOrEqual(0.12);
        expect(p60.elim).toBeLessThanOrEqual(0.25);
      } else if (d === 'normal') {
        expect(short.slime).toBeGreaterThanOrEqual(0.06);
        expect(short.slime).toBeLessThanOrEqual(0.3);
        expect(guess.elim).toBeGreaterThanOrEqual(0.4);
      } else {
        expect(short.slime).toBeGreaterThanOrEqual(0.25);
        expect(short.slime).toBeLessThanOrEqual(0.55);
        expect(guess.elim).toBeGreaterThanOrEqual(0.6);
      }
    }, 300_000);
  }
});

/**
 * Gold Door (F4-G): a paired comparison on the same seeds. A perfect player who takes the star door should
 * end with less slime; a guesser who takes it should do worse (double surge on most tries).
 * Score = slime at the end, 1.0 for an eliminated run.
 */
describe('gold door pays off for strong players and hurts guessers', () => {
  const pairs = Math.max(10, N);
  function paired(d: Difficulty, label: string, opts: (i: number, gold: 'take' | 'skip') => BotOpts) {
    let a = 0, b = 0, ea = 0, eb = 0, ta = 0, tb = 0;
    for (let i = 0; i < pairs; i++) {
      const seed = 5000 + 37 * i;
      const skip = playThrough(d, seed, opts(i, 'skip')), take = playThrough(d, seed, opts(i, 'take'));
      a += skip.eliminated ? 1 : skip.slime; b += take.eliminated ? 1 : take.slime;
      ea += skip.eliminated ? 1 : 0; eb += take.eliminated ? 1 : 0;
      ta += skip.timeS; tb += take.timeS;
    }
    console.log(`gold ${d.padEnd(6)} ${label.padEnd(10)} n=${pairs}  score skip=${(a / pairs).toFixed(3)} take=${(b / pairs).toFixed(3)}  `
      + `P(elim) skip=${((ea / pairs) * 100).toFixed(0)}% take=${((eb / pairs) * 100).toFixed(0)}%  time skip=${(ta / pairs).toFixed(0)} s take=${(tb / pairs).toFixed(0)} s`);
    return { skip: a / pairs, take: b / pairs };
  }
  for (const d of DIFFS) {
    it(`${d}: perfect player gains, guesser loses`, () => {
      const perfect = paired(d, 'perfect', (_i, gold) => ({ route: 'short', junctionRight: true, gold }));
      const guesser = paired(d, 'guesser', (i, gold) => ({ guess: true, thinkSec: 1, rng: mulberry32(i + 301), route: i % 2 ? 'long' : 'short', gold }));
      expect(perfect.take).toBeLessThanOrEqual(perfect.skip + 0.01); // small samples: allow noise
      expect(guesser.take).toBeGreaterThanOrEqual(guesser.skip - 0.02);
    }, 600_000);
  }
});
