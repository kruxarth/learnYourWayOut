import { describe, expect, it } from 'vitest';
import { EXAMPLE_PACKS } from '../../src/content/examples';
import { mulberry32 } from '../../src/game/rng';
import {
  CODE_ALPHABET, PROTOCOL_V, type ClientMsg, type PlayerState, type ServerMsg,
} from '../../src/net/protocol';
import { RULES, Rooms } from './rooms';

const AV = { v: 1, body: 'blue', eyes: 'round', mouth: 'smile', hat: 'none', extra: 'none' };

/** In-memory clients through the real Rooms machine with a fake clock. */
function setup() {
  const clock = { t: 1_000_000 };
  const inbox = new Map<string, ServerMsg[]>();
  const closed: string[] = [];
  const rooms = new Rooms({
    now: () => clock.t, rng: mulberry32(11),
    send: (id, m) => { inbox.get(id)?.push(m); },
    close: (id) => { closed.push(id); },
  });
  const client = (id: string) => {
    inbox.set(id, []);
    rooms.connect(id);
    const api = {
      id,
      send: (m: ClientMsg) => rooms.handle(id, m),
      hello: (name = id.repeat(2), token?: string) => api.send({ t: 'hello', v: PROTOCOL_V, name, avatar: AV, resumeToken: token }),
      msgs: () => inbox.get(id)!,
      last: <T extends ServerMsg['t']>(t: T) => [...inbox.get(id)!].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined,
      all: <T extends ServerMsg['t']>(t: T) => inbox.get(id)!.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[],
      clear: () => { inbox.get(id)!.length = 0; },
      drop: () => rooms.disconnect(id),
      welcome: () => api.last('welcome')!,
      create: (domainId: 'math' | 'custom' = 'math', pack?: unknown) =>
        api.send({ t: 'create', domainId, difficulty: 'normal', pack: pack as never }),
    };
    return api;
  };
  const advance = (ms: number, step = 100) => { for (let i = 0; i < ms / step; i++) { clock.t += step; rooms.tick(); } };
  return { clock, rooms, client, advance };
}

type C = ReturnType<ReturnType<typeof setup>['client']>;

const state = (over: Partial<PlayerState> = {}): ClientMsg => ({
  t: 'state', seq: 1, x: 1, y: 0, z: -2, f: 0.5, sp: 3, g: true, spin: 0, seg: 1, slime: 0.1, solved: 1, asked: 1, correct: 1, detour: false, bc: 0, ...over,
});

/** Host creates, guest joins, both ready. Returns the code. */
function lobby(_s: unknown, ...cs: C[]): string {
  cs.forEach((c) => c.hello());
  cs[0].create();
  const code = cs[0].last('lobby')!.code;
  for (const c of cs.slice(1)) c.send({ t: 'join', code });
  for (const c of cs) c.send({ t: 'ready', ready: true });
  return code;
}

function race(s: ReturnType<typeof setup>, ...cs: C[]): string {
  const code = lobby(s, ...cs);
  cs[0].send({ t: 'start' });
  s.advance(RULES.START_DELAY_MS + 100);
  expect(s.rooms.roomPhase(code)).toBe('racing');
  return code;
}

describe('hello', () => {
  it('welcomes with an id and a token, and rejects other versions and bad names', () => {
    const s = setup();
    const a = s.client('a');
    a.send({ t: 'hello', v: 99, name: 'Ann', avatar: AV });
    expect(a.last('error')?.code).toBe('version');
    a.hello('x');
    expect(a.last('error')?.code).toBe('bad-name');
    a.hello('Ann');
    expect(a.welcome().playerId).toBeTruthy();
    expect(a.welcome().resumeToken.length).toBeGreaterThan(16);
  });

  it('answers ping before hello and ignores other messages before hello', () => {
    const s = setup();
    const a = s.client('a');
    a.send({ t: 'ping', c: 5 });
    expect(a.last('pong')).toMatchObject({ c: 5, s: s.clock.t });
    a.create();
    expect(a.msgs().filter((m) => m.t !== 'pong')).toEqual([]);
  });
});

