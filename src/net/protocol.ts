// Multiplayer wire protocol (plan/F3_MULTIPLAYER.md §3). Pure TS, shared by the client and server/mp.
// Every incoming message goes through parseClientMsg / parseServerMsg; anything that fails is dropped (null).
import type { AvatarConfig } from '../game/avatar';
import type { DomainPack } from '../content/schema';
import type { Difficulty, DomainId } from '../game/types';

export const PROTOCOL_V = 1;
export const MAX_ROOM_PLAYERS = 8;
/** No vowels, so codes cannot spell words. */
export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 4;
export const MAX_MSG_BYTES = 256 * 1024;
export const MAX_PACK_JSON = 200 * 1024;
export const MAX_NAME_RAW = 64;
export const TOKEN_MAX = 64;
export const EMOTE_COUNT = 4;

export const DOMAIN_IDS: readonly DomainId[] = ['math', 'science', 'history', 'programming', 'custom'];
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export type RoomPhase = 'lobby' | 'countdown' | 'racing' | 'over';
export type Outcome = 'qualified' | 'eliminated';
export type FinalOutcome = Outcome | 'dnf';
export type ErrorCode = 'bad-code' | 'full' | 'started' | 'bad-name' | 'bad-pack' | 'version' | 'bad-request';

/** What a client reports about its own player, 10 times a second. */
export interface PlayerState {
  seq: number;
  x: number; y: number; z: number;
  /** Facing (yaw radians). */
  f: number;
  /** Horizontal speed (m/s). */
  sp: number;
  /** Grounded. */
  g: boolean;
  /** Spin progress 0..1, 0 when not spinning. */
  spin: number;
  /** Segment index. */
  seg: number;
  slime: number;
  /** Rooms resolved so far. */
  solved: number;
  asked: number;
  correct: number;
  detour: boolean;
  /** Current combo (M4 turns this into the Hot Streak award). */
  bc: number;
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; avatar: unknown; resumeToken?: string }
  | { t: 'create'; domainId: DomainId; difficulty: Difficulty; pack?: DomainPack }
  | { t: 'join'; code: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | ({ t: 'state' } & PlayerState)
  | { t: 'finish'; outcome: Outcome; timeMs: number; stars: number; asked: number; correct: number }
  | { t: 'emote'; id: number }
  | { t: 'ping'; c: number }
  | { t: 'leave' };

export interface LobbyPlayer { id: string; name: string; avatar: AvatarConfig; ready: boolean; connected: boolean }

export interface Standing {
  id: string;
  name: string;
  avatar: AvatarConfig;
  outcome: FinalOutcome;
  /** 1-based, qualified players first (by time), then the rest. */
  place: number;
  timeMs: number;
  stars: number;
  asked: number;
  correct: number;
  solved: number;
}

/** A relayed state. `at` is the server time (ms) the state arrived; the renderer uses it as the snapshot time. */
export type RelayedState = { id: string; at: number } & PlayerState;

export type ServerMsg =
  | { t: 'welcome'; playerId: string; resumeToken: string }
  | {
    t: 'lobby'; code: string; hostId: string; phase: RoomPhase; players: LobbyPlayer[];
    domainId: DomainId; difficulty: Difficulty; packName?: string;
  }
  /** `players` = how many racers the room had at the start; every client uses it to pick the same last room (3 or more play the Hex Finale). */
  | { t: 'start'; seed: number; domainId: DomainId; difficulty: Difficulty; pack?: DomainPack; startAt: number; players?: number }
  | { t: 'states'; s: RelayedState[] }
  | { t: 'finished'; id: string; place: number; outcome: Outcome; timeMs: number }
  | { t: 'raceOver'; standings: Standing[] }
  | { t: 'emote'; from: string; id: number }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: ErrorCode; message: string };

// ───────────────────────── guards ─────────────────────────

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const isInt = (x: unknown, lo: number, hi: number): x is number => isNum(x) && Number.isInteger(x) && x >= lo && x <= hi;

function decode(raw: unknown): Rec | null {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MSG_BYTES) return null;
    try { v = JSON.parse(raw); } catch { return null; }
  }
  return isRec(v) && typeof v.t === 'string' ? v : null;
}

