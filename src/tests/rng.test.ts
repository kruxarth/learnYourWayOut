import { describe, expect, it } from 'vitest';
import { hashString, mulberry32, shuffle, stream } from '../game/rng';

describe('rng', () => {
  it('same seed gives the same sequence', () => {
    const a = mulberry32(123), b = mulberry32(123);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });
  it('different seeds give different sequences', () => {
    const a = mulberry32(1), b = mulberry32(2);
    const sa = Array.from({ length: 10 }, a), sb = Array.from({ length: 10 }, b);
    expect(sa).not.toEqual(sb);
  });
  it('values are in [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('hashString is stable and distinguishes inputs', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
  it('named streams are independent', () => {
    expect(stream(5, 'layout')()).not.toBe(stream(5, 'questions')());
  });
  it('shuffle is a permutation and does not mutate', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(src, mulberry32(7));
    expect(out.slice().sort()).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
