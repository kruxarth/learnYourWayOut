/**
 * Topic -> DomainPack. Every LLM reply is `unknown` until a hand-written guard checks it.
 * Steps: normalize, safety gate, plan, write (parallel per concept), validate, fix, review, top-up, assemble.
 */
import type { DomainPack, Question } from '../../src/content/schema';
import { validateDomainPack, validateQuestion } from '../../src/content/validate';
import type { Difficulty } from '../../src/game/types';
import type { LlmClient } from './client';
import {
  defaultWanted, FLAG_PROBLEMS, fixPrompt, planPrompt, reviewPrompt, writePrompt, type WantedItem,
} from './prompts';
import { blocklisted, checkTopic, type GateResult } from './safety';

export type Stage = 'checking' | 'planning' | 'writing' | 'reviewing' | 'fixing' | 'done' | 'failed';
export type OnStage = (stage: Stage, progress: number) => void;
export type PackErrorCode = 'too-short' | 'too-long' | 'unsafe' | 'not-a-topic' | 'too-broad' | 'failed';

export class PackError extends Error {
  constructor(readonly code: PackErrorCode, message: string, readonly suggestions?: string[]) {
    super(message);
    this.name = 'PackError';
  }
}

export const TOPIC_MIN = 3;
export const TOPIC_MAX = 60;
export const NAME_MAX = 30;
const TOP_UP_ROUNDS = 2;
const FAIL_MESSAGE = "Couldn't make enough good questions about that. Try a broader topic.";
const LLM_MESSAGE = 'The question writer had a problem. Please try again.';
const COLORS = ['#7EC8E3', '#9ADE7B', '#FFB86B', '#C79BFF', '#FF8FB1', '#FFD93D'];

/** Trim, collapse spaces, strip control characters. */
export function normalizeTopic(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return String(raw).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Cache key: level + ':' + normalized topic, lowercased. */
export function packKey(level: Difficulty, topic: string): string {
  return `${level}:${normalizeTopic(topic).toLowerCase()}`;
}

/** Throws PackError('too-short' | 'too-long'); returns the normalized topic. */
export function checkTopicLength(raw: string): string {
  const t = normalizeTopic(raw);
  if (t.length < TOPIC_MIN) throw new PackError('too-short', 'Please type at least 3 letters.');
  if (t.length > TOPIC_MAX) throw new PackError('too-long', 'Please keep the topic under 60 characters.');
  return t;
}

export interface PipelineOpts {
  /** Model name stored in `pack.generated` (metadata only). */
  model?: string;
  /** Model for the review pass. */
  reviewModel?: string;
  now?: () => Date;
  /** Gate result from the caller (the API gates before starting the job). Skips the gate here. */
  gated?: GateResult;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// ───────────────────────── guards ─────────────────────────

interface PlanConcept { id: string; name: string; facts: string[] }

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/g, '');
}

/** Accepts only a plan with 4 usable concepts. Fixes ids (slug, unique) and drops bad facts. */
export function parsePlan(raw: unknown): PlanConcept[] | null {
  if (!isObj(raw) || !Array.isArray(raw.concepts)) return null;
  const out: PlanConcept[] = [];
  const used = new Set<string>();
  for (const c of raw.concepts) {
    if (!isObj(c) || typeof c.name !== 'string') return null;
    const name = normalizeTopic(c.name);
    if (name.length < 1 || name.length > NAME_MAX) return null;
    let id = slug(typeof c.id === 'string' ? c.id : '') || slug(name);
    if (!id) return null;
    while (used.has(id)) id = `${id.slice(0, 22)}-${String.fromCharCode(97 + used.size)}`;
    used.add(id);
    const facts = (Array.isArray(c.facts) ? c.facts : [])
      .filter((f): f is string => typeof f === 'string')
      .map((f) => normalizeTopic(f))
      .filter((f) => f.length >= 10 && f.length <= 120)
      .slice(0, 3);
    out.push({ id, name, facts });
  }
  return out.length === 4 ? out : null;
}

const QTYPES = new Set(['mcq', 'truefalse', 'steps', 'order', 'classify']);

