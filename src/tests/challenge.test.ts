import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, place, room, steer, update, walkLateralThenForward, walkTo } from './helpers';
import { engine } from '../game/engine';
import { compassTarget, comboSpeedMult, grantPowerup } from '../game/loop/powerups';
import { computeZone } from '../game/loop/progression';
import { visibilityRadius } from '../game/loop/visibility';
import { selectQuestion } from '../content/select';
import { questionSource } from '../content/source';
import { mulberry32 } from '../game/rng';
import type { RoomRuntime, RunState } from '../game/runtime';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { JunctionLayout } from '../game/types';
import { useUI } from '../ui/store';
import { DEFAULT_SETTINGS } from '../game/persistence';

afterEach(() => {
  finish();
  useUI.setState({ settings: { ...DEFAULT_SETTINGS } });
});

/** Stand in the junction cell (activates its question). */
function atJunction(jl: JunctionLayout): void {
  place(jl.x, jl.z);
  advance(0.1);
}

/** Walk from the junction centre into corridor `bi`, then back out. */
function into(jl: JunctionLayout, bi: number, back = true): void {
  const b = jl.branches[bi];
  walkTo(b.signX + b.dx * 2, b.signZ + b.dz * 2, 5, 0.4);
  if (back) walkTo(jl.x, jl.z, 5, 0.4);
}

function quizRoom(run: RunState, withMcq = false): { r: RoomRuntime; j: JunctionLayout } {
  for (const r of run.rooms.filter((x) => x.kind === 'quizMaze')) {
    const j = r.layout.junctions.find((x) => !withMcq || x.branches.length === 3);
    if (j) return { r, j };
  }
  throw new Error('no quiz maze junction');
}

describe('Crossroads quiz maze', () => {
  it('a junction activates its question; the labels sit on the corridors', () => {
    const run = boot('normal', 4242);
    const { r, j } = quizRoom(run);
    expect(r.state).toBe('idle');
    atJunction(j);
    expect(r.state).toBe('active');
    expect(r.currentWall).toBe(j.index);
    const jr = r.junctions[j.index];
    expect(jr.branches.every((b) => b.state === 'open' && b.label !== '?')).toBe(true);
    const q = r.wallQuestions[j.index]!;
    expect(['mcq', 'truefalse']).toContain(q.type);
    const right = jr.branches.find((b) => b.correct)!;
    if (q.type === 'mcq') expect(right.label).toBe(q.answer);
    else if (q.type === 'truefalse') expect(right.label).toBe(q.answer ? 'TRUE' : 'FALSE');
    expect(computeZone(run)).toBe('think');
    expect(useUI.getState().room?.title).toContain('CROSSROADS');
  });

  it('a wrong corridor costs a surge once, walking back out is free, the right one resolves the junction', () => {
    const run = boot('normal', 4242);
    const { r, j } = quizRoom(run);
    atJunction(j);
    const wi = j.branches.findIndex((b) => !b.correct);
    const s0 = run.slime;
    into(j, wi);
    expect(r.junctions[j.index].branches[wi].state).toBe('wrong');
    expect(run.slime).toBeGreaterThan(s0 + T.SLIME_SURGE.normal * 0.9);
    expect(r.wallWrong[j.index]).toBe(1);
    expect(run.records.at(-1)!.correctFirstTry).toBe(false);
    expect(useUI.getState().room?.feedback?.tone).toBe('bad');
    // revisiting a known-wrong corridor costs nothing
    const s1 = run.slime;
    into(j, wi);
    expect(run.slime).toBeLessThan(s1 + 0.01);
    expect(r.wallWrong[j.index]).toBe(1);
    // the right corridor
    into(j, j.branches.findIndex((b) => b.correct), false);
    expect(r.wallDone[j.index]).toBe(true);
    expect(r.junctions[j.index].branches.find((b) => b.correct)!.state).toBe('right');
    expect(computeZone(run)).toBe('normal'); // between junctions: no think zone
    expect(useUI.getState().room).toBeNull();
  });

  it('two-corridor junctions mix mcq and true/false questions', () => {
    const types = new Set<string>();
    for (const seed of [4242, 1, 2, 3, 5, 6, 7, 8]) {
      const run = boot('normal', seed);
      for (const r of run.rooms.filter((x) => x.kind === 'quizMaze')) {
        for (const j of r.layout.junctions) { atJunction(j); types.add(r.wallQuestions[j.index]!.type); into(j, j.branches.findIndex((b) => b.correct), false); }
      }
    }
    expect([...types].sort()).toEqual(['mcq', 'truefalse']);
  });

  it('50/50 crosses out a wrong sign', () => {
    const run = boot('normal', 4242);
    const { r, j } = quizRoom(run);
    atJunction(j);
    run.coins = 10;
    engine.useLifeline('fifty');
    const crossed = r.junctions[j.index].branches.filter((b) => b.state === 'crossed');
    expect(crossed).toHaveLength(1);
    expect(crossed[0].correct).toBe(false);
    expect(run.coins).toBe(10 - T.COST_FIFTY);
  });
});

