import { describe, expect, it } from 'vitest';
import { questionSource } from '../content/source';
import { validateDomainPack, validatePacks } from '../content/validate';
import type { DomainPack } from '../content/schema';

describe('content', () => {
  const packs = questionSource.allPacks();
  it('has four packs and at least 128 questions', () => {
    expect(packs).toHaveLength(4);
    expect(packs.reduce((n, p) => n + p.questions.length, 0)).toBeGreaterThanOrEqual(128);
  });
  it('validateDomainPack returns no errors for all packs', () => {
    expect(validatePacks(packs)).toEqual([]);
  });
  it('ids are unique across packs', () => {
    const ids = packs.flatMap((p) => p.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('detects problems (validator sanity)', () => {
    const bad = structuredClone(packs[0]) as DomainPack;
    bad.questions[0] = { ...bad.questions[0], tier: 5 as never };
    bad.questions.push({ ...bad.questions[1] }); // duplicate id
    const errs = validateDomainPack(bad);
    expect(errs.some((e) => e.includes('tier'))).toBe(true);
    expect(errs.some((e) => e.includes('duplicate'))).toBe(true);
  });
  it('every concept has a tier-1 mcq or truefalse for detour retries', () => {
    for (const p of packs) for (const c of p.concepts) {
      expect(p.questions.some((q) => q.concept === c.id && q.tier === 1 && (q.type === 'mcq' || q.type === 'truefalse'))).toBe(true);
    }
  });
});
