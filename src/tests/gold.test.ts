import { afterEach, describe, expect, it } from 'vitest';
import { answerGold, offerGold, touchGold } from '../game/rooms/goldDoor';
import * as doorRush from '../game/rooms/doorRush';
import { slimeFloor } from '../game/loop/progression';
import { G } from '../game/state';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';
import { playThrough } from './bot';
import { advance, boot, enterRoom, finish, room } from './helpers';

afterEach(() => finish());

/** A normal run with the Door Rush entered and its right door burst: the gold door is offered. */
function offered(seed = 4242, d: 'easy' | 'normal' | 'hard' = 'normal') {
  const run = boot(d, seed);
  const r = room(run, 'doorRush');
  enterRoom(run, r);
  const right = r.doorWalls[0].panels.findIndex((p) => p.isCorrect);
  doorRush.onTouch(r, right);
  return { run, r };
}

describe('Gold Door', () => {
  it('stays hidden until the main question is answered right the first time', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'doorRush');
    expect(r.gold?.state).toBe('burst');                       // hidden
    expect(run.world.walls[r.layout.gold!.wallId].enabled).toBe(false);
    enterRoom(run, r);
    expect(r.gold?.state).toBe('burst');                       // still hidden while the question is open
    const wrong = r.doorWalls[0].panels.findIndex((p) => !p.isCorrect);
    doorRush.onTouch(r, wrong);                                // a wrong door: fall and detour, no gold
    expect(r.gold?.state).toBe('burst');
  });

  it('a right answer opens the star door; running into it asks a harder follow-up in the room panel', () => {
    const { run, r } = offered();
    expect(r.state).toBe('resolved');
    expect(r.gold!.state).toBe('closed');
    expect(r.gold!.label).toBe('★');
    expect(run.world.walls[r.layout.gold!.wallId].enabled).toBe(true);
    touchGold(run, r);
    const g = run.gold!;
    expect(g.phase).toBe('asking');
    expect(g.tier).toBe(Math.min(3, r.tierAsked + 1));
    expect(g.question.tier).toBeGreaterThanOrEqual(1);
    expect(g.options.length).toBe(4);
    expect(g.options[g.correct]).toBe(g.question.answer);
    expect(r.gold!.state).toBe('burst');                       // the door bursts
    const panel = useUI.getState().room!;
    expect(panel.title).toContain('GOLD');
    expect(panel.gold!.options.map((o) => o.label)).toEqual(g.options);
    advance(0.05);
    expect(run.zone).toBe('think');                            // reading the bonus question is a think zone
  });

  it('right: double pushback and +2 coins; the panel clears after a moment', () => {
    const { run } = offered();
    touchGold(run, run.rooms.find((x) => x.kind === 'doorRush'));
    run.slime = 0.5;
    const coins = run.coins;
    const before = run.slime;
    expect(answerGold(run.gold!.correct)).toBe(true);
    expect(run.coins).toBe(coins + T.GOLD_COINS);
    const drop = Math.max(Math.min(before, slimeFloor(run)), before - T.SLIME_PUSHBACK.normal);
    expect(run.slime).toBeLessThanOrEqual(drop + 1e-9);
    expect(before - run.slime).toBeCloseTo(2 * T.SLIME_PUSHBACK.normal, 3);
    const rec = run.records[run.records.length - 1];
    expect(rec.correctFirstTry).toBe(true);
    expect(rec.roomKind).toBe('doorRush');
    expect(useUI.getState().room!.gold!.done).toBe(true);
    expect(answerGold(0)).toBe(false);                         // one answer only
    advance(T.GOLD_RESULT_S + 0.5);
    expect(run.gold).toBeNull();
    expect(useUI.getState().room).toBeNull();
  });

  it('wrong: double surge, recorded as a miss, the concept becomes a weak spot', () => {
    const { run } = offered();
    touchGold(run, run.rooms.find((x) => x.kind === 'doorRush'));
    run.slime = 0.1;
    const wrong = run.gold!.options.findIndex((_, i) => i !== run.gold!.correct);
    const concept = run.gold!.question.concept;
    answerGold(wrong);
    expect(run.slime - 0.1).toBeCloseTo(2 * T.SLIME_SURGE.normal, 5);
    expect(run.records[run.records.length - 1].correctFirstTry).toBe(false);
    expect(run.wrongConcepts.has(concept)).toBe(true);
    expect(run.coins).toBe(T.COINS_START + run.coinsCollected);
  });

  it('is ignored while another room is active or after it was already used', () => {
    const { run, r } = offered(4242);
    touchGold(run, r);
    answerGold(run.gold!.correct);
    advance(T.GOLD_RESULT_S + 0.5);
    touchGold(run, r);                                         // the door burst: nothing happens
    expect(run.gold).toBeNull();
    // a door that was offered but touched during another room's question is ignored
    const { run: run2, r: r2 } = offered(99);
    run2.activeRoomId = 'other';
    touchGold(run2, r2);
    expect(run2.gold).toBeNull();
    run2.activeRoomId = null;
  });

  it('is not offered twice and offerGold only works on a hidden panel', () => {
    const { run, r } = offered();
    r.gold!.state = 'closed';
    offerGold(run, r);
    expect(r.gold!.state).toBe('closed');
    expect(G.run).toBe(run);
  });

  it('the bot takes it in whole runs: it qualifies, the bonus is recorded, and it pays off', () => {
    let gold = 0;
    for (let i = 0; i < 4; i++) {
      const d = (['easy', 'normal', 'hard'] as const)[i % 3];
      const res = playThrough(d, 700 + 41 * i, { gold: 'take', route: 'short', junctionRight: true, keepAlive: true });
      expect(res.run.phase, `${d} #${i}`).toBe('won');
      const rushes = res.run.rooms.filter((x) => x.kind === 'doorRush' && x.state === 'resolved' && x.result === 'correct');
      for (const x of rushes) expect(x.gold!.state, `${d} #${i}: gold door used`).toBe('burst');
      gold += rushes.length;
      // every follow-up of a perfect player was right
      expect(res.run.records.every((rec) => rec.correctFirstTry || rec.roomKind === 'junctionHall')).toBe(true);
    }
    expect(gold).toBeGreaterThan(0);
  }, 300_000);
});
