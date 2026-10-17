import { existsSync } from 'node:fs';

export interface ServerEnv {
  port: number;
  llmBaseUrl: string;
  llmApiKey: string;
  /** Preferred model (first of `llmModels`); stored in pack metadata. */
  llmModel: string;
  /** Models to try in order; the next one takes over when one fails or is rate-limited. */
  llmModels: string[];
  /** Model for the review pass; defaults to the main model. */
  reviewModel: string;
  /** Send `reasoning: {enabled: false}`: reasoning counts against max_tokens and made free models 10x slower. LLM_THINKING=on/off; default off. */
  disableThinking: boolean;
  allowedOrigins: string[];
  /** False when no key is set: Any Topic is then disabled and /api/health says so. */
  llmEnabled: boolean;
}

/** Load an env file into process.env if it exists. Variables already set (real ones, or an earlier file) win. */
export function loadEnvFile(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

/** Free OpenRouter models, best first. Chosen by testing JSON replies; edit with LLM_MODELS. */
export const DEFAULT_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'xingchen-agi/xing4.0-29b-a4b:free',
];

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const port = Number.parseInt(source.PORT ?? '', 10);
  const listed = (source.LLM_MODELS ?? source.LLM_MODEL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const models = listed.length ? listed : DEFAULT_MODELS;
  const model = models[0];
  // LLM_API_KEY (server/.env) wins; OPENROUTER_KEY is the root .env name (see .env.example)
  const key = ((source.LLM_API_KEY ?? '').trim() || (source.OPENROUTER_KEY ?? '').trim());
  const baseUrl = ((source.LLM_BASE_URL ?? '').trim() || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const thinking = (source.LLM_THINKING ?? '').trim().toLowerCase();
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787,
    llmBaseUrl: baseUrl,
    llmApiKey: key,
    llmModel: model,
    llmModels: models,
    reviewModel: (source.LLM_REVIEW_MODEL ?? '').trim() || model,
    disableThinking: thinking !== 'on',
    allowedOrigins: (source.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    llmEnabled: key.length > 0 && key !== '...',
  };
}
