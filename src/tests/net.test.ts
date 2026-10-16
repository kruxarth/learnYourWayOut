import { describe, expect, it } from 'vitest';
import { Rooms, RULES } from '../../server/mp/rooms';
import { mulberry32 } from '../game/rng';
import { T } from '../game/tuning';
import type { RunResult } from '../game/types';
import { NetClient, median, wsUrl, type NetDeps, type NetEvents, type Timers, type Transport } from '../net/client';
import type { PlayerState, ServerMsg } from '../net/protocol';
import { createSession, remotes, useNet, type SessionDeps } from '../net/store';
import { sampleSnapshots } from '../net/interp';

/** A fake clock whose timers fire in order when you advance it. */
class FakeClock implements Timers {
  t = 1_000_000;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private n = 0;
  now = (): number => this.t;
  set(fn: () => void, ms: number): unknown { const id = ++this.n; this.q.push({ at: this.t + ms, fn, id }); return id; }
  clear(h: unknown): void { this.q = this.q.filter((x) => x.id !== h); }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
}

/** The server side: real Rooms, a server clock offset from the client clock, and in-memory transports with latency. */
function world(opts: { serverOffset?: number; latency?: (dir: 'up' | 'down') => number } = {}) {
  const clock = new FakeClock();
  const serverOffset = opts.serverOffset ?? 0;
  const latency = opts.latency ?? (() => 0);
  const conns = new Map<string, { onMsg: (s: string) => void; onClose: () => void; open: boolean }>();
  let n = 0;
  const rooms = new Rooms({
    now: () => clock.t + serverOffset, rng: mulberry32(5),
    send: (id, m) => {
      const c = conns.get(id);
      if (!c) return;
      const d = latency('down');
      if (d > 0) clock.set(() => { if (conns.get(id)?.open) c.onMsg(JSON.stringify(m)); }, d); else c.onMsg(JSON.stringify(m));
    },
    close: (id) => { dropConn(id); },
  });
  function dropConn(id: string): void {
    const c = conns.get(id);
    if (!c || !c.open) return;
    c.open = false;
    rooms.disconnect(id);
    c.onClose();
  }
  const refuse = { on: false };
  const connect = (): Transport => {
    const id = `c${++n}`;
    const c = { onMsg: (_s: string) => {}, onClose: () => {}, open: true };
    conns.set(id, c);
    if (refuse.on) { clock.set(() => dropConn(id), 0); return makeTp(id, c); }
    rooms.connect(id);
    return makeTp(id, c);
  };
  function makeTp(id: string, c: { onMsg: (s: string) => void; onClose: () => void; open: boolean }): Transport {
    return {
      send: (s) => {
        const d = latency('up');
        const go = () => { if (c.open) rooms.handle(id, JSON.parse(s)); };
        if (d > 0) clock.set(go, d); else go();
      },
      onMessage: (cb) => { c.onMsg = cb; },
      onClose: (cb) => { c.onClose = cb; },
      close: () => { if (c.open) { c.open = false; rooms.disconnect(id); } },
    };
  }
  /** Kill every open socket from the server side (a network drop). */
  const dropAll = () => { for (const id of [...conns.keys()]) dropConn(id); };
  const tickLoop = () => { rooms.tick(); clock.set(tickLoop, 100); };
  clock.set(tickLoop, 100);
  const store = (): { get(): string | null; set(t: string | null): void } => { let v: string | null = null; return { get: () => v, set: (t) => { v = t; } }; };
  const deps = (name: string): NetDeps => ({
    connect, now: clock.now, timers: clock, identity: () => ({ name, avatar: { v: 1 } }), tokens: store(),
  });
  return { clock, rooms, connect, deps, dropAll, refuse, serverOffset };
}

function client(w: ReturnType<typeof world>, name: string) {
  const msgs: ServerMsg[] = [];
  const statuses: string[] = [];
  const welcomes: { id: string; fresh: boolean }[] = [];
  const ev: Partial<NetEvents> = {
    message: (m) => msgs.push(m), status: (s) => statuses.push(s), welcome: (id, fresh) => welcomes.push({ id, fresh }),
  };
  const c = new NetClient(w.deps(name), ev);
  return { c, msgs, statuses, welcomes, last: <T2 extends ServerMsg['t']>(t: T2) => [...msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T2 }> | undefined };
}

