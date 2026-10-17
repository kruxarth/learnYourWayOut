import type { Difficulty } from '../game/types';
import type { DomainPack } from './schema';
import { validateDomainPack } from './validate';

/** Talks to the game server for Any Topic. The browser never sees an LLM key: only the topic and level are sent. */

export type ReportReason = 'wrong' | 'confusing' | 'unsuitable';

export type TopicErrorCode =
  | 'server-down' | 'llm-disabled' | 'too-short' | 'too-long' | 'unsafe' | 'not-a-topic' | 'too-broad'
  | 'rate-limited' | 'failed' | 'expired' | 'timeout' | 'bad-pack';

export class TopicError extends Error {
  readonly code: TopicErrorCode;
  readonly suggestions: string[];
  constructor(code: TopicErrorCode, message: string, suggestions: string[] = []) {
    super(message);
    this.name = 'TopicError';
    this.code = code;
    this.suggestions = suggestions;
  }
}

export interface ServerStatus { ok: boolean; llm: boolean }
export type ProgressFn = (stage: string, progress: number) => void;

export interface ClientOptions {
  /** Empty means same origin (Vite proxies /api in dev). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Resolves after `ms`, or rejects with an AbortError when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  pollMs?: number;
  /** Give up polling after this long (the server caps a job at about 2 minutes). */
  maxWaitMs?: number;
  now?: () => number;
}

const SERVER_DOWN = 'Any Topic needs the game server. Try an example below!';

function abortError(): Error {
  return Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const id = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(id); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null;

export function createCustomClient(opts: ClientOptions = {}) {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '');
  const doFetch: typeof fetch = opts.fetch ?? ((...a) => fetch(...a));
  const sleep = opts.sleep ?? defaultSleep;
  const pollMs = opts.pollMs ?? 1000;
  const maxWaitMs = opts.maxWaitMs ?? 300_000;
  const now = opts.now ?? Date.now;

  async function call(path: string, init: RequestInit | undefined): Promise<{ status: number; body: Json }> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      throw new TopicError('server-down', SERVER_DOWN);
    }
    let body: Json = {};
    try {
      const parsed: unknown = await res.json();
      if (isObj(parsed)) body = parsed;
    } catch { /* an empty or non-JSON body: handled by status */ }
    return { status: res.status, body };
  }

  function errorFrom(status: number, body: Json): TopicError {
    const message = typeof body.message === 'string' ? body.message : 'Something went wrong. Please try again.';
    const suggestions = Array.isArray(body.suggestions) ? body.suggestions.filter((s): s is string => typeof s === 'string') : [];
    if (status === 503) return new TopicError('llm-disabled', SERVER_DOWN);
    if (status === 429) return new TopicError('rate-limited', message);
    if (status === 404) return new TopicError('expired', message);
    const code = body.error;
    const known: TopicErrorCode[] = ['too-short', 'too-long', 'unsafe', 'not-a-topic', 'too-broad', 'failed'];
    if (typeof code === 'string' && (known as string[]).includes(code)) return new TopicError(code as TopicErrorCode, message, suggestions);
    return new TopicError('failed', message, suggestions);
  }

  function checkedPack(raw: unknown): DomainPack {
    // never trust the network: the pack must pass the same validator as the built-in ones
    if (!isObj(raw) || !Array.isArray(raw.questions) || !Array.isArray(raw.concepts) || validateDomainPack(raw as unknown as DomainPack).length > 0) {
      throw new TopicError('bad-pack', 'The server sent a broken question set. Please try again.');
    }
    return raw as unknown as DomainPack;
  }

  return {
    /** Never throws: an unreachable server is `{ ok: false, llm: false }`. */
    async checkServer(signal?: AbortSignal): Promise<ServerStatus> {
      try {
        const { status, body } = await call('/api/health', { signal });
        return status === 200 && body.ok === true ? { ok: true, llm: body.llm === true } : { ok: false, llm: false };
      } catch {
        return { ok: false, llm: false };
      }
    },

    /** Starts a job (or gets a cached pack), then polls it once a second. Rejects with TopicError, or an AbortError if `signal` aborts. */
    async requestPack(topic: string, level: Difficulty, onProgress: ProgressFn = () => {}, signal?: AbortSignal): Promise<DomainPack> {
      onProgress('checking', 0);
      const start = await call('/api/packs', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic, level }), signal,
      });
      if (start.status === 200) { onProgress('done', 1); return checkedPack(start.body.pack); }
      if (start.status !== 202 || typeof start.body.jobId !== 'string') throw errorFrom(start.status, start.body);
      const jobId = encodeURIComponent(start.body.jobId);
      const t0 = now();
      for (;;) {
        await sleep(pollMs, signal);
        if (now() - t0 > maxWaitMs) throw new TopicError('timeout', 'That is taking too long. Please try again.');
        const r = await call(`/api/packs/jobs/${jobId}`, { signal });
        if (r.status !== 200) throw errorFrom(r.status, r.body);
        const stage = typeof r.body.stage === 'string' ? r.body.stage : 'writing';
        const progress = typeof r.body.progress === 'number' ? Math.max(0, Math.min(1, r.body.progress)) : 0;
        if (stage === 'failed') {
          const err = isObj(r.body.error) ? r.body.error : {};
          throw errorFrom(400, { error: err.code === 'failed' ? 'failed' : err.code, message: err.message, suggestions: err.suggestions });
        }
        onProgress(stage, progress);
        if (stage === 'done') return checkedPack(r.body.pack);
      }
    },

    /** Tells the server a question looks wrong. Best effort: returns false instead of throwing. */
    async reportQuestion(r: { packKey: string; questionId: string; reason: ReportReason }, signal?: AbortSignal): Promise<boolean> {
      try {
        const { status } = await call('/api/reports', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r), signal,
        });
        return status === 200;
      } catch {
        return false;
      }
    },
  };
}

export type CustomClient = ReturnType<typeof createCustomClient>;

/** The client the UI uses. `VITE_SERVER_URL` is empty by default (same origin / Vite proxy). */
export const customClient: CustomClient = createCustomClient({ baseUrl: import.meta.env?.VITE_SERVER_URL ?? '' });
