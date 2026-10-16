import { describe, expect, it } from 'vitest';
import { validateDomainPack } from '../src/content/validate';
import { generatePack, PackError } from './llm/pipeline';
import { cleanHandler, FakeLlm } from './testing/fakeLlm';

type Compact = { id: string; type: string };
const reviewed = (user: string): Compact[] => JSON.parse(user.split('\n')[1]) as Compact[];

describe('review pass', () => {
  it('sends the surviving questions in one call, with the review model, and drops flagged ones', async () => {
    let flaggedIds: string[] = [];
    const llm = new FakeLlm(cleanHandler({
      review: (req) => {
        const qs = reviewed(req.user);
        if (qs.length < 20) return { flags: [] }; // a small top-up batch
        // flag one truefalse per problem kind (tier does not matter: the pipeline has spare ones)
        const tfs = qs.filter((q) => q.type === 'truefalse').slice(0, 3);
        flaggedIds = tfs.map((q) => q.id);
        return { flags: [
          { id: tfs[0].id, problem: 'wrong_answer', note: 'key is wrong' },
          { id: tfs[1].id, problem: 'ambiguous', note: '' },
          { id: tfs[2].id, problem: 'two_correct', note: '' },
          { id: 'custom-nothing-999', problem: 'wrong_answer', note: 'unknown id is ignored' },
          { id: qs[0].id, problem: 'made_up_problem', note: 'unknown problems are ignored' },
          'garbage', null,
        ] };
      },
    }));
    const pack = await generatePack('Roman Empire', 'hard', llm, () => {}, { reviewModel: 'strict-model' });
    // call 1 holds the whole first batch; any later calls are small top-ups
    expect(reviewed(llm.of('review')[0].user).length).toBeGreaterThan(40);
    expect(llm.of('review').every((r) => r.model === 'strict-model' && r.temperature === 0)).toBe(true);
    expect(flaggedIds).toHaveLength(3);
    for (const id of flaggedIds) expect(pack.questions.some((q) => q.id === id)).toBe(false);
    expect(validateDomainPack(pack)).toEqual([]);
  });

  it('reviews only questions that passed validation', async () => {
    let first = true;
    const llm = new FakeLlm(cleanHandler({
      write: (req) => {
        const base = cleanHandler()(req, 'write') as { questions: Record<string, unknown>[] };
        if (first) { first = false; base.questions.push({ ...base.questions[0], answer: 'This answer is much too long' }); }
        return base;
      },
      fix: () => ({ questions: [] }), // cannot repair it
    }));
    await generatePack('Roman Empire', 'normal', llm);
    const ids = reviewed(llm.of('review')[0].user).map((q) => JSON.stringify(q));
    expect(ids.some((s) => s.includes('much too long'))).toBe(false);
  });

  it('flags that break the quota trigger a top-up, which is reviewed again', async () => {
    let round = 0;
    const llm = new FakeLlm(cleanHandler({
      review: (req) => {
        round++;
        if (round > 1) return { flags: [] };
        // first review: flag every tier-1 and tier-2 truefalse of the first concept => quota shortfall
        const first = reviewed(req.user).filter((q) => q.type === 'truefalse' && q.id.startsWith('custom-rise-'));
        return { flags: first.map((q) => ({ id: q.id, problem: 'wrong_answer', note: '' })) };
      },
    }));
    const pack = await generatePack('Roman Empire', 'normal', llm);
    expect(llm.count('review')).toBe(2);
    expect(llm.count('write')).toBeGreaterThan(4);
    expect(pack.questions.filter((q) => q.type === 'truefalse' && q.concept === 'rise').length).toBeGreaterThanOrEqual(2);
    expect(validateDomainPack(pack)).toEqual([]);
  });

  it('keeps flagging the same thing: after 2 top-ups the job fails cleanly', async () => {
    const llm = new FakeLlm(cleanHandler({
      review: (req) => ({
        flags: reviewed(req.user).filter((q) => q.type === 'mcq' && q.id.startsWith('custom-decline-')).map((q) => ({ id: q.id, problem: 'wrong_answer', note: '' })),
      }),
    }));
    const err = await generatePack('Roman Empire', 'normal', llm).catch((e) => e);
    expect(err).toBeInstanceOf(PackError);
    expect(err.code).toBe('failed');
    expect(err.message).toContain('Try a broader topic');
    expect(llm.count('review')).toBe(3);
  });

  it('a review call that keeps failing fails the job: unreviewed questions are never shipped', async () => {
    const llm = new FakeLlm(cleanHandler({ review: () => { throw new Error('boom'); } }));
    await expect(generatePack('Roman Empire', 'normal', llm)).rejects.toMatchObject({ code: 'failed' });
    expect(llm.count('review')).toBe(2); // one retry
  });

  it('a review that returns junk flags nothing but does not crash', async () => {
    const llm = new FakeLlm(cleanHandler({ review: () => ({ flags: 'none' }) }));
    const pack = await generatePack('Roman Empire', 'normal', llm);
    expect(validateDomainPack(pack)).toEqual([]);
  });

  it('questions with blocklisted words are dropped from the pack', async () => {
    let first = true;
    const llm = new FakeLlm(cleanHandler({
      write: (req) => {
        const base = cleanHandler()(req, 'write') as { questions: Record<string, unknown>[] };
        if (first) { first = false; base.questions[0] = { ...base.questions[0], prompt: 'Question about free porn videos?' }; }
        return base;
      },
    }));
    const pack = await generatePack('Roman Empire', 'normal', llm);
    expect(JSON.stringify(pack)).not.toContain('porn');
  });
});
