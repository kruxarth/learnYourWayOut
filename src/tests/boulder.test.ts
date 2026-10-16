import { afterEach, describe, expect, it } from 'vitest';
import { advance, boot, enterRoom, finish, place, room, steer, walkTo } from './helpers';
import { useLifelineSafe } from './rooms.util';
import { questionSource } from '../content/source';
import type { DomainPack } from '../content/schema';
import { buildCourse, recipeOverride } from '../game/loop/generation';
import { DEMO_RECIPE, POOL, TEMPLATES, eligibleEntries, gauntletRecipe, resolveRecipe } from '../game/loop/pool';
import { boulderSpeed } from '../game/rooms/boulderRun';
import { mulberry32, stream } from '../game/rng';
import type { RoomRuntime, RunState } from '../game/runtime';
import { G } from '../game/state';
import { T } from '../game/tuning';
import type { Course, Difficulty } from '../game/types';
import { playThrough } from './bot';

afterEach(() => { finish(); recipeOverride.mode = 'pool'; });

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const BOULDER_DIFFS: Difficulty[] = ['normal', 'hard'];

function bootWithBoulder(d: Difficulty, from = 1): RunState {
  for (let seed = from; seed < from + 120; seed++) {
    const run = boot(d, seed, 'math', {}, true);
    if (run.rooms.some((r) => r.kind === 'boulderRun')) return run;
  }
  throw new Error('no boulderRun course');
}

/** Wall boxes that block a player circle at (x, z): enabled walls only. */
function blocked(c: Course, x: number, z: number, skip: Set<number> = new Set()): boolean {
  const r = T.PLAYER_RADIUS;
  return c.walls.some((w) => w.enabled && !skip.has(w.id) && x > w.minX - r && x < w.maxX + r && z > w.minZ - r && z < w.maxZ + r);
}

/** Grid flood fill inside the room from its entrance to the hall, with only `open` gates passable. */
function hallReachable(c: Course, roomId: string, open: number | null): boolean {
  const L = c.rooms.find((r) => r.id === roomId)!;
  const B = L.boulder!;
  const gates = new Set(B.alcoves.map((a) => a.gateWallId).filter((g): g is number => g !== null));
  const skip = new Set<number>();
  // the entrance gate is closed behind the player but the player is already inside; ignore it
  if (L.gateWallId !== null) skip.add(L.gateWallId);
  if (open !== null && B.alcoves[open].gateWallId !== null) skip.add(B.alcoves[open].gateWallId!);
  void gates;
  const res = 0.25;
  const minX = L.laneX - 10, minZ = L.z0 - L.depth, W = Math.ceil(20 / res), H = Math.ceil(L.depth / res);
  const seen = new Uint8Array(W * H);
  const sx = Math.round((L.laneX - minX) / res), sz = Math.round((L.z0 - 1.5 - minZ) / res);
  const queue = [sz * W + sx];
  seen[queue[0]] = 1;
  const goalZ = L.z0 - L.depth + 2;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi], cx = cur % W, cz = (cur - cx) / W;
    if (minZ + cz * res <= goalZ) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const k = nz * W + nx;
      if (seen[k] || blocked(c, minX + nx * res, minZ + nz * res, skip)) continue;
      seen[k] = 1; queue.push(k);
    }
  }
  return false;
}

describe('Boulder Run in the pool', () => {
  it('is a big set piece from Normal up and fits packs with mcq questions', () => {
    const pack = questionSource.getPack('math');
    const e = POOL.find((x) => x.kind === 'boulderRun')!;
    expect(e.slot).toBe('room');
    expect(e.big).toBe(true);
    expect(e.minDifficulty).toBe('normal');
    expect(e.fits(pack)).toBe(true);
    expect(e.fits({ ...pack, questions: pack.questions.filter((q) => q.type !== 'mcq') } as DomainPack)).toBe(false);
    expect(eligibleEntries('room', 'easy', pack).some((x) => x.kind === 'boulderRun')).toBe(false);
    expect(eligibleEntries('room', 'normal', pack).some((x) => x.kind === 'boulderRun')).toBe(true);
  });

  it('shows up on Normal and Hard but never on Easy, never next to another big room, and is not pinned in the demo', () => {
    const pack = questionSource.getPack('math');
    for (const d of DIFFS) {
      let seen = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const steps = resolveRecipe(TEMPLATES[d], { domainId: 'math', difficulty: d, seed }, pack, stream(seed, 'recipe'));
        seen += steps.filter((s) => s.k === 'boulderRun').length;
      }
      if (d === 'easy') expect(seen).toBe(0); else expect(seen, d).toBeGreaterThan(40);
    }
    expect(DEMO_RECIPE.some((s) => s.k === 'boulderRun')).toBe(false);
    expect(gauntletRecipe(pack, stream(3, 'recipe')).some((s) => s.k === 'boulderRun')).toBe(true);
  });
});

