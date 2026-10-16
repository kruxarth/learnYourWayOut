import { existsSync } from 'node:fs';

export interface ServerEnv {
  port: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  /** Model for the review pass; defaults to the main model. */
  reviewModel: string;
  /**
   * Send `thinking: {type: "disabled"}`. DeepSeek's models reason by default and the reasoning counts against
   * max_tokens, which truncates our JSON. LLM_THINKING=on/off; default off for api.deepseek.com, untouched elsewhere.
   */
  disableThinking: boolean;
  allowedOrigins: string[];
  /** False when no key is set: Any Topic is then disabled and /api/health says so. */
  llmEnabled: boolean;
}

/** Load an env file into process.env if it exists. Variables already set (real ones, or an earlier file) win. */
export function loadEnvFile(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const port = Number.parseInt(source.PORT ?? '', 10);
  const model = (source.LLM_MODEL ?? '').trim() || 'deepseek-flash';
  // LLM_API_KEY (server/.env) wins; DEEPSEEK_API is the root .env name (see .env.example)
  const key = ((source.LLM_API_KEY ?? '').trim() || (source.DEEPSEEK_API ?? '').trim());
  const baseUrl = ((source.LLM_BASE_URL ?? '').trim() || 'https://api.deepseek.com').replace(/\/+$/, '');
  const thinking = (source.LLM_THINKING ?? '').trim().toLowerCase();
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787,
    llmBaseUrl: baseUrl,
    llmApiKey: key,
    llmModel: model,
    reviewModel: (source.LLM_REVIEW_MODEL ?? '').trim() || model,
    disableThinking: thinking === 'off' || (thinking !== 'on' && /^https:\/\/api\.deepseek\.com(\/|$)/.test(baseUrl)),
    allowedOrigins: (source.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    llmEnabled: key.length > 0 && key !== '...',
  };
}