describe('Junction Hall', () => {
  function hall(run: RunState) { return room(run, 'junctionHall', 0); }
  function touch(r: RoomRuntime, correct: boolean): void {
    const dw = r.doorWalls[0];
    const i = dw.panels.findIndex((p) => p.isCorrect === correct);
    const d = r.layout.doorWalls[0];
    walkTo(d.doors[i].cx, d.z + 3, 10, 0.3);
    walkTo(d.doors[i].cx, d.z - 2.5, 10, 0.4);
  }

  it('the right door opens the shortcut gate only', () => {
    const run = boot('normal', 4242);
    const r = hall(run);
    enterRoom(run, r);
    expect(r.state).toBe('active');
    touch(r, true);
    expect(r.result).toBe('correct');
    const g = r.layout.laneGates!;
    expect(run.world.walls[g.short].enabled).toBe(false);
    expect(run.world.walls[g.long].enabled).toBe(true);
  });

  it('a wrong door swings open, the scenic gate opens, the room resolves as wrong (no detour)', () => {
    const run = boot('normal', 4242);
    const r = hall(run);
    enterRoom(run, r);
    const s0 = run.slime;
    touch(r, false);
    advance(0.5);
    expect(run.detour).toBeNull();
    expect(r.result).toBe('wrongCompleted');
    expect(run.slime).toBeGreaterThan(s0 + T.SLIME_SURGE.normal * 0.9);
    const g = r.layout.laneGates!;
    expect(run.world.walls[g.long].enabled).toBe(false);
    expect(run.world.walls[g.short].enabled).toBe(true);
    // walking into the scenic lane records the route
    const lane = run.course.segments.find((s) => s.lane === 'long')!;
    walkTo(lane.laneX, lane.z0 + 1.5, 15, 0.5);
    walkTo(lane.laneX, lane.z0 - 1, 5, 0.4);
    expect(run.route).toBe('long');
  });
});

