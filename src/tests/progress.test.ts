import { describe, expect, it } from 'vitest';
import {
  AVATAR_CATALOG, EMPTY_PROGRESS, achievementsAfterRun, applyRun, isUnlocked, unlockText, unlocksAfterRun,
} from '../game/avatar';
import { fakeResult } from './helpers';

describe('achievements and unlocks', () => {
  const none = EMPTY_PROGRESS;

  it('qualifying in History grants qualify_history and unlocks the laurel', () => {
    const r = fakeResult({ domainId: 'history' });
    expect(achievementsAfterRun(none, r)).toEqual(['qualify_history']);
    const after = applyRun(none, r);
    expect(unlocksAfterRun(none, after).map((c) => c.id)).toEqual(['laurel']);
  });

  it('each domain maps to its own achievement', () => {
    const ids = ['math', 'science', 'history', 'programming'].map((d) => achievementsAfterRun(none, fakeResult({ domainId: d }))[0]);
    expect(ids).toEqual(['qualify_math', 'qualify_science', 'qualify_history', 'qualify_programming']);
  });

  it('an Any Topic run (domain "custom") grants the wizard hat achievement', () => {
    const r = fakeResult({ domainId: 'custom' });
    expect(achievementsAfterRun(none, r)).toEqual(['qualify_custom']);
    expect(unlocksAfterRun(none, applyRun(none, r)).map((c) => c.id)).toEqual(['wizard']);
  });

  it('an eliminated run grants no qualify achievements, but its correct answers still count', () => {
    const r = fakeResult({ domainId: 'math', outcome: 'eliminated', stars: 0, correct: 4, difficulty: 'hard' });
    expect(achievementsAfterRun(none, r)).toEqual([]);
    expect(applyRun(none, r)).toMatchObject({ stars: 0, correctTotal: 4 });
  });

  it('3 stars on Hard grants the crown; 3 stars elsewhere does not', () => {
    expect(achievementsAfterRun(none, fakeResult({ difficulty: 'hard', stars: 3 }))).toContain('hard_3star');
    expect(achievementsAfterRun(none, fakeResult({ difficulty: 'hard', stars: 2 }))).not.toContain('hard_3star');
    expect(achievementsAfterRun(none, fakeResult({ difficulty: 'normal', stars: 3 }))).not.toContain('hard_3star');
  });

  it('50 correct answers in total grant glasses; weak-spot runs count toward the book bag', () => {
    const p = { ...none, correctTotal: 45 };
    expect(achievementsAfterRun(p, fakeResult({ correct: 4 }))).not.toContain('correct_50');
    expect(achievementsAfterRun(p, fakeResult({ correct: 5 }))).toContain('correct_50');
    const r = fakeResult({ focus: ['c'] });
    const two = applyRun(applyRun(none, r), r);
    const three = applyRun(two, r);
    expect(three.weakRuns).toBe(3);
    expect(three.achievements).toContain('weak_3');
    expect(unlocksAfterRun(two, three).map((c) => c.id)).toContain('bookbag');
  });

  it('achievements are only reported once', () => {
    const p = applyRun(none, fakeResult({ domainId: 'science' }));
    expect(achievementsAfterRun(p, fakeResult({ domainId: 'science' }))).toEqual([]);
  });

  it('star thresholds unlock items', () => {
    const at = (n: number) => AVATAR_CATALOG.filter((c) => isUnlocked(c, { ...none, stars: n }) && c.unlock.kind === 'stars').map((c) => c.id).sort();
    expect(at(2)).toEqual([]);
    expect(at(3)).toEqual(['propeller']);
    expect(at(25)).toEqual(['chef', 'propeller', 'wide', 'wink']);
    expect(at(60)).toContain('cape');
    expect(unlockText({ kind: 'achievement', id: 'qualify_history' })).toBe('Qualify in History');
  });
});
