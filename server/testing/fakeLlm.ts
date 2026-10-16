/** Test doubles. No network: the pipeline only ever sees an LlmClient. */
import type { LlmClient, LlmRequest } from '../llm/client';

export type CallKind = 'gate' | 'plan' | 'write' | 'fix' | 'review';

export function kindOf(req: LlmRequest): CallKind {
  if (req.system.includes('safety gate')) return 'gate';
  if (req.system.includes('You plan a short quiz')) return 'plan';
  if (req.system.includes('repair quiz')) return 'fix';
  if (req.system.includes('fact-checker')) return 'review';
  return 'write';
}

export type Handler = (req: LlmRequest, kind: CallKind) => unknown | Promise<unknown>;

/** Returns canned replies from `handler` and records every call. */
export class FakeLlm implements LlmClient {
  readonly calls: { req: LlmRequest; kind: CallKind }[] = [];
  constructor(public handler: Handler) {}
  async json(req: LlmRequest): Promise<unknown> {
    const kind = kindOf(req);
    this.calls.push({ req, kind });
    return this.handler(req, kind);
  }
  count(kind: CallKind): number { return this.calls.filter((c) => c.kind === kind).length; }
  of(kind: CallKind): LlmRequest[] { return this.calls.filter((c) => c.kind === kind).map((c) => c.req); }
}

export const CONCEPTS = [
  { id: 'rise', name: 'Founding and rise' },
  { id: 'daily-life', name: 'Daily life' },
  { id: 'army-rule', name: 'Army and government' },
  { id: 'decline', name: 'Decline and legacy' },
];

export function planReply() {
  return {
    concepts: CONCEPTS.map((c) => ({
      ...c,
      facts: [`${c.name} is a big part of this topic.`, `A second true fact about ${c.name}.`, `A third true fact about ${c.name}.`],
    })),
  };
}

export interface Wanted { type: string; tier: number; count: number }

/** Reads "Write exactly: 3 x mcq with tier 1, ..." back out of a write prompt. */
export function parseWanted(user: string): Wanted[] {
  const line = user.split('\n').find((l) => l.startsWith('Write exactly:')) ?? '';
  return [...line.matchAll(/(\d+) x (\w+) with tier (\d)/g)].map((m) => ({ count: Number(m[1]), type: m[2], tier: Number(m[3]) }));
}

export function sectionOf(user: string): string {
  return /Section: (.*)/.exec(user)?.[1] ?? 'x';
}

let serial = 0;
/** One valid raw question (what a good model would return). Prompts are unique. */
export function rawQuestion(type: string, tier: number, section: string): Record<string, unknown> {
  const n = ++serial;
  const base = { type, tier, prompt: `Question number ${n} about ${section}?`, hint: 'Think about the main idea.', explanation: `Number ${n} is explained by the key idea of ${section}.` };
  switch (type) {
    case 'mcq': return { ...base, answer: `Right ${n}`, distractors: [`Wrong A${n}`, `Wrong B${n}`, `Wrong C${n}`] };
    case 'truefalse': return { ...base, answer: n % 2 === 0 };
    case 'steps': return { ...base, steps: [0, 1, 2, 3].map((i) => ({ correct: `Step ${i + 1} right`, wrong: [`Step ${i + 1} wrong`] })) };
    case 'classify': return {
      ...base, prompt: `Step only on the right things ${n}.`,
      items: [...[1, 2, 3, 4].map((i) => ({ label: `Fits ${i}-${n}`, fits: true })), ...[1, 2, 3, 4].map((i) => ({ label: `No ${i}-${n}`, fits: false }))],
    };
    default: return { ...base, prompt: `Put these in order, first ${n}.`, items: ['First', 'Second', 'Third', 'Fourth'] };
  }
}

export function questionsFor(wanted: Wanted[], section: string): Record<string, unknown>[] {
  return wanted.flatMap((w) => Array.from({ length: w.count }, () => rawQuestion(w.type, w.tier, section)));
}

/** A model that does everything right. Pass overrides to break one kind of call. */
export function cleanHandler(over: Partial<Record<CallKind, Handler>> = {}): Handler {
  return (req, kind) => {
    if (over[kind]) return over[kind]!(req, kind);
    switch (kind) {
      case 'gate': return { verdict: 'ok', cleanTopic: /<topic>(.*)<\/topic>/.exec(req.user)?.[1] ?? 'Topic', suggestions: [] };
      case 'plan': return planReply();
      case 'write': return { questions: questionsFor(parseWanted(req.user), sectionOf(req.user)) };
      case 'fix': return { questions: [] };
      default: return { flags: [] };
    }
  };
}
