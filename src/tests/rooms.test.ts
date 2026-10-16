import { afterEach, describe, expect, it } from 'vitest';
import { useLifelineSafe } from './rooms.util';
import { advance, boot, enterRoom, finish, place, room, steer, walkLateralThenForward, walkTo } from './helpers';
import { engine } from '../game/engine';
import { G } from '../game/state';
import { useUI } from '../ui/store';
import { T } from '../game/tuning';
import type { McqQuestion, OrderQuestion, StepsQuestion, TfQuestion } from '../content/schema';

afterEach(() => finish());

/** Walk through the correct door of the active Door Rush. */
function doorX(r: ReturnType<typeof room>, wrong = false): { x: number; z: number; index: number } {
  const dw = r.doorWalls[0];
  const idx = dw.panels.findIndex((p) => (wrong ? !p.isCorrect : p.isCorrect));
  const d = r.layout.doorWalls[0].doors[idx];
  return { x: d.cx, z: r.layout.doorWalls[0].z, index: idx };
}

describe('Door Rush', () => {
  it('activates on entry, the correct door bursts, the room resolves as correct', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    expect(r.state).toBe('active');
    expect(run.world.walls[r.layout.gateWallId!].enabled).toBe(true);
    expect(useUI.getState().room?.kind).toBe('doorRush');
    expect(r.doorWalls[0].panels.map((p) => p.label)).not.toContain('?');
    const q = r.question as McqQuestion;
    const target = doorX(r);
    expect(r.doorWalls[0].panels[target.index].label).toBe(q.answer);
    walkTo(target.x, target.z - 3, 10);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    expect(r.doorWalls[0].panels[target.index].state).toBe('burst');
    expect(run.records).toHaveLength(1);
    expect(run.records[0].correctFirstTry).toBe(true);
    expect(run.world.walls[r.doorWalls[0].panels[target.index].wallId].enabled).toBe(false);
  });

  it('a wrong door drops the player into the detour; retry + portal returns past the room', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    const slime0 = run.slime;
    const wrong = doorX(r, true);
    walkTo(wrong.x, wrong.z - 3, 10);
    // fall + transition
    advance(2);
    expect(run.detour).not.toBeNull();
    expect(G.player.pos.x).toBeGreaterThan(400);
    expect(run.slime).toBeGreaterThan(slime0 + T.SLIME_SURGE.normal * 0.9);
    expect(run.records).toHaveLength(1);
    expect(run.records[0].correctFirstTry).toBe(false);
    expect(run.tier).toBe(1); // tier 2 → wrong → 1
    expect(useUI.getState().detour?.correct).toBeTruthy();

    // walk to the boards, then the retry doors
    const dl = run.course.detour;
    walkTo(dl.boardA.x, dl.boardA.z, 10);
    expect(run.detour!.nearBoard).toBe('A');
    advance(0.2);
    expect(useUI.getState().detour?.nearBoard).toBe('A');
    walkTo(dl.boardB.x, dl.boardB.z, 10);
    expect(run.detour!.nearBoard).toBe('B');
    walkTo(dl.spawn.x, dl.spawn.z - 19, 10);
    expect(run.detour!.retryActive).toBe(true);
    expect(useUI.getState().detour?.retryPrompt).toBeTruthy();

    // first try: touch the WRONG retry door → red X, bounce, extra surge
    const wall = run.detour!.retryWall;
    const wi = wall.panels.findIndex((p) => !p.isCorrect);
    const slime1 = run.slime;
    walkTo(dl.retryWall.doors[wi].cx, dl.retryWall.z - 1.2, 10);
    steer(0, 1); advance(0.5); steer(0, 0);
    expect(wall.panels[wi].state).toBe('wrongX');
    expect(run.slime).toBeGreaterThan(slime1);
    expect(run.detour!.retryFirstTry).toBe(false);
    advance(1.2);

    // now the correct door
    const ci = wall.panels.findIndex((p) => p.isCorrect);
    walkTo(dl.retryWall.doors[ci].cx, dl.retryWall.z + 3, 10);
    walkTo(dl.retryWall.doors[ci].cx, dl.retryWall.z - 2, 10);
    expect(run.detour!.solved).toBe(true);
    walkTo(dl.portal.x, dl.portal.z, 10, 1.2);
    advance(1.5);
    expect(run.detour).toBeNull();
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('wrongCompleted'); // the retry was not right on the first try
    expect(G.player.pos.x).toBeLessThan(100);
    expect(G.player.pos.z).toBeCloseTo(r.layout.exitSpawn.z, 0);
    expect(run.records.filter((x) => x.isRetry)).toHaveLength(1);
    expect(run.records.filter((x) => !x.isRetry)).toHaveLength(1);
    expect(run.world.walls[r.doorWalls[0].panels.find((p) => p.isCorrect)!.wallId].enabled).toBe(false);
  });

  it('a first-try correct retry marks the room remediated', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    const wrong = doorX(r, true);
    walkTo(wrong.x, wrong.z - 3, 10);
    advance(2);
    const dl = run.course.detour;
    walkTo(dl.spawn.x, dl.spawn.z - 19, 10);
    const wall = run.detour!.retryWall;
    const ci = wall.panels.findIndex((p) => p.isCorrect);
    walkTo(dl.retryWall.doors[ci].cx, dl.retryWall.z + 3, 10);
    walkTo(dl.retryWall.doors[ci].cx, dl.retryWall.z - 2, 10);
    walkTo(dl.portal.x, dl.portal.z, 10, 1.2);
    advance(1.5);
    expect(r.result).toBe('remediated');
    expect(r.record!.remediated).toBe(true);
  });
});

