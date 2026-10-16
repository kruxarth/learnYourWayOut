import { afterEach, describe, it } from 'vitest';
import { finish } from './helpers';
import { playThrough } from './bot';
import type { Difficulty } from '../game/types';

declare const process: { env: Record<string, string | undefined> };

afterEach(() => finish());

/**
 * Par-time calibration (F4-0): prints the perfect bot's mean time per segment kind and a
 * `T.PAR_S` line at 1.8x. Skipped unless CALIBRATE=1:
 *   CALIBRATE=1 CAL_N=40 npx vitest run src/tests/calibrate.test.ts --silent=false
 */
const run = process.env.CALIBRATE ? describe : describe.skip;
const N = Number(process.env.CAL_N ?? 30);

run('par calibration', () => {
  it('measures the bot per segment kind', () => {
    const table: Record<string, Partial<Record<Difficulty, number>>> = {};
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const sums = new Map<string, { t: number; n: number }>();
      for (let i = 0; i < N; i++) {
        const route = i % 2 ? 'long' : 'short';
        const res = playThrough(d, 2000 + 53 * i, { route, junctionRight: route === 'short', keepAlive: true });
        res.run.course.segments.forEach((s, idx) => {
          if (res.segTimes[idx] === 0 && !(s.lane === 'main' || s.lane === route)) return;
          const e = sums.get(s.kind) ?? { t: 0, n: 0 };
          e.t += res.segTimes[idx]; e.n++;
          sums.set(s.kind, e);
        });
      }
      // the Hex Finale is not in the default course: a few runs with it as the last room
      for (let i = 0; i < Math.max(6, N / 4); i++) {
        const res = playThrough(d, 3000 + 53 * i, { finale: 'hex', route: 'short', junctionRight: true, keepAlive: true });
        res.run.course.segments.forEach((s, idx) => {
          if (s.kind !== 'hexFinale') return;
          const e = sums.get(s.kind) ?? { t: 0, n: 0 };
          e.t += res.segTimes[idx]; e.n++;
          sums.set(s.kind, e);
        });
      }
      for (const [kind, e] of sums) (table[kind] ??= {})[d] = e.t / e.n;
    }
    const lines = Object.entries(table).map(([k, v]) => {
      const f = (d: Difficulty) => Math.max(1, Math.ceil(1.8 * (v[d] ?? v.normal ?? 8)));
      return `    ${k}: { easy: ${f('easy')}, normal: ${f('normal')}, hard: ${f('hard')} },   // bot ${(['easy', 'normal', 'hard'] as const).map((d) => (v[d] ?? NaN).toFixed(1)).join(' / ')} s`;
    });
    console.log(`\nPAR_S: {\n${lines.join('\n')}\n}\n`);
  }, 600_000);
});
