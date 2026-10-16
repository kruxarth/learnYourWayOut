import { existsSync } from 'node:fs';

export interface ServerEnv {
  port: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  /** Model for the review pass; defaults to the main model. */
  reviewModel: string;
  allowedOrigins: string[];
  /** False when no key is set: Any Topic is then disabled and /api/health says so. */
  llmEnabled: boolean;
}

/** Load `server/.env` into process.env if it exists. Real environment variables win. */
export function loadEnvFile(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const port = Number.parseInt(source.PORT ?? '', 10);
  const model = (source.LLM_MODEL ?? '').trim() || 'deepseek-v4-flash';
  const key = (source.LLM_API_KEY ?? '').trim();
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787,
    llmBaseUrl: ((source.LLM_BASE_URL ?? '').trim() || 'https://api.deepseek.com').replace(/\/+$/, ''),
    llmApiKey: key,
    llmModel: model,
    reviewModel: (source.LLM_REVIEW_MODEL ?? '').trim() || model,
    allowedOrigins: (source.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    llmEnabled: key.length > 0 && key !== '...',
  };
}