describe('Hard mode', () => {
  it('Door Rush has a 12 s clock that starts on the first move; time up starts the detour', () => {
    const run = boot('hard', 4242);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    expect(r.answerTimer).not.toBeNull();
    expect(useUI.getState().room?.timer?.total).toBe(T.DOOR_TIMER.hard);
    advance(1);
    walkTo(r.layout.laneX, r.layout.z0 - 6, 5, 0.4);
    expect(r.answerTimer!.started).toBe(true);
    advance(T.DOOR_TIMER.hard + 2);
    expect(run.detour).not.toBeNull();
    expect(run.records[0].correctFirstTry).toBe(false);
  });

  it('no clock on Normal; "Relaxed timers" doubles it on Hard', () => {
    const run = boot('normal', 4242);
    enterRoom(run, room(run, 'doorRush', 0));
    expect(room(run, 'doorRush', 0).answerTimer).toBeNull();
    useUI.setState({ settings: { ...DEFAULT_SETTINGS, relaxedTimers: true } });
    const hard = boot('hard', 4242);
    enterRoom(hard, room(hard, 'doorRush', 0));
    expect(room(hard, 'doorRush', 0).answerTimer!.total).toBe(T.DOOR_TIMER.hard * T.RELAXED_TIMER_MULT);
  });

  it('Step Stones: a wrong step drops back to the start; unsolved rows reshuffle and come back', () => {
    const run = boot('hard', 4242);
    const r = room(run, 'stepStones', 0);
    enterRoom(run, r);
    const t0 = r.stepRows[0].find((t) => t.visible && t.correct)!;
    walkLateralThenForward(t0.cx, t0.cz);
    advance(0.3);
    expect(r.currentRow).toBe(1);
    const w1 = r.stepRows[1].find((t) => t.visible && !t.correct)!;
    walkLateralThenForward(w1.cx, w1.cz);
    advance(T.STEP_SHAKE_TIME + 1.5);
    expect(Math.abs(G.player.pos.z - r.layout.startSpawn.z)).toBeLessThan(1);
    expect(r.currentRow).toBe(1);
    expect(t0.state).toBe('locked');
    for (let i = 1; i < 4; i++) {
      const vis = r.stepRows[i].filter((t) => t.visible);
      expect(vis.every((t) => t.state === 'solid')).toBe(true);
      expect(vis.every((t) => run.world.floors[t.floorId].enabled)).toBe(true);
    }
    expect(r.stepRows[1].some((t) => t.glow)).toBe(false);
  });

  it('Bridge Builder: a wrong block knocks the bridge down', () => {
    const run = boot('hard', 4242);
    const r = room(run, 'bridgeBuilder', 0);
    enterRoom(run, r);
    const bz = r.layout.buildZone!;
    const zx = (bz.minX + bz.maxX) / 2, zz = (bz.minZ + bz.maxZ) / 2;
    walkTo(r.blocks[0].home.x, r.blocks[0].home.z, 10, 0.5);
    advance(0.2);
    walkTo(zx, zz, 10, 0.3);
    advance(0.2);
    expect(r.nextIndex).toBe(1);
    walkTo(r.blocks[2].home.x, r.blocks[2].home.z, 10, 0.5);
    advance(0.2);
    expect(G.player.carrying).toBe(r.blocks[2].id);
    walkTo(zx, zz, 10, 0.3);
    advance(0.2);
    expect(r.nextIndex).toBe(0);
    expect(run.world.floors[r.layout.slabs[0].floorId].enabled).toBe(false);
    expect(r.blocks[0].state).toBe('home');
  });

  it('Slime Gate: a wrong door locks the gate for 3 s and the last door never glows', () => {
    const run = boot('hard', 4242);
    const r = room(run, 'slimeGate', 0);
    const wallZ = r.layout.doorWalls[0].z;
    place(r.layout.laneX, wallZ + 7);
    advance(0.3);
    const dw = r.doorWalls[0];
    const wrong = dw.panels.map((p, i) => (p.isCorrect ? -1 : i)).filter((i) => i >= 0);
    for (const wi of wrong) {
      advance(T.GATE_LOCK_TIME.hard + 0.2);
      walkTo(r.layout.doorWalls[0].doors[wi].cx, wallZ + 1.6, 10, 0.3);
      steer(0, 1); advance(0.4); steer(0, 0);
      expect(dw.panels[wi].state).toBe('wrongX');
    }
    expect(r.lockT).toBeGreaterThan(0);
    expect(dw.panels.find((p) => p.isCorrect)!.glow).toBe(false);
  });

  it('detour: 4 retry doors, no glow; two misses bring a new question', () => {
    const run = boot('hard', 4242);
    expect(run.course.detour.retryWall.doors).toHaveLength(4);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    const wi = r.doorWalls[0].panels.findIndex((p) => !p.isCorrect);
    walkTo(r.layout.doorWalls[0].doors[wi].cx, r.layout.doorWalls[0].z - 3, 10);
    advance(2);
    const d = run.detour!;
    const dl = run.course.detour;
    walkTo(dl.spawn.x, dl.spawn.z - 19, 10);
    const q0 = d.retryQuestion!.id;
    for (let k = 0; k < 2; k++) {
      const p = d.retryWall.panels.find((x) => !x.isCorrect && x.state === 'closed')!;
      walkTo(dl.retryWall.doors[p.index].cx, dl.retryWall.z + 2, 10, 0.3);
      walkTo(dl.retryWall.doors[p.index].cx, dl.retryWall.z - 1.2, 3, 0.3);
      steer(0, 1); advance(0.5); steer(0, 0);
      advance(1);
    }
    expect(d.retryWall.panels.some((p) => p.glow)).toBe(false);
    expect(d.retryQuestion!.id).not.toBe(q0);
  });
});

describe('detour on Normal', () => {
  it('3 retry doors; the right one glows after two misses', () => {
    const run = boot('normal', 4242);
    expect(run.course.detour.retryWall.doors).toHaveLength(3);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    const wi = r.doorWalls[0].panels.findIndex((p) => !p.isCorrect);
    walkTo(r.layout.doorWalls[0].doors[wi].cx, r.layout.doorWalls[0].z - 3, 10);
    advance(2);
    const d = run.detour!;
    const dl = run.course.detour;
    walkTo(dl.spawn.x, dl.spawn.z - 19, 10);
    const wrong = d.retryWall.panels.filter((x) => !x.isCorrect && x.state === 'closed');
    expect(wrong.length).toBeGreaterThanOrEqual(1);
    for (let k = 0; k < Math.min(2, wrong.length); k++) {
      const p = wrong[k];
      walkTo(dl.retryWall.doors[p.index].cx, dl.retryWall.z + 2, 10, 0.3);
      walkTo(dl.retryWall.doors[p.index].cx, dl.retryWall.z - 1.2, 3, 0.3);
      steer(0, 1); advance(0.5); steer(0, 0);
      advance(1);
      expect(d.retryWall.panels.find((x) => x.isCorrect)!.glow).toBe(k >= 1);
    }
  });
});

