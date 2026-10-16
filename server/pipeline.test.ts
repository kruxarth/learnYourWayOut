import { describe, expect, it } from 'vitest';
import { validateDomainPack } from '../src/content/validate';
import { parseJsonLoose, LlmError } from './llm/client';
import { generatePack, normalizeTopic, PackError, packKey, parsePlan, type Stage } from './llm/pipeline';
import { cleanHandler, CONCEPTS, FakeLlm, parseWanted, questionsFor, rawQuestion, sectionOf } from './testing/fakeLlm';

const fixed = () => new Date('2026-10-15T12:00:00Z');

async function run(llm: FakeLlm, topic = 'Roman Empire', level: 'easy' | 'normal' | 'hard' = 'normal') {
  const stages: { stage: Stage; p: number }[] = [];
  const pack = await generatePack(topic, level, llm, (stage, p) => stages.push({ stage, p }), { model: 'fake', now: fixed });
  return { pack, stages };
}

describe('generatePack with a clean model', () => {
  it('produces a valid pack, reassigns ids and reports steady progress', async () => {
    const llm = new FakeLlm(cleanHandler({
      write: (req) => ({
        questions: questionsFor(parseWanted(req.user), sectionOf(req.user)).map((q) => ({ ...q, id: 'evil-id-999', concept: 'nope' })),
      }),
    }));
    const { pack, stages } = await run(llm);
    expect(validateDomainPack(pack)).toEqual([]);
    expect(pack.id).toBe('custom');
    expect(pack.concepts.map((c) => c.id)).toEqual(CONCEPTS.map((c) => c.id));
    expect(pack.concepts.every((c) => (c.facts?.length ?? 0) === 3)).toBe(true);
    for (const q of pack.questions) expect(q.id).toMatch(new RegExp(`^custom-${q.concept}-\\d{3}$`));
    expect(new Set(pack.questions.map((q) => q.id)).size).toBe(pack.questions.length);
    expect(pack.topic).toEqual({ query: 'Roman Empire', level: 'normal' });
    expect(pack.generated).toEqual({ model: 'fake', createdAt: '2026-10-15T12:00:00.000Z', packKey: 'normal:roman empire' });
    // 1 plan + 4 writes + 1 review, no fix and no top-up
    expect([llm.count('plan'), llm.count('write'), llm.count('fix'), llm.count('review')]).toEqual([1, 4, 0, 1]);
    const ps = stages.map((s) => s.p);
    expect([...ps].sort((a, b) => a - b)).toEqual(ps);
    expect(ps.at(-1)).toBe(1);
    expect(stages.at(-1)!.stage).toBe('done');
    expect(new Set(stages.map((s) => s.stage))).toContain('writing');
  });

  it('rejects topics that are too short or too long before any LLM call', async () => {
    const llm = new FakeLlm(cleanHandler());
    await expect(run(llm, '  a ')).rejects.toMatchObject({ code: 'too-short' });
    await expect(run(llm, 'x'.repeat(61))).rejects.toMatchObject({ code: 'too-long' });
    expect(llm.calls).toHaveLength(0);
  });
});

describe('fix and top-up', () => {
  it('sends invalid questions to exactly one fix call per concept, with the error strings; still-invalid ones are dropped', async () => {
    let first = true;
    const llm = new FakeLlm(cleanHandler({
      write: (req) => {
        const section = sectionOf(req.user);
        const qs = questionsFor(parseWanted(req.user), section);
        if (section === 'Daily life' && first) {
          first = false;
          // two broken mcqs: one label too long (fixable), one with 5 distractors (the fix call returns it unchanged)
          qs.push({ ...rawQuestion('mcq', 1, section), answer: 'This label is far too long to fit' });
          qs.push({ ...rawQuestion('mcq', 1, section), distractors: ['a', 'b', 'c', 'd', 'e'] });
        }
        return { questions: qs };
      },
      fix: (req) => {
        const items = JSON.parse(req.user.split('\n')[1]) as { question: Record<string, unknown>; errors: string[] }[];
        return { questions: items.map((i) => (i.errors.some((e) => e.includes('answer must be 1-22')) ? { ...i.question, answer: 'Short answer' } : i.question)) };
      },
    }));
    const { pack } = await run(llm);
    expect(llm.count('fix')).toBe(1);
    const fixReq = llm.of('fix')[0].user;
    expect(fixReq).toContain('answer must be 1-22 chars');
    expect(fixReq).toContain('mcq needs exactly 3 distractors');
    expect(pack.questions.some((q) => q.type === 'mcq' && q.answer === 'Short answer')).toBe(true);
    expect(pack.questions.some((q) => q.type === 'mcq' && (q.distractors as string[]).length !== 3)).toBe(false);
    expect(validateDomainPack(pack)).toEqual([]);
  });

  it('a quota shortfall triggers a top-up call for the missing pieces', async () => {
    let wrote = 0;
    const llm = new FakeLlm(cleanHandler({
      write: (req) => {
        wrote++;
        const wanted = parseWanted(req.user);
        // first call of the run: skip all tier-3 mcq for whichever concept it is
        const w = wrote <= 4 ? wanted.filter((x) => !(x.type === 'mcq' && x.tier === 3)) : wanted;
        return { questions: questionsFor(w, sectionOf(req.user)) };
      },
    }));
    const { pack } = await run(llm);
    expect(llm.count('write')).toBeGreaterThan(4);
    const topUp = llm.of('write').slice(4).map((r) => parseWanted(r.user));
    expect(topUp.flat().every((w) => w.type === 'mcq' && w.tier === 3)).toBe(true);
    expect(validateDomainPack(pack)).toEqual([]);
  });

  it('fails cleanly after two top-ups when the quota cannot be met', async () => {
    const llm = new FakeLlm(cleanHandler({
      write: (req) => ({ questions: questionsFor(parseWanted(req.user).filter((x) => x.type !== 'order'), sectionOf(req.user)) }),
    }));
    const err = await run(llm).catch((e) => e);
    expect(err).toBeInstanceOf(PackError);
    expect(err.code).toBe('failed');
    expect(err.message).toContain('Try a broader topic');
    expect(llm.count('write')).toBe(4 + 4 + 4); // 4 first writes, then two top-up rounds (the missing order questions span all 4 concepts)
  });
});

