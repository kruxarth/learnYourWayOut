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
  /** Add `thinking: {type: "disabled"}` to every request (DeepSeek: reasoning would eat max_tokens). */
  disableThinking?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Posts to `${baseUrl}/chat/completions`. Works with DeepSeek, OpenCode Zen, OpenRouter and other compatible hosts. */
export class OpenAiCompatClient implements LlmClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  constructor(private readonly opts: OpenAiCompatOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? 45_000;
  }

  /** One retry, only on 429 and 5xx, after a short backoff. */
  async json(req: LlmRequest): Promise<unknown> {
    try {
      return await this.once(req);
    } catch (e) {
      if (!(e instanceof HttpStatusError) || !(e.status === 429 || e.status >= 500)) throw e;
      await this.sleep(1500);
      return this.once(req);
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
          ...(this.opts.disableThinking ? { thinking: { type: 'disabled' } } : {}),
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

class HttpStatusError extends LlmError {
  constructor(readonly status: number) {
    super(`HTTP ${status}`, 'http');
  }
}
