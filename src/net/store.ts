// The multiplayer session: a NetClient plus the `useNet` zustand store (plan/F3 §5).
//
// Remote players live in the plain mutable `remotes` map, NOT in React state: the renderer reads it in `useFrame`
// (a third exception to ARCHITECTURE data-flow rule 6, next to Minimap and DebugOverlay). Each remote has `buf`,
// a time-sorted array of `Snapshot`s in server time (see src/net/interp.ts), so M3 can feed it straight to
// `sampleSnapshots(buf, net.client.serverNow() - T.INTERP_DELAY_MS)` or use `remoteSource` with `GhostPlayers`.
import { create } from 'zustand';
import type { DomainPack } from '../content/schema';
import { setCustomPack } from '../content/source';
import { DEFAULT_AVATAR, type AvatarConfig } from '../game/avatar';
import { engine } from '../game/engine';
import { T } from '../game/tuning';
import type { Difficulty, DomainId, RunResult } from '../game/types';
import { useUI } from '../ui/store';
import { NetClient, realTimers, webSocketTransport, wsUrl, type NetDeps, type NetStatus, type Timers } from './client';
import type { Snapshot, SnapshotSource } from './interp';
import { emoteReady, finaleFor, type RaceStat } from './race';
import { normalizeCode, type PlayerState, type RelayedState, type ServerMsg, type Standing } from './protocol';

export type LobbyInfo = Extract<ServerMsg, { t: 'lobby' }>;
export type StartInfo = Extract<ServerMsg, { t: 'start' }>;

export interface Remote {
  id: string;
  name: string;
  avatar: AvatarConfig;
  /** Time-sorted snapshots, `t` in server ms. Pruned to the last NET_BUFFER_MS. */
  buf: Snapshot[];
  /** The latest progress fields from the server (null until the first state arrives). */
  last: RelayedState | null;
  connected: boolean;
}

/** Remote players by id. Mutated in place by the net layer; read by the renderer each frame. Never contains the local player. */
export const remotes = new Map<string, Remote>();

/** The newest emote per remote player id (`at` in local ms); the renderer shows it for EMOTE_SHOW_MS. */
export const emotes = new Map<string, { id: number; at: number }>();

/** My own progress, written by the send tick for the RaceStrip (plain object, like `remotes`). */
export const localProgress = { solved: 0, seg: 0 };

export interface Finish { place: number; outcome: 'qualified' | 'eliminated'; timeMs: number }

export interface NetState {
  status: NetStatus;
  /** null while the health check runs. */
  serverUp: boolean | null;
  lanUrls: string[];
  error: string | null;
  meId: string | null;
  room: LobbyInfo | null;
  /** Ids of the remote players, in lobby order. Changes only when someone joins or leaves (safe to subscribe to). */
  remoteIds: string[];
  /** A race is running (from `start` until `raceOver`). */
  racing: boolean;
  /** Rooms in the local course (same for everyone). */
  totalRooms: number;
  /** Finished players by id (including me). */
  finishes: Record<string, Finish>;
  standings: Standing[] | null;
  /** The newest emote; M4 shows it above the sender. */
  lastEmote: { from: string; id: number; n: number } | null;
  /** My own last emote (the server does not echo it back). */
  myEmote: { id: number; n: number; at: number } | null;
  /** Best combo and detours per player id, tracked from the state feed (awards). */
  stats: Record<string, RaceStat>;
}

const initialNet: NetState = {
  status: 'offline', serverUp: null, lanUrls: [], error: null, meId: null, room: null, remoteIds: [], racing: false,
  totalRooms: 0, finishes: {}, standings: null, lastEmote: null, myEmote: null, stats: {},
};

export const useNet = create<NetState>(() => ({ ...initialNet }));

export interface SessionDeps extends NetDeps {
  /** Start the local run. Returns the number of rooms in the course. */
  startRace: (s: { seed: number; domainId: DomainId; difficulty: Difficulty; pack?: DomainPack; countdownAt: number; players?: number }) => number;
  /** The local player's state, or null when there is no online run. May return a shared object. */
  snapshot: () => PlayerState | null;
  /** Subscribe to finished runs. Returns an unsubscribe function. */
  onRunResult: (cb: (r: RunResult) => void) => () => void;
  fetchHealth: () => Promise<{ ok: boolean; lanUrls: string[] }>;
}

const set = (p: Partial<NetState>): void => useNet.setState(p);
const EMPTY_BUF: Snapshot[] = [];