export function isDomainId(x: unknown): x is DomainId { return typeof x === 'string' && (DOMAIN_IDS as readonly string[]).includes(x); }
export function isDifficulty(x: unknown): x is Difficulty { return typeof x === 'string' && (DIFFICULTIES as readonly string[]).includes(x); }

/** Upper-case a typed code and drop everything outside the alphabet. */
export function normalizeCode(s: string): string {
  return s.toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, CODE_LENGTH);
}
export function isRoomCode(s: unknown): s is string {
  return typeof s === 'string' && s.length === CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c));
}

const STATE_KEYS = ['x', 'y', 'z', 'f', 'sp', 'spin', 'slime'] as const;

export function parsePlayerState(m: Rec): PlayerState | null {
  for (const k of STATE_KEYS) if (!isNum(m[k])) return null;
  if (!isInt(m.seq, 0, 2 ** 31) || typeof m.g !== 'boolean' || typeof m.detour !== 'boolean') return null;
  if (!isInt(m.seg, 0, 999) || !isInt(m.solved, 0, 999) || !isInt(m.asked, 0, 9999) || !isInt(m.correct, 0, 9999)) return null;
  const bc = m.bc === undefined ? 0 : m.bc;
  if (!isInt(bc, 0, 9999)) return null;
  return {
    seq: m.seq, x: m.x as number, y: m.y as number, z: m.z as number, f: m.f as number, sp: m.sp as number, g: m.g,
    spin: m.spin as number, seg: m.seg, slime: m.slime as number, solved: m.solved, asked: m.asked, correct: m.correct,
    detour: m.detour, bc,
  };
}

export function parseClientMsg(raw: unknown): ClientMsg | null {
  const m = decode(raw);
  if (!m) return null;
  switch (m.t) {
    case 'hello':
      if (!isInt(m.v, 0, 1000) || !isStr(m.name, MAX_NAME_RAW)) return null;
      if (m.resumeToken !== undefined && !isStr(m.resumeToken, TOKEN_MAX)) return null;
      return { t: 'hello', v: m.v, name: m.name, avatar: m.avatar, resumeToken: m.resumeToken as string | undefined };
    case 'create': {
      if (!isDomainId(m.domainId) || !isDifficulty(m.difficulty)) return null;
      let pack: DomainPack | undefined;
      if (m.pack !== undefined) {
        if (!isRec(m.pack)) return null;
        // size check on the object form too (the whole message is already capped when it came in as a string)
        try { if (JSON.stringify(m.pack).length > MAX_PACK_JSON) return null; } catch { return null; }
        pack = m.pack as unknown as DomainPack;
      }
      return { t: 'create', domainId: m.domainId, difficulty: m.difficulty, pack };
    }
    case 'join':
      return isStr(m.code, 16) ? { t: 'join', code: m.code } : null;
    case 'ready':
      return typeof m.ready === 'boolean' ? { t: 'ready', ready: m.ready } : null;
    case 'start': return { t: 'start' };
    case 'state': {
      const s = parsePlayerState(m);
      return s ? { t: 'state', ...s } : null;
    }
    case 'finish':
      if ((m.outcome !== 'qualified' && m.outcome !== 'eliminated') || !isInt(m.timeMs, 0, 3_600_000)) return null;
      if (!isInt(m.stars, 0, 3) || !isInt(m.asked, 0, 9999) || !isInt(m.correct, 0, 9999)) return null;
      return { t: 'finish', outcome: m.outcome, timeMs: m.timeMs, stars: m.stars, asked: m.asked, correct: m.correct };
    case 'emote':
      return isInt(m.id, 0, EMOTE_COUNT - 1) ? { t: 'emote', id: m.id } : null;
    case 'ping':
      return isNum(m.c) ? { t: 'ping', c: m.c } : null;
    case 'leave': return { t: 'leave' };
    default: return null;
  }
}

const PHASES: readonly string[] = ['lobby', 'countdown', 'racing', 'over'];
const ERRORS: readonly string[] = ['bad-code', 'full', 'started', 'bad-name', 'bad-pack', 'version', 'bad-request'];

function isAvatarLike(x: unknown): x is AvatarConfig { return isRec(x) && x.v === 1; }