describe('Tile Drop', () => {
  function stand(r: ReturnType<typeof room>, correct: boolean) {
    const tile = r.tiles.find((t) => t.correct === correct)!;
    walkTo(tile.cx, tile.cz, 10, 0.4);
  }

  it('timer starts on the first tile; standing on a correct tile resolves it and opens the exit gate', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'tileDrop', 0);
    enterRoom(run, r);
    expect(r.state).toBe('active');
    expect(r.timer.started).toBe(false);
    expect(run.world.walls[r.layout.exitGateWallId!].enabled).toBe(true);
    const q = r.question as TfQuestion;
    expect(r.tiles.map((t) => t.label).sort()).toEqual(['FALSE', 'FALSE', 'TRUE', 'TRUE']);
    expect(r.tiles.filter((t) => t.correct)).toHaveLength(2);
    expect(r.tiles.every((t) => (t.label === 'TRUE') === q.answer === t.correct)).toBe(true);
    stand(r, true);
    expect(r.timer.started).toBe(true);
    advance(T.TILE_TIMER.normal + 0.3);
    expect(r.result).toBe('correct');
    advance(T.TILE_SHAKE_TIME + 0.2);
    expect(run.world.walls[r.layout.exitGateWallId!].enabled).toBe(false);
    const wrongTiles = r.tiles.filter((t) => !t.correct);
    expect(wrongTiles.every((t) => t.state === 'falling' || t.state === 'gone')).toBe(true);
    expect(wrongTiles.every((t) => !run.world.floors[t.floorId].enabled)).toBe(true);
    expect(run.records[0].correctFirstTry).toBe(true);
  });

  it('standing on a wrong tile drops it and starts the detour', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'tileDrop', 0);
    enterRoom(run, r);
    stand(r, false);
    advance(T.TILE_TIMER.normal + 0.3);
    expect(r.timer.evaluated).toBe(true);
    expect(r.timer.correct).toBe(false);
    advance(3);
    expect(run.detour).not.toBeNull();
    expect(run.records[0].correctFirstTry).toBe(false);
  });

  it('not standing on any tile (waiting on the platform) is wrong and starts the detour', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'tileDrop', 0);
    enterRoom(run, r);
    // timer only starts on a tile: step on and back off
    stand(r, true);
    const seg = run.course.segments[r.layout.segIndex];
    walkTo(seg.laneX, seg.z0 - 2, 5, 0.4);
    advance(T.TILE_TIMER.normal + 0.5);
    expect(r.timer.correct).toBe(false);
    advance(2);
    expect(run.detour).not.toBeNull();
  });
});