export function createSession(deps: SessionDeps) {
  const timers: Timers = deps.timers;
  let sendTimer: unknown = null;
  let started: { seed: number; startAt: number } | null = null;
  let offResult: (() => void) | null = null;
  let emoteN = 0;
  let lastEmoteAt: number | null = null;
  const tally = new Map<string, RaceStat & { inDetour: boolean }>();
  function track(id: string, bc: number, detour: boolean): void {
    let t = tally.get(id);
    if (!t) { t = { bestCombo: 0, detours: 0, inDetour: false }; tally.set(id, t); }
    if (bc > t.bestCombo) t.bestCombo = bc;
    if (t.inDetour && !detour) t.detours++;
    t.inDetour = detour;
  }
  function tallyStats(): Record<string, RaceStat> {
    const out: Record<string, RaceStat> = {};
    for (const [id, t] of tally) out[id] = { bestCombo: t.bestCombo, detours: t.detours };
    return out;
  }
  const listeners = new Set<() => void>();
  const fire = () => { for (const l of listeners) l(); };

  const client = new NetClient(deps, {
    status: (status) => {
      set({ status });
      if (status === 'failed') set({ error: 'Could not reach the game server.' });
      if (status === 'lost') { clearRoom(); set({ error: 'Lost the connection to the server.' }); }
    },
    welcome: (id, fresh) => {
      set({ meId: id, error: null });
      if (fresh) { clearRoom(); set({ error: 'The server forgot your race, so you left it.' }); }
    },
    message: onMessage,
  });

  function clearRoom(): void {
    stopSending();
    started = null;
    remotes.clear();
    emotes.clear();
    tally.clear();
    set({ room: null, stats: {}, myEmote: null, remoteIds: [], racing: false, finishes: {}, standings: null, totalRooms: 0 });
    fire();
  }

  function stopSending(): void {
    if (sendTimer !== null) timers.clear(sendTimer);
    sendTimer = null;
    offResult?.();
    offResult = null;
  }

  function startSending(): void {
    stopSending();
    const tick = () => {
      const s = deps.snapshot();
      if (s) {
        client.sendState(s);
        localProgress.solved = s.solved; localProgress.seg = s.seg;
        if (client.playerId) track(client.playerId, s.bc, s.detour);
      }
      sendTimer = timers.set(tick, T.NET_SEND_MS);
    };
    sendTimer = timers.set(tick, T.NET_SEND_MS);
    offResult = deps.onRunResult((r) => {
      if (r.selection.mode !== 'online') return;
      let asked = 0, correct = 0;
      for (const rec of r.records) if (!rec.isRetry) { asked++; if (rec.correctFirstTry) correct++; }
      client.finish(r.outcome, r.timeMs, r.stars, asked, correct);
      stopSending();
    });
  }

  function syncRemotes(lobby: LobbyInfo): void {
    const me = client.playerId;
    const ids: string[] = [];
    for (const p of lobby.players) {
      if (p.id === me) continue;
      ids.push(p.id);
      const r = remotes.get(p.id);
      if (r) { r.name = p.name; r.avatar = p.avatar; r.connected = p.connected; } else {
        remotes.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, buf: [], last: null, connected: p.connected });
      }
    }
    for (const id of [...remotes.keys()]) if (!ids.includes(id)) remotes.delete(id);
    const prev = useNet.getState().remoteIds;
    if (prev.length !== ids.length || prev.some((x, i) => x !== ids[i])) { set({ remoteIds: ids }); fire(); }
  }

  function onStates(list: RelayedState[]): void {
    for (const e of list) {
      const r = remotes.get(e.id);
      if (!r) continue;
      const last = r.buf[r.buf.length - 1];
      if (last && e.at <= last.t) continue; // out of order
      r.buf.push({ t: e.at, x: e.x, y: e.y, z: e.z, f: e.f, sp: e.sp, g: e.g, spin: e.spin > 0 ? e.spin : undefined });
      let drop = 0;
      while (drop < r.buf.length - 2 && r.buf[drop].t < e.at - T.NET_BUFFER_MS) drop++;
      if (drop) r.buf.splice(0, drop);
      r.last = e;
      track(e.id, e.bc, e.detour);
    }
  }

  function onStart(m: StartInfo): void {
    if (started && started.startAt === m.startAt && started.seed === m.seed) return; // resent after a reconnect
    started = { seed: m.seed, startAt: m.startAt };
    for (const r of remotes.values()) { r.buf.length = 0; r.last = null; }
    tally.clear();
    localProgress.solved = 0; localProgress.seg = 0;
    set({ stats: {}, myEmote: null, racing: true, finishes: {}, standings: null, error: null });
    const countdownAt = m.startAt - client.offsetMs - 3 * T.COUNTDOWN_STEP * 1000;
    let totalRooms: number;
    try {
      totalRooms = deps.startRace({ seed: m.seed, domainId: m.domainId, difficulty: m.difficulty, pack: m.pack, countdownAt, players: m.players });
    } catch {
      // e.g. the pack in `start` did not validate
      set({ racing: false, error: 'Could not start the race on this laptop.' });
      return;
    }
    set({ totalRooms });
    startSending();
  }

  function onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'lobby':
        set({ room: m });
        syncRemotes(m);
        break;
      case 'start': onStart(m); break;
      case 'states': onStates(m.s); break;
      case 'finished':
        set({ finishes: { ...useNet.getState().finishes, [m.id]: { place: m.place, outcome: m.outcome, timeMs: m.timeMs } } });
        break;
      case 'raceOver':
        stopSending();
        set({ standings: m.standings, racing: false, stats: tallyStats() });
        break;
      case 'emote': emotes.set(m.from, { id: m.id, at: deps.now() }); set({ lastEmote: { from: m.from, id: m.id, n: ++emoteN } }); break;
      case 'error':
        set({ error: m.message });
        if (m.code === 'version' || m.code === 'bad-name') client.close();
        break;
      default: break;
    }
  }

  const source: SnapshotSource = {
    ids: () => useNet.getState().remoteIds,
    buffer: (id) => remotes.get(id)?.buf ?? EMPTY_BUF,
    renderTime: () => client.serverNow() - T.INTERP_DELAY_MS,
    config: (id) => remotes.get(id)?.avatar ?? DEFAULT_AVATAR,
    subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };

  return {
    client,
    /** What `GhostPlayers` (or M3's `RemotePlayers`) draws: the other players, 150 ms in the past. */
    source,

    /** Ask the server if it is up (and for its LAN addresses). Never throws. */
    async checkServer(): Promise<boolean> {
      set({ serverUp: null });
      try {
        const h = await deps.fetchHealth();
        set({ serverUp: h.ok, lanUrls: h.lanUrls });
        return h.ok;
      } catch {
        set({ serverUp: false });
        return false;
      }
    },
    /** Connect (idempotent). */
    connect(): void { set({ error: null }); client.open(); },
    createRace(domainId: DomainId, difficulty: Difficulty, pack?: DomainPack): void {
      set({ error: null, standings: null });
      client.create(domainId, difficulty, pack);
    },
    joinRace(code: string): void { set({ error: null, standings: null }); client.join(normalizeCode(code)); },
    setReady(ready: boolean): void { client.ready(ready); },
    startRace(): void { client.start(); },
    /** Send an emote (3 s client cooldown). Returns whether it was sent. */
    emote(id: number): boolean {
      const now = deps.now();
      if (!emoteReady(lastEmoteAt, now) || !client.emote(id)) return false;
      lastEmoteAt = now;
      set({ myEmote: { id, n: ++emoteN, at: now } });
      return true;
    },
    /** Leave the room (the connection stays open for a new one). */
    leaveRoom(): void {
      client.leave();
      clearRoom();
    },
    /** Leave the room and close the connection. */
    disconnect(): void {
      if (client.status === 'online') client.leave();
      clearRoom();
      client.close();
      set({ error: null });
    },
    resetForTests(): void {
      stopSending();
      client.close();
      remotes.clear();
      tally.clear();
      lastEmoteAt = null;
      started = null;
      useNet.setState({ ...initialNet });
    },
  };
}