describe('classify questions (optional for the quota)', () => {
  it('asks for one classify per concept, and keeps good ones in the pack', async () => {
    const llm = new FakeLlm(cleanHandler());
    const { pack } = await run(llm);
    for (const r of llm.of('write').slice(0, 4)) expect(parseWanted(r.user).filter((w) => w.type === 'classify')).toHaveLength(1);
    expect(pack.questions.filter((q) => q.type === 'classify')).toHaveLength(4);
    expect(validateDomainPack(pack)).toEqual([]);
  });

  it('accepts a pack whose classify questions all fail validation (the Rule Minefield is just left out)', async () => {
    const llm = new FakeLlm(cleanHandler({
      // every classify has too few items; the fix call hands them back unchanged
      write: (req) => ({
        questions: questionsFor(parseWanted(req.user), sectionOf(req.user)).map((q) => (q.type === 'classify' ? { ...q, items: (q.items as unknown[]).slice(0, 4) } : q)),
      }),
      fix: (req) => ({ questions: (JSON.parse(req.user.split('\n')[1]) as { question: unknown }[]).map((i) => i.question) }),
    }));
    const { pack } = await run(llm);
    expect(llm.count('fix')).toBeGreaterThan(0);
    expect(pack.questions.some((q) => q.type === 'classify')).toBe(false);
    expect(validateDomainPack(pack)).toEqual([]);
    // no top-up round is spent on classify: the quota never asks for it
    expect(llm.count('write')).toBe(4);
  });
});

describe('robustness against odd model output', () => {
  it('survives wrong types, nulls and extra fields without crashing', async () => {
    const llm = new FakeLlm(cleanHandler({
      write: (req) => {
        const section = sectionOf(req.user);
        const qs: unknown[] = questionsFor(parseWanted(req.user), section);
        qs.push(null, 7, 'text', { type: 'essay' }, { type: 'mcq' }, { type: 'steps', steps: [null, 3, 'x', {}] });
        qs.push({ ...rawQuestion('mcq', 2, section), answer: 42, distractors: 'abc' });
        qs.push({ ...rawQuestion('truefalse', 1, section), answer: 'true' });
        return { questions: qs };
      },
    }));
    const { pack } = await run(llm);
    expect(validateDomainPack(pack)).toEqual([]);
  });

  it('fails cleanly when the plan is garbage or the replies are not objects', async () => {
    const bad = new FakeLlm(() => 'not an object');
    await expect(run(bad)).rejects.toMatchObject({ code: 'failed' });
    const thrower = new FakeLlm(() => { throw new LlmError('HTTP 500', 'http'); });
    await expect(run(thrower)).rejects.toMatchObject({ code: 'failed' });
  });

  it('parsePlan fixes ids and rejects the wrong number of concepts', () => {
    const plan = parsePlan({ concepts: [
      { id: 'Daily Life!!', name: 'A', facts: ['too short', 'A fact that is long enough.', 5] },
      { id: 'daily-life', name: 'B' }, { id: '', name: 'Third part' }, { name: 'Fourth', id: 'x'.repeat(40) },
    ] });
    expect(plan).not.toBeNull();
    expect(plan!.map((c) => c.id)).toEqual(['daily-life', 'daily-life-b', 'third-part', 'xxxxxxxxxxxxxxxxxxxxxxxx']);
    expect(plan![0].facts).toEqual(['A fact that is long enough.']);
    expect(plan!.every((c) => /^[a-z]+(-[a-z]+)*$/.test(c.id))).toBe(true);
    expect(parsePlan({ concepts: [{ id: 'a', name: 'A' }] })).toBeNull();
    expect(parsePlan({ concepts: 'x' })).toBeNull();
    expect(parsePlan(null)).toBeNull();
  });
});

describe('parseJsonLoose', () => {
  it('handles fences, prefixes and clean JSON', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure! Here you go:\n{"a":{"b":2}}\nHope that helps.')).toEqual({ a: { b: 2 } });
  });
  it('throws a clean error on truncated or missing JSON', () => {
    expect(() => parseJsonLoose('{"a":[1,2')).toThrow(LlmError);
    expect(() => parseJsonLoose('{"a":1,"b":}')).toThrow(/not valid JSON/);
    expect(() => parseJsonLoose('no json here')).toThrow(/no JSON object/);
  });
});

describe('topic normalisation', () => {
  it('trims, collapses spaces and strips control characters', () => {
    expect(normalizeTopic('  Roman \t Empire\u0000\n ')).toBe('Roman Empire');
  });
  it('builds the cache key as level:lowercased topic', () => {
    expect(packKey('easy', '  Roman   EMPIRE ')).toBe('easy:roman empire');
    expect(packKey('hard', 'Roman Empire')).not.toBe(packKey('easy', 'Roman Empire'));
  });
});