describe('Step Stones', () => {
  it('correct steps lock and build the working list; wrong steps drop and respawn on the last safe tile', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'stepStones', 0);
    enterRoom(run, r);
    expect(r.state).toBe('active');
    const q = r.question as StepsQuestion;
    expect(r.stepRows.every((row) => row.some((t) => t.visible))).toBe(true);
    const slime0 = run.slime;
    // row 0 correct
    const t0 = r.stepRows[0].find((t) => t.visible && t.correct)!;
    walkLateralThenForward(t0.cx, t0.cz);
    advance(0.3);
    expect(r.currentRow).toBe(1);
    expect(r.working).toEqual([q.steps[0].correct]);
    expect(t0.state).toBe('locked');
    // row 1 wrong
    const w1 = r.stepRows[1].find((t) => t.visible && !t.correct)!;
    walkLateralThenForward(w1.cx, w1.cz);
    advance(0.1);
    expect(['shaking', 'falling']).toContain(w1.state);
    expect(run.slime).toBeGreaterThan(slime0);
    expect(r.wrongCount).toBe(1);
    expect(useUI.getState().room?.feedback?.tone).toBe('bad');
    advance(T.STEP_SHAKE_TIME + 1);
    expect(w1.state === 'falling' || w1.state === 'gone').toBe(true);
    expect(run.world.floors[w1.floorId].enabled).toBe(false);
    advance(T.TILE_FALL_TIME + T.STEP_RISE_TIME);
    expect(w1.state).toBe('solid'); // rises back so no hole blocks the way
    expect(run.world.floors[w1.floorId].enabled).toBe(true);
    // respawned on the last safe tile (row 0 correct tile)
    expect(Math.abs(G.player.pos.z - t0.cz)).toBeLessThan(2.5);
    expect(G.player.pos.y).toBeGreaterThan(-1);
    // finish the rest correctly
    for (let i = 1; i < 4; i++) {
      const t = r.stepRows[i].find((x) => x.visible && x.correct)!;
      walkLateralThenForward(t.cx, t.cz);
      advance(0.3);
    }
    expect(r.currentRow).toBe(4);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('remediated');
    expect(run.records[0].correctFirstTry).toBe(false);
    expect(run.records[0].wrongCount).toBe(1);
  });

  it('a perfect run resolves as correct on the first try', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'stepStones', 0);
    enterRoom(run, r);
    for (let i = 0; i < 4; i++) {
      const t = r.stepRows[i].find((x) => x.visible && x.correct)!;
      walkLateralThenForward(t.cx, t.cz);
      advance(0.3);
    }
    expect(r.result).toBe('correct');
    expect(run.records[0].correctFirstTry).toBe(true);
  });
});

describe('Bridge Builder', () => {
  it('carry blocks in order to build the bridge; a wrong block falls and returns home', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'bridgeBuilder', 0);
    enterRoom(run, r);
    expect(r.state).toBe('active');
    const q = r.question as OrderQuestion;
    expect(r.blocks.map((b) => b.label)).toEqual(q.items);
    const bz = r.layout.buildZone!;
    const zoneX = (bz.minX + bz.maxX) / 2, zoneZ = (bz.minZ + bz.maxZ) / 2;
    const slime0 = run.slime;
    // wrong block first (item 1)
    walkTo(r.blocks[1].home.x, r.blocks[1].home.z, 10, 0.5);
    advance(0.2);
    expect(r.blocks[1].state).toBe('carried');
    expect(G.player.carrying).toBe(r.blocks[1].id);
    walkTo(zoneX, zoneZ, 10, 0.3);
    advance(0.2);
    expect(r.blocks[1].state).toBe('falling');
    expect(r.wrongCount).toBe(1);
    expect(run.slime).toBeGreaterThan(slime0);
    expect(r.nextIndex).toBe(0);
    advance(1.3);
    expect(r.blocks[1].state).toBe('home');
    // drop works
    walkTo(r.blocks[3].home.x, r.blocks[3].home.z, 10, 0.5);
    advance(0.2);
    expect(G.player.carrying).toBe(r.blocks[3].id);
    engine.dropBlock();
    expect(G.player.carrying).toBeNull();
    expect(r.blocks[3].state).toBe('home');
    // correct order
    for (let i = 0; i < 4; i++) {
      walkTo(r.blocks[i].home.x, r.blocks[i].home.z, 10, 0.5);
      advance(0.9); // pickup cooldown after a drop
      walkTo(r.blocks[i].home.x + 0.01, r.blocks[i].home.z, 3, 0.5);
      advance(0.2);
      expect(G.player.carrying).toBe(r.blocks[i].id);
      walkTo(zoneX, zoneZ, 10, 0.3);
      advance(0.2);
      expect(r.nextIndex).toBe(i + 1);
      expect(run.world.floors[r.layout.slabs[i].floorId].enabled).toBe(true);
    }
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('remediated');
  });
});