describe('NetClient over the in-memory transport and rooms.ts', () => {
  it('two clients create, join, ready and get an identical start', () => {
    const w = world();
    const a = client(w, 'Ann'), b = client(w, 'Bob');
    a.c.open(); b.c.open();
    expect(a.c.status).toBe('online');
    a.c.create('math', 'normal');
    const code = a.last('lobby')!.code;
    expect(b.c.join(code.toLowerCase())).toBe(true);
    a.c.ready(true); b.c.ready(true);
    expect(b.last('lobby')!.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(a.c.start()).toBe(true);
    const sa = a.last('start')!, sb = b.last('start')!;
    expect(sa).toEqual(sb);
    expect(sa.startAt).toBe(w.clock.t + RULES.START_DELAY_MS);
  });

  it('relays states and finish between clients', () => {
    const w = world();
    const a = client(w, 'Ann'), b = client(w, 'Bob');
    a.c.open(); b.c.open();
    a.c.create('math', 'easy');
    b.c.join(a.last('lobby')!.code);
    a.c.start();
    w.clock.advance(RULES.START_DELAY_MS + 200);
    const st: PlayerState = { seq: 1, x: 3, y: 0, z: -4, f: 1, sp: 2, g: true, spin: 0, seg: 2, slime: 0.2, solved: 1, asked: 1, correct: 1, detour: false, bc: 0 };
    a.c.sendState(st);
    w.clock.advance(100);
    expect(b.last('states')!.s[0]).toMatchObject({ id: a.c.playerId, x: 3, z: -4, solved: 1 });
    a.c.finish('qualified', 61_234.4, 3, 10, 9);
    expect(b.last('finished')).toMatchObject({ id: a.c.playerId, place: 1 });
  });

  it('does not send before it is welcomed', () => {
    const w = world();
    const a = client(w, 'Ann');
    expect(a.c.create('math', 'easy')).toBe(false);
    expect(a.c.sendState({ seq: 1, x: 0, y: 0, z: 0, f: 0, sp: 0, g: true, spin: 0, seg: 0, slime: 0, solved: 0, asked: 0, correct: 0, detour: false, bc: 0 })).toBe(false);
  });
});

describe('time sync', () => {
  it('converges on the server offset with symmetric latency', () => {
    const w = world({ serverOffset: 7_345, latency: () => 20 });
    const a = client(w, 'Ann');
    a.c.open();
    expect(a.c.synced).toBe(false);
    w.clock.advance(T.NET_SYNC_PINGS * T.NET_SYNC_GAP_MS + 200);
    expect(a.c.synced).toBe(true);
    expect(Math.abs(a.c.offsetMs - 7_345)).toBeLessThanOrEqual(1);
    expect(a.c.rttMs).toBe(40);
    expect(Math.abs(a.c.serverNow() - (w.clock.t + 7_345))).toBeLessThanOrEqual(1);
  });

  it('the median shrugs off a laggy ping and keeps pinging every 5 s', () => {
    let i = 0;
    // the third round trip has a slow, lopsided uplink (+200 ms one way)
    const w = world({ serverOffset: -2_000, latency: (d) => (d === 'up' && ++i === 4 ? 220 : 20) });
    const a = client(w, 'Ann');
    a.c.open();
    w.clock.advance(1500);
    expect(Math.abs(a.c.offsetMs + 2_000)).toBeLessThanOrEqual(1);
    const before = a.c.rttMs;
    w.clock.advance(T.NET_PING_MS + 100);
    expect(a.c.rttMs).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });

  it('median helper', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('reconnect', () => {
  it('backs off 0.5, 1, 2 s, then resumes the same player and room', () => {
    const w = world();
    const a = client(w, 'Ann'), b = client(w, 'Bob');
    a.c.open(); b.c.open();
    a.c.create('math', 'normal');
    b.c.join(a.last('lobby')!.code);
    const id = b.c.playerId;
    w.refuse.on = true;
    w.dropAll();
    expect(b.c.status).toBe('reconnecting');
    // failed attempts back off 0.5, 1, 2, 4 s; the server is back before the 5th
    w.clock.advance(499);
    expect(b.c.status).toBe('reconnecting');
    w.clock.advance(1 + 1000 + 2000 + 4000);
    w.refuse.on = false;
    w.clock.advance(5000);
    expect(b.c.status).toBe('online');
    expect(b.c.playerId).toBe(id);
    expect(b.welcomes.at(-1)).toEqual({ id: id!, fresh: false });
    expect(b.last('lobby')!.players.find((p) => p.id === id)!.connected).toBe(true);
    expect(a.last('lobby')!.players.find((p) => p.id === id)!.connected).toBe(true);
  });

  it('gets a fresh session when the resume window has passed', () => {
    const w = world();
    const a = client(w, 'Ann'), b = client(w, 'Bob');
    a.c.open(); b.c.open();
    a.c.create('math', 'normal');
    b.c.join(a.last('lobby')!.code);
    const id = b.c.playerId;
    w.refuse.on = true;
    w.dropAll();
    w.clock.advance(RULES.RESUME_GRACE_MS + 1000);
    w.refuse.on = false;
    w.clock.advance(5000);
    expect(b.c.status).toBe('online');
    expect(b.c.playerId).not.toBe(id);
    expect(b.welcomes.at(-1)!.fresh).toBe(true);
  });

  it('reports failed when the very first connection never opens, and lost after too many retries', () => {
    const w = world();
    w.refuse.on = true;
    const a = client(w, 'Ann');
    a.c.open();
    w.clock.advance(10);
    expect(a.c.status).toBe('failed');

    w.refuse.on = false;
    const b = client(w, 'Bob');
    b.c.open();
    w.refuse.on = true;
    w.dropAll();
    w.clock.advance(T.NET_RECONNECT_TRIES * 5000);
    expect(b.c.status).toBe('lost');
  });

  it('close() stops reconnecting', () => {
    const w = world();
    const a = client(w, 'Ann');
    a.c.open();
    a.c.close();
    w.clock.advance(20_000);
    expect(a.c.status).toBe('offline');
  });
});

describe('wsUrl', () => {
  it('uses the page host, or VITE_SERVER_URL when set', () => {
    expect(wsUrl('', { protocol: 'http:', host: '192.168.1.20:8787' })).toBe('ws://192.168.1.20:8787/ws');
    expect(wsUrl('', { protocol: 'https:', host: 'game.example' })).toBe('wss://game.example/ws');
    expect(wsUrl('http://laptop:8787/', undefined)).toBe('ws://laptop:8787/ws');
    expect(wsUrl('https://srv.example', undefined)).toBe('wss://srv.example/ws');
  });
});

describe('session (useNet)', () => {
  function setupSession() {
    const w = world({ serverOffset: 1_500 });
    const started: Parameters<SessionDeps['startRace']>[0][] = [];
    let resultCb: ((r: RunResult) => void) | null = null;
    const snap: PlayerState = { seq: 0, x: 0, y: 0, z: 0, f: 0, sp: 0, g: true, spin: 0, seg: 0, slime: 0, solved: 0, asked: 0, correct: 0, detour: false, bc: 0 };
    let snapOn = false;
    const sess = createSession({
      ...w.deps('Ann'),
      startRace: (s) => { started.push(s); snapOn = true; return 12; },
      snapshot: () => { if (!snapOn) return null; snap.seq++; snap.x += 1; return snap; },
      onRunResult: (cb) => { resultCb = cb; return () => { resultCb = null; }; },
      fetchHealth: async () => ({ ok: true, lanUrls: ['http://192.168.1.20:8787'] }),
    });
    sess.resetForTests();
    return { w, sess, started, snap, result: (r: RunResult) => resultCb?.(r), hasResultCb: () => resultCb !== null };
  }

  it('walks the lobby, starts in sync, relays remote snapshots, and sends finish', async () => {
    const { w, sess, started, result, hasResultCb } = setupSession();
    expect(await sess.checkServer()).toBe(true);
    expect(useNet.getState().lanUrls).toEqual(['http://192.168.1.20:8787']);
    sess.connect();
    expect(useNet.getState().status).toBe('online');
    sess.createRace('science', 'hard');
    const room = useNet.getState().room!;
    expect(room).toMatchObject({ domainId: 'science', difficulty: 'hard' });
    expect(useNet.getState().meId).toBe(sess.client.playerId);

    const b = client(w, 'Bob');
    b.c.open();
    b.c.join(room.code);
    expect(useNet.getState().remoteIds).toEqual([b.c.playerId]);
    expect(remotes.get(b.c.playerId!)).toMatchObject({ name: 'Bob', buf: [] });

    w.clock.advance(T.NET_SYNC_PINGS * T.NET_SYNC_GAP_MS + 100); // time sync settles
    sess.startRace();
    expect(started).toHaveLength(1);
    const st = b.last('start')!;
    // countdownAt is the local moment of the 3-2-1, 2.4 s before GO at startAt
    expect(started[0].countdownAt).toBe(st.startAt - sess.client.offsetMs - 3 * T.COUNTDOWN_STEP * 1000);
    expect(Math.abs(sess.client.offsetMs - 1_500)).toBeLessThanOrEqual(1);
    expect(started[0]).toMatchObject({ seed: st.seed, domainId: 'science', difficulty: 'hard' });
    expect(useNet.getState()).toMatchObject({ racing: true, totalRooms: 12 });
    expect(hasResultCb()).toBe(true);

    // a duplicate start (resent after a reconnect) does not restart the run
    sess.client['ev'].message?.(st);
    expect(started).toHaveLength(1);

    // our own state goes out every 100 ms and reaches Bob; Bob's reaches our remotes map as Snapshots
    w.clock.advance(RULES.START_DELAY_MS + 600);
    expect(b.msgs.filter((m) => m.t === 'states').length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i <= 5; i++) {
      b.c.sendState({ seq: i, x: i, y: 0, z: -i, f: 0.5, sp: 3, g: true, spin: 0.25, seg: 1, slime: 0, solved: 2, asked: 3, correct: 2, detour: false, bc: 1 });
      w.clock.advance(100);
    }
    const buf = remotes.get(b.c.playerId!)!.buf;
    expect(buf).toHaveLength(5);
    expect(buf[0]).toMatchObject({ x: 1, z: -1, f: 0.5, sp: 3, g: true, spin: 0.25 });
    for (let i = 1; i < buf.length; i++) expect(buf[i].t).toBeGreaterThan(buf[i - 1].t);
    expect(remotes.get(b.c.playerId!)!.last).toMatchObject({ solved: 2, asked: 3 });
    // the source M3 renders from samples between the two newest snapshots
    expect(sess.source.ids()).toEqual([b.c.playerId]);
    const mid = (buf[3].t + buf[4].t) / 2;
    expect(sampleSnapshots(sess.source.buffer(b.c.playerId!), mid)!.x).toBeCloseTo(4.5, 5);

    // finishing sends `finish` once and stops the state timer
    result({
      outcome: 'qualified', selection: { domainId: 'science', difficulty: 'hard', seed: st.seed, mode: 'online' }, timeMs: 75_000, route: 'short',
      coinsCollected: 0, slimeAtEnd: 0, stars: 2, parMs: 1, mastery: [], weakConcepts: [], review: [],
      records: [{ isRetry: false, correctFirstTry: true }, { isRetry: false, correctFirstTry: false }, { isRetry: true, correctFirstTry: false }],
    } as unknown as RunResult);
    expect(b.last('finished')).toMatchObject({ id: sess.client.playerId, place: 1, outcome: 'qualified', timeMs: 75_000 });
    w.clock.advance(100);
    b.msgs.length = 0;
    w.clock.advance(500);
    expect(b.msgs.filter((m) => m.t === 'states')).toHaveLength(0);

    b.c.finish('eliminated', 50_000, 0, 5, 1);
    expect(useNet.getState().standings!.map((s) => s.name)).toEqual(['Ann', 'Bob']);
    expect(useNet.getState().racing).toBe(false);
    sess.resetForTests();
  });

  it('shows server errors and clears the room when the server forgot us', () => {
    const { w, sess } = setupSession();
    sess.connect();
    sess.joinRace('BCDF');
    expect(useNet.getState().error).toMatch(/No race/);
    sess.createRace('math', 'easy');
    expect(useNet.getState().room).not.toBeNull();
    w.refuse.on = true;
    w.dropAll();
    w.clock.advance(RULES.RESUME_GRACE_MS + 1000);
    w.refuse.on = false;
    w.clock.advance(5000);
    expect(useNet.getState().room).toBeNull();
    expect(useNet.getState().error).toMatch(/forgot/);
    sess.resetForTests();
  });
});