/** Keep only known fields. Values stay as the model wrote them: the validator reports wrong types. */
function coerceQuestion(raw: unknown, concept: string, id: string): Question | null {
  if (!isObj(raw) || typeof raw.type !== 'string' || !QTYPES.has(raw.type)) return null;
  const base: Obj = {
    id, type: raw.type, concept, tier: raw.tier, prompt: raw.prompt, hint: raw.hint, explanation: raw.explanation,
  };
  if (raw.workedExample !== undefined && raw.workedExample !== null && raw.workedExample !== '') base.workedExample = raw.workedExample;
  switch (raw.type) {
    case 'mcq': base.answer = raw.answer; base.distractors = raw.distractors; break;
    case 'truefalse': base.answer = raw.answer; break;
    case 'steps': base.steps = Array.isArray(raw.steps)
      ? raw.steps.map((r) => (isObj(r) ? { correct: r.correct, wrong: r.wrong, ...(r.why !== undefined && r.why !== null && r.why !== '' ? { why: r.why } : {}) } : r))
      : raw.steps; break;
    case 'order': base.items = raw.items; break;
    case 'classify': base.items = Array.isArray(raw.items)
      ? raw.items.map((i) => (isObj(i) ? { label: i.label, fits: i.fits } : i))
      : raw.items; break;
  }
  return base as unknown as Question;
}

function questionList(raw: unknown): unknown[] {
  return isObj(raw) && Array.isArray(raw.questions) ? raw.questions : [];
}

// ───────────────────────── helpers ─────────────────────────

function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function truncateName(s: string): string {
  if (s.length <= NAME_MAX) return s;
  const cut = s.slice(0, NAME_MAX);
  const sp = cut.lastIndexOf(' ');
  return (sp >= 12 ? cut.slice(0, sp) : cut).trim();
}

function safeErrors(skel: Pick<DomainPack, 'id' | 'concepts'>, q: Question): string[] {
  try {
    return validateQuestion(skel, q);
  } catch {
    return [`${q?.id}: malformed question`];
  }
}

function compact(q: Question): unknown {
  switch (q.type) {
    case 'mcq': return { id: q.id, type: q.type, prompt: q.prompt, answer: q.answer, distractors: q.distractors };
    case 'truefalse': return { id: q.id, type: q.type, prompt: q.prompt, answer: q.answer };
    case 'steps': return { id: q.id, type: q.type, prompt: q.prompt, steps: q.steps.map((r) => ({ correct: r.correct, wrong: r.wrong })) };
    case 'order': return { id: q.id, type: q.type, prompt: q.prompt, itemsInCorrectOrder: q.items };
    case 'classify': return { id: q.id, type: q.type, rule: q.prompt, items: q.items.map((i) => ({ label: i.label, fits: i.fits })) };
  }
}