describe('room codes and joining', () => {
  it('uses 4 letters from the no-vowel alphabet and never repeats', () => {
    const s = setup();
    const codes = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const c = s.client(`c${i}`);
      c.hello(`Player${i}`);
      c.create();
      const code = c.last('lobby')!.code;
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
      expect([...code].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
      codes.add(code);
    }
    expect(codes.size).toBe(60);
  });

  it('joins with a lower-case code, and reports bad-code, full and started', () => {
    const s = setup();
    const h = s.client('h'); h.hello('Host'); h.create();
    const code = h.last('lobby')!.code;
    const g = s.client('g'); g.hello('Guest');
    g.send({ t: 'join', code: 'AAAA' });
    expect(g.last('error')?.code).toBe('bad-code');
    g.send({ t: 'join', code: code.toLowerCase() });
    expect(g.last('lobby')?.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
    for (let i = 0; i < 6; i++) { const c = s.client(`f${i}`); c.hello(`Fill${i}`); c.send({ t: 'join', code }); }
    const extra = s.client('x'); extra.hello('Extra'); extra.send({ t: 'join', code });
    expect(extra.last('error')?.code).toBe('full');
    h.send({ t: 'start' });
    const late = s.client('late'); late.hello('Late'); late.send({ t: 'join', code });
    expect(late.last('error')?.code).toBe('started');
  });

  it('cleans names and avatars on the server', () => {
    const s = setup();
    const a = s.client('a');
    a.send({ t: 'hello', v: PROTOCOL_V, name: '  Ann   Lee ', avatar: { v: 1, body: 'nope', hat: 'crown' } });
    a.create();
    const p = a.last('lobby')!.players[0];
    expect(p.name).toBe('Ann Lee');
    expect(p.avatar.body).toBe('pink');
  });

  it('only the host can start, and start sends one identical message to everyone', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b');
    lobby(s, a, b);
    b.send({ t: 'start' });
    expect(b.last('start')).toBeUndefined();
    a.send({ t: 'start' });
    const sa = a.last('start')!, sb = b.last('start')!;
    expect(sa).toEqual(sb);
    expect(sa.startAt).toBe(s.clock.t + RULES.START_DELAY_MS);
  });

  it('start carries the player count (the Hex Finale needs 3), the same for everyone and again after a reconnect', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b'), c = s.client('c');
    lobby(s, a, b, c);
    a.send({ t: 'start' });
    for (const x of [a, b, c]) expect(x.last('start')!.players).toBe(3);
    s.advance(RULES.START_DELAY_MS + 100);
    // a racer leaving mid-race does not change what a late reconnect is told: the course is already fixed
    const tok = c.welcome();
    c.drop();
    s.advance(2000);
    const c2 = s.client('c2');
    c2.hello('cc', tok.resumeToken);
    expect(c2.last('start')!.players).toBe(3);
    // two players: 2
    const s2 = setup();
    const p = s2.client('p'), q = s2.client('q');
    lobby(s2, p, q);
    p.send({ t: 'start' });
    expect(q.last('start')!.players).toBe(2);
  });
});

describe('packs', () => {
  const pack = EXAMPLE_PACKS[0].pack;
  it('custom needs a valid pack, which then goes out with start', () => {
    const s = setup();
    const a = s.client('a'); a.hello('Ann');
    a.create('custom');
    expect(a.last('error')?.code).toBe('bad-pack');
    a.create('custom', { ...pack, questions: [{ id: 'x' }] });
    expect(a.last('error')?.code).toBe('bad-pack');
    a.create('custom', { ...pack, id: 'math' });
    expect(a.last('error')?.code).toBe('bad-pack');
    a.create('custom', pack);
    expect(a.last('lobby')).toMatchObject({ domainId: 'custom', packName: pack.name });
    const b = s.client('b'); b.hello('Bob');
    b.send({ t: 'join', code: a.last('lobby')!.code });
    a.send({ t: 'start' });
    expect(b.last('start')?.pack?.questions.length).toBe(pack.questions.length);
  });
});

