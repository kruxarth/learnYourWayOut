/**
 * Multiplayer rooms as a pure state machine (plan/F3_MULTIPLAYER.md §4): no sockets, no timers.
 * The caller feeds it parsed messages (`handle`), socket events (`connect`/`disconnect`) and a clock tick (`tick`),
 * and gets replies through the injected `send`. `now` and `rng` are injected, so tests are deterministic.
 */
import type { DomainPack } from '../../src/content/schema';
import { validateDomainPack } from '../../src/content/validate';
import { sanitizeAvatar, type AvatarConfig } from '../../src/game/avatar';
import { cleanName, nameError } from '../../src/game/names';
import type { Difficulty, DomainId } from '../../src/game/types';
import {
  CODE_ALPHABET, CODE_LENGTH, MAX_ROOM_PLAYERS, PROTOCOL_V, isRoomCode, normalizeCode,
  type ClientMsg, type ErrorCode, type FinalOutcome, type PlayerState, type RelayedState, type RoomPhase, type ServerMsg, type Standing,
} from '../../src/net/protocol';

export const RULES = {
  /** A disconnected player keeps their slot this long and can resume with their token. */
  RESUME_GRACE_MS: 30_000,
  /** A room with nobody connected is deleted after this long. */
  EMPTY_ROOM_MS: 60_000,
  /** The race ends this long after the first qualifier; whoever is still running gets DNF. */
  RACE_TIMEOUT_MS: 180_000,
  /** `start.startAt` is this far in the future so every laptop has time to build the course. */
  START_DELAY_MS: 4000,
  /** Light sanity check, not anti-cheat: a qualified finish faster than this is ignored. */
  MIN_QUALIFY_MS: 15_000,
} as const;

export interface RoomsDeps {
  now: () => number;
  /** [0, 1). */
  rng: () => number;
  send: (connId: string, msg: ServerMsg) => void;
  /** Close a connection (a second tab took over the session). Optional. */
  close?: (connId: string) => void;
}

interface Fin { outcome: 'qualified' | 'eliminated'; timeMs: number; stars: number; asked: number; correct: number }

interface Player {
  id: string;
  token: string;
  name: string;
  avatar: AvatarConfig;
  ready: boolean;
  connId: string | null;
  joinedAt: number;
  disconnectedAt: number | null;
  /** Left on purpose during a race, or the resume window ran out. Counts as done (DNF unless it finished). */
  left: boolean;
  state: PlayerState | null;
  stateAt: number;
  dirty: boolean;
  fin: Fin | null;
  room: Room | null;
}

interface Room {
  code: string;
  hostId: string;
  phase: RoomPhase;
  domainId: DomainId;
  difficulty: Difficulty;
  pack: DomainPack | null;
  players: Player[];
  seed: number;
  startAt: number;
  /** Racers at the start; sent in `start` so every client picks the same last room. */
  startPlayers: number;
  firstQualifiedAt: number | null;
  qualifiedCount: number;
  emptySince: number | null;
}

interface Conn { id: string; player: Player | null }

export class Rooms {
  private rooms = new Map<string, Room>();
  private byToken = new Map<string, Player>();
  private conns = new Map<string, Conn>();
  private counter = 0;

  private deps: RoomsDeps;

  constructor(deps: RoomsDeps) {
    this.deps = deps;
  }

  // ───────────── introspection (tests, health) ─────────────
  roomCount(): number { return this.rooms.size; }
  hasRoom(code: string): boolean { return this.rooms.has(code); }
  roomPhase(code: string): RoomPhase | null { return this.rooms.get(code)?.phase ?? null; }

  // ───────────── connection events ─────────────
  connect(connId: string): void {
    this.conns.set(connId, { id: connId, player: null });
  }

  disconnect(connId: string): void {
    const c = this.conns.get(connId);
    this.conns.delete(connId);
    const p = c?.player;
    if (!p || p.connId !== connId) return; // already replaced by a newer connection
    p.connId = null;
    p.disconnectedAt = this.deps.now();
    const room = p.room;
    if (!room) { this.forget(p); return; }
    this.migrateHost(room);
    this.broadcastLobby(room);
  }

  // ───────────── messages ─────────────
  handle(connId: string, msg: ClientMsg): void {
    const c = this.conns.get(connId);
    if (!c) return;
    if (msg.t === 'ping') { this.deps.send(connId, { t: 'pong', c: msg.c, s: this.deps.now() }); return; }
    if (msg.t === 'hello') { this.onHello(c, msg); return; }
    const p = c.player;
    if (!p) return; // must say hello first
    switch (msg.t) {
      case 'create': this.onCreate(c, p, msg); break;
      case 'join': this.onJoin(c, p, msg.code); break;
      case 'ready': this.onReady(p, msg.ready); break;
      case 'start': this.onStart(p); break;
      case 'state': this.onState(p, msg); break;
      case 'finish': this.onFinish(p, msg); break;
      case 'emote': this.onEmote(p, msg.id); break;
      case 'leave': this.onLeave(p); break;
      default: break;
    }
  }

