import { describe, expect, it } from 'vitest';
import {
  MAX_MSG_BYTES, PROTOCOL_V, normalizeCode, parseClientMsg, parseServerMsg, isRoomCode,
} from '../net/protocol';

const st = { t: 'state', seq: 1, x: 1, y: 0, z: 2, f: 0, sp: 1, g: true, spin: 0, seg: 0, slime: 0, solved: 0, asked: 0, correct: 0, detour: false };

describe('client message guards', () => {
  it('accepts valid messages as objects or JSON strings', () => {
    expect(parseClientMsg({ t: 'ping', c: 5 })).toEqual({ t: 'ping', c: 5 });
    expect(parseClientMsg(JSON.stringify({ t: 'hello', v: PROTOCOL_V, name: 'Ann', avatar: {} }))).toMatchObject({ t: 'hello', name: 'Ann' });
    expect(parseClientMsg(st)).toMatchObject({ t: 'state', seq: 1, bc: 0 });
    expect(parseClientMsg({ t: 'create', domainId: 'math', difficulty: 'easy' })).toMatchObject({ t: 'create' });
    expect(parseClientMsg({ t: 'leave' })).toEqual({ t: 'leave' });
  });

  it('rejects unknown t, wrong types, junk and non-finite numbers', () => {
    for (const bad of [
      null, 5, 'nope', '{', '[]', {}, { t: 7 }, { t: 'launch-missiles' }, { t: 'ping', c: 'x' }, { t: 'ping', c: NaN },
      { t: 'ready', ready: 'yes' }, { t: 'join', code: 5 }, { t: 'emote', id: 4 }, { t: 'emote', id: -1 }, { t: 'emote', id: 1.5 },
      { t: 'create', domainId: 'cooking', difficulty: 'easy' }, { t: 'create', domainId: 'math', difficulty: 'insane' },
      { t: 'hello', v: 'one', name: 'A', avatar: {} }, { t: 'hello', v: 1, name: 'x'.repeat(100), avatar: {} },
      { ...st, x: Infinity }, { ...st, g: 1 }, { ...st, seg: -1 }, { ...st, solved: 1.5 }, { ...st, seq: 'a' },
      { t: 'finish', outcome: 'won', timeMs: 5, stars: 1, asked: 1, correct: 1 },
      { t: 'finish', outcome: 'qualified', timeMs: 5, stars: 9, asked: 1, correct: 1 },
    ]) expect(parseClientMsg(bad)).toBeNull();
  });

  it('rejects oversized payloads', () => {
    expect(parseClientMsg('x'.repeat(MAX_MSG_BYTES + 1))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'ping', c: 1, pad: 'x'.repeat(MAX_MSG_BYTES) }))).toBeNull();
    const huge = { t: 'create', domainId: 'custom', difficulty: 'easy', pack: { id: 'custom', pad: 'x'.repeat(210 * 1024) } };
    expect(parseClientMsg(huge)).toBeNull();
  });
});

describe('server message guards', () => {
  it('accepts a lobby and rejects a broken one', () => {
    const lobby = {
      t: 'lobby', code: 'BCDF', hostId: 'p1', phase: 'lobby', domainId: 'math', difficulty: 'easy',
      players: [{ id: 'p1', name: 'Ann', avatar: { v: 1 }, ready: false, connected: true }],
    };
    expect(parseServerMsg(lobby)).toMatchObject({ t: 'lobby', code: 'BCDF' });
    expect(parseServerMsg({ ...lobby, code: 'AEIO' })).toBeNull();
    expect(parseServerMsg({ ...lobby, phase: 'x' })).toBeNull();
    expect(parseServerMsg({ ...lobby, players: [{ id: 'p1' }] })).toBeNull();
  });

  it('checks states, start and errors', () => {
    expect(parseServerMsg({ t: 'states', s: [{ id: 'p2', at: 5, ...st, t: undefined }] })).toMatchObject({ t: 'states' });
    expect(parseServerMsg({ t: 'states', s: [{ id: 'p2', at: 'now' }] })).toBeNull();
    expect(parseServerMsg({ t: 'start', seed: 12, domainId: 'math', difficulty: 'easy', startAt: 1e12 })).toMatchObject({ t: 'start', seed: 12 });
    expect(parseServerMsg({ t: 'start', seed: 'x', domainId: 'math', difficulty: 'easy', startAt: 1 })).toBeNull();
    // the player count (Hex Finale): optional, an integer from 1 to the room size
    expect(parseServerMsg({ t: 'start', seed: 12, domainId: 'math', difficulty: 'easy', startAt: 1e12, players: 3 })).toMatchObject({ players: 3 });
    expect(parseServerMsg({ t: 'start', seed: 12, domainId: 'math', difficulty: 'easy', startAt: 1e12 })).not.toHaveProperty('players');
    for (const bad of [0, 9, -1, 2.5, '3', NaN, null]) {
      expect(parseServerMsg({ t: 'start', seed: 12, domainId: 'math', difficulty: 'easy', startAt: 1e12, players: bad }), String(bad)).toBeNull();
    }
    expect(parseServerMsg({ t: 'error', code: 'full', message: 'Full' })).toMatchObject({ code: 'full' });
    expect(parseServerMsg({ t: 'error', code: 'weird', message: 'x' })).toBeNull();
    expect(parseServerMsg({ t: 'bogus' })).toBeNull();
  });
});

describe('room codes', () => {
  it('normalizes typed input', () => {
    expect(normalizeCode('b c-d1f9')).toBe('BCDF');
    expect(normalizeCode('aeiou')).toBe('');
    expect(normalizeCode('bcdfgh')).toBe('BCDF');
    expect(isRoomCode('BCDF')).toBe(true);
    expect(isRoomCode('BCDE')).toBe(false);
    expect(isRoomCode('BCD')).toBe(false);
  });
});
