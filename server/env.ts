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
/** Free Groq models, best first. `reasoning_effort: low` keeps hidden reasoning from eating max_tokens. */
const MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
const NO_THINK = { reasoning_effort: 'low' };

/** True for something that looks like a Groq key (`gsk_…`). */
export function isGroqKey(key: string): boolean {
  const k = key.trim();
  return k.startsWith('gsk_') && k.length >= 20 && k.length <= 200;
}

export function chainForKey(apiKey: string, noThink = true): ChainEntry[] {
  return MODELS.map((model) => ({ baseUrl: GROQ_URL, apiKey: apiKey.trim(), model, ...(noThink ? { extraBody: NO_THINK } : {}) }));
}

const real = (v: string | undefined): string => {
  const t = (v ?? '').trim();
  return t === '...' ? '' : t;
};

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const port = Number.parseInt(source.PORT ?? '', 10);
  const noThink = (source.LLM_THINKING ?? '').trim().toLowerCase() !== 'on';
  const key = real(source.GROQ_API);
  const chain = key ? chainForKey(key, noThink) : [];
  const model = chain[0]?.model ?? MODELS[0];
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787,
    llmChain: chain,
    llmModel: model,
    reviewModel: (source.LLM_REVIEW_MODEL ?? '').trim() || model,
    allowedOrigins: (source.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    llmEnabled: chain.length > 0,
  };
}
