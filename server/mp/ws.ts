/** Wires the `ws` package to the pure Rooms machine on the existing http server, at path /ws. */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MSG_BYTES, parseClientMsg, type ServerMsg } from '../../src/net/protocol';
import { Rooms } from './rooms';

export const WS_PATH = '/ws';
/** `state` messages per second a socket may send; extras are dropped. */
export const STATE_PER_SEC = 15;
export const TICK_MS = 100;
const PING_MS = 15_000;

/** Token bucket with an injected clock. */
export class RateBucket {
  private tokens: number;
  private last: number;
  constructor(private perSec: number, private now: () => number) {
    this.tokens = perSec;
    this.last = now();
  }
  allow(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.perSec, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** http://192.168.1.20:8787 style URLs for the other laptops on the LAN. */
export function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
  }
  return out;
}

const secureRng = (): number => randomBytes(4).readUInt32LE() / 0x100000000;

interface Sock { ws: WebSocket; alive: boolean }

export interface Multiplayer { rooms: Rooms; close(): void }

export function attachMultiplayer(server: Server, now: () => number = Date.now): Multiplayer {
  const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: MAX_MSG_BYTES });
  const sockets = new Map<string, Sock>();
  const rooms = new Rooms({
    now, rng: secureRng,
    send: (id, msg: ServerMsg) => {
      const s = sockets.get(id);
      if (s && s.ws.readyState === s.ws.OPEN) s.ws.send(JSON.stringify(msg));
    },
    close: (id) => { sockets.get(id)?.ws.close(4000, 'replaced'); },
  });
  let n = 0;
  wss.on('connection', (ws) => {
    const id = `c${++n}`;
    const sock: Sock = { ws, alive: true };
    sockets.set(id, sock);
    rooms.connect(id);
    const bucket = new RateBucket(STATE_PER_SEC, now);
    ws.on('pong', () => { sock.alive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = parseClientMsg(data.toString('utf8'));
      if (!msg) return;
      if (msg.t === 'state' && !bucket.allow()) return;
      rooms.handle(id, msg);
    });
    ws.on('close', () => {
      sockets.delete(id);
      rooms.disconnect(id);
    });
    ws.on('error', () => { /* the close event follows */ });
  });
  const tick = setInterval(() => rooms.tick(), TICK_MS);
  const ping = setInterval(() => {
    for (const s of sockets.values()) {
      if (!s.alive) { s.ws.terminate(); continue; }
      s.alive = false;
      s.ws.ping();
    }
  }, PING_MS);
  return {
    rooms,
    close() {
      clearInterval(tick); clearInterval(ping);
      for (const s of sockets.values()) s.ws.terminate();
      wss.close();
    },
  };
}
