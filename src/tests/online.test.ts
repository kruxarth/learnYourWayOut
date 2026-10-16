import { afterEach, describe, expect, it } from 'vitest';
import { engine } from '../game/engine';
import { input } from '../game/input';
import { teleport } from '../game/loop/navigation';
import { G } from '../game/state';
import { T } from '../game/tuning';
import { useUI } from '../ui/store';
import { advance, finish } from './helpers';

const wall = { t: 5_000_000 };
engine.setWallClock(() => wall.t);

afterEach(() => { finish(); useUI.setState({ lobbyOpen: false, leaveMenuOpen: false }); });

const sel = { domainId: 'math', difficulty: 'normal', seed: 4242, mode: 'online' } as const;

describe('synced countdown', () => {
  it('waits locked and silent until countdownAt, then plays 3-2-1-GO on the wall clock', () => {
    engine.startRun({ ...sel }, { countdownAt: wall.t + 3000 });
    const run = G.run!;
    const banners: string[] = [];
    const off = G.events.on((e) => { if (e.type === 'countdown') banners.push(String(e.n)); });
    advance(2.5);
    wall.t += 2500;
    expect(run.phase).toBe('countdown');
    expect(G.player.inputLocked).toBe(true);
    expect(useUI.getState().banner?.text).toBe('Get ready…');
    expect(banners).toEqual([]); // no "5", "4" while waiting, no early 3
    wall.t += 500; // countdownAt reached
    advance(0.1);
    expect(banners).toEqual(['3']);
    expect(useUI.getState().banner?.text).toBe('3');
    wall.t += T.COUNTDOWN_STEP * 1000;
    advance(0.05);
    wall.t += T.COUNTDOWN_STEP * 1000;
    advance(0.05);
    expect(banners).toEqual(['3', '2', '1']);
    expect(run.phase).toBe('countdown');
    wall.t += T.COUNTDOWN_STEP * 1000;
    advance(0.05);
    expect(banners).toEqual(['3', '2', '1', '0']);
    expect(run.phase).toBe('playing');
    expect(G.player.inputLocked).toBe(false);
    off();
    wall.t += 1000;
  });

  it('a late start (countdownAt long past) goes straight to GO', () => {
    engine.startRun({ ...sel }, { countdownAt: wall.t - 10_000 });
    advance(0.1);
    expect(G.run!.phase).toBe('playing');
  });

  it('without countdownAt the countdown is the normal 3-2-1-GO', () => {
    engine.startRun({ ...sel });
    advance(1);
    expect(G.run!.phase).toBe('countdown');
    advance(2.5);
    expect(G.run!.phase).toBe('playing');
  });
});

describe('online-mode rules', () => {
  it('cannot be paused; Esc toggles the leave menu while the game keeps running', () => {
    engine.startRun({ ...sel }, { countdownAt: wall.t - 10_000 });
    advance(0.5);
    engine.setPaused(true);
    expect(G.run!.paused).toBe(false);
    input.press('pause');
    advance(0.05);
    expect(useUI.getState().leaveMenuOpen).toBe(true);
    expect(useUI.getState().paused).toBe(false);
    const t0 = G.run!.elapsedMs;
    advance(0.5);
    expect(G.run!.elapsedMs).toBeGreaterThan(t0 + 400);
    input.press('pause');
    advance(0.05);
    expect(useUI.getState().leaveMenuOpen).toBe(false);
  });

  it('solo runs still pause', () => {
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 4242 });
    advance(3.3);
    engine.setPaused(true);
    expect(G.run!.paused).toBe(true);
  });

  it('debug keys are off online (and work in a solo run)', () => {
    G.debug = true;
    const poll = input.poll;
    const pressK = () => {
      input.poll = () => { const st = poll.call(input); st.keys = ['KeyK']; return st; };
      advance(0.05);
      input.poll = poll;
    };
    try {
      engine.startRun({ ...sel }, { countdownAt: wall.t - 10_000 });
      advance(0.5);
      pressK(); // KeyK would fill the slime bar
      expect(G.run!.slime).toBeLessThan(1);
      engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 4242 });
      advance(3.3);
      pressK();
      expect(G.run!.slime).toBe(1);
    } finally { G.debug = false; input.poll = poll; }
  });

  it('restartRun from an online run goes back to the hub', () => {
    engine.startRun({ ...sel }, { countdownAt: wall.t - 10_000 });
    engine.restartRun();
    expect(engine.mode).toBe('hub');
  });
});

describe('netSnapshot', () => {
  it('is null outside an online run and returns one reused object inside it', () => {
    engine.startRun({ domainId: 'math', difficulty: 'normal', seed: 4242 });
    expect(engine.netSnapshot()).toBeNull();
    engine.startHub();
    expect(engine.netSnapshot()).toBeNull();
    engine.startRun({ ...sel }, { countdownAt: wall.t - 10_000 });
    advance(3);
    const a = engine.netSnapshot()!;
    const seq = a.seq;
    teleport(G.player, 3, 0, -2);
    const b = engine.netSnapshot()!;
    expect(b).toBe(a);
    expect(b.seq).toBe(seq + 1);
    expect(b.x).toBe(3);
    expect(b).toMatchObject({ g: false, detour: false, solved: 0, asked: 0, correct: 0 });
    expect(Object.keys(b).sort()).toEqual(['asked', 'bc', 'correct', 'detour', 'f', 'g', 'seg', 'seq', 'slime', 'solved', 'sp', 'spin', 'x', 'y', 'z']);
  });
});

describe('run result event and Play Online booth', () => {
  it('emits runResult when the results are built', () => {
    engine.startRun({ ...sel }, { countdownAt: wall.t - 10_000 });
    advance(0.5);
    const got: string[] = [];
    const off = G.events.on((e) => { if (e.type === 'runResult') got.push(`${e.result.outcome}:${e.result.selection.mode}`); });
    engine.debug.win();
    advance(T.RESULT_DELAY + 0.5);
    off();
    expect(got).toEqual(['qualified:online']);
  });

  it('the booth sits at (6, 9) and opens the lobby once', () => {
    engine.startHub();
    const hub = engine.hub!;
    expect(hub.booths.find((b) => b.id === 'online')).toMatchObject({ x: 6, z: 9 });
    teleport(G.player, 6, 0, 9);
    advance(0.2);
    expect(useUI.getState().lobbyOpen).toBe(false);
    advance(0.6);
    expect(useUI.getState().lobbyOpen).toBe(true);
    // the hub freezes while it is open, and Esc closes it
    const z0 = G.player.pos.z;
    advance(0.3);
    expect(G.player.pos.z).toBe(z0);
    input.press('pause');
    advance(0.05);
    expect(useUI.getState().lobbyOpen).toBe(false);
  });
});
