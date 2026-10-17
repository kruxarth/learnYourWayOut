/** The HTTP API as a pure function (request in, response out), so tests need no sockets. index.ts adds node:http around it. */
import type { Difficulty } from '../src/game/types';
import type { PackCache } from './cache';
import type { ServerEnv } from './env';
import type { JobStore } from './jobs';
import type { LlmClient } from './llm/client';
import { checkTopicLength, generatePack, packKey, PackError } from './llm/pipeline';
import { checkTopic } from './llm/safety';
import type { RateLimiter } from './ratelimit';

export interface ApiDeps {
  env: Pick<ServerEnv, 'llmEnabled' | 'llmModel' | 'reviewModel'>;
  /** null when no LLM key is configured. */
  llm: LlmClient | null;
  /** A client that uses the player's own API key; null when the key is not one we recognise. Omitted in tests that don't use it. */
  clientForKey?: (apiKey: string) => LlmClient | null;
  cache: PackCache;
  jobs: JobStore;
  packLimiter: RateLimiter;
  pollLimiter: RateLimiter;
  now: () => Date;
  /** Appends one line to reports.jsonl. */
  appendReport: (line: string) => void;
  /** LAN addresses of this server for /api/health (F3). Omitted in tests. */
  lanUrls?: () => string[];
}

export interface ApiRequest { method: string; path: string; ip: string; body?: unknown }
export interface ApiResponse { status: number; body: unknown }

const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];
const REASONS = ['wrong', 'confusing', 'unsuitable'];
const reply = (status: number, body: unknown): ApiResponse => ({ status, body });