describe('Boulder Run geometry', () => {
  it('a 40 m corridor, 3 end alcoves (Hard: 2 mid-run pockets too), one gate per end alcove, and the hall is only reachable through the right gate', () => {
    for (const d of BOULDER_DIFFS) {
      let seen = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = buildCourse({ domainId: 'math', difficulty: d, seed });
        for (const rl of c.rooms.filter((r) => r.kind === 'boulderRun')) {
          seen++;
          const B = rl.boulder!;
          expect(rl.depth).toBeCloseTo(T.BOULDER_LEN + T.WALL_T + T.BOULDER_HALL_D, 6);
          expect(B.waves).toHaveLength(T.BOULDER_WAVES[d]);
          const end = B.waves[B.waves.length - 1];
          expect(end).toHaveLength(3);
          if (d === 'hard') expect(B.waves[0]).toHaveLength(2);
          for (const slot of end) expect(B.alcoves[slot].gateWallId, `${d} gate`).not.toBeNull();
          for (const slot of B.waves.slice(0, -1).flat()) expect(B.alcoves[slot].gateWallId).toBeNull();
          for (const a of B.alcoves) {
            // the alcove interior is free floor, inside the room
            const x = B.axisX + a.side * (T.BOULDER_CW + T.BOULDER_ALC_DEPTH / 2);
            expect(blocked(c, x, a.cz), `${d} seed ${seed} alcove free`).toBe(false);
            expect(c.floors.some((f) => f.enabled && x >= f.minX && x <= f.maxX && a.cz >= f.minZ && a.cz <= f.maxZ)).toBe(true);
            expect(a.maxZ - a.minZ).toBeCloseTo(T.BOULDER_ALC_LEN, 6);
            expect(a.minZ).toBeGreaterThan(B.endZ);
          }
          // the corridor's far end is a wall; every end alcove is deep enough to be out of the boulder's path
          expect(T.BOULDER_ENTER_X).toBeGreaterThan(T.BOULDER_R + T.PLAYER_RADIUS);
          expect(T.BOULDER_ENTER_X).toBeLessThan(T.BOULDER_CW + T.BOULDER_ALC_DEPTH);
          // closed gates: the hall cannot be reached; opening any one end alcove's gate does reach it
          expect(hallReachable(c, rl.id, null), `${d} seed ${seed} sealed`).toBe(false);
          for (const slot of end) expect(hallReachable(c, rl.id, slot), `${d} seed ${seed} via ${slot}`).toBe(true);
        }
      }
      expect(seen, d).toBeGreaterThan(0);
    }
  });

  it('the same seed gives the same boulder layout', () => {
    for (const d of BOULDER_DIFFS) {
      for (let seed = 1; seed <= 30; seed++) {
        const a = buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.map((r) => r.boulder);
        const b = buildCourse({ domainId: 'math', difficulty: d, seed }).rooms.map((r) => r.boulder);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    }
  });
});

