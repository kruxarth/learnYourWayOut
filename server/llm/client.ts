/** The only way the server talks to an LLM. Tests inject a fake; production uses OpenAiCompatClient. */

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  model?: string;
}

export interface LlmClient {
  /** Returns the parsed JSON object the model replied with. Its shape is `unknown` until a guard checks it. */
  json(req: LlmRequest): Promise<unknown>;
}

export class LlmError extends Error {
  constructor(message: string, readonly code: 'http' | 'timeout' | 'bad-json' | 'empty' | 'network') {
    super(message);
    this.name = 'LlmError';
  }
}

/** Tolerant JSON parse: strips ``` fences and any text around the outermost {...}. Throws LlmError('bad-json'). */
export function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new LlmError('reply has no JSON object', 'bad-json');
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new LlmError('reply is not valid JSON (maybe truncated)', 'bad-json');
  }
}

export interface OpenAiCompatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Add `reasoning: {enabled: false}` to every request (reasoning eats max_tokens and slows free models a lot). */
  disableThinking?: boolean;
  /** Retries after a 429 or 5xx. Default 1; a FallbackClient sets 0 and moves to the next model instead. */
  retries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Posts to `${baseUrl}/chat/completions`. Works with OpenRouter and other compatible hosts. */
export class OpenAiCompatClient implements LlmClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  constructor(private readonly opts: OpenAiCompatOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? 45_000;
  }

  /** Retries (default one) only on 429 and 5xx, after a short backoff. */
  async json(req: LlmRequest): Promise<unknown> {
    for (let left = this.opts.retries ?? 1; ; left--) {
      try {
        return await this.once(req);
      } catch (e) {
        if (left <= 0 || !(e instanceof HttpStatusError) || !(e.status === 429 || e.status >= 500)) throw e;
        await this.sleep(1500);
      }
    }
  }

  private async once(req: LlmRequest): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: req.model || this.opts.model,
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
          max_tokens: req.maxTokens,
          temperature: req.temperature ?? 0.7,
          response_format: { type: 'json_object' },
          ...(this.opts.disableThinking ? { reasoning: { enabled: false } } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new HttpStatusError(res.status);
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new LlmError('empty reply', 'empty');
      return parseJsonLoose(content);
    } catch (e) {
      if (e instanceof LlmError || e instanceof HttpStatusError) throw e;
      if (e instanceof Error && e.name === 'AbortError') throw new LlmError('LLM request timed out', 'timeout');
      throw new LlmError(`network error: ${e instanceof Error ? e.message : String(e)}`, 'network');
    } finally {
      clearTimeout(timer);
    }
  }
}

export class HttpStatusError extends LlmError {
  constructor(readonly status: number) {
    super(`HTTP ${status}`, 'http');
  }
}

/** Cooldowns after a failure: rate limits and outages are short, a model that is gone or a key problem is long. */
export const COOLDOWN_SHORT_MS = 60_000;
export const COOLDOWN_LONG_MS = 600_000;

export interface FallbackEntry { model: string; client: LlmClient }

/**
 * Tries each model in order. A model that fails with an HTTP error, timeout or network error is skipped for a while;
 * a bad or empty reply just moves on to the next model. Throws the last error when every model failed.
 */
export class FallbackClient implements LlmClient {
  private readonly coolUntil = new Map<string, number>();
  constructor(private readonly entries: FallbackEntry[], private readonly now: () => number = Date.now, private readonly onFallback?: (model: string, e: LlmError) => void) {}

  async json(req: LlmRequest): Promise<unknown> {
    const order = this.entries.slice();
    const preferred = order.findIndex((e) => e.model === req.model);
    if (preferred > 0) order.unshift(...order.splice(preferred, 1));
    const ready = order.filter((e) => (this.coolUntil.get(e.model) ?? 0) <= this.now());
    let last: unknown = new LlmError('no models configured', 'empty');
    for (const entry of ready.length ? ready : order) {
      try {
        return await entry.client.json({ ...req, model: entry.model });
      } catch (e) {
        last = e;
        if (e instanceof LlmError) {
          this.onFallback?.(entry.model, e);
          const cool = this.cooldownFor(e);
          if (cool > 0) this.coolUntil.set(entry.model, this.now() + cool);
        }
      }
    }
    throw last;
  }

  private cooldownFor(e: LlmError): number {
    if (e instanceof HttpStatusError) return e.status === 429 || e.status >= 500 ? COOLDOWN_SHORT_MS : COOLDOWN_LONG_MS;
    return e.code === 'timeout' || e.code === 'network' ? COOLDOWN_SHORT_MS : 0;
  }
}

/** One OpenAiCompatClient per configured model, wrapped so a failing model hands over to the next. */
export function buildLlm(
  env: { llmBaseUrl: string; llmApiKey: string; llmModels: string[]; disableThinking: boolean },
  onFallback?: (model: string, e: LlmError) => void,
): LlmClient {
  return new FallbackClient(env.llmModels.map((model) => ({
    model,
    client: new OpenAiCompatClient({ baseUrl: env.llmBaseUrl, apiKey: env.llmApiKey, model, disableThinking: env.disableThinking, retries: 0 }),
  })), Date.now, onFallback);
}