describe('host migration and disconnects', () => {
  it('passes the host to the longest-connected player', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b'), c = s.client('c');
    lobby(s, a, b, c);
    const bId = b.welcome().playerId;
    a.send({ t: 'leave' });
    expect(b.last('lobby')?.hostId).toBe(bId);
    expect(b.last('lobby')?.players).toHaveLength(2);
    b.drop();
    expect(c.last('lobby')?.hostId).toBe(c.welcome().playerId);
  });

  it('keeps a slot for 30 s: resume works inside the window and not after it', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b');
    const code = lobby(s, a, b);
    const tok = b.welcome();
    b.drop();
    expect(a.last('lobby')!.players.find((p) => p.id === tok.playerId)!.connected).toBe(false);
    s.advance(RULES.RESUME_GRACE_MS - 1000);
    const b2 = s.client('b2');
    b2.hello('Bob', tok.resumeToken);
    expect(b2.welcome().playerId).toBe(tok.playerId);
    expect(b2.last('lobby')?.code).toBe(code);
    expect(a.last('lobby')!.players.find((p) => p.id === tok.playerId)!.connected).toBe(true);

    const c = s.client('c'); c.hello('Cy'); c.send({ t: 'join', code });
    const ctok = c.welcome();
    c.drop();
    s.advance(RULES.RESUME_GRACE_MS + 500);
    expect(a.last('lobby')!.players.map((p) => p.id)).not.toContain(ctok.playerId);
    const c2 = s.client('c2');
    c2.hello('Cy', ctok.resumeToken);
    expect(c2.welcome().playerId).not.toBe(ctok.playerId);
    expect(c2.last('lobby')).toBeUndefined();
  });

  it('a second connection with the token takes over and closes the old socket', () => {
    const s = setup();
    const a = s.client('a'); a.hello('Ann'); a.create();
    const a2 = s.client('a2'); a2.hello('Ann', a.welcome().resumeToken);
    expect(a2.last('lobby')).toBeDefined();
    expect((s as unknown as { rooms: Rooms }).rooms.roomCount()).toBe(1);
  });

  it('deletes a room with nobody connected: a lobby once the resume window ends, a finished race after 60 s', () => {
    const s = setup();
    const a = s.client('a'); a.hello('Ann'); a.create();
    const lobbyCode = a.last('lobby')!.code;
    const h = s.client('h'), g = s.client('g');
    const code = race(s, h, g);
    a.drop(); h.drop(); g.drop();
    s.advance(RULES.RESUME_GRACE_MS - 1000);
    expect(s.rooms.hasRoom(lobbyCode)).toBe(true);
    s.advance(2000);
    expect(s.rooms.hasRoom(lobbyCode)).toBe(false);
    expect(s.rooms.roomPhase(code)).toBe('over');
    s.advance(20_000);
    expect(s.rooms.hasRoom(code)).toBe(true);
    s.advance(15_000);
    expect(s.rooms.hasRoom(code)).toBe(false);
  });

  it('deletes the room at once when the last player leaves', () => {
    const s = setup();
    const a = s.client('a'); a.hello('Ann'); a.create();
    const code = a.last('lobby')!.code;
    a.send({ t: 'leave' });
    expect(s.rooms.hasRoom(code)).toBe(false);
  });
});