  private err(connId: string, code: ErrorCode, message: string): void {
    this.deps.send(connId, { t: 'error', code, message });
  }

  private onHello(c: Conn, m: Extract<ClientMsg, { t: 'hello' }>): void {
    if (m.v !== PROTOCOL_V) { this.err(c.id, 'version', 'This game version does not match the server. Refresh the page.'); return; }
    const name = cleanName(m.name);
    if (!name.ok) { this.err(c.id, 'bad-name', nameError(name.reason)); return; }
    const avatar = sanitizeAvatar(m.avatar);
    const old = m.resumeToken ? this.byToken.get(m.resumeToken) : undefined;
    let p: Player;
    if (old && !old.left) {
      // resume: take over the slot (also when the old socket is still half-open)
      p = old;
      if (p.connId && p.connId !== c.id) {
        const prev = this.conns.get(p.connId);
        if (prev) prev.player = null;
        this.deps.close?.(p.connId);
      }
      p.connId = c.id;
      p.disconnectedAt = null;
      p.name = name.name; p.avatar = avatar;
    } else {
      p = {
        id: `p${++this.counter}`, token: this.makeToken(), name: name.name, avatar, ready: false, connId: c.id, joinedAt: this.deps.now(),
        disconnectedAt: null, left: false, state: null, stateAt: 0, dirty: false, fin: null, room: null,
      };
      this.byToken.set(p.token, p);
    }
    c.player = p;
    this.deps.send(c.id, { t: 'welcome', playerId: p.id, resumeToken: p.token });
    const room = p.room;
    if (room) {
      room.emptySince = null;
      if (room.phase === 'countdown' || room.phase === 'racing') this.sendStart(room, c.id);
      this.broadcastLobby(room);
    }
  }

  private makeToken(): string {
    let s = '';
    for (let i = 0; i < 4; i++) s += Math.floor(this.deps.rng() * 0x100000000).toString(36).padStart(7, '0');
    return `${s}${(++this.counter).toString(36)}`.slice(0, TOKEN_LEN);
  }

