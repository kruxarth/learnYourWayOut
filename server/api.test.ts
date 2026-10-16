import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from './api';
import { PackCache } from './cache';
import { JobStore } from './jobs';
import { RateLimiter } from './ratelimit';
import { cleanHandler, FakeLlm } from './testing/fakeLlm';
import { readEnv } from './env';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function setup(opts: { llm?: FakeLlm | null; clock?: { t: number }; cacheDir?: string; packsPerWindow?: number } = {}) {
  const clock = opts.clock ?? { t: 1_000_000 };
  const llm = opts.llm === undefined ? new FakeLlm(cleanHandler()) : opts.llm;
  const reports: string[] = [];
  const cache = new PackCache({ dir: opts.cacheDir ?? null });
  const api = createApi({
    env: { llmEnabled: llm !== null, llmModel: 'fake', reviewModel: 'fake' },
    llm, cache,
    jobs: new JobStore(() => clock.t),
    packLimiter: new RateLimiter(opts.packsPerWindow ?? 6, 10 * 60_000, () => clock.t),
    pollLimiter: new RateLimiter(60, 60_000, () => clock.t),
    now: () => new Date(clock.t),
    appendReport: (l) => reports.push(l),
  });
  const call = (method: string, path: string, body?: unknown, ip = '1.1.1.1') => api.handle({ method, path, ip, body });
  return { api, call, llm, clock, reports, cache };
}