describe('Slime Gate', () => {
  it('K walls; wrong doors bounce back and stay closed; slime runs 2x', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'slimeGate', 0);
    expect(r.doorWalls).toHaveLength(3);
    enterRoom(run, r);
    place(r.layout.laneX, r.layout.z0 - 3);
    advance(0.2);
    expect(r.state).toBe('active');
    expect(run.zone).toBe('boss');
    for (let k = 0; k < 3; k++) {
      const wallZ = r.layout.doorWalls[k].z;
      place(r.layout.laneX, wallZ + 7); // inside the trigger zone of wall k
      advance(0.3);
      expect(r.currentWall).toBe(k);
      const dw = r.doorWalls[k];
      const wi = dw.panels.findIndex((p) => !p.isCorrect);
      const slime0 = run.slime;
      walkTo(r.layout.doorWalls[k].doors[wi].cx, wallZ + 1.6, 10, 0.3);
      steer(0, 1); advance(0.4); steer(0, 0);
      expect(dw.panels[wi].state).toBe('wrongX');
      expect(run.slime).toBeGreaterThan(slime0 + T.SLIME_SURGE.normal * 0.9);
      advance(1);
      const ci = dw.panels.findIndex((p) => p.isCorrect);
      walkTo(r.layout.doorWalls[k].doors[ci].cx, wallZ + 3, 10, 0.3);
      walkTo(r.layout.doorWalls[k].doors[ci].cx, wallZ - 2, 10, 0.3);
      expect(dw.panels[ci].state).toBe('burst');
    }
    expect(r.state).toBe('resolved');
    expect(run.records).toHaveLength(3);
    expect(run.records.every((x) => !x.correctFirstTry)).toBe(true);
  });
});

describe('lifelines', () => {
  it('50/50 removes floor(N/2) wrong doors, costs 3 coins, works once per question; hint costs 2', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    run.coins = 10;
    useLifelineSafe('fifty');
    const smashed = r.doorWalls[0].panels.filter((p) => p.state === 'smashed');
    expect(smashed).toHaveLength(2);
    expect(smashed.every((p) => !p.isCorrect)).toBe(true);
    expect(run.coins).toBe(7);
    useLifelineSafe('fifty');
    expect(run.coins).toBe(7); // once per question
    useLifelineSafe('hint');
    expect(run.coins).toBe(5);
    expect(r.hintShown).toBe(r.question!.hint);
    useLifelineSafe('hint');
    expect(run.coins).toBe(5);
  });

  it('not enough coins denies the lifeline and keeps the coins', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    run.coins = 1;
    useLifelineSafe('fifty');
    useLifelineSafe('hint');
    expect(run.coins).toBe(1);
    expect(r.fiftyUsed).toBe(false);
    expect(r.hintUsed).toBe(false);
    expect(useUI.getState().toasts.some((t) => t.text.includes('coins'))).toBe(true);
  });

  it('lifelines do nothing with no active question', () => {
    const run = boot('normal', 4242);
    run.coins = 10;
    useLifelineSafe('fifty');
    useLifelineSafe('hint');
    expect(run.coins).toBe(10);
  });
});
