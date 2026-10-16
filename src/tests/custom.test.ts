import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCustomPack, questionSource } from '../content/source';
import { EXAMPLE_PACKS } from '../content/examples';
import { validateDomainPack } from '../content/validate';
import { createCustomClient, TopicError } from '../content/customClient';
import { applyExcluded, excludeQuestion, excludedFor, loadRecent, removeRecent, saveRecent, RECENT_MAX } from '../content/customStore';
import { engine } from '../game/engine';
import { input } from '../game/input';
import { padUnderPlayer } from '../game/loop/selection';
import { teleport } from '../game/loop/navigation';
import { loadSave, loadSeen, recordRun, rememberSeen } from '../game/persistence';
import { G } from '../game/state';
import { useUI } from '../ui/store';
import { stageText } from '../ui/topicText';
import { playThrough } from './bot';
import { advance, finish } from './helpers';

afterEach(() => { finish(); vi.unstubAllGlobals(); });

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

describe('example packs', () => {
  for (const ex of EXAMPLE_PACKS) {
    it(`${ex.label} passes validateDomainPack and carries concept facts`, () => {
      expect(validateDomainPack(ex.pack)).toEqual([]);
      expect(ex.pack.id).toBe('custom');
      expect(ex.pack.concepts).toHaveLength(4);
      expect(ex.pack.concepts.every((c) => (c.facts?.length ?? 0) === 3)).toBe(true);
      expect(ex.pack.generated?.model).toBe('hand-written');
      expect(ex.pack.topic?.level).toBe(ex.level);
      expect(ex.pack.generated?.packKey).toBe(`${ex.level}:${ex.label.toLowerCase()}`);
    });
    for (const d of ['easy', 'normal', 'hard'] as const) {
      it(`${ex.label}: the bot qualifies as 'custom' on ${d}`, () => {
        setCustomPack(ex.pack);
        const res = playThrough(d, 77 + d.length, { domain: 'custom', keepAlive: true });
        expect(res.run.phase).toBe('won');
        expect(res.run.pack.id).toBe('custom');
        expect(res.run.usedQuestionIds.size).toBeGreaterThan(5);
      });
    }
  }

  it('setCustomPack validates, and the built-in domain list stays at four', () => {
    const bad = { ...EXAMPLE_PACKS[0].pack, questions: EXAMPLE_PACKS[0].pack.questions.slice(0, 5) };
    expect(() => setCustomPack(bad)).toThrow(/Invalid custom pack/);
    expect(questionSource.listDomains().map((d) => d.id)).toEqual(['math', 'science', 'history', 'programming']);
  });
});

describe('persistence skips custom packs', () => {
  it('no best times and no seen ids for custom', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    rememberSeen(['custom-rise-001', 'math-algebra-001']);
    expect([...loadSeen()]).toEqual(['math-algebra-001']);
    recordRun({
      outcome: 'qualified', selection: { domainId: 'custom', difficulty: 'easy', seed: 1 }, timeMs: 5000, parMs: 60000, route: null,
      coinsCollected: 0, slimeAtEnd: 0, stars: 1, records: [], mastery: [], weakConcepts: [], review: [],
    });
    const save = loadSave();
    expect(save.bestTimes.custom).toBeUndefined();
    expect(save.wins).toBe(1);
  });
});

describe('recent packs store', () => {
  it('keeps the newest 6, dedupes by key, and survives corrupt storage', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const base = EXAMPLE_PACKS[0].pack;
    for (let i = 0; i < 8; i++) saveRecent({ ...base, name: `T${i}`, generated: { ...base.generated!, packKey: `normal:t${i}` } });
    saveRecent({ ...base, name: 'T7 again', generated: { ...base.generated!, packKey: 'normal:t7' } });
    const r = loadRecent();
    expect(r).toHaveLength(RECENT_MAX);
    expect(r.map((p) => p.name)).toEqual(['T7 again', 'T6', 'T5', 'T4', 'T3', 'T2']);
    removeRecent('normal:t6');
    expect(loadRecent().some((p) => p.name === 'T6')).toBe(false);
    localStorage.setItem('lywo:packs:v1', '{not json');
    expect(loadRecent()).toEqual([]);
    localStorage.setItem('lywo:packs:v1', JSON.stringify({ recent: [{ id: 'custom', questions: [] }, 5, null] }));
    expect(loadRecent()).toEqual([]);
  });

  it('reported questions are excluded, unless that would break the quotas', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const pack = EXAMPLE_PACKS[0].pack;
    const key = pack.generated!.packKey;
    saveRecent(pack);
    const tf = pack.questions.find((q) => q.type === 'truefalse' && q.tier === 3)!;
    excludeQuestion(key, tf.id);
    expect(excludedFor(key)).toEqual([tf.id]);
    expect(loadRecent()[0].questions.some((q) => q.id === tf.id)).toBe(false);
    // the pack has exactly 4 orders: removing one would break the quota, so it stays
    const orders = pack.questions.filter((q) => q.type === 'order');
    expect(applyExcluded(pack, [orders[0].id]).questions.some((q) => q.id === orders[0].id)).toBe(true);
  });

  it('works with no localStorage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadRecent()).toEqual([]);
    expect(() => saveRecent(EXAMPLE_PACKS[0].pack)).not.toThrow();
  });
});