// ───────────── the real session ─────────────

const TOKEN_KEY = 'lywo:net:token';
const tokens = {
  get(): string | null { try { return globalThis.sessionStorage?.getItem(TOKEN_KEY) ?? null; } catch { return null; } },
  set(t: string | null): void { try { if (t) globalThis.sessionStorage?.setItem(TOKEN_KEY, t); else globalThis.sessionStorage?.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

async function fetchHealth(): Promise<{ ok: boolean; lanUrls: string[] }> {
  const base = import.meta.env?.VITE_SERVER_URL ?? '';
  const res = await fetch(`${base}/api/health`);
  const body: unknown = await res.json();
  const b = (typeof body === 'object' && body !== null ? body : {}) as { ok?: unknown; lanUrls?: unknown };
  const lanUrls = Array.isArray(b.lanUrls) ? b.lanUrls.filter((u): u is string => typeof u === 'string').slice(0, 6) : [];
  return { ok: res.ok && b.ok === true, lanUrls };
}

export const net = createSession({
  connect: () => webSocketTransport(wsUrl()),
  now: () => Date.now(),
  timers: realTimers,
  identity: () => {
    const s = useUI.getState();
    return { name: s.playerName ?? 'Player', avatar: s.avatar };
  },
  tokens,
  startRace: ({ seed, domainId, difficulty, pack, countdownAt, players }) => {
    if (pack) setCustomPack(pack);
    useUI.setState({ lobbyOpen: false });
    engine.startRun({ domainId, difficulty, seed, mode: 'online', finale: finaleFor(players) }, { countdownAt });
    return engine.run?.rooms.length ?? 0;
  },
  snapshot: () => engine.netSnapshot(),
  onRunResult: (cb) => engine.events.on((e) => { if (e.type === 'runResult') cb(e.result); }),
  fetchHealth,
});