/** The client trusts the server's field types but not its shape: check enough that the UI cannot crash. */
export function parseServerMsg(raw: unknown): ServerMsg | null {
  const m = decode(raw);
  if (!m) return null;
  switch (m.t) {
    case 'welcome':
      return isStr(m.playerId, 64) && isStr(m.resumeToken, TOKEN_MAX) ? { t: 'welcome', playerId: m.playerId, resumeToken: m.resumeToken } : null;
    case 'lobby': {
      if (!isRoomCode(m.code) || !isStr(m.hostId, 64) || typeof m.phase !== 'string' || !PHASES.includes(m.phase)) return null;
      if (!isDomainId(m.domainId) || !isDifficulty(m.difficulty) || !Array.isArray(m.players) || m.players.length > MAX_ROOM_PLAYERS) return null;
      const players: LobbyPlayer[] = [];
      for (const p of m.players) {
        if (!isRec(p) || !isStr(p.id, 64) || !isStr(p.name, 64) || !isAvatarLike(p.avatar) || typeof p.ready !== 'boolean' || typeof p.connected !== 'boolean') return null;
        players.push({ id: p.id, name: p.name, avatar: p.avatar, ready: p.ready, connected: p.connected });
      }
      return {
        t: 'lobby', code: m.code, hostId: m.hostId, phase: m.phase as RoomPhase, players, domainId: m.domainId, difficulty: m.difficulty,
        packName: isStr(m.packName, 200) ? m.packName : undefined,
      };
    }
    case 'start':
      if (!isInt(m.seed, -(2 ** 31), 2 ** 32) || !isDomainId(m.domainId) || !isDifficulty(m.difficulty) || !isNum(m.startAt)) return null;
      if (m.pack !== undefined && !isRec(m.pack)) return null;
      if (m.players !== undefined && !isInt(m.players, 1, MAX_ROOM_PLAYERS)) return null;
      return {
        t: 'start', seed: m.seed, domainId: m.domainId, difficulty: m.difficulty, startAt: m.startAt, pack: m.pack as unknown as DomainPack | undefined,
        ...(m.players !== undefined ? { players: m.players } : {}),
      };
    case 'states': {
      if (!Array.isArray(m.s) || m.s.length > MAX_ROOM_PLAYERS) return null;
      const out: RelayedState[] = [];
      for (const e of m.s) {
        if (!isRec(e) || !isStr(e.id, 64) || !isNum(e.at)) return null;
        const st = parsePlayerState(e);
        if (!st) return null;
        out.push({ id: e.id, at: e.at, ...st });
      }
      return { t: 'states', s: out };
    }
    case 'finished':
      if (!isStr(m.id, 64) || !isInt(m.place, 0, 99) || (m.outcome !== 'qualified' && m.outcome !== 'eliminated') || !isNum(m.timeMs)) return null;
      return { t: 'finished', id: m.id, place: m.place, outcome: m.outcome, timeMs: m.timeMs };
    case 'raceOver': {
      if (!Array.isArray(m.standings) || m.standings.length > MAX_ROOM_PLAYERS) return null;
      const standings: Standing[] = [];
      for (const s of m.standings) {
        if (!isRec(s) || !isStr(s.id, 64) || !isStr(s.name, 64) || !isAvatarLike(s.avatar)) return null;
        if (s.outcome !== 'qualified' && s.outcome !== 'eliminated' && s.outcome !== 'dnf') return null;
        if (!isInt(s.place, 1, 99) || !isNum(s.timeMs) || !isInt(s.stars, 0, 3) || !isInt(s.asked, 0, 9999) || !isInt(s.correct, 0, 9999) || !isInt(s.solved, 0, 999)) return null;
        standings.push({
          id: s.id, name: s.name, avatar: s.avatar, outcome: s.outcome, place: s.place, timeMs: s.timeMs, stars: s.stars,
          asked: s.asked, correct: s.correct, solved: s.solved,
        });
      }
      return { t: 'raceOver', standings };
    }
    case 'emote':
      return isStr(m.from, 64) && isInt(m.id, 0, EMOTE_COUNT - 1) ? { t: 'emote', from: m.from, id: m.id } : null;
    case 'pong':
      return isNum(m.c) && isNum(m.s) ? { t: 'pong', c: m.c, s: m.s } : null;
    case 'error':
      return typeof m.code === 'string' && ERRORS.includes(m.code) && isStr(m.message, 300) ? { t: 'error', code: m.code as ErrorCode, message: m.message } : null;
    default: return null;
  }
}