describe('Boulder Run play', () => {
  it('shows the question on entry, rumbles for 3 s (Hard 2 s), then releases a boulder at 0.8 x MAX_SPEED (Hard 0.9)', () => {
    for (const d of BOULDER_DIFFS) {
      const run = bootWithBoulder(d);
      const r = room(run, 'boulderRun');
      enterRoom(run, r);
      const B = r.boulder!;
      expect(r.state).toBe('active');
      expect(r.question).not.toBeNull();
      expect(B.phase).toBe('rumble');
      const rumble = T.BOULDER_RUMBLE_S[d];
      expect(rumble).toBe(d === 'hard' ? 2 : 3);
      // the player stays put; the entrance gate is shut behind them
      advance(rumble - 0.5);
      expect(B.phase).toBe('rumble');
      advance(0.7);
      expect(B.phase).toBe('rolling');
      // speed = fraction x MAX_SPEED x the slime wade factor (none at slime 0.0x)
      run.slime = 0;
      const d0 = B.d;
      advance(0.5);
      const v = (B.d - d0) / 0.5;
      expect(v).toBeCloseTo(T.BOULDER_SPEED[d] * T.MAX_SPEED, 0);
      expect(T.BOULDER_SPEED[d]).toBe(d === 'hard' ? 0.9 : 0.8);
    }
  });

  it('the boulder always runs slower than the player, on every slime level', () => {
    const run = bootWithBoulder('normal');
    for (const d of BOULDER_DIFFS) {
      run.selection.difficulty = d;
      for (let s = 0; s <= 1.0001; s += 0.05) {
        run.slime = s;
        const wade = 1 - T.WADE_SLOW * Math.min(1, Math.max(0, (T.SLIME_Y_MIN + (T.SLIME_Y_MAX - T.SLIME_Y_MIN) * s) / T.SLIME_Y_MAX));
        const player = T.MAX_SPEED * wade;
        expect(boulderSpeed(run) / player).toBeLessThan(1);
        expect(boulderSpeed(run) / player).toBeCloseTo(T.BOULDER_SPEED[d], 6);
      }
    }
  });

  it('a boulder that catches the player squashes them: surge x0.5, back to the room start, boulder reset, same question', () => {
    const run = bootWithBoulder('normal');
    const r = room(run, 'boulderRun');
    enterRoom(run, r);
    const B = r.boulder!;
    const q = r.question;
    const s0 = run.slime;
    // stand still in the corridor until the boulder arrives
    place(r.layout.laneX, r.layout.z0 - 12);
    for (let i = 0; i < 20 * 60 && B.squashes === 0; i++) advance(1 / 60);
    expect(B.squashes).toBe(1);
    advance(1);
    expect(run.slime - s0).toBeGreaterThan(T.SLIME_SURGE.normal * T.BOULDER_SQUASH_SURGE * 0.9);
    expect(run.slime - s0).toBeLessThan(T.SLIME_SURGE.normal * T.BOULDER_SQUASH_SURGE + 0.03);
    const start = r.layout.boulder!.startSpawn;
    expect(Math.hypot(G.player.pos.x - start.x, G.player.pos.z - start.z)).toBeLessThan(1.5);
    expect(B.phase).toBe('rumble');
    expect(B.d).toBe(T.BOULDER_START);
    expect(r.question).toBe(q);
    expect(r.state).toBe('active');
    expect(run.records).toHaveLength(0);
    expect(G.player.inputLocked).toBe(false);
  });

  it('a Shield blocks one squash', () => {
    const run = bootWithBoulder('normal');
    const r = room(run, 'boulderRun');
    enterRoom(run, r);
    const B = r.boulder!;
    run.shield = true;
    place(r.layout.laneX, r.layout.z0 - 12);
    for (let i = 0; i < 20 * 60 && B.phase !== 'smash'; i++) advance(1 / 60);
    expect(B.squashes).toBe(0);
    expect(run.shield).toBe(false);
    expect(B.shielded).toBe(true);
    expect(Math.abs(G.player.pos.z - (r.layout.z0 - 12))).toBeLessThan(1);
  });

  it('the right alcove opens its gate and resolves the room as correct; the boulder smashes into the end wall', () => {
    const run = bootWithBoulder('normal');
    const r = room(run, 'boulderRun');
    enterRoom(run, r);
    const B = r.boulder!;
    const L = r.layout.boulder!;
    const w = B.waves[0];
    expect(w.alcoves).toHaveLength(3);
    expect(w.alcoves.filter((a) => a.correct)).toHaveLength(1);
    expect(new Set(w.alcoves.map((a) => a.label)).size).toBe(3);
    for (const a of w.alcoves) expect(a.label.length).toBeLessThanOrEqual(22);
    const right = w.alcoves.find((a) => a.correct)!;
    const geo = L.alcoves[right.slot];
    expect(run.world.walls[geo.gateWallId!].enabled).toBe(true);
    place(L.axisX + geo.side * 3.4, geo.cz);
    advance(0.2);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    expect(run.world.walls[geo.gateWallId!].enabled).toBe(false);
    expect(run.records).toHaveLength(1);
    expect(run.records[0].correctFirstTry).toBe(true);
    // the wrong gates stay shut
    for (const a of w.alcoves) if (!a.correct) expect(run.world.walls[L.alcoves[a.slot].gateWallId!].enabled).toBe(true);
    // a boulder already on its way runs on and smashes
    for (let i = 0; i < 25 * 60 && B.phase !== 'smash'; i++) advance(1 / 60);
    advance(T.BOULDER_SMASH_S + 0.2);
    expect(B.phase).toBe('idle');
  });

  it('a wrong alcove is a dead end marked X with a surge; after the boulder smashes, it comes again and the right alcove is remediated', () => {
    const run = bootWithBoulder('normal');
    const r = room(run, 'boulderRun');
    enterRoom(run, r);
    const B = r.boulder!;
    const L = r.layout.boulder!;
    const w = B.waves[0];
    const wrong = w.alcoves.find((a) => !a.correct)!;
    const gw = L.alcoves[wrong.slot];
    const s0 = run.slime;
    place(L.axisX + gw.side * 3.4, gw.cz);
    advance(0.1);
    expect(wrong.state).toBe('wrong');
    expect(run.slime - s0).toBeGreaterThan(T.SLIME_SURGE.normal * 0.9);
    expect(r.state).toBe('active');
    expect(w.passed).toBe(false);
    expect(run.world.walls[gw.gateWallId!].enabled).toBe(true);
    // the player is safe in the alcove while the boulder passes
    for (let i = 0; i < 25 * 60 && B.phase !== 'smash'; i++) advance(1 / 60);
    expect(B.squashes).toBe(0);
    advance(T.BOULDER_SMASH_S + 0.1);
    expect(B.phase).toBe('rumble');
    // a second visit to the crossed-out alcove costs nothing
    const s1 = run.slime;
    place(L.axisX + gw.side * 3.4, gw.cz + 0.5);
    advance(0.1);
    expect(run.slime - s1).toBeLessThan(0.01);
    const right = w.alcoves.find((a) => a.correct)!;
    const rg = L.alcoves[right.slot];
    place(L.axisX + rg.side * 3.4, rg.cz);
    advance(0.2);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('remediated');
    expect(run.records[0].correctFirstTry).toBe(false);
    expect(r.wrongCount).toBe(1);
  });

  it('50/50 crosses out one wrong alcove', () => {
    const run = bootWithBoulder('normal');
    const r = room(run, 'boulderRun');
    enterRoom(run, r);
    run.coins = 5;
    useLifelineSafe('fifty');
    const crossed = r.boulder!.waves[0].alcoves.filter((a) => a.state === 'wrong');
    expect(crossed).toHaveLength(1);
    expect(crossed[0].correct).toBe(false);
  });

  it('Hard has two waves: the mid-run pockets first (a question), then the real alcoves (another)', () => {
    const run = bootWithBoulder('hard');
    const r = room(run, 'boulderRun');
    enterRoom(run, r);
    const B = r.boulder!;
    const L = r.layout.boulder!;
    expect(B.wave).toBe(0);
    const q0 = r.question;
    const right0 = B.waves[0].alcoves.find((a) => a.correct)!;
    const g0 = L.alcoves[right0.slot];
    expect(g0.gateWallId).toBeNull();
    place(L.axisX + g0.side * 3.4, g0.cz);
    advance(0.2);
    // a pocket that is right passes the wave but does not end the room
    expect(r.state).toBe('active');
    expect(B.waves[0].passed).toBe(true);
    // the boulder is released, rolls past and smashes; then the second question and a new rumble
    for (let i = 0; i < 25 * 60 && B.wave === 0; i++) advance(1 / 60);
    expect(B.wave).toBe(1);
    expect(B.phase).toBe('rumble');
    expect(r.question).not.toBe(q0);
    const right1 = B.waves[1].alcoves.find((a) => a.correct)!;
    const g1 = L.alcoves[right1.slot];
    expect(g1.gateWallId).not.toBeNull();
    place(L.axisX + g1.side * 3.4, g1.cz);
    advance(0.2);
    expect(r.state).toBe('resolved');
    expect(r.result).toBe('correct');
    expect(run.records).toHaveLength(2);
    expect(run.records.every((x) => x.correctFirstTry)).toBe(true);
  });
});

