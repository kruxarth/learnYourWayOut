import { afterEach, describe, expect, it } from 'vitest';
import { engine } from '../game/engine';
import { buildHub, padUnderPlayer } from '../game/loop/selection';
import { teleport } from '../game/loop/navigation';
import { parseUrlParams } from '../game/urlParams';
import { G } from '../game/state';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';
import { advance, finish } from './helpers';

afterEach(() => finish());

describe('hub', () => {
  it('has 5 portals and 13 pads; harder pads are closer to the portal', () => {
    const hub = buildHub();
    expect(hub.portals).toHaveLength(5);
    expect(hub.pads).toHaveLength(15);
    // Any Topic is at the centre of the arc with all three pads
    const any = hub.portals.find((p) => p.domainId === 'custom')!;
    expect(any.x).toBeCloseTo(0, 5);
    expect(any.z).toBeCloseTo(-16, 5);
    expect(hub.pads.filter((p) => p.domainId === 'custom')).toHaveLength(3);
    const angles = hub.portals.map((p) => Math.round((p.angle * 180) / Math.PI)).sort((a, b) => a - b);
    expect(angles).toEqual([-60, -30, 0, 30, 60]);
    for (const portal of hub.portals) {
      const pads = hub.pads.filter((p) => p.domainId === portal.domainId);
      const dist = (d: string) => { const p = pads.find((x) => x.difficulty === d)!; return Math.hypot(p.x - portal.x, p.z - portal.z); };
      expect(dist('hard')).toBeLessThan(dist('normal'));
      expect(dist('normal')).toBeLessThan(dist('easy'));
      expect(Math.hypot(portal.x, portal.z)).toBeCloseTo(16, 5);
    }
    expect(hub.trees.every((t) => Math.hypot(t.x, t.z) >= 19)).toBe(true);
  });

  it('the player starts on the island at (0, 0, 5) and can reach every pad', () => {
    engine.startHub();
    expect(useUI.getState().screen).toBe('hub');
    expect(G.player.pos.z).toBe(5);
    for (const pad of engine.hub!.pads) {
      expect(Math.hypot(pad.x, pad.z)).toBeLessThanOrEqual(T.HUB_RADIUS);
      expect(padUnderPlayer(engine.hub!, pad.x, pad.z)).toBe(pad);
    }
  });

  it('standing on a pad for 1 s starts a run with that domain and difficulty', () => {
    engine.startHub();
    const pad = engine.hub!.pads.find((p) => p.domainId === 'science' && p.difficulty === 'hard')!;
    teleport(G.player, pad.x, 0, pad.z);
    advance(0.5);
    expect(useUI.getState().screen).toBe('hub');
    expect(useUI.getState().hubPad?.domainId).toBe('science');
    expect(useUI.getState().hubPad?.progress).toBeGreaterThan(0.2);
    advance(1.2);
    expect(useUI.getState().screen).toBe('run');
    expect(useUI.getState().selection).toMatchObject({ domainId: 'science', difficulty: 'hard' });
    expect(G.run!.phase).toBe('countdown');
  });

  it('leaving a pad resets the charge', () => {
    engine.startHub();
    const pad = engine.hub!.pads[0];
    teleport(G.player, pad.x, 0, pad.z);
    advance(0.6);
    teleport(G.player, 0, 0, 5);
    advance(0.3);
    expect(engine.hub!.hold).toBe(0);
    expect(useUI.getState().screen).toBe('hub');
  });

  it('the countdown runs and then the player can move', () => {
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 4242 });
    const run = G.run!;
    const z0 = G.player.pos.z;
    advance(1);
    expect(run.phase).toBe('countdown');
    expect(G.player.inputLocked).toBe(true);
    advance(2.5);
    expect(run.phase).toBe('playing');
    expect(G.player.inputLocked).toBe(false);
    expect(G.player.pos.z).toBeCloseTo(z0, 1);
  });

  it('?demo=1 style runs give the same layout every time', () => {
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 4242 });
    const a = JSON.stringify(G.run!.course.walls);
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 4242 });
    expect(JSON.stringify(G.run!.course.walls)).toBe(a);
  });
});

describe('url params', () => {
  it('parses seed, domain, difficulty, demo and debug', () => {
    expect(parseUrlParams('?seed=12&domain=science&difficulty=hard&debug=1')).toMatchObject({ seed: 12, domain: 'science', difficulty: 'hard', debug: true, demo: false });
    expect(parseUrlParams('?demo=1')).toMatchObject({ demo: true, seed: null, domain: null });
    expect(parseUrlParams('?domain=bogus&difficulty=nope&seed=abc')).toMatchObject({ domain: null, difficulty: null, seed: null });
    expect(parseUrlParams('')).toMatchObject({ demo: false, debug: false, arena: false });
  });
});
