import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, finish, place, stick } from './helpers';
import { inMazeSegment, isMazeHedge, isMazeKind } from '../game/loop/visibility';
import { G } from '../game/state';
import { T } from '../game/tuning';

afterEach(() => finish());

describe('chase cam in mazes', () => {
  it('A/D steer the bean and the camera yaw follows its heading', () => {
    const run = boot('normal', 4242);
    const seg = run.course.segments.find((s) => s.kind === 'maze')!;
    place(seg.laneX, seg.z0 - 2);
    expect(inMazeSegment(run)).toBe(true);
    const f0 = G.player.facing;
    stick(-1, 0); // A: turn left on the spot
    advance(0.25);
    stick(0, 0);
    expect(G.player.facing - f0).toBeCloseTo(T.CHASE_TURN_RATE * 0.25, 1);
    expect(G.camera.yaw).toBe(G.player.facing);
    // leaving the maze swings the free camera back to looking up the course
    place(seg.laneX, seg.z0 + 1);
    expect(inMazeSegment(run)).toBe(false);
    expect(G.camera.yaw).toBe(0);
  });

  it('outside mazes A/D strafe relative to the camera and the camera stays put', () => {
    const run = boot('normal', 4242);
    expect(inMazeSegment(run)).toBe(false);
    const x0 = G.player.pos.x, yaw0 = G.camera.yaw;
    stick(1, 0);
    advance(0.3);
    stick(0, 0);
    expect(G.player.pos.x).toBeGreaterThan(x0 + 0.5);
    expect(G.camera.yaw).toBe(yaw0);
  });

  it('marks the hedges of maze segments (drawn tall) and nothing else', () => {
    const run = boot('normal', 4242);
    const tall = run.world.walls.filter((w) => isMazeHedge(w, run.course.segments));
    expect(tall.length).toBeGreaterThan(10);
    for (const w of run.world.walls) {
      if (w.kind !== 'hedge') expect(isMazeHedge(w, run.course.segments)).toBe(false);
    }
    // a hedge in a non-maze segment stays at its normal height
    const plain = run.course.segments.filter((s) => !isMazeKind(s.kind));
    const outside = run.world.walls.filter((w) => w.kind === 'hedge' && !isMazeHedge(w, run.course.segments));
    expect(plain.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
  });
});
