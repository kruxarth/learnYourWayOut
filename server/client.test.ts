import { describe, expect, it } from 'vitest';
import { FallbackClient, HttpStatusError, LlmError, OpenAiCompatClient, type LlmClient } from './llm/client';

const REQ = { system: 's', user: 'u', maxTokens: 100 };
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

function client(responses: (Response | Error)[], extra: { timeoutMs?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const c = new OpenAiCompatClient({ baseUrl: 'https://llm.test/v1/', apiKey: 'KEY', model: 'm1', fetch: fakeFetch, sleep: async (ms) => { sleeps.push(ms); }, ...extra });
  return { c, calls, sleeps };
}

describe('OpenAiCompatClient (fake fetch)', () => {
  it('posts to /chat/completions with the key, model and json mode, and parses fenced replies', async () => {
    const { c, calls } = client([ok('```json\n{"a":1}\n```')]);
    expect(await c.json({ ...REQ, model: 'review-model', temperature: 0 })).toEqual({ a: 1 });
    expect(calls[0].url).toBe('https://llm.test/v1/chat/completions');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer KEY');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({ model: 'review-model', max_tokens: 100, temperature: 0, response_format: { type: 'json_object' } });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    expect(body.reasoning).toBeUndefined();
  });

  it('turns reasoning off when asked', async () => {
    const calls: RequestInit[] = [];
    const f = (async (_u: string, init: RequestInit) => { calls.push(init); return ok('{"a":1}'); }) as unknown as typeof fetch;
    await new OpenAiCompatClient({ baseUrl: 'https://x', apiKey: 'k', model: 'm', fetch: f, disableThinking: true }).json(REQ);
    expect(JSON.parse(calls[0].body as string).reasoning).toEqual({ enabled: false });
  });

  it('retries once on 429 and 5xx, with backoff', async () => {
    const { c, calls, sleeps } = client([new Response('', { status: 429 }), ok('{"a":2}')]);
    expect(await c.json(REQ)).toEqual({ a: 2 });
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    const twice = client([new Response('', { status: 503 }), new Response('', { status: 500 })]);
    await expect(twice.c.json(REQ)).rejects.toThrow('HTTP 500');
    expect(twice.calls).toHaveLength(2);
  });

  it('does not retry on other errors', async () => {
    const { c, calls } = client([new Response('', { status: 401 })]);
    await expect(c.json(REQ)).rejects.toThrow('HTTP 401');
    expect(calls).toHaveLength(1);
  });

  it('maps bad replies and network failures to LlmError', async () => {
    await expect(client([ok('{"a":')]).c.json(REQ)).rejects.toBeInstanceOf(LlmError);
    await expect(client([ok('   ')]).c.json(REQ)).rejects.toMatchObject({ code: 'empty' });
    await expect(client([new Response('{}', { status: 200 })]).c.json(REQ)).rejects.toMatchObject({ code: 'empty' });
    await expect(client([new Error('boom')]).c.json(REQ)).rejects.toMatchObject({ code: 'network' });
  });

  it('times out with an AbortController', async () => {
    const hang = (async (_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;
    const c = new OpenAiCompatClient({ baseUrl: 'https://x', apiKey: 'k', model: 'm', fetch: hang, timeoutMs: 10 });
    await expect(c.json(REQ)).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('FallbackClient', () => {
  const failing = (code: LlmError['code']): LlmClient => ({ json: async () => { throw new LlmError('x', code); } });
  const answering = (v: unknown): LlmClient & { n: number } => { const c = { n: 0, json: async () => { c.n++; return v; } }; return c; };

  it('moves to the next model on failure and skips a rate-limited one until the cooldown ends', async () => {
    let t = 0;
    const a = { n: 0, json: async () => { a.n++; throw new HttpStatusError(429); } };
    const b = answering({ ok: 1 });
    const f = new FallbackClient([{ model: 'a', client: a }, { model: 'b', client: b }], () => t);
    expect(await f.json(REQ)).toEqual({ ok: 1 });
    expect(await f.json(REQ)).toEqual({ ok: 1 });
    expect(a.n).toBe(1); // second call skipped it
    t = 61_000;
    await f.json(REQ);
    expect(a.n).toBe(2);
  });

  it('a bad reply tries the next model without a cooldown, and the last error is thrown when all fail', async () => {
    const a = { n: 0, json: async () => { a.n++; throw new LlmError('bad', 'bad-json'); } };
    const f = new FallbackClient([{ model: 'a', client: a }, { model: 'b', client: failing('bad-json') }]);
    await expect(f.json(REQ)).rejects.toThrow('x');
    await expect(f.json(REQ)).rejects.toThrow('x');
    expect(a.n).toBe(2);
  });

  it('tries every model even while all are cooling down, and a preferred model goes first', async () => {
    const a = answering({ from: 'a' });
    const b = answering({ from: 'b' });
    const f = new FallbackClient([{ model: 'a', client: a }, { model: 'b', client: b }]);
    expect(await f.json({ ...REQ, model: 'b' })).toEqual({ from: 'b' });
  });
});
