import type { DomainPack, McqQuestion, Question, TfQuestion } from '../../content/schema';
import { T } from '../tuning';
import type { AnswerRecord, Difficulty, MasteryEntry, Tier } from '../types';

export function evaluateMcq(q: McqQuestion, label: string): boolean {
  return label === q.answer;
}

export function evaluateTf(q: TfQuestion, label: string): boolean {
  return (label === 'TRUE') === q.answer;
}

/** Adaptive tier staircase (spec §12.3). Retry questions never call this. */
export function nextTier(tier: Tier, streak: number, firstTryCorrect: boolean): { tier: Tier; streak: number } {
  if (firstTryCorrect) {
    const s = streak + 1;
    if (s >= T.STREAK_TO_LEVEL_UP) return { tier: Math.min(3, tier + 1) as Tier, streak: 0 };
    return { tier, streak: s };
  }
  return { tier: Math.max(1, tier - 1) as Tier, streak: 0 };
}

/** Mastery per concept from main (non-retry) records, lowest first (spec §12.5, §14.4). */
export function computeMastery(records: AnswerRecord[], pack: DomainPack): MasteryEntry[] {
  const map = new Map<string, MasteryEntry>();
  for (const r of records) {
    if (r.isRetry) continue;
    let e = map.get(r.concept);
    if (!e) {
      e = { conceptId: r.concept, name: pack.concepts.find((c) => c.id === r.concept)?.name ?? r.concept, asked: 0, correct: 0 };
      map.set(r.concept, e);
    }
    e.asked++;
    if (r.correctFirstTry) e.correct++;
  }
  return [...map.values()].sort((a, b) => a.correct / a.asked - b.correct / b.asked || a.name.localeCompare(b.name));
}

export function weakConcepts(mastery: MasteryEntry[]): string[] {
  return mastery.filter((m) => m.correct < m.asked).map((m) => m.conceptId);
}

export function accuracy(records: AnswerRecord[]): { asked: number; correct: number } {
  let asked = 0, correct = 0;
  for (const r of records) {
    if (r.isRetry) continue;
    asked++;
    if (r.correctFirstTry) correct++;
  }
  return { asked, correct };
}

/**
 * Par time (ms) for a course: the sum of `T.PAR_S` over the segments the run passes (main segments
 * plus the chosen lane), plus reading time per room. Each PAR_S value is about 1.8x the perfect bot's time in that segment.
 */
export function parTimeMs(difficulty: Difficulty, segments: readonly { kind: string; lane: string; roomId?: string }[], route: 'short' | 'long' | null): number {
  const lane = route === 'short' ? 'short' : 'long';
  let s = 0;
  for (const seg of segments) {
    if (seg.lane !== 'main' && seg.lane !== lane) continue;
    s += T.PAR_S[seg.kind]?.[difficulty] ?? T.PAR_DEFAULT_S;
    if (seg.roomId) s += T.PAR_READ_S;
  }
  return Math.round(s * 1000);
}

/**
 * Each star is independent (spec §14.3, P1-A): qualified, ≥ 70% first-try accuracy, and
 * qualified within par time (rewards speed plus knowledge, which strong players can still improve).
 */
export function computeStars(qualified: boolean, records: AnswerRecord[], timeMs: number, parMs: number): 0 | 1 | 2 | 3 {
  const { asked, correct } = accuracy(records);
  let stars = 0;
  if (qualified) stars++;
  if (asked > 0 && correct / asked >= 0.7) stars++;
  if (qualified && timeMs <= parMs) stars++;
  return stars as 0 | 1 | 2 | 3;
}

/** Human-readable correct answer for the review list. */
export function answerText(q: Question): string {
  switch (q.type) {
    case 'mcq': return q.answer;
    case 'truefalse': return q.answer ? 'TRUE' : 'FALSE';
    case 'steps': return q.steps.map((s) => s.correct).join(' → ');
    case 'order': return q.items.join(' → ');
    case 'classify': return q.items.filter((i) => i.fits).map((i) => i.label).join(', ');
  }
}