describe('power-ups and combo', () => {
  it('3 first-try answers in a row grant a power-up; a wrong answer resets the combo', () => {
    const run = boot('normal', 4242);
    run.combo = 2;
    const before = Object.values(run.powerups).reduce((a, b) => a + b, 0);
    const r = room(run, 'doorRush', 0);
    enterRoom(run, r);
    const i = r.doorWalls[0].panels.findIndex((p) => p.isCorrect);
    walkTo(r.layout.doorWalls[0].doors[i].cx, r.layout.doorWalls[0].z - 3, 10);
    expect(run.combo).toBe(3);
    expect(Object.values(run.powerups).reduce((a, b) => a + b, 0)).toBe(before + 1);
    expect(comboSpeedMult(run)).toBeCloseTo(1 + 3 * T.COMBO_SPEED_STEP, 6);
    run.combo = 10;
    expect(comboSpeedMult(run)).toBeCloseTo(1 + T.COMBO_SPEED_MAX, 6);
    const t = room(run, 'tileDrop', 0);
    enterRoom(run, t);
    const wrong = t.tiles.find((x) => !x.correct)!;
    walkTo(wrong.cx, wrong.cz, 10, 0.4);
    advance(T.TILE_TIMER.normal + 0.5);
    expect(run.combo).toBe(0);
  });

  it('Slime Freeze stops the slime for 10 s', () => {
    const run = boot('normal', 4242);
    run.powerups.freeze = 1;
    expect(engine.activatePowerup('freeze')).toBe(true);
    const s0 = run.slime;
    advance(5);
    expect(run.slime).toBe(s0);
    expect(run.zone).toBe('frozen');
    advance(T.FREEZE_TIME);
    expect(run.slime).toBeGreaterThan(s0);
  });

  it('Lantern widens the visibility radius in the current maze; Compass points along the way out', () => {
    const run = boot('normal', 4242);
    const seg = run.course.segments.find((s) => s.kind === 'maze')!;
    expect(visibilityRadius(run)).toBe(T.VIS_OPEN);
    place(seg.laneX, seg.z0 - 2);
    advance(0.2);
    expect(visibilityRadius(run)).toBe(T.VIS_RADIUS.normal);
    run.powerups.lantern = 1;
    run.powerups.compass = 1;
    expect(engine.activatePowerup('lantern')).toBe(true);
    expect(visibilityRadius(run)).toBe(T.VIS_RADIUS.normal + T.LANTERN_BONUS);
    expect(engine.activatePowerup('compass')).toBe(true);
    expect(run.compassT).toBeCloseTo(T.COMPASS_TIME, 1);
    // following the compass leads out of the maze (hazards off: this checks the guidance, not dodging hammers)
    run.godMode = true;
    for (let i = 0; i < 60 * 30; i++) {
      const p = G.player.pos;
      const tgt = compassTarget(run, p.x, p.z);
      if (!tgt || p.z < seg.z0 - seg.depth) break;
      const dx = tgt.x - p.x, dz = tgt.z - p.z, len = Math.hypot(dx, dz) || 1;
      steer(dx / len, -dz / len);
      update();
    }
    steer(0, 0);
    expect(G.player.pos.z).toBeLessThan(seg.z0 - seg.depth + 1);
    // Easy has no darkness and no lantern
    const easy = boot('easy', 4242);
    expect(visibilityRadius(easy)).toBe(T.VIS_OPEN);
    for (let i = 0; i < 30; i++) expect(grantPowerup(easy)).not.toBe('lantern');
  });

  it('X-ray is a free 50/50', () => {
    const run = boot('normal', 4242);
    const r = room(run, 'doorRush', 0);
    run.powerups.xray = 1;
    expect(engine.activatePowerup('xray')).toBe(false); // no question yet
    enterRoom(run, r);
    const coins = run.coins;
    expect(engine.activatePowerup('xray')).toBe(true);
    expect(r.doorWalls[0].panels.filter((p) => p.state === 'smashed')).toHaveLength(2);
    expect(run.coins).toBe(coins);
    expect(run.powerups.xray).toBe(0);
  });
});

describe('question supply', () => {
  it('questions seen in earlier runs are picked later than unseen ones', () => {
    const pack = questionSource.getPack('math');
    const pick = (seen: Set<string>) => selectQuestion({
      pack, type: 'mcq', tier: 2, usedIds: new Set(), recentConcepts: [], wrongConceptsThisRun: new Set(), rng: mulberry32(3), seenIds: seen,
    });
    const first = pick(new Set());
    const second = pick(new Set([first.id]));
    expect(second.id).not.toBe(first.id);
    expect(second.tier).toBe(first.tier);
  });
});
