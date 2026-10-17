import { existsSync } from 'node:fs';

/** One model on one provider. Extra body fields switch the model's hidden reasoning off (it eats max_tokens and is slow). */
export interface ChainEntry {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraBody?: Record<string, unknown>;
}

export interface ServerEnv {
  port: number;
  /** Models to try in order; the next one takes over when one fails or is rate-limited. Only providers with a key are included. */
  llmChain: ChainEntry[];
  /** Preferred model (first of the chain); stored in pack metadata. */
  llmModel: string;
  /** Model for the review pass; defaults to the main model. */
  reviewModel: string;
  allowedOrigins: string[];
  /** False when no key is set: Any Topic is then disabled and /api/health says so. */
  llmEnabled: boolean;
}

/** Load an env file into process.env if it exists. Variables already set (real ones, or an earlier file) win. */
export function loadEnvFile(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

const GROQ_URL = 'https://api.groq.com/openai/v1';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const GROQ_NO_THINK = { reasoning_effort: 'low' };
const OPENROUTER_NO_THINK = { reasoning: { enabled: false } };

/** Free models, best first. Groq is fast; OpenRouter's free models are slow and capped at 50 requests a day, so they come last. */
const DEFAULT_CHAIN = [
  { provider: 'groq', model: 'openai/gpt-oss-120b' },
  { provider: 'groq', model: 'qwen/qwen3.8-27b' },
  { provider: 'groq', model: 'openai/gpt-oss-20b' },
  { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
  { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
  { provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' },
] as const;

const real = (v: string | undefined): string => {
  const t = (v ?? '').trim();
  return t === '...' ? '' : t;
};

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const port = Number.parseInt(source.PORT ?? '', 10);
  const noThink = (source.LLM_THINKING ?? '').trim().toLowerCase() !== 'on';
  const customKey = real(source.LLM_API_KEY);
  const listed = (source.LLM_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let chain: ChainEntry[];
  if (customKey || listed.length) {
    // one provider of your own: LLM_BASE_URL + LLM_API_KEY (+ LLM_MODELS)
    const baseUrl = ((source.LLM_BASE_URL ?? '').trim() || OPENROUTER_URL).replace(/\/+$/, '');
    const apiKey = customKey || real(source.OPENROUTER_KEY);
    chain = (listed.length ? listed : DEFAULT_CHAIN.filter((e) => e.provider === 'openrouter').map((e) => e.model))
      .map((model) => ({ baseUrl, apiKey, model, ...(noThink ? { extraBody: baseUrl === GROQ_URL ? GROQ_NO_THINK : OPENROUTER_NO_THINK } : {}) }));
  } else {
    const keys = { groq: real(source.GROQ_API), openrouter: real(source.OPENROUTER_KEY) };
    chain = DEFAULT_CHAIN.filter((e) => keys[e.provider]).map((e) => ({
      baseUrl: e.provider === 'groq' ? GROQ_URL : OPENROUTER_URL,
      apiKey: keys[e.provider],
      model: e.model,
      ...(noThink ? { extraBody: e.provider === 'groq' ? GROQ_NO_THINK : OPENROUTER_NO_THINK } : {}),
    }));
  }
  chain = chain.filter((e) => e.apiKey);
  const model = chain[0]?.model ?? DEFAULT_CHAIN[0].model;
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787,
    llmChain: chain,
    llmModel: model,
    reviewModel: (source.LLM_REVIEW_MODEL ?? '').trim() || model,
    allowedOrigins: (source.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    llmEnabled: chain.length > 0,
  };
}
