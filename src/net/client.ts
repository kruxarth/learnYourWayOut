// NetClient: the multiplayer connection, over an injectable Transport so tests need no sockets (plan/F3 §5).
// Time sync, hello/resume and reconnect live here; what to do with the messages is the caller's business (src/net/store.ts).
import type { DomainPack } from '../content/schema';
import { T } from '../game/tuning';
import type { Difficulty, DomainId } from '../game/types';
import {
  PROTOCOL_V, parseServerMsg, type ClientMsg, type PlayerState, type ServerMsg,
} from './protocol';

export interface Transport {
  send(s: string): void;
  onMessage(cb: (s: string) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 'failed': the first connection never opened (no server). 'lost': gave up reconnecting. */
export type NetStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'failed' | 'lost';

export interface NetDeps {
  /** Open a new transport. It buffers sends until the socket is open. */
  connect: () => Transport;
  /** Local wall clock in ms. */
  now: () => number;
  timers: Timers;
  /** Name and avatar for `hello`; read on every (re)connect. */
  identity: () => { name: string; avatar: unknown };
  tokens: { get(): string | null; set(token: string | null): void };
}

export interface NetEvents {
  status(s: NetStatus): void;
  /** `fresh` is true when this is a different session than before (the old room is gone). */
  welcome(playerId: string, fresh: boolean): void;
  message(m: ServerMsg): void;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class NetClient {
  status: NetStatus = 'offline';
  playerId: string | null = null;
  /** serverNow() = local now + offset. */
  offsetMs = 0;
  rttMs = 0;
  synced = false;

  private tp: Transport | null = null;
  private wanted = false;
  private welcomed = false;
  private attempt = 0;
  private samples: number[] = [];
  private timers: unknown[] = [];
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  /** Bumps on every connect so late events from an old transport are ignored. */
  private gen = 0;

  private deps: NetDeps;
  private ev: Partial<NetEvents>;

  constructor(deps: NetDeps, ev: Partial<NetEvents> = {}) {
    this.deps = deps;
    this.ev = ev;
  }

  serverNow(): number { return this.deps.now() + this.offsetMs; }

  // ───────────── connection ─────────────
  open(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.attempt = 0;
    this.playerId = null;
    this.dial('connecting');
  }

  /** Close for good (no reconnect). */
  close(): void {
    this.wanted = false;
    this.welcomed = false;
    this.clearTimers();
    this.gen++;
    const tp = this.tp;
    this.tp = null;
    tp?.close();
    this.setStatus('offline');
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.ev.status?.(s);
  }

  private dial(status: NetStatus): void {
    this.setStatus(status);
    const gen = ++this.gen;
    let tp: Transport;
    try { tp = this.deps.connect(); } catch { this.onDrop(gen); return; }
    this.tp = tp;
    tp.onMessage((s) => { if (gen === this.gen) this.onRaw(s); });
    tp.onClose(() => this.onDrop(gen));
    const id = this.deps.identity();
    this.rawSend({ t: 'hello', v: PROTOCOL_V, name: id.name, avatar: id.avatar, resumeToken: this.deps.tokens.get() ?? undefined });
  }

  private onDrop(gen: number): void {
    if (gen !== this.gen || !this.wanted) return;
    this.tp = null;
    this.clearTimers();
    if (!this.welcomed && this.status === 'connecting') { this.wanted = false; this.setStatus('failed'); return; }
    this.welcomed = false;
    if (this.attempt >= T.NET_RECONNECT_TRIES) { this.wanted = false; this.setStatus('lost'); return; }
    const delay = T.NET_BACKOFF_MS[Math.min(this.attempt, T.NET_BACKOFF_MS.length - 1)];
    this.attempt++;
    this.setStatus('reconnecting');
    this.retryTimer = this.deps.timers.set(() => { this.retryTimer = null; if (this.wanted) this.dial('reconnecting'); }, delay);
  }

  private clearTimers(): void {
    for (const h of this.timers) this.deps.timers.clear(h);
    this.timers = [];
    if (this.retryTimer !== null) this.deps.timers.clear(this.retryTimer);
    if (this.pingTimer !== null) this.deps.timers.clear(this.pingTimer);
    this.retryTimer = null; this.pingTimer = null;
  }

  // ───────────── incoming ─────────────
  private onRaw(raw: string): void {
    const m = parseServerMsg(raw);
    if (!m) return;
    switch (m.t) {
      case 'welcome': {
        const fresh = this.playerId !== null && this.playerId !== m.playerId;
        this.playerId = m.playerId;
        this.deps.tokens.set(m.resumeToken);
        this.welcomed = true;
        this.attempt = 0;
        this.setStatus('online');
        this.startSync();
        this.ev.welcome?.(m.playerId, fresh);
        return;
      }
      case 'pong': this.onPong(m.c, m.s); return;
      default: this.ev.message?.(m);
    }
  }

  // ───────────── time sync ─────────────
  private startSync(): void {
    this.samples = [];
    for (let i = 0; i < T.NET_SYNC_PINGS; i++) {
      this.timers.push(this.deps.timers.set(() => this.ping(), i * T.NET_SYNC_GAP_MS));
    }
    this.schedulePing();
  }

  private schedulePing(): void {
    if (this.pingTimer !== null) this.deps.timers.clear(this.pingTimer);
    this.pingTimer = this.deps.timers.set(() => { this.ping(); this.schedulePing(); }, T.NET_PING_MS);
  }

  private ping(): void {
    if (this.welcomed) this.rawSend({ t: 'ping', c: this.deps.now() });
  }

  private onPong(c: number, s: number): void {
    const t1 = this.deps.now();
    const rtt = t1 - c;
    if (rtt < 0) return;
    this.rttMs = rtt;
    this.samples.push(s - (c + rtt / 2));
    if (this.samples.length > T.NET_SAMPLES) this.samples.shift();
    this.offsetMs = median(this.samples);
    this.synced = true;
  }

  // ───────────── outgoing ─────────────
  private rawSend(m: ClientMsg): void {
    this.tp?.send(JSON.stringify(m));
  }

  private send(m: ClientMsg): boolean {
    if (!this.welcomed) return false;
    this.rawSend(m);
    return true;
  }

  create(domainId: DomainId, difficulty: Difficulty, pack?: DomainPack): boolean { return this.send({ t: 'create', domainId, difficulty, pack }); }
  join(code: string): boolean { return this.send({ t: 'join', code }); }
  ready(ready: boolean): boolean { return this.send({ t: 'ready', ready }); }
  start(): boolean { return this.send({ t: 'start' }); }
  sendState(s: PlayerState): boolean { return this.send({ t: 'state', ...s }); }
  finish(outcome: 'qualified' | 'eliminated', timeMs: number, stars: number, asked: number, correct: number): boolean {
    return this.send({ t: 'finish', outcome, timeMs: Math.round(timeMs), stars, asked, correct });
  }
  emote(id: number): boolean { return this.send({ t: 'emote', id }); }
  leave(): boolean { return this.send({ t: 'leave' }); }
}

// ───────────── real WebSocket transport ─────────────

/** The `/ws` URL for this page (same origin, or `VITE_SERVER_URL` when the game is hosted apart from the server). */
export function wsUrl(base: string = import.meta.env?.VITE_SERVER_URL ?? '', loc: { protocol: string; host: string } | undefined = typeof location !== 'undefined' ? location : undefined): string {
  if (base) return `${base.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws`;
  const secure = loc?.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${loc?.host ?? 'localhost:8787'}/ws`;
}

export function webSocketTransport(url: string = wsUrl()): Transport {
  const ws = new WebSocket(url);
  const queue: string[] = [];
  let open = false;
  let msgCb: (s: string) => void = () => {};
  let closeCb: () => void = () => {};
  ws.onopen = () => { open = true; for (const q of queue.splice(0)) ws.send(q); };
  ws.onmessage = (e) => { if (typeof e.data === 'string') msgCb(e.data); };
  ws.onclose = () => closeCb();
  ws.onerror = () => { /* onclose follows */ };
  return {
    send: (s) => { if (open) ws.send(s); else if (queue.length < 20) queue.push(s); },
    onMessage: (cb) => { msgCb = cb; },
    onClose: (cb) => { closeCb = cb; },
    close: () => { closeCb = () => {}; try { ws.close(); } catch { /* already closed */ } },
  };
}