describe('customClient with a fake fetch', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const noSleep = async () => {};
  const pack = EXAMPLE_PACKS[1].pack;

  function make(responses: (Response | Error)[]) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift();
      if (!r) throw new Error('out of responses');
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch;
    return { client: createCustomClient({ baseUrl: 'http://srv', fetch: f, sleep: noSleep }), calls };
  }

  it('checkServer never throws', async () => {
    expect(await make([json(200, { ok: true, llm: true })]).client.checkServer()).toEqual({ ok: true, llm: true });
    expect(await make([json(200, { ok: true, llm: false })]).client.checkServer()).toEqual({ ok: true, llm: false });
    expect(await make([new TypeError('failed to fetch')]).client.checkServer()).toEqual({ ok: false, llm: false });
    expect(await make([json(500, {})]).client.checkServer()).toEqual({ ok: false, llm: false });
  });

  it('polls a job, reports progress and validates the pack', async () => {
    const { client, calls } = make([
      json(202, { jobId: 'j1' }),
      json(200, { stage: 'planning', progress: 0.12 }),
      json(200, { stage: 'writing', progress: 0.4 }),
      json(200, { stage: 'done', progress: 1, pack }),
    ]);
    const seen: [string, number][] = [];
    const got = await client.requestPack('Volcanoes', 'easy', (s, p) => seen.push([s, p]));
    expect(got.name).toBe('Volcanoes');
    expect(seen.map((x) => x[0])).toEqual(['checking', 'planning', 'writing', 'done']);
    expect(calls[0].url).toBe('http://srv/api/packs');
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ topic: 'Volcanoes', level: 'easy' });
    expect(calls[1].url).toBe('http://srv/api/packs/jobs/j1');
  });

  it('a cache hit returns the pack at once; a broken pack is rejected', async () => {
    expect((await make([json(200, { pack })]).client.requestPack('Volcanoes', 'easy')).id).toBe('custom');
    const broken = make([json(200, { pack: { ...pack, questions: [] } })]);
    await expect(broken.client.requestPack('Volcanoes', 'easy')).rejects.toMatchObject({ code: 'bad-pack' });
  });

  it('maps errors to friendly codes', async () => {
    await expect(make([new TypeError('x')]).client.requestPack('Volcanoes', 'easy')).rejects.toMatchObject({ code: 'server-down' });
    await expect(make([json(503, { error: 'llm-disabled' })]).client.requestPack('Volcanoes', 'easy')).rejects.toMatchObject({ code: 'llm-disabled' });
    await expect(make([json(429, { error: 'rate-limited', message: 'slow' })]).client.requestPack('Volcanoes', 'easy')).rejects.toMatchObject({ code: 'rate-limited', message: 'slow' });
    const unsafe = await make([json(400, { error: 'unsafe', message: 'no', suggestions: ['Volcanoes'] })]).client.requestPack('x y z', 'easy').catch((e) => e);
    expect(unsafe).toBeInstanceOf(TopicError);
    expect(unsafe).toMatchObject({ code: 'unsafe', suggestions: ['Volcanoes'] });
    await expect(make([json(400, { error: 'too-broad', suggestions: ['A', 'B', 'C'] })]).client.requestPack('science', 'easy')).rejects.toMatchObject({ code: 'too-broad', suggestions: ['A', 'B', 'C'] });
    const failed = make([json(202, { jobId: 'j' }), json(200, { stage: 'failed', progress: 0.5, error: { code: 'failed', message: 'Try a broader topic.' } })]);
    await expect(failed.client.requestPack('Volcanoes', 'easy')).rejects.toMatchObject({ code: 'failed', message: 'Try a broader topic.' });
    const expired = make([json(202, { jobId: 'j' }), json(404, { error: 'not-found', message: 'gone' })]);
    await expect(expired.client.requestPack('Volcanoes', 'easy')).rejects.toMatchObject({ code: 'expired' });
  });

  it('gives up after the max wait, and aborts cleanly', async () => {
    let t = 0;
    const f = (async (u: string) => (u.endsWith('/api/packs') ? json(202, { jobId: 'j' }) : json(200, { stage: 'writing', progress: 0.3 }))) as unknown as typeof fetch;
    const slow = createCustomClient({ fetch: f, sleep: async () => { t += 60_000; }, now: () => t, maxWaitMs: 150_000 });
    await expect(slow.requestPack('Volcanoes', 'easy')).rejects.toMatchObject({ code: 'timeout' });

    const ctrl = new AbortController();
    const aborting = createCustomClient({
      fetch: f,
      sleep: (_ms, signal) => new Promise((_res, rej) => { signal?.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' }))); }),
    });
    const p = aborting.requestPack('Volcanoes', 'easy', () => {}, ctrl.signal);
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reportQuestion posts the report and returns false on failure', async () => {
    const ok = make([json(200, { ok: true })]);
    expect(await ok.client.reportQuestion({ packKey: 'easy:volcanoes', questionId: 'custom-world-001', reason: 'wrong' })).toBe(true);
    expect(JSON.parse(ok.calls[0].init!.body as string)).toEqual({ packKey: 'easy:volcanoes', questionId: 'custom-world-001', reason: 'wrong' });
    expect(await make([new TypeError('x')]).client.reportQuestion({ packKey: 'a', questionId: 'b', reason: 'wrong' })).toBe(false);
  });

  it('stage text for the progress line', () => {
    expect(stageText('checking', 0)).toBe('Checking your topic…');
    expect(stageText('writing', 0.375)).toBe('Writing questions 2/4…');
    expect(stageText('reviewing', 0.8)).toBe('Double-checking answers…');
  });
});