export function createApi(deps: ApiDeps) {
  const running = new Set<Promise<void>>();

  async function postPack(req: ApiRequest): Promise<ApiResponse> {
    const b = req.body;
    if (typeof b !== 'object' || b === null) return reply(400, { error: 'bad-request', message: 'Send { topic, level }.' });
    const { topic: rawTopic, level, apiKey } = b as { topic?: unknown; level?: unknown; apiKey?: unknown };
    if (typeof rawTopic !== 'string' || !LEVELS.includes(level as Difficulty)) {
      return reply(400, { error: 'bad-request', message: 'Send { topic: string, level: "easy" | "normal" | "hard" }.' });
    }
    let topic: string;
    try {
      topic = checkTopicLength(rawTopic);
    } catch (e) {
      if (e instanceof PackError) return reply(400, { error: e.code, message: e.message });
      throw e;
    }
    const lvl = level as Difficulty;
    const key = packKey(lvl, topic);

    const cached = deps.cache.get(key);
    if (cached) return reply(200, { pack: cached });
    // the player's own key (never logged or stored) replaces ours for this one pack
    const ownKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
    const llm = ownKey ? (deps.clientForKey?.(ownKey) ?? null) : deps.llm;
    if (ownKey && !llm) return reply(400, { error: 'bad-key', message: "That key isn't one I know. Use a Groq (gsk_…), OpenRouter (sk-or-…) or Cerebras (csk-…) key." });
    if (!llm) return reply(503, { error: 'llm-disabled', message: 'Any Topic is not set up on this server.' });
    const active = deps.jobs.findActive(key);
    if (active) return reply(202, { jobId: active.id });
    if (!deps.packLimiter.allow(req.ip)) {
      return reply(429, { error: 'rate-limited', message: 'Lots of new topics! Please wait a few minutes.' });
    }

    // the safety gate runs before any job starts, so unsafe topics get a 400 right away
    let gate;
    try {
      gate = await checkTopic(topic, llm);
    } catch {
      if (ownKey) return reply(400, { error: 'bad-key', message: "That API key didn't work, or its free limit is used up. Check it or try again later." });
      return reply(502, { error: 'llm-error', message: 'The question writer had a problem. Please try again.' });
    }
    if (gate.verdict !== 'ok') {
      const code = gate.verdict === 'unsafe' ? 'unsafe' : gate.verdict === 'too_broad' ? 'too-broad' : 'not-a-topic';
      const message = gate.verdict === 'unsafe' ? "Let's pick a different topic!"
        : gate.verdict === 'too_broad' ? 'That topic is too big. Pick a narrower one!'
        : "That doesn't look like something to learn about. Try a school subject!";
      return reply(400, { error: code, message, suggestions: gate.suggestions });
    }
    const cleanKey = packKey(lvl, gate.cleanTopic);
    const cleanHit = deps.cache.get(cleanKey);
    if (cleanHit) return reply(200, { pack: cleanHit });

    const job = deps.jobs.create(cleanKey);
    const p = (async () => {
      try {
        const pack = await generatePack(topic, lvl, llm, (stage, progress) => { job.stage = stage; job.progress = progress; }, {
          gated: gate, model: ownKey ? 'player-key' : deps.env.llmModel, reviewModel: deps.env.reviewModel, now: deps.now,
        });
        deps.cache.set(cleanKey, pack);
        job.pack = pack; job.stage = 'done'; job.progress = 1;
      } catch (e) {
        job.stage = 'failed';
        job.error = e instanceof PackError
          ? { code: e.code, message: e.message, ...(e.suggestions ? { suggestions: e.suggestions } : {}) }
          : { code: 'failed', message: 'Something went wrong. Please try again.' };
      }
    })();
    running.add(p);
    void p.finally(() => running.delete(p));
    return reply(202, { jobId: job.id });
  }

  function getJob(req: ApiRequest, id: string): ApiResponse {
    if (!deps.pollLimiter.allow(req.ip)) return reply(429, { error: 'rate-limited', message: 'Too many requests. Slow down a little.' });
    const job = deps.jobs.get(id);
    if (!job) return reply(404, { error: 'not-found', message: 'That job has expired. Start again.' });
    return reply(200, { stage: job.stage, progress: job.progress, ...(job.pack ? { pack: job.pack } : {}), ...(job.error ? { error: job.error } : {}) });
  }

  function postReport(req: ApiRequest): ApiResponse {
    const b = req.body as { packKey?: unknown; questionId?: unknown; reason?: unknown } | null;
    if (!b || typeof b.packKey !== 'string' || typeof b.questionId !== 'string' || typeof b.reason !== 'string' || !REASONS.includes(b.reason)
      || b.packKey.length > 200 || b.questionId.length > 80) {
      return reply(400, { error: 'bad-request', message: 'Send { packKey, questionId, reason }.' });
    }
    if (!deps.pollLimiter.allow(req.ip)) return reply(429, { error: 'rate-limited', message: 'Too many requests.' });
    deps.appendReport(JSON.stringify({ at: deps.now().toISOString(), packKey: b.packKey, questionId: b.questionId, reason: b.reason }));
    const result = deps.cache.removeQuestion(b.packKey, b.questionId);
    return reply(200, { ok: true, result });
  }

  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      const method = req.method.toUpperCase();
      try {
        if (method === 'GET' && req.path === '/api/health') return reply(200, { ok: true, llm: deps.env.llmEnabled && deps.llm !== null, ...(deps.lanUrls ? { lanUrls: deps.lanUrls() } : {}) });
        if (method === 'POST' && req.path === '/api/packs') return await postPack(req);
        const m = /^\/api\/packs\/jobs\/([A-Za-z0-9-]{1,64})$/.exec(req.path);
        if (method === 'GET' && m) return getJob(req, m[1]);
        if (method === 'POST' && req.path === '/api/reports') return postReport(req);
        return reply(404, { error: 'not-found', message: 'Unknown route.' });
      } catch {
        return reply(500, { error: 'server-error', message: 'Something went wrong on the server.' });
      }
    },
    /** Resolves when no job is running (tests). */
    async idle(): Promise<void> {
      while (running.size) await Promise.all([...running]);
    },
  };
}
