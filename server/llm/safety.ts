/**
 * Safety gate for typed topics: a short blocklist first (no LLM call at all for a hit), then an LLM classifier.
 * The LLM does the real work; the blocklist only catches the obvious cases cheaply.
 */
import type { LlmClient } from './client';
import { gatePrompt } from './prompts';

export interface GateResult {
  verdict: 'ok' | 'unsafe' | 'not_a_topic' | 'too_broad';
  cleanTopic: string;
  suggestions: string[];
}

const VERDICTS = ['ok', 'unsafe', 'not_a_topic', 'too_broad'] as const;

/** Whole words or phrases. Kept short on purpose: ordinary school topics (WW2, the human heart, "naked mole rat") must pass. */
const BLOCK_WORDS = [
  'porn', 'porno', 'pornography', 'xxx', 'nsfw', 'nude', 'nudes', 'hentai', 'erotica', 'onlyfans', 'blowjob', 'handjob', 'bestiality',
  'nigger', 'nigga', 'faggot', 'tranny', 'kike',
];
const BLOCK_PHRASES = [
  'sex tape', 'sex video', 'sex toy', 'sexy girls', 'kill yourself', 'suicide method', 'suicide methods', 'self harm', 'self-harm',
  'cut myself', 'hurt myself', 'make a bomb', 'build a bomb', 'make meth', 'cook meth', 'how to get high', 'get drunk',
];
/** Obvious attempts to talk to the model instead of naming a topic. The LLM gate catches the subtle ones. */
const INJECTION = [
  /\bignore\b.{0,30}\b(previous|prior|above|earlier|all|any)\b.{0,30}\b(instructions?|prompts?|rules?)\b/,
  /\bdisregard\b.{0,30}\b(instructions?|prompts?|rules?)\b/,
  /\b(system|developer)\s+prompt\b/,
  /\bjailbreak\b/,
  /\byou are now\b/,
  /\bpretend (to be|you are)\b/,
  /\breveal\b.{0,20}\b(prompt|instructions?|key|secret)\b/,
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '@': 'a', $: 's' };

function squash(s: string): string {
  return s.toLowerCase().replace(/[01345@$]/g, (c) => LEET[c] ?? c);
}

/** True when the text hits the blocklist (whole words, simple letter substitutions, spaced-out long words). */
export function blocklisted(text: string): boolean {
  const flat = squash(text).replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return false;
  const words = new Set(flat.split(' '));
  if (BLOCK_WORDS.some((w) => words.has(w))) return true;
  const padded = ` ${flat} `;
  if (BLOCK_PHRASES.some((p) => padded.includes(` ${p.replace(/-/g, ' ')} `))) return true;
  if (INJECTION.some((re) => re.test(flat))) return true;
  // "h e n t a i", "p.o.r.n": a run of single letters is read as one word
  const joined = flat.replace(/\b(?:[a-z] ){3,}[a-z]\b/g, (m) => m.replace(/ /g, ''));
  return joined !== flat && BLOCK_WORDS.some((w) => joined.split(' ').includes(w));
}

function cleanString(v: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';
}

/** Hand-written guard for the classifier reply. Returns null when it is not usable. */
export function parseGate(raw: unknown, typed: string): GateResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const verdict = (VERDICTS as readonly unknown[]).includes(r.verdict) ? (r.verdict as GateResult['verdict']) : null;
  if (!verdict) return null;
  const suggestions = (Array.isArray(r.suggestions) ? r.suggestions : [])
    .map((s) => cleanString(s, 40))
    .filter((s) => s.length >= 3 && !blocklisted(s))
    .slice(0, 3);
  const clean = cleanString(r.cleanTopic, 30);
  if (verdict === 'ok' && clean.length < 3) return { verdict, cleanTopic: typed.slice(0, 30).trim(), suggestions: [] };
  return { verdict, cleanTopic: clean || typed.slice(0, 30).trim(), suggestions: verdict === 'ok' ? [] : suggestions };
}

/** Blocklist first (no LLM call on a hit), then the LLM classifier. Throws if the classifier fails: unknown means no. */
export async function checkTopic(topic: string, llm: LlmClient): Promise<GateResult> {
  if (blocklisted(topic)) return { verdict: 'unsafe', cleanTopic: topic, suggestions: [] };
  const p = gatePrompt(topic);
  const gate = parseGate(await llm.json({ ...p, maxTokens: 300, temperature: 0 }), topic);
  if (!gate) throw new Error('unusable safety gate reply');
  // the classifier may echo or "fix" the topic into something blocked
  if (gate.verdict === 'ok' && blocklisted(gate.cleanTopic)) return { verdict: 'unsafe', cleanTopic: topic, suggestions: [] };
  return gate;
}
