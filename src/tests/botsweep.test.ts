import { afterEach, describe, expect, it } from 'vitest';
import { finish } from './helpers';
import { playThrough } from './bot';

declare const process: { env: Record<string, string | undefined> };

afterEach(() => finish());

/**
 * Seed sweep: the bot must walk every pool course through the hazards without being knocked off the path
 * too often. Seed 1518 / normal once failed at the maze → Rule Minefield exit: the bot stood in a doorway the
 * sweeper reaches into and never found a clean moment to start. BOT_SWEEP=100 runs the wide version
 * (both lanes, 100 seeds per difficulty); the default is a quick one.
 */
const wide = Number(process.env.BOT_SWEEP ?? 0);
const n = wide || 12;

describe('bot qualifies over a seed sweep', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: ${n} seeds${d === 'normal' ? ' plus the regression seed' : ''}`, () => {
      const seeds = Array.from({ length: n }, (_, i) => 1000 + 37 * i);
      if (d === 'normal') seeds.push(1518);
      for (const seed of seeds) {
        for (const route of wide ? (['short', 'long'] as const) : (['short'] as const)) {
          const r = playThrough(d, seed, { route, junctionRight: route === 'short' });
          expect(r.eliminated, `${d} ${route} seed ${seed}`).toBe(false);
        }
      }
    }, 300_000);
  }
});