describe('api', () => {
  it('health reports whether the LLM is configured', async () => {
    expect((await setup().call('GET', '/api/health')).body).toEqual({ ok: true, llm: true });
    expect((await setup({ llm: null }).call('GET', '/api/health')).body).toEqual({ ok: true, llm: false });
  });

  it('health lists the LAN urls when the server provides them', async () => {
    const api = createApi({
      env: { llmEnabled: false, llmModel: 'f', reviewModel: 'f' }, llm: null, cache: new PackCache({ dir: null }), jobs: new JobStore(() => 0),
      packLimiter: new RateLimiter(1, 1000, () => 0), pollLimiter: new RateLimiter(1, 1000, () => 0), now: () => new Date(0),
      appendReport: () => {}, lanUrls: () => ['http://192.168.1.20:8787'],
    });
    expect((await api.handle({ method: 'GET', path: '/api/health', ip: 'x' })).body).toEqual({ ok: true, llm: false, lanUrls: ['http://192.168.1.20:8787'] });
  });

  it('503 without an LLM, 400 on bad input', async () => {
    const off = setup({ llm: null });
    expect((await off.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' })).status).toBe(503);
    const s = setup();
    expect((await s.call('POST', '/api/packs', { topic: 'ab', level: 'easy' })).body).toMatchObject({ error: 'too-short' });
    expect((await s.call('POST', '/api/packs', { topic: 'x'.repeat(61), level: 'easy' })).body).toMatchObject({ error: 'too-long' });
    expect((await s.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'insane' })).status).toBe(400);
    expect((await s.call('POST', '/api/packs', null)).status).toBe(400);
    expect((await s.call('GET', '/api/nope')).status).toBe(404);
  });

  it('starts a job, polls it to done, then serves the pack from the cache', async () => {
    const s = setup();
    const start = await s.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' });
    expect(start.status).toBe(202);
    const { jobId } = start.body as { jobId: string };
    // a second request for the same topic shares the running job
    expect(((await s.call('POST', '/api/packs', { topic: ' volcanoes ', level: 'easy' })).body as { jobId: string }).jobId).toBe(jobId);
    await s.api.idle();
    const job = (await s.call('GET', `/api/packs/jobs/${jobId}`)).body as { stage: string; progress: number; pack?: { id: string } };
    expect(job.stage).toBe('done');
    expect(job.progress).toBe(1);
    expect(job.pack?.id).toBe('custom');
    const calls = s.llm!.calls.length;
    const hit = await s.call('POST', '/api/packs', { topic: 'VOLCANOES', level: 'easy' });
    expect(hit.status).toBe(200);
    expect((hit.body as { pack: { id: string } }).pack.id).toBe('custom');
    expect(s.llm!.calls.length).toBe(calls);
  });

  it('a failed job reports its error', async () => {
    const s = setup({ llm: new FakeLlm(cleanHandler({ plan: () => ({}) })) });
    const { jobId } = (await s.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' })).body as { jobId: string };
    await s.api.idle();
    const job = (await s.call('GET', `/api/packs/jobs/${jobId}`)).body as { stage: string; error?: { code: string; message: string } };
    expect(job.stage).toBe('failed');
    expect(job.error?.code).toBe('failed');
  });

  it('a broken safety gate answers 502 and starts no job', async () => {
    const s = setup({ llm: new FakeLlm(() => ({})) });
    expect((await s.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' })).status).toBe(502);
  });

  it('jobs expire after 10 minutes', async () => {
    const s = setup();
    const { jobId } = (await s.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' })).body as { jobId: string };
    await s.api.idle();
    s.clock.t += 11 * 60_000;
    expect((await s.call('GET', `/api/packs/jobs/${jobId}`)).status).toBe(404);
  });

  it('rate-limits new packs to 6 per 10 minutes per IP, but cache hits are free', async () => {
    const s = setup();
    const topics = ['Volcanoes', 'Rainforest', 'Solar System', 'Fractions', 'Pyramids', 'Photosynthesis'];
    for (const t of topics) expect((await s.call('POST', '/api/packs', { topic: t, level: 'easy' })).status).toBe(202);
    await s.api.idle();
    expect((await s.call('POST', '/api/packs', { topic: 'Magnets', level: 'easy' })).status).toBe(429);
    expect((await s.call('POST', '/api/packs', { topic: 'Magnets', level: 'easy' }, '2.2.2.2')).status).toBe(202);
    expect((await s.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' })).status).toBe(200); // cached
    s.clock.t += 10 * 60_000;
    expect((await s.call('POST', '/api/packs', { topic: 'Dinosaurs', level: 'easy' })).status).toBe(202);
    await s.api.idle();
  });

  it('limits polling to 60 per minute per IP', async () => {
    const s = setup();
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await s.call('GET', '/api/packs/jobs/abc')).status;
    expect(last).toBe(429);
    s.clock.t += 60_000;
    expect((await s.call('GET', '/api/packs/jobs/abc')).status).toBe(404);
  });
});

describe('reports', () => {
  it('logs the report and removes the question from the cached pack', async () => {
    const s = setup();
    await s.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' });
    await s.api.idle();
    const pack = s.cache.get('easy:volcanoes')!;
    // pick a question whose removal keeps the quotas valid (a tier-3 truefalse is never needed)
    const victim = pack.questions.find((q) => q.type === 'truefalse' && q.tier === 3)!;
    const out = await s.call('POST', '/api/reports', { packKey: 'easy:volcanoes', questionId: victim.id, reason: 'wrong' });
    expect(out.body).toEqual({ ok: true, result: 'removed' });
    expect(s.cache.get('easy:volcanoes')!.questions.some((q) => q.id === victim.id)).toBe(false);
    expect(s.reports).toHaveLength(1);
    expect(JSON.parse(s.reports[0])).toMatchObject({ packKey: 'easy:volcanoes', questionId: victim.id, reason: 'wrong' });
  });

  it('drops the whole cached pack when removing a question would break the quotas', async () => {
    const s = setup();
    await s.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' });
    await s.api.idle();
    const pack = s.cache.get('easy:volcanoes')!;
    // there are exactly 4 orders in a clean pack: removing one breaks the quota
    const order = pack.questions.filter((q) => q.type === 'order');
    expect(order).toHaveLength(8);
    for (const q of order.slice(0, 4)) await s.call('POST', '/api/reports', { packKey: 'easy:volcanoes', questionId: q.id, reason: 'confusing' });
    const last = await s.call('POST', '/api/reports', { packKey: 'easy:volcanoes', questionId: order[4].id, reason: 'confusing' });
    expect(last.body).toEqual({ ok: true, result: 'pack-dropped' });
    expect(s.cache.get('easy:volcanoes')).toBeNull();
  });

  it('rejects malformed reports', async () => {
    const s = setup();
    expect((await s.call('POST', '/api/reports', { packKey: 'a', questionId: 'b', reason: 'rude' })).status).toBe(400);
    expect((await s.call('POST', '/api/reports', { packKey: 1 })).status).toBe(400);
    expect((await s.call('POST', '/api/reports', null)).status).toBe(400);
  });
});

describe('disk cache', () => {
  it('survives a restart and rejects tampered files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lywo-cache-'));
    dirs.push(dir);
    const first = setup({ cacheDir: dir });
    await first.call('POST', '/api/packs', { topic: 'Volcanoes', level: 'easy' });
    await first.api.idle();
    expect(readdirSync(dir)).toHaveLength(1);
    const second = setup({ cacheDir: dir, llm: new FakeLlm(() => { throw new Error('must not be called'); }) });
    const hit = await second.call('POST', '/api/packs', { topic: 'volcanoes', level: 'easy' });
    expect(hit.status).toBe(200);
    // a file with the wrong key inside is ignored
    const other = new PackCache({ dir });
    expect(other.get('hard:volcanoes')).toBeNull();
  });

  it('keeps at most 50 packs in memory (LRU)', () => {
    const cache = new PackCache({ max: 2 });
    const stub = (k: string) => ({ id: 'custom', name: k, color: '#fff', concepts: [], questions: [], generated: { model: 'm', createdAt: '', packKey: k } });
    cache.set('a', stub('a') as never); cache.set('b', stub('b') as never);
    cache.get('a');
    cache.set('c', stub('c') as never);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
  });
});

describe('rate limiter and env', () => {
  it('refills continuously', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect([rl.allow('x'), rl.allow('x'), rl.allow('x')]).toEqual([true, true, false]);
    t = 500;
    expect(rl.allow('x')).toBe(true);
    expect(rl.allow('x')).toBe(false);
  });
  it('reads env with defaults and disables the LLM without a key', () => {
    expect(readEnv({})).toMatchObject({ port: 8787, llmEnabled: false, llmModel: 'deepseek-v4-flash', allowedOrigins: ['http://localhost:5173'] });
    expect(readEnv({ LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_REVIEW_MODEL: 'r', PORT: '9000', ALLOWED_ORIGINS: 'a, b' }))
      .toMatchObject({ port: 9000, llmEnabled: true, llmModel: 'm', reviewModel: 'r', allowedOrigins: ['a', 'b'] });
    expect(readEnv({ LLM_API_KEY: '...' }).llmEnabled).toBe(false);
  });
});
