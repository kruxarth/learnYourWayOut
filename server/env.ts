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

export type Provider = 'groq' | 'openrouter' | 'cerebras';

/** Free models per provider, best first. Groq is fast; OpenRouter's are slow and capped at 50 requests a day, so they come last. */
const PROVIDERS: Record<Provider, { baseUrl: string; noThink: Record<string, unknown>; models: string[]; keyPrefix: string }> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1', noThink: { reasoning_effort: 'low' }, keyPrefix: 'gsk_',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1', noThink: { reasoning: { enabled: false } }, keyPrefix: 'sk-or-',
    models: ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-super-vl:free'],
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1', noThink: { reasoning_effort: 'low' }, keyPrefix: 'csk-',
    models: ['gpt-oss-120b', 'qwen-3.8-27b'],
  },
};
const DEFAULT_PROVIDERS: Provider[] = ['groq', 'openrouter'];

/** Which provider a pasted key belongs to, by its prefix; null when it is none of ours. */
export function providerOfKey(key: string): Provider | null {
  const k = key.trim();
  return (Object.keys(PROVIDERS) as Provider[]).find((p) => k.startsWith(PROVIDERS[p].keyPrefix) && k.length >= 20 && k.length <= 200) ?? null;
}

export function chainForKey(provider: Provider, apiKey: string, noThink = true): ChainEntry[] {
  const p = PROVIDERS[provider];
  return p.models.map((model) => ({ baseUrl: p.baseUrl, apiKey: apiKey.trim(), model, ...(noThink ? { extraBody: p.noThink } : {}) }));
}

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
    const baseUrl = ((source.LLM_BASE_URL ?? '').trim() || PROVIDERS.openrouter.baseUrl).replace(/\/+$/, '');
    const apiKey = customKey || real(source.OPENROUTER_KEY);
    const noThinkBody = Object.values(PROVIDERS).find((p) => p.baseUrl === baseUrl)?.noThink;
    chain = (listed.length ? listed : PROVIDERS.openrouter.models)
      .map((model) => ({ baseUrl, apiKey, model, ...(noThink && noThinkBody ? { extraBody: noThinkBody } : {}) }));
  } else {
    const keys: Record<Provider, string> = { groq: real(source.GROQ_API), openrouter: real(source.OPENROUTER_KEY), cerebras: '' };
    chain = DEFAULT_PROVIDERS.flatMap((p) => (keys[p] ? chainForKey(p, keys[p], noThink) : []));
  }
  chain = chain.filter((e) => e.apiKey);
  const model = chain[0]?.model ?? PROVIDERS.groq.models[0];
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787,
    llmChain: chain,
    llmModel: model,
    reviewModel: (source.LLM_REVIEW_MODEL ?? '').trim() || model,
    allowedOrigins: (source.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    llmEnabled: chain.length > 0,
  };
}
