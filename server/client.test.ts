import { describe, expect, it } from 'vitest';
import { LlmError, OpenAiCompatClient } from './llm/client';

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