/** What the quota still needs, per concept (mirrors `quotaErrors` in validate.ts). */
export function missingWanted(questions: Question[], concepts: { id: string }[]): Map<string, WantedItem[]> {
  const out = new Map<string, WantedItem[]>();
  const want = (concept: string, type: WantedItem['type'], tier: 1 | 2 | 3, count: number) => {
    if (count <= 0) return;
    const list = out.get(concept) ?? [];
    list.push({ type, tier, count });
    out.set(concept, list);
  };
  const of = (t: string) => questions.filter((q) => q.type === t);
  for (const c of concepts) {
    const m = of('mcq').filter((q) => q.concept === c.id);
    const n1 = Math.max(0, 2 - m.filter((q) => q.tier === 1).length);
    const n2 = Math.max(0, 1 - m.filter((q) => q.tier === 2).length);
    const n3 = Math.max(0, 1 - m.filter((q) => q.tier === 3).length);
    want(c.id, 'mcq', 1, n1); want(c.id, 'mcq', 2, n2); want(c.id, 'mcq', 3, n3);
    want(c.id, 'mcq', 2, Math.max(0, 4 - m.length - n1 - n2 - n3));
    const t = of('truefalse').filter((q) => q.concept === c.id);
    const t1 = Math.max(0, 1 - t.filter((q) => q.tier === 1).length);
    want(c.id, 'truefalse', 1, t1);
    want(c.id, 'truefalse', 2, Math.max(0, 2 - t.length - t1));
  }
  const spread = (type: 'steps' | 'order', total: number, tiers: (1 | 2 | 3)[]) => {
    const have = of(type);
    const counts = new Map(concepts.map((c) => [c.id, have.filter((q) => q.concept === c.id).length]));
    const fewest = () => [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
    const ask = (tier: 1 | 2 | 3, conceptId = fewest()) => { want(conceptId, type, tier, 1); counts.set(conceptId, (counts.get(conceptId) ?? 0) + 1); };
    let asked = 0;
    for (const tier of tiers) if (!have.some((q) => q.tier === tier)) { ask(tier); asked++; }
    while (have.length + asked < total) { ask(tiers[asked % tiers.length]); asked++; }
    const present = [...counts.values()].filter((n) => n > 0).length;
    if (present < 2 && concepts.length > 1) ask(tiers[0], [...counts.entries()].find(([, n]) => n === 0)![0]);
  };
  spread('steps', 4, [1, 2, 3]);
  spread('order', 4, [1, 2]);
  return out;
}

// ───────────────────────── the pipeline ─────────────────────────

export async function generatePack(
  topicRaw: string, level: Difficulty, llm: LlmClient, onStage: OnStage = () => {}, opts: PipelineOpts = {},
): Promise<DomainPack> {
  let lastProgress = 0;
  const stage = (s: Stage, p: number) => { lastProgress = Math.max(lastProgress, p); onStage(s, lastProgress); };

  // 1. normalize
  const typed = checkTopicLength(topicRaw);

  // 2. safety gate
  stage('checking', 0.03);
  let gate: GateResult;
  try {
    gate = opts.gated ?? await checkTopic(typed, llm);
  } catch {
    throw new PackError('failed', LLM_MESSAGE);
  }
  if (gate.verdict === 'unsafe') throw new PackError('unsafe', "Let's pick a different topic!", gate.suggestions);
  if (gate.verdict === 'not_a_topic') throw new PackError('not-a-topic', "That doesn't look like something to learn about. Try a school subject!", gate.suggestions);
  if (gate.verdict === 'too_broad') throw new PackError('too-broad', 'That topic is too big. Pick a narrower one!', gate.suggestions);
  const topic = normalizeTopic(gate.cleanTopic) || typed;
  const name = truncateName(topic);
  // the cache key follows the cleaned topic, so "roman empre" and "Roman Empire" share one pack
  const key = packKey(level, topic);
  stage('checking', 0.1);

  // 3. plan (one retry if the plan has the wrong shape)
  stage('planning', 0.12);
  let plan: PlanConcept[] | null = null;
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    try {
      const p = planPrompt(topic, level);
      plan = parsePlan(await llm.json({ ...p, maxTokens: 1200, temperature: 0.4 }));
    } catch {
      /* try again, then fail below */
    }
  }
  if (!plan) throw new PackError('failed', LLM_MESSAGE);
  const concepts = plan.map((c) => ({ id: c.id, name: c.name, ...(c.facts.length ? { facts: c.facts } : {}) }));
  const skel = { id: 'custom' as const, concepts };

  const counters = new Map<string, number>(concepts.map((c) => [c.id, 0]));
  const nextId = (concept: string) => {
    const n = (counters.get(concept) ?? 0) + 1;
    counters.set(concept, n);
    return `custom-${concept}-${String(n).padStart(3, '0')}`;
  };
  const coerceAll = (conceptId: string, raws: unknown[]): Question[] =>
    raws.map((r) => coerceQuestion(r, conceptId, nextId(conceptId))).filter((q): q is Question => q !== null);

  const kept: Question[] = [];

  /** Validate, fix once, validate again, drop what still fails. */
  const refineValid = async (cands: Question[]): Promise<Question[]> => {
    const good: Question[] = [];
    const failed: { q: Question; errors: string[] }[] = [];
    for (const q of cands) {
      const errs = safeErrors(skel, q);
      if (errs.length) failed.push({ q, errors: errs }); else good.push(q);
    }
    if (failed.length) {
      stage('fixing', 0.65);
      const byConcept = new Map<string, typeof failed>();
      for (const f of failed) byConcept.set(f.q.concept, [...(byConcept.get(f.q.concept) ?? []), f]);
      await Promise.all([...byConcept.entries()].map(async ([conceptId, items]) => {
        try {
          const p = fixPrompt(topic, level, items.map((i) => ({ question: i.q, errors: i.errors })));
          const reply = questionList(await llm.json({ ...p, maxTokens: 3000, temperature: 0.3 }));
          items.forEach((it, i) => {
            const fixed = coerceQuestion(reply[i], conceptId, it.q.id);
            if (fixed && safeErrors(skel, fixed).length === 0) good.push(fixed);
          });
        } catch { /* these questions are dropped */ }
      }));
    }
    return good;
  };

  /** One review call over `cands`. Flagged questions are dropped. */
  const review = async (cands: Question[]): Promise<Question[]> => {
    if (!cands.length) return cands;
    stage('reviewing', 0.8);
    const p = reviewPrompt(topic, level, cands.map(compact));
    let reply: unknown = null;
    for (let attempt = 0; attempt < 2 && reply === null; attempt++) {
      try { reply = await llm.json({ ...p, maxTokens: 2500, temperature: 0, model: opts.reviewModel }); } catch { /* retry once */ }
    }
    if (reply === null) throw new PackError('failed', LLM_MESSAGE);
    const flagged = new Set<string>();
    if (isObj(reply) && Array.isArray(reply.flags)) {
      for (const f of reply.flags) {
        if (isObj(f) && typeof f.id === 'string' && (FLAG_PROBLEMS as readonly unknown[]).includes(f.problem)) flagged.add(f.id);
      }
    }
    return cands.filter((q) => !flagged.has(q.id));
  };

  const refine = async (cands: Question[]): Promise<Question[]> => review(await refineValid(cands));

  const seenPrompts = new Set<string>();
  const addUnique = (qs: Question[]) => {
    for (const q of qs) {
      const k = String(q.prompt).toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenPrompts.has(k) || blocklisted(JSON.stringify(q))) continue;
      seenPrompts.add(k);
      kept.push(q);
    }
  };

  // 4. write: one call per concept, in parallel
  stage('writing', 0.15);
  let done = 0;
  const written = await Promise.all(concepts.map(async (c, i) => {
    let qs: Question[] = [];
    try {
      const p = writePrompt(topic, level, { name: c.name, facts: c.facts ?? [] }, defaultWanted(i));
      qs = coerceAll(c.id, questionList(await llm.json({ ...p, maxTokens: 6000, temperature: 0.7 })));
    } catch { /* this concept is rebuilt by top-up */ }
    done++;
    stage('writing', 0.15 + 0.45 * (done / concepts.length));
    return qs;
  }));

  // 5-7. validate, fix, review
  addUnique(await refine(written.flat()));

  // 8. quota: up to 2 top-up rounds, each validated, fixed and reviewed again
  for (let round = 0; round < TOP_UP_ROUNDS; round++) {
    const missing = missingWanted(kept, concepts);
    if (missing.size === 0) break;
    stage('writing', 0.85 + round * 0.04);
    const extra = await Promise.all([...missing.entries()].map(async ([conceptId, wanted]) => {
      const c = concepts.find((x) => x.id === conceptId)!;
      try {
        const p = writePrompt(topic, level, { name: c.name, facts: c.facts ?? [] }, wanted);
        return coerceAll(conceptId, questionList(await llm.json({ ...p, maxTokens: 3000, temperature: 0.7 })));
      } catch { return []; }
    }));
    addUnique(await refine(extra.flat()));
  }

  // 9. assemble
  const pack: DomainPack = {
    id: 'custom', name, color: hashColor(key), concepts, questions: kept,
    topic: { query: topic, level },
    generated: { model: opts.model ?? 'unknown', createdAt: (opts.now?.() ?? new Date()).toISOString(), packKey: key },
  };
  if (validateDomainPack(pack).length > 0) throw new PackError('failed', FAIL_MESSAGE);
  stage('done', 1);
  return pack;
}