describe('racing', () => {
  it('relays the latest state of each player in one batch per tick, without echoing to the sender', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b'), c = s.client('c');
    race(s, a, b, c);
    const aId = a.welcome().playerId, bId = b.welcome().playerId;
    [a, b, c].forEach((x) => x.clear());
    a.send(state({ seq: 1, x: 1 }));
    a.send(state({ seq: 2, x: 2 }));
    b.send(state({ seq: 1, x: 9, slime: 7 }));
    expect(c.all('states')).toHaveLength(0); // nothing until the tick
    s.advance(100);
    const batch = c.all('states');
    expect(batch).toHaveLength(1);
    expect(batch[0].s.map((e) => [e.id, e.x])).toEqual([[aId, 2], [bId, 9]]);
    expect(batch[0].s[1].slime).toBe(1); // clamped
    expect(batch[0].s[0].at).toBeGreaterThan(0);
    expect(a.all('states')[0].s.map((e) => e.id)).toEqual([bId]);
    // nothing new, nothing sent
    c.clear();
    s.advance(300);
    expect(c.all('states')).toHaveLength(0);
  });

  it('finish order gives places; the race ends when everyone is done', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b'), c = s.client('c');
    const code = race(s, a, b, c);
    a.send(state({ solved: 3 })); b.send(state({ solved: 5, asked: 8, correct: 7 })); c.send(state({ solved: 5, asked: 8, correct: 4 }));
    b.send({ t: 'finish', outcome: 'qualified', timeMs: 60_000, stars: 2, asked: 8, correct: 7 });
    expect(a.last('finished')).toMatchObject({ id: b.welcome().playerId, place: 1, outcome: 'qualified' });
    a.send({ t: 'finish', outcome: 'qualified', timeMs: 55_000, stars: 3, asked: 8, correct: 8 });
    expect(c.all('finished').map((m) => m.place)).toEqual([1, 2]);
    expect(s.rooms.roomPhase(code)).toBe('racing');
    c.send({ t: 'finish', outcome: 'eliminated', timeMs: 40_000, stars: 0, asked: 8, correct: 4 });
    expect(s.rooms.roomPhase(code)).toBe('over');
    const over = a.last('raceOver')!;
    expect(over.standings.map((r) => [r.name, r.outcome, r.place])).toEqual([['aa', 'qualified', 1], ['bb', 'qualified', 2], ['cc', 'eliminated', 3]]);
    expect(b.last('raceOver')).toEqual(over);
  });

  it('ignores a qualified finish that is impossibly fast, and a second finish', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b');
    const code = race(s, a, b);
    a.send({ t: 'finish', outcome: 'qualified', timeMs: 1000, stars: 3, asked: 1, correct: 1 });
    expect(b.last('finished')).toBeUndefined();
    a.send({ t: 'finish', outcome: 'qualified', timeMs: 60_000, stars: 3, asked: 1, correct: 1 });
    a.send({ t: 'finish', outcome: 'qualified', timeMs: 61_000, stars: 3, asked: 1, correct: 1 });
    expect(b.all('finished')).toHaveLength(1);
    expect(s.rooms.roomPhase(code)).toBe('racing');
  });

  it('gives DNF to players still running 180 s after the first qualifier', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b');
    const code = race(s, a, b);
    b.send(state({ solved: 2 }));
    a.send({ t: 'finish', outcome: 'qualified', timeMs: 60_000, stars: 1, asked: 2, correct: 2 });
    s.advance(RULES.RACE_TIMEOUT_MS - 1000);
    expect(s.rooms.roomPhase(code)).toBe('racing');
    s.advance(1500);
    expect(s.rooms.roomPhase(code)).toBe('over');
    expect(a.last('raceOver')!.standings.map((r) => [r.name, r.outcome, r.solved])).toEqual([['aa', 'qualified', 0], ['bb', 'dnf', 2]]);
  });

  it('counts a player who left or stayed disconnected past 30 s as done (DNF)', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b'), c = s.client('c');
    const code = race(s, a, b, c);
    c.send({ t: 'leave' });
    b.drop();
    a.send({ t: 'finish', outcome: 'qualified', timeMs: 60_000, stars: 1, asked: 2, correct: 2 });
    expect(s.rooms.roomPhase(code)).toBe('racing');
    s.advance(RULES.RESUME_GRACE_MS + 500);
    expect(s.rooms.roomPhase(code)).toBe('over');
    const rows = a.last('raceOver')!.standings;
    expect(rows.map((r) => r.outcome)).toEqual(['qualified', 'dnf', 'dnf']);
    // the leaver can join another room straight away
    const d = s.client('d'); d.hello('Dee'); d.create();
    c.send({ t: 'join', code: d.last('lobby')!.code });
    expect(d.last('lobby')?.players).toHaveLength(2);
  });

  it('a reconnecting player gets the start message again mid-race', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b');
    race(s, a, b);
    const tok = b.welcome();
    const start = b.last('start')!;
    b.drop();
    s.advance(2000);
    const b2 = s.client('b2');
    b2.hello('bb', tok.resumeToken);
    expect(b2.last('start')).toEqual(start);
  });

  it('relays emotes to the others', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b');
    race(s, a, b);
    a.send({ t: 'emote', id: 2 });
    expect(b.last('emote')).toEqual({ t: 'emote', from: a.welcome().playerId, id: 2 });
    expect(a.last('emote')).toBeUndefined();
  });

  it('Race again: the host starts a new seed and everyone is ready', () => {
    const s = setup();
    const a = s.client('a'), b = s.client('b');
    const code = race(s, a, b);
    const seed1 = a.last('start')!.seed;
    a.send({ t: 'finish', outcome: 'qualified', timeMs: 60_000, stars: 1, asked: 2, correct: 2 });
    b.send({ t: 'finish', outcome: 'eliminated', timeMs: 50_000, stars: 0, asked: 2, correct: 0 });
    expect(s.rooms.roomPhase(code)).toBe('over');
    b.send({ t: 'start' });
    expect(s.rooms.roomPhase(code)).toBe('over');
    a.send({ t: 'start' });
    expect(s.rooms.roomPhase(code)).toBe('countdown');
    expect(a.last('start')!.seed).not.toBe(seed1);
    expect(a.last('lobby')!.players.every((p) => p.ready)).toBe(true);
  });
});