  private makeCode(): string {
    for (let tries = 0; tries < 500; tries++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(this.deps.rng() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('no free room code');
  }

  private onCreate(c: Conn, p: Player, m: Extract<ClientMsg, { t: 'create' }>): void {
    if (p.room) { this.err(c.id, 'bad-request', 'Leave your current room first.'); return; }
    let pack: DomainPack | null = null;
    if (m.domainId === 'custom') {
      if (!m.pack) { this.err(c.id, 'bad-pack', 'Pick a topic pack for this race.'); return; }
      let errs: string[];
      try { errs = validateDomainPack(m.pack); } catch { errs = ['unreadable']; }
      if (m.pack.id !== 'custom') errs.push('wrong id');
      if (errs.length) { this.err(c.id, 'bad-pack', 'That topic pack is not valid.'); return; }
      pack = m.pack;
    }
    const room: Room = {
      code: this.makeCode(), hostId: p.id, phase: 'lobby', domainId: m.domainId, difficulty: m.difficulty, pack, players: [],
      seed: 0, startAt: 0, startPlayers: 1, firstQualifiedAt: null, qualifiedCount: 0, emptySince: null,
    };
    this.rooms.set(room.code, room);
    this.addPlayer(room, p);
    this.broadcastLobby(room);
  }

  private addPlayer(room: Room, p: Player): void {
    room.players.push(p);
    p.room = room;
    p.ready = false; p.fin = null; p.state = null; p.dirty = false; p.left = false;
    p.joinedAt = this.deps.now();
  }

  private onJoin(c: Conn, p: Player, raw: string): void {
    if (p.room) { this.err(c.id, 'bad-request', 'Leave your current room first.'); return; }
    const code = normalizeCode(raw);
    const room = isRoomCode(code) ? this.rooms.get(code) : undefined;
    if (!room) { this.err(c.id, 'bad-code', 'No race with that code. Check the letters.'); return; }
    if (room.phase !== 'lobby') { this.err(c.id, 'started', 'That race has already started.'); return; }
    if (room.players.length >= MAX_ROOM_PLAYERS) { this.err(c.id, 'full', 'That race is full.'); return; }
    room.emptySince = null;
    this.addPlayer(room, p);
    this.broadcastLobby(room);
  }

  private onReady(p: Player, ready: boolean): void {
    const room = p.room;
    if (!room || room.phase !== 'lobby') return;
    p.ready = ready;
    this.broadcastLobby(room);
  }

  private onStart(p: Player): void {
    const room = p.room;
    if (!room || room.hostId !== p.id) return;
    if (room.phase !== 'lobby' && room.phase !== 'over') return;
    const again = room.phase === 'over';
    if (again) {
      // "Race again": drop whoever left or timed out, everyone else is auto-ready
      for (const q of room.players.filter((x) => x.left || x.connId === null)) { room.players = room.players.filter((x) => x !== q); this.detach(q); }
    }
    room.phase = 'countdown';
    room.seed = Math.floor(this.deps.rng() * 0x7fffffff);
    room.startAt = this.deps.now() + RULES.START_DELAY_MS;
    room.startPlayers = room.players.length;
    room.firstQualifiedAt = null;
    room.qualifiedCount = 0;
    for (const q of room.players) { q.fin = null; q.state = null; q.dirty = false; if (again) q.ready = true; }
    this.broadcastLobby(room);
    for (const q of room.players) if (q.connId) this.sendStart(room, q.connId);
  }

  private sendStart(room: Room, connId: string): void {
    this.deps.send(connId, {
      t: 'start', seed: room.seed, domainId: room.domainId, difficulty: room.difficulty, startAt: room.startAt, players: room.startPlayers,
      ...(room.pack ? { pack: room.pack } : {}),
    });
  }

  private onState(p: Player, s: PlayerState & { t: 'state' }): void {
    const room = p.room;
    if (!room || (room.phase !== 'racing' && room.phase !== 'countdown') || p.fin) return;
    const { t, ...rest } = s;
    void t;
    p.state = { ...rest, slime: clamp01(rest.slime), spin: clamp01(rest.spin) };
    p.stateAt = this.deps.now();
    p.dirty = true;
  }

  private onFinish(p: Player, m: Extract<ClientMsg, { t: 'finish' }>): void {
    const room = p.room;
    if (!room || room.phase !== 'racing' || p.fin) return;
    if (m.outcome === 'qualified' && m.timeMs < RULES.MIN_QUALIFY_MS) return;
    let place = 0;
    if (m.outcome === 'qualified') {
      place = ++room.qualifiedCount;
      if (room.firstQualifiedAt === null) room.firstQualifiedAt = this.deps.now();
    }
    p.fin = { outcome: m.outcome, timeMs: m.timeMs, stars: m.stars, asked: m.asked, correct: m.correct };
    this.broadcast(room, { t: 'finished', id: p.id, place, outcome: m.outcome, timeMs: m.timeMs });
    this.checkRaceEnd(room);
  }

  private onEmote(p: Player, id: number): void {
    const room = p.room;
    if (!room || room.phase === 'lobby') return;
    this.broadcast(room, { t: 'emote', from: p.id, id }, p);
  }

  private onLeave(p: Player): void {
    const room = p.room;
    if (!room) return;
    if (room.phase === 'racing' || room.phase === 'countdown') {
      // keep a record of the leaver so the standings show them as DNF; the session itself is free to join another room
      const rec: Player = { ...p, connId: null, left: true, room };
      room.players = room.players.map((x) => (x === p ? rec : x));
      this.detach(p, false);
      if (room.hostId === p.id) this.migrateHost(room);
      this.broadcastLobby(room);
      this.checkRaceEnd(room);
      return;
    }
    room.players = room.players.filter((x) => x !== p);
    this.detach(p, false);
    this.migrateHost(room);
    this.afterMembershipChange(room);
  }

  /** Take a player out of any room. `forgetToken` drops the session too (it can no longer resume). */
  private detach(p: Player, forgetToken = true): void {
    p.room = null; p.ready = false; p.fin = null; p.state = null; p.dirty = false;
    if (forgetToken) this.forget(p);
  }

  private forget(p: Player): void {
    if (this.byToken.get(p.token) === p) this.byToken.delete(p.token);
  }

  private afterMembershipChange(room: Room): void {
    if (room.players.length === 0) { this.rooms.delete(room.code); return; }
    this.broadcastLobby(room);
  }

  /** If the host is gone or disconnected, the longest-connected connected player takes over. */
  private migrateHost(room: Room): void {
    const host = room.players.find((q) => q.id === room.hostId);
    if (host && host.connId !== null && !host.left) return;
    const next = room.players
      .filter((q) => q.connId !== null && !q.left)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) room.hostId = next.id;
  }

  // ───────────── clock ─────────────
  /** Call every ~100 ms. Relays states, expires disconnected players, ends races, deletes empty rooms. */
  tick(): void {
    const now = this.deps.now();
    for (const room of [...this.rooms.values()]) {
      let changed = false;
      if (room.phase === 'countdown' && now >= room.startAt) { room.phase = 'racing'; changed = true; }
      // resume window ran out
      for (const q of [...room.players]) {
        if (q.connId !== null || q.left || q.disconnectedAt === null || now - q.disconnectedAt < RULES.RESUME_GRACE_MS) continue;
        changed = true;
        this.forget(q);
        if (room.phase === 'lobby' || room.phase === 'over') {
          room.players = room.players.filter((x) => x !== q);
          q.room = null;
        } else q.left = true;
      }
      if (changed) this.migrateHost(room);
      if (room.phase === 'racing') this.relay(room);
      if (changed) this.broadcastLobby(room);
      if (room.phase === 'racing') this.checkRaceEnd(room);
      // empty rooms
      if (room.players.length === 0) { this.rooms.delete(room.code); continue; }
      if (room.players.every((q) => q.connId === null)) {
        room.emptySince ??= now;
        if (now - room.emptySince >= RULES.EMPTY_ROOM_MS) {
          for (const q of room.players) this.forget(q);
          this.rooms.delete(room.code);
        }
      } else room.emptySince = null;
    }
  }

  private relay(room: Room): void {
    const batch: RelayedState[] = [];
    for (const q of room.players) {
      if (!q.dirty || !q.state) continue;
      q.dirty = false;
      batch.push({ id: q.id, at: q.stateAt, ...q.state });
    }
    if (batch.length === 0) return;
    for (const q of room.players) {
      if (!q.connId) continue;
      const mine = batch.filter((s) => s.id !== q.id);
      if (mine.length) this.deps.send(q.connId, { t: 'states', s: mine });
    }
  }

  private isDone(q: Player): boolean {
    return q.fin !== null || q.left;
  }

  private checkRaceEnd(room: Room): void {
    if (room.phase !== 'racing') return;
    const timedOut = room.firstQualifiedAt !== null && this.deps.now() - room.firstQualifiedAt >= RULES.RACE_TIMEOUT_MS;
    if (!timedOut && !room.players.every((q) => this.isDone(q))) return;
    room.phase = 'over';
    for (const q of room.players) q.ready = false;
    this.broadcast(room, { t: 'raceOver', standings: this.standings(room) });
    this.broadcastLobby(room);
  }

  private standings(room: Room): Standing[] {
    const rows = room.players.map((q) => ({
      q, outcome: (q.fin?.outcome ?? 'dnf') as FinalOutcome, timeMs: q.fin?.timeMs ?? 0, solved: q.state?.solved ?? 0,
      asked: q.fin?.asked ?? q.state?.asked ?? 0, correct: q.fin?.correct ?? q.state?.correct ?? 0,
    }));
    const acc = (r: { asked: number; correct: number }) => (r.asked ? r.correct / r.asked : 0);
    const rank = (o: FinalOutcome) => (o === 'qualified' ? 0 : o === 'eliminated' ? 1 : 2);
    rows.sort((a, b) => {
      if (rank(a.outcome) !== rank(b.outcome)) return rank(a.outcome) - rank(b.outcome);
      if (a.outcome === 'qualified') return a.timeMs - b.timeMs;
      return b.solved - a.solved || acc(b) - acc(a);
    });
    return rows.map((r, i) => ({
      id: r.q.id, name: r.q.name, avatar: r.q.avatar, outcome: r.outcome, place: i + 1, timeMs: r.timeMs, stars: r.q.fin?.stars ?? 0,
      asked: r.asked, correct: r.correct, solved: r.solved,
    }));
  }

  // ───────────── output ─────────────
  private lobbyMsg(room: Room): ServerMsg {
    return {
      t: 'lobby', code: room.code, hostId: room.hostId, phase: room.phase, domainId: room.domainId, difficulty: room.difficulty,
      players: room.players.filter((q) => !q.left).map((q) => ({ id: q.id, name: q.name, avatar: q.avatar, ready: q.ready, connected: q.connId !== null })),
      ...(room.pack ? { packName: room.pack.name } : {}),
    };
  }

  private broadcastLobby(room: Room): void {
    this.broadcast(room, this.lobbyMsg(room));
  }

  private broadcast(room: Room, msg: ServerMsg, except?: Player): void {
    for (const q of room.players) if (q.connId && q !== except) this.deps.send(q.connId, msg);
  }
}

const TOKEN_LEN = 32;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
