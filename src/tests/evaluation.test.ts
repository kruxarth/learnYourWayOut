import { describe, expect, it } from 'vitest';
import { questionSource } from '../content/source';
import type { McqQuestion, TfQuestion } from '../content/schema';
import {
  accuracy, answerText, computeMastery, computeStars, evaluateMcq, evaluateTf, nextTier, weakConcepts,
} from '../game/loop/evaluation';
import type { AnswerRecord } from '../game/types';

const rec = (concept: string, ok: boolean, isRetry = false): AnswerRecord => ({
  questionId: 'x', concept, type: 'mcq', roomKind: 'doorRush', tierAsked: 2, correctFirstTry: ok, wrongCount: ok ? 0 : 1,
  usedHint: false, usedFifty: false, remediated: false, isRetry, timeMs: 1000,
});

describe('evaluation', () => {
  const pack = questionSource.getPack('math');
  it('evaluateMcq', () => {
    const q = pack.questions.find((x) => x.type === 'mcq') as McqQuestion;
    expect(evaluateMcq(q, q.answer)).toBe(true);
    expect(evaluateMcq(q, q.distractors[0])).toBe(false);
  });
  it('evaluateTf', () => {
    const q = { type: 'truefalse', answer: true } as TfQuestion;
    expect(evaluateTf(q, 'TRUE')).toBe(true);
    expect(evaluateTf(q, 'FALSE')).toBe(false);
    expect(evaluateTf({ ...q, answer: false }, 'FALSE')).toBe(true);
  });
  it('staircase: up after 2 first-try correct, down after a wrong one', () => {
    let s = { tier: 2 as 1 | 2 | 3, streak: 0 };
    s = nextTier(s.tier, s.streak, true);
    expect(s).toEqual({ tier: 2, streak: 1 });
    s = nextTier(s.tier, s.streak, true);
    expect(s).toEqual({ tier: 3, streak: 0 });
    s = nextTier(s.tier, s.streak, true); s = nextTier(s.tier, s.streak, true);
    expect(s.tier).toBe(3); // capped
    s = nextTier(s.tier, s.streak, false);
    expect(s).toEqual({ tier: 2, streak: 0 });
    s = nextTier(1, 1, false);
    expect(s.tier).toBe(1); // floored
  });
  it('mastery and weak spots ignore retries and sort lowest first', () => {
    const records = [rec('fractions', true), rec('fractions', false), rec('geometry', true), rec('geometry', true), rec('geometry', false, true)];
    const m = computeMastery(records, pack);
    expect(m.map((e) => e.conceptId)).toEqual(['fractions', 'geometry']);
    expect(m[0]).toMatchObject({ asked: 2, correct: 1 });
    expect(m[1]).toMatchObject({ asked: 2, correct: 2 });
    expect(weakConcepts(m)).toEqual(['fractions']);
  });
  it('accuracy counts only main questions', () => {
    expect(accuracy([rec('a', true), rec('a', false), rec('a', false, true)])).toEqual({ asked: 2, correct: 1 });
  });
  it('stars are independent', () => {
    const good = [rec('a', true), rec('a', true), rec('a', true)];
    const bad = [rec('a', false), rec('a', false)];
    expect(computeStars(true, good, 100_000, 120_000)).toBe(3);
    expect(computeStars(true, good, 130_000, 120_000)).toBe(2); // over par
    expect(computeStars(true, bad, 130_000, 120_000)).toBe(1);
    expect(computeStars(true, bad, 90_000, 120_000)).toBe(2);
    expect(computeStars(false, good, 10_000, 120_000)).toBe(1); // eliminated but accurate
    expect(computeStars(false, bad, 10_000, 120_000)).toBe(0);
  });
  it('answerText joins steps and order with arrows', () => {
    const steps = pack.questions.find((q) => q.type === 'steps')!;
    expect(answerText(steps)).toContain(' → ');
    const order = pack.questions.find((q) => q.type === 'order')!;
    expect(answerText(order).split(' → ')).toHaveLength(4);
  });
});
