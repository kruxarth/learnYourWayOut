import type { Rng } from '../game/rng';
import { T } from '../game/tuning';
import type { Tier } from '../game/types';
import type { DomainPack, Question, QuestionType } from './schema';

export interface SelectRequest {
  pack: DomainPack;
  type: QuestionType | QuestionType[];
  tier: Tier;
  usedIds: Set<string>;
  recentConcepts: string[];            // last 2 main-question concepts
  focusConcepts?: string[];            // weak-spot run
  wrongConceptsThisRun: Set<string>;
  conceptFilter?: string;              // detour retry
  seenIds?: Set<string>;               // seen in earlier runs: scored lower
  rng: Rng;
}

function typeMatches(q: Question, type: QuestionType | QuestionType[]): boolean {
  return Array.isArray(type) ? type.includes(q.type) : q.type === type;
}

function score(q: Question, req: SelectRequest): number {
  let s = 10 * Math.abs(q.tier - req.tier);
  if (req.focusConcepts?.includes(q.concept)) s -= 50;
  if (req.recentConcepts.includes(q.concept)) s += 5;
  if (req.wrongConceptsThisRun.has(q.concept)) s -= 3;
  if (req.seenIds?.has(q.id)) s += T.SEEN_PENALTY;
  return s + req.rng();
}

function best(cands: Question[], req: SelectRequest): Question {
  let bestQ = cands[0], bestS = Infinity;
  for (const q of cands) {
    const s = score(q, req);
    if (s < bestS) { bestS = s; bestQ = q; }
  }
  return bestQ;
}

/** Spec §12.1. Marks the chosen id as used. */
export function selectQuestion(req: SelectRequest): Question {
  const ofType = req.pack.questions.filter((q) => typeMatches(q, req.type) && (!req.conceptFilter || q.concept === req.conceptFilter));
  let cands = ofType.filter((q) => !req.usedIds.has(q.id));
  if (cands.length === 0) {
    console.warn(`[select] no unused ${String(req.type)} questions left; reusing`);
    cands = ofType.length ? ofType : req.pack.questions.filter((q) => typeMatches(q, req.type));
  }
  if (cands.length === 0) throw new Error(`No ${String(req.type)} questions in pack ${req.pack.id}`);
  const q = best(cands, req);
  req.usedIds.add(q.id);
  return q;
}

/**
 * Detour retry question (spec §11.2): same concept, tier 1, mcq/truefalse, unused.
 * Falls back to any tier, then to the original question. Returns null if the original
 * is itself not mcq/truefalse and nothing else is available.
 */
export function selectRetryQuestion(
  pack: DomainPack, original: Question, usedIds: Set<string>, rng: Rng, preferMcq = false,
): Question | null {
  let cands = pack.questions.filter(
    (q) => (q.type === 'mcq' || q.type === 'truefalse') && q.concept === original.concept && !usedIds.has(q.id) && q.id !== original.id,
  );
  // more than two retry doors: an mcq fills them all
  if (preferMcq && cands.some((q) => q.type === 'mcq')) cands = cands.filter((q) => q.type === 'mcq');
  if (cands.length) {
    const tier1 = cands.filter((q) => q.tier === 1);
    const pool = tier1.length ? tier1 : cands;
    const q = pool[Math.floor(rng() * pool.length)];
    usedIds.add(q.id);
    return q;
  }
  if (original.type === 'mcq' || original.type === 'truefalse') return original;
  return null;
}