describe('input ignores text fields', () => {
  it('keys typed into an input do not move the bean, but keys on the page do', () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    vi.stubGlobal('window', { addEventListener: (ev: string, fn: (e: unknown) => void) => { handlers[ev] = fn; } });
    input.init();
    const key = (code: string, target: unknown) => handlers.keydown({ code, target, repeat: false, preventDefault() {} });
    key('KeyW', { tagName: 'INPUT' });
    key('KeyA', { tagName: 'TEXTAREA' });
    key('KeyD', { tagName: 'DIV', isContentEditable: true });
    key('Space', { tagName: 'INPUT' });
    key('KeyP', { tagName: 'INPUT' });
    let s = input.poll();
    expect([s.moveX, s.moveY, s.jumpPressed, s.pausePressed]).toEqual([0, 0, false, false]);
    key('KeyW', { tagName: 'CANVAS' });
    s = input.poll();
    expect(s.moveY).toBe(1);
  });
});

describe('hub Any Topic pad', () => {
  it('opens the Topic panel instead of starting a run, and needs a step off before it fires again', () => {
    engine.startHub();
    const pad = engine.hub!.pads.find((p) => p.domainId === 'custom')!;
    teleport(G.player, pad.x, 0, pad.z);
    expect(padUnderPlayer(engine.hub!, pad.x, pad.z)).toBe(pad);
    advance(1.3);
    expect(useUI.getState().topicOpen).toBe(true);
    expect(useUI.getState().screen).toBe('hub');
    expect(G.run).toBeNull();
    // closing the panel while still on the pad does not reopen it
    useUI.setState({ topicOpen: false });
    advance(1.5);
    expect(useUI.getState().topicOpen).toBe(false);
    // stepping off and back on does
    teleport(G.player, 0, 0, 5);
    advance(0.3);
    teleport(G.player, pad.x, 0, pad.z);
    advance(1.3);
    expect(useUI.getState().topicOpen).toBe(true);
    useUI.setState({ topicOpen: false });
  });

  it('while the panel is open the game does not step', () => {
    engine.startHub();
    useUI.setState({ topicOpen: true });
    const z0 = G.player.pos.z;
    input.setTouchMove(0, 1);
    advance(0.5);
    expect(G.player.pos.z).toBe(z0);
    input.setTouchMove(0, 0);
    useUI.setState({ topicOpen: false });
  });
});
