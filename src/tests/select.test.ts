import { describe, expect, it } from 'vitest';
import { questionSource } from '../content/source';
import { selectQuestion, selectRetryQuestion, type SelectRequest } from '../content/select';
import { mulberry32 } from '../game/rng';

const pack = questionSource.getPack('math');
function req(extra: Partial<SelectRequest> = {}): SelectRequest {
  return { pack, type: 'mcq', tier: 2, usedIds: new Set(), recentConcepts: [], wrongConceptsThisRun: new Set(), rng: mulberry32(1), ...extra };
}

describe('selectQuestion', () => {
  it('returns the requested type', () => {
    for (const type of ['mcq', 'truefalse', 'steps', 'order'] as const) expect(selectQuestion(req({ type })).type).toBe(type);
  });
  it('does not repeat while alternatives exist', () => {
    const used = new Set<string>();
    const total = pack.questions.filter((q) => q.type === 'mcq').length;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) ids.push(selectQuestion(req({ usedIds: used, rng: mulberry32(i) })).id);
    expect(new Set(ids).size).toBe(total);
  });
  it('prefers focus concepts', () => {
    for (let s = 0; s < 20; s++) {
      const q = selectQuestion(req({ focusConcepts: ['geometry'], rng: mulberry32(s) }));
      expect(q.concept).toBe('geometry');
    }
  });
  it('respects conceptFilter', () => {
    const q = selectQuestion(req({ conceptFilter: 'fractions', type: ['mcq', 'truefalse'] }));
    expect(q.concept).toBe('fractions');
  });
  it('falls back to used questions when all are used', () => {
    const used = new Set(pack.questions.filter((q) => q.type === 'order').map((q) => q.id));
    const q = selectQuestion(req({ type: 'order', usedIds: used }));
    expect(q.type).toBe('order');
  });
  it('prefers the requested tier', () => {
    const q1 = selectQuestion(req({ tier: 1, rng: mulberry32(3) }));
    const q3 = selectQuestion(req({ tier: 3, rng: mulberry32(3) }));
    expect(q1.tier).toBe(1);
    expect(q3.tier).toBe(3);
  });
  it('adds the chosen id to usedIds', () => {
    const r = req();
    const q = selectQuestion(r);
    expect(r.usedIds.has(q.id)).toBe(true);
  });
});

describe('selectRetryQuestion', () => {
  it('returns a tier-1 mcq/truefalse of the same concept when available', () => {
    const original = pack.questions.find((q) => q.type === 'mcq' && q.concept === 'geometry' && q.tier === 3)!;
    const r = selectRetryQuestion(pack, original, new Set([original.id]), mulberry32(2))!;
    expect(r.concept).toBe('geometry');
    expect(['mcq', 'truefalse']).toContain(r.type);
    expect(r.tier).toBe(1);
    expect(r.id).not.toBe(original.id);
  });
  it('falls back to the original when it is mcq and nothing else is left', () => {
    const original = pack.questions.find((q) => q.type === 'mcq')!;
    const used = new Set(pack.questions.map((q) => q.id));
    expect(selectRetryQuestion(pack, original, used, mulberry32(2))).toBe(original);
  });
  it('returns null for a steps original with nothing left', () => {
    const original = pack.questions.find((q) => q.type === 'steps')!;
    const used = new Set(pack.questions.map((q) => q.id));
    expect(selectRetryQuestion(pack, original, used, mulberry32(2))).toBeNull();
  });
});