describe('Boulder Run fairness: a player who knows the answer always escapes', () => {
  /** Read for `readS` seconds standing at the entrance, then run straight to the right alcove and duck in. */
  function knowerRuns(d: Difficulty, seed: number, slime: number, readS: number): { squashes: number; resolved: boolean } {
    const run = boot(d, seed, 'math', {}, true);
    const r = room(run, 'boulderRun');
    if (!r) return { squashes: 0, resolved: true };
    enterRoom(run, r);
    run.slime = slime;
    run.freezeT = 0;
    const B = r.boulder!;
    const L = r.layout.boulder!;
    advance(readS);
    for (let wave = 0; wave < L.waves.length; wave++) {
      const w = B.waves[B.wave];
      const al = w.alcoves.find((a) => a.correct)!;
      const g = L.alcoves[al.slot];
      // the knowing player runs: the corridor axis to the alcove's z, then sideways into it
      const ok = walkTo(L.axisX, g.cz, 20, 0.3) && walkTo(L.axisX + g.side * 3.4, g.cz, 6, 0.3);
      if (!ok || B.squashes > 0) return { squashes: B.squashes, resolved: false };
      // wait for the next wave (Hard) to begin, safe in the pocket
      for (let i = 0; i < 25 * 60 && B.wave === wave && r.state !== 'resolved'; i++) advance(1 / 60);
      run.slime = slime;
    }
    return { squashes: B.squashes, resolved: r.state === 'resolved' };
  }

  it('reads for the whole rumble, then runs: never squashed on any seed, difficulty or slime level', () => {
    let tried = 0;
    for (const d of BOULDER_DIFFS) {
      for (const slime of [0, 0.4, 0.7, 0.95]) {
        for (let seed = 1; seed <= 12; seed++) {
          const res = knowerRuns(d, seed, slime, T.BOULDER_RUMBLE_S[d]);
          tried++;
          expect(res, `${d} seed ${seed} slime ${slime}`).toEqual({ squashes: 0, resolved: true });
        }
      }
    }
    expect(tried).toBeGreaterThan(0);
  }, 120_000);

  it('the head start covers more than the whole rumble plus a second of dithering, with room to spare', () => {
    for (const d of BOULDER_DIFFS) {
      const rumble = T.BOULDER_RUMBLE_S[d];
      // the worst case: the player has not moved from the entrance (d ~ 1) when the boulder is released
      const gap = 1 - T.BOULDER_START;
      const contact = T.BOULDER_R + T.PLAYER_RADIUS;
      const vb = T.BOULDER_SPEED[d] * T.MAX_SPEED, vp = T.MAX_SPEED;
      // time until the boulder touches a player who starts running t seconds after the release
      const slack = (gap - contact) / vb;
      expect(slack, `${d}: ${rumble} s rumble`).toBeGreaterThan(1.5);
      // a runner that starts within `slack` is never caught, because vp > vb; the nearest alcove is reached first
      const nearest = 27 - 1;
      const player = (nearest / vp) + 1.0; // a second of dithering
      const boulder = (nearest - T.BOULDER_START) / vb;
      expect(boulder - player, d).toBeGreaterThan(1.0);
    }
  });
});

describe('Boulder Run with the bot', () => {
  it('guessers and 60% players qualify or lose cleanly on Normal and Hard', () => {
    for (const d of BOULDER_DIFFS) {
      for (let i = 0; i < 4; i++) {
        const res = playThrough(d, 40 + i, { accuracy: 0.6, rng: mulberry32(i + 5), keepAlive: true, route: 'short', junctionRight: true });
        expect(['won', 'lost'], `${d} ${40 + i}`).toContain(res.run.phase);
      }
    }
  });

  it('a slow reader (reads 6 s) gets squashed at least once, then still finishes', () => {
    let squashed = 0;
    for (let i = 0; i < 6; i++) {
      const res = playThrough('normal', 30 + i, { thinkSec: 6, keepAlive: true, route: 'short', junctionRight: true });
      expect(res.run.phase).toBe('won');
      squashed += res.run.rooms.reduce((n: number, x: RoomRuntime) => n + (x.boulder?.squashes ?? 0), 0);
    }
    expect(squashed).toBeGreaterThan(0);
  }, 120_000);
});

void steer;
