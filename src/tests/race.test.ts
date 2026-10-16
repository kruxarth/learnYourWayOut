import { describe, expect, it } from 'vitest';
import { T } from '../game/tuning';
import { sampleSnapshots } from '../net/interp';
import type { RelayedState, ServerMsg, Standing } from '../net/protocol';
import {
  computeAwards, emoteForKey, emoteReady, nameTagText, ordinal, rankRacers, sortStandings, tagTextColor, type Racer,
} from '../net/race';
import { createSession, emotes, remotes, useNet } from '../net/store';
import { DEFAULT_AVATAR } from '../game/avatar';

const st = (o: Partial<Standing> & { id: string }): Standing => ({
  name: o.id, avatar: DEFAULT_AVATAR, outcome: 'qualified', place: 0, timeMs: 60_000, stars: 1, asked: 6, correct: 3, solved: 5, ...o,
});

describe('standings and awards', () => {
  it('sorts qualified by time, then the rest by rooms solved and accuracy', () => {
    const out = sortStandings([
      st({ id: 'e1', outcome: 'eliminated', solved: 2, asked: 4, correct: 1 }),
      st({ id: 'q2', timeMs: 80_000 }),
      st({ id: 'd1', outcome: 'dnf', solved: 4 }),
      st({ id: 'e2', outcome: 'eliminated', solved: 2, asked: 4, correct: 4 }),
      st({ id: 'q1', timeMs: 50_000 }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['q1', 'q2', 'd1', 'e2', 'e1']);
    expect(out.map((s) => s.place)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives Brainiest to the best accuracy with enough questions, and skips it otherwise', () => {
    const list = sortStandings([
      st({ id: 'fast', timeMs: 40_000, asked: 10, correct: 6 }),
      st({ id: 'sharp', timeMs: 70_000, asked: 8, correct: 8 }),
      st({ id: 'lucky', timeMs: 50_000, asked: 2, correct: 2 }),
    ]);
    const a = computeAwards(list, {});
    expect(a.find((x) => x.id === 'brainiest')).toMatchObject({ playerId: 'sharp' });
    expect(computeAwards([st({ id: 'x', asked: 3, correct: 3 })], {}).find((x) => x.id === 'brainiest')).toBeUndefined();
  });

  it('gives Hot Streak to the max combo and Comeback to a qualifier with detours', () => {
    const list = sortStandings([st({ id: 'a', timeMs: 40_000 }), st({ id: 'b', timeMs: 50_000 }), st({ id: 'c', outcome: 'eliminated' })]);
    const a = computeAwards(list, {
      a: { bestCombo: 3, detours: 0 }, b: { bestCombo: 5, detours: 2 }, c: { bestCombo: 9, detours: 4 },
    });
    expect(a.find((x) => x.id === 'streak')).toMatchObject({ playerId: 'c', note: '9 in a row' });
    expect(a.find((x) => x.id === 'comeback')).toMatchObject({ playerId: 'b' }); // c did not qualify
    expect(computeAwards(list, { a: { bestCombo: 1, detours: 0 } }).find((x) => x.id === 'streak')).toBeUndefined();
  });
});

describe('strip, tags and emotes', () => {
  const racer = (o: Partial<Racer> & { id: string }): Racer => ({ name: o.id, me: false, color: '#fff', solved: 0, seg: 0, outcome: null, finishMs: 0, connected: true, ...o });

  it('ranks finishers first, then progress, then eliminated', () => {
    const out = rankRacers([
      racer({ id: 'dead', outcome: 'eliminated', solved: 9 }),
      racer({ id: 'slow', solved: 1, seg: 9 }),
      racer({ id: 'lead', solved: 4, seg: 2 }),
      racer({ id: 'late', outcome: 'qualified', finishMs: 90_000 }),
      racer({ id: 'win', outcome: 'qualified', finishMs: 60_000 }),
      racer({ id: 'same', solved: 4, seg: 5 }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['win', 'late', 'same', 'lead', 'slow', 'dead']);
  });

  it('formats ordinals and name tags', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
    expect(nameTagText('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(nameTagText('Bartholomew the Great')).toBe('Bartholomew…');
    expect(nameTagText('   ')).toBe('Player');
    expect(tagTextColor('#FFFFFF')).toBe('#2B2D42');
    expect(tagTextColor('#202040')).toBe('#FFFFFF');
  });

  it('maps keys 6-9 to emotes and enforces the cooldown', () => {
    expect(['Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'KeyA'].map(emoteForKey)).toEqual([-1, 0, 1, 2, 3, -1]);
    expect(emoteReady(null, 1000)).toBe(true);
    expect(emoteReady(1000, 1000 + T.EMOTE_COOLDOWN_MS - 1)).toBe(false);
    expect(emoteReady(1000, 1000 + T.EMOTE_COOLDOWN_MS)).toBe(true);
    expect(emoteReady(5000, 1000)).toBe(true); // clock went backwards
  });
});

/** A session fed only by scripted server messages (the engine is a singleton, so no second engine). */
function scripted() {
  let now = 1_000_000;
  const sent: string[] = [];
  let deliver: (s: string) => void = () => {};
  const sess = createSession({
    connect: () => ({ send: (s) => sent.push(s), onMessage: (cb) => { deliver = cb; }, onClose: () => {}, close: () => {} }),
    now: () => now,
    timers: { set: () => 0, clear: () => {} },
    identity: () => ({ name: 'Me', avatar: DEFAULT_AVATAR }),
    tokens: { get: () => null, set: () => {} },
    startRace: () => 8,
    snapshot: () => null,
    onRunResult: () => () => {},
    fetchHealth: async () => ({ ok: true, lanUrls: [] }),
  });
  sess.resetForTests();
  sess.connect();
  const msg = (m: ServerMsg) => deliver(JSON.stringify(m));
  msg({ t: 'welcome', playerId: 'me', resumeToken: 'tok' });
  msg({
    t: 'lobby', code: 'BCDF', hostId: 'me', phase: 'lobby', domainId: 'math', difficulty: 'easy',
    players: [
      { id: 'me', name: 'Me', avatar: DEFAULT_AVATAR, ready: true, connected: true },
      { id: 'bob', name: 'Bob', avatar: { ...DEFAULT_AVATAR, body: 'blue' }, ready: true, connected: true },
    ],
  });
  const state = (at: number, x: number, o: Partial<RelayedState> = {}): RelayedState => ({
    id: 'bob', at, seq: at, x, y: 0, z: -x, f: 0, sp: 3, g: true, spin: 0, seg: 1, slime: 0, solved: 1, asked: 2, correct: 1, detour: false, bc: 0, ...o,
  });
  return { sess, msg, sent, state, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe('scripted remotes', () => {
  it('turns a scripted states feed into correct sampled positions, with snaps on teleport and stale flags', () => {
    const t = scripted();
    t.msg({ t: 'states', s: [t.state(1000, 0), t.state(1100, 1), t.state(1200, 2), t.state(1300, 20, { detour: true })] });
    t.msg({ t: 'states', s: [t.state(1250, 99)] }); // out of order, dropped
    const buf = remotes.get('bob')!.buf;
    expect(buf.map((s) => s.x)).toEqual([0, 1, 2, 20]);
    expect(sampleSnapshots(buf, 1050)!.x).toBeCloseTo(0.5, 5);
    expect(sampleSnapshots(buf, 1150)!.z).toBeCloseTo(-1.5, 5);
    expect(sampleSnapshots(buf, 1220)!.x).toBe(2); // 18 m jump: snap to the nearer end, no slide
    expect(sampleSnapshots(buf, 1290)!.x).toBe(20);
    expect(sampleSnapshots(buf, 1300 + T.STALE_MS + 1)!.stale).toBe(true);
    expect(t.sess.source.ids()).toEqual(['bob']);
    // render time is server time minus the interpolation delay
    expect(t.sess.source.renderTime()).toBe(t.sess.client.serverNow() - T.INTERP_DELAY_MS);
    t.sess.resetForTests();
  });

  it('tracks best combo and completed detours per player for the awards', () => {
    const t = scripted();
    t.msg({
      t: 'states', s: [
        t.state(1000, 0, { bc: 1 }), t.state(1100, 1, { bc: 4, detour: true }), t.state(1200, 2, { bc: 2, detour: false }),
        t.state(1300, 3, { bc: 0, detour: true }), t.state(1400, 4, { detour: false }),
      ],
    });
    t.msg({ t: 'raceOver', standings: [] });
    expect(useNet.getState().stats.bob).toEqual({ bestCombo: 4, detours: 2 });
    t.sess.resetForTests();
  });

  it('stores remote emotes, and rate-limits my own with a 3 s cooldown', () => {
    const t = scripted();
    t.msg({ t: 'emote', from: 'bob', id: 2 });
    expect(emotes.get('bob')).toMatchObject({ id: 2, at: t.now() });
    expect(useNet.getState().lastEmote).toMatchObject({ from: 'bob', id: 2 });

    expect(t.sess.emote(1)).toBe(true);
    expect(t.sess.emote(0)).toBe(false);
    t.advance(T.EMOTE_COOLDOWN_MS - 1);
    expect(t.sess.emote(0)).toBe(false);
    t.advance(1);
    expect(t.sess.emote(3)).toBe(true);
    const sentEmotes = t.sent.map((s) => JSON.parse(s) as { t: string; id?: number }).filter((m) => m.t === 'emote').map((m) => m.id);
    expect(sentEmotes).toEqual([1, 3]);
    expect(useNet.getState().myEmote).toMatchObject({ id: 3 });
    t.sess.resetForTests();
  });
});
