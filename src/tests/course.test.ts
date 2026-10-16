import { describe, expect, it } from 'vitest';
import { buildCourse } from '../game/loop/generation';
import type { Course, Difficulty, RunSelection, WallBox } from '../game/types';
import { T } from '../game/tuning';
import { branchCells, reachableCells } from '../game/loop/maze';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const sel = (difficulty: Difficulty, seed: number): RunSelection => ({ domainId: 'math', difficulty, seed });
const ROOMS = { easy: 6, normal: 10, hard: 12 };

function insideWall(c: Course, x: number, z: number): WallBox | undefined {
  return c.walls.find((w) => w.enabled && x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ);
}

function pathExists(c: Course): boolean {
  const R = T.PLAYER_RADIUS;
  const blockers = c.walls.filter((w) => w.isStatic);
  const res = 0.25;
  const minX = c.bounds.minX - 2, minZ = c.bounds.minZ - 2;
  const W = Math.ceil((c.bounds.maxX + 2 - minX) / res), H = Math.ceil((c.bounds.maxZ + 2 - minZ) / res);
  const floorOk = new Uint8Array(W * H);
  for (const f of c.floors) {
    if (f.minX > c.bounds.maxX + 5) continue; // skip the far-away detour
    const x0 = Math.max(0, Math.floor((f.minX - minX) / res)), x1 = Math.min(W - 1, Math.ceil((f.maxX - minX) / res));
    const z0 = Math.max(0, Math.floor((f.minZ - minZ) / res)), z1 = Math.min(H - 1, Math.ceil((f.maxZ - minZ) / res));
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) floorOk[iz * W + ix] = 1;
  }
  const blocked = new Uint8Array(W * H);
  for (const w of blockers) {
    if (w.minX > c.bounds.maxX + 5) continue;
    const x0 = Math.max(0, Math.floor((w.minX - R - minX) / res)), x1 = Math.min(W - 1, Math.ceil((w.maxX + R - minX) / res));
    const z0 = Math.max(0, Math.floor((w.minZ - R - minZ) / res)), z1 = Math.min(H - 1, Math.ceil((w.maxZ + R - minZ) / res));
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const px = minX + ix * res, pz = minZ + iz * res;
      const cx = Math.min(Math.max(px, w.minX), w.maxX), cz = Math.min(Math.max(pz, w.minZ), w.maxZ);
      if ((px - cx) ** 2 + (pz - cz) ** 2 < R * R) blocked[iz * W + ix] = 1;
    }
  }
  const sx = Math.round((c.spawn.x - minX) / res), sz = Math.round((c.spawn.z - minZ) / res);
  const tx = Math.round((c.exitPortal.x - minX) / res), tz = Math.round((c.exitPortal.z - minZ) / res);
  const seen = new Uint8Array(W * H);
  const queue = [sz * W + sx];
  seen[sz * W + sx] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi], cx = cur % W, cz = (cur - cx) / W;
    if (Math.abs(cx - tx) <= 1 && Math.abs(cz - tz) <= 1) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const k = nz * W + nx;
      if (seen[k] || !floorOk[k] || blocked[k]) continue;
      seen[k] = 1; queue.push(k);
    }
  }
  return false;
}

describe('course generation', () => {
  it('segments in each lane are contiguous and both lanes end at the same Z', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 20; seed++) {
        const c = buildCourse(sel(d, seed));
        const hall = c.segments.find((s) => s.kind === 'forkHall' || s.kind === 'junctionHall')!;
        expect(hall.kind).toBe(T.JUNCTION_HALL[d] ? 'junctionHall' : 'forkHall');
        const merge = c.segments.find((s) => s.kind === 'mergeHall')!;
        const lanes = (['short', 'long'] as const).map((l) => c.segments.filter((s) => s.lane === l));
        for (const lane of lanes) {
          expect(lane[0].z0).toBeCloseTo(hall.z0 - hall.depth, 6);
          for (let i = 1; i < lane.length; i++) expect(lane[i].z0).toBeCloseTo(lane[i - 1].z0 - lane[i - 1].depth, 6);
          const last = lane[lane.length - 1];
          expect(last.z0 - last.depth).toBeCloseTo(merge.z0, 6);
        }
        const main = c.segments.filter((s) => s.lane === 'main');
        for (let i = 1; i < main.length; i++) {
          const a = main[i - 1], b = main[i];
          if (a.kind === 'forkHall' || a.kind === 'junctionHall') expect(b.kind).toBe('mergeHall');
          else expect(b.z0).toBeCloseTo(a.z0 - a.depth, 6);
        }
        expect(Math.abs(lanes[0][0].laneX)).toBe(T.LANE_OFFSET);
        expect(lanes[0][0].laneX).toBe(-lanes[1][0].laneX);
      }
    }
  });

  it('opening centers align at every segment boundary', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 10; seed++) {
        const c = buildCourse(sel(d, seed));
        for (const s of c.segments) {
          if (s.kind === 'start') continue;
          const centers = s.kind === 'mergeHall' ? [-T.LANE_OFFSET, T.LANE_OFFSET] : [s.laneX];
          for (const cx of centers) {
            expect(insideWall(c, cx, s.z0), `${s.kind} entrance free`).toBeUndefined();
            expect(insideWall(c, cx + 2.5, s.z0), `${s.kind} wall right of entrance`).toBeDefined();
            expect(insideWall(c, cx - 2.5, s.z0), `${s.kind} wall left of entrance`).toBeDefined();
          }
        }
      }
    }
  });

  it('spawn is over a floor and the exit portal exists', () => {
    for (const d of DIFFS) {
      const c = buildCourse(sel(d, 5));
      expect(c.floors.some((f) => f.enabled && c.spawn.x >= f.minX && c.spawn.x <= f.maxX && c.spawn.z >= f.minZ && c.spawn.z <= f.maxZ)).toBe(true);
      expect(c.exitPortal.z).toBeLessThan(c.spawn.z);
    }
  });

  it('room triggers lie inside their segment', () => {
    for (const d of DIFFS) {
      const c = buildCourse(sel(d, 9));
      for (const t of c.triggers) {
        const roomId = t.data.roomId;
        if (roomId === undefined) continue;
        const seg = c.segments.find((s) => s.roomId === roomId)!;
        expect(t.minX).toBeGreaterThanOrEqual(seg.laneX - seg.width / 2 - 1e-6);
        expect(t.maxX).toBeLessThanOrEqual(seg.laneX + seg.width / 2 + 1e-6);
        expect(t.maxZ).toBeLessThanOrEqual(seg.z0 + 1e-6);
        expect(t.minZ).toBeGreaterThanOrEqual(seg.z0 - seg.depth - 1e-6);
      }
    }
  });

  it('no two walls have identical bounds', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 20; seed++) {
        const c = buildCourse(sel(d, seed));
        const keys = new Set(c.walls.map((w) => [w.minX, w.minY, w.minZ, w.maxX, w.maxY, w.maxZ].map((v) => v.toFixed(4)).join(',')));
        expect(keys.size).toBe(c.walls.length);
      }
    }
  });

  it('room count matches the recipe', () => {
    for (const d of DIFFS) {
      const c = buildCourse(sel(d, 3));
      // a Key Hunt or Shifting Maze (from a mazeSlot) is a room of its own
      expect(c.rooms.length).toBe(ROOMS[d] + c.rooms.filter((r) => r.kind === 'keyHunt' || r.kind === 'shiftMaze').length);
      expect(c.rooms.map((r) => r.id)).toEqual(c.rooms.map((_, i) => `r${i}`));
    }
  });

  it('wall and floor ids equal their array index', () => {
    const c = buildCourse(sel('normal', 1));
    c.walls.forEach((w, i) => expect(w.id).toBe(i));
    c.floors.forEach((f, i) => expect(f.id).toBe(i));
    c.triggers.forEach((t, i) => expect(t.id).toBe(i));
  });

  it('the same seed gives an identical course; different seeds differ', () => {
    for (const d of DIFFS) {
      expect(buildCourse(sel(d, 4242))).toEqual(buildCourse(sel(d, 4242)));
    }
    expect(buildCourse(sel('normal', 1))).not.toEqual(buildCourse(sel('normal', 2)));
  });

  it('has mazes with dead ends and coins, a fork with two signs and a detour', () => {
    const c = buildCourse(sel('normal', 7));
    expect(c.mazeDeadEnds).toBeGreaterThan(0);
    expect(c.coins.length).toBeGreaterThan(4);
    expect(c.signs.map((s) => s.title).sort()).toEqual(['SCENIC ROUTE', 'SHORTCUT']);
    expect(c.detour.retryWall.doors).toHaveLength(T.DETOUR_DOORS.normal);
    expect(c.triggers.filter((t) => t.kind === 'laneChoice')).toHaveLength(2);
  });

  it('a path exists from spawn to the exit portal (doors, gates and room floors treated as passable)', () => {
    for (const d of DIFFS) {
      for (const seed of [1, 2, 3]) expect(pathExists(buildCourse(sel(d, seed))), `${d} seed ${seed}`).toBe(true);
    }
  });

  it('the path checker detects a sealed course', () => {
    const c = buildCourse(sel('normal', 1));
    const start = c.segments[0];
    c.walls.push({ id: c.walls.length, minX: -11, maxX: 11, minZ: start.z0 - 8, maxZ: start.z0 - 7, minY: 0, maxY: 2, kind: 'hedge', enabled: true, isStatic: true });
    expect(pathExists(c)).toBe(false);
  });

  it('quiz mazes: K junctions, correct corridors follow the solution path, wrong ones are dead ends', () => {
    for (const d of ['normal', 'hard'] as const) {
      let full = 0, total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const c = buildCourse(sel(d, seed));
        for (const room of c.rooms.filter((r) => r.kind === 'quizMaze')) {
          total++;
          const m = c.mazes.find((x) => x.segIndex === room.segIndex)!;
          const maze = { rows: m.rows, exitC: m.exitC, wallE: m.wallE, wallN: m.wallN, deadEnds: [], coins: [] };
          expect(room.junctions.length).toBeGreaterThanOrEqual(1);
          expect(room.junctions.length).toBeLessThanOrEqual(T.QUIZ_JUNCTIONS[d]);
          if (room.junctions.length === T.QUIZ_JUNCTIONS[d]) full++;
          const onPath = new Set(m.path.map((p) => `${p.c},${p.r}`));
          expect(m.path[0]).toEqual({ c: 2, r: 0 });
          expect(m.path[m.path.length - 1]).toEqual({ c: m.exitC, r: m.rows - 1 });
          // the maze is a tree: cells − 1 open edges
          expect(reachableCells(maze)).toBe(m.rows * 5);
          let edges = 0;
          for (const row of m.wallE) for (const w of row) if (!w) edges++;
          for (const row of m.wallN) for (const w of row) if (!w) edges++;
          expect(edges).toBe(m.rows * 5 - 1);
          let lastIndex = -1;
          for (const j of room.junctions) {
            const pi = m.path.findIndex((p) => p.c === j.cell.c && p.r === j.cell.r);
            expect(pi, 'junction on the solution path').toBeGreaterThan(0);
            expect(pi).toBeGreaterThan(lastIndex);
            lastIndex = pi;
            expect(j.branches.filter((b) => b.correct)).toHaveLength(1);
            expect(j.branches.length === 2 || j.branches.length === 3).toBe(true);
            for (const b of j.branches) {
              const n = { c: j.cell.c + b.dx, r: j.cell.r - b.dz };
              if (b.correct) expect(onPath.has(`${n.c},${n.r}`), 'correct corridor continues the path').toBe(true);
              else {
                expect(onPath.has(`${n.c},${n.r}`)).toBe(false);
                expect(b.size).toBeGreaterThanOrEqual(T.QUIZ_MIN_BRANCH);
                const cells = branchCells(maze, j.cell.c, j.cell.r, b.dx, -b.dz);
                expect(cells.some((x) => x.c === m.exitC && x.r === m.rows - 1), 'wrong branch never reaches the exit').toBe(false);
              }
            }
          }
          // a junction trigger per junction, a pick trigger per corridor
          expect(c.triggers.filter((t) => t.kind === 'junction' && t.data.roomId === room.id)).toHaveLength(room.junctions.length);
          expect(c.triggers.filter((t) => t.kind === 'junctionPick' && t.data.roomId === room.id))
            .toHaveLength(room.junctions.reduce((n, j) => n + j.branches.length, 0));
        }
      }
      expect(full / total, `${d}: share of quiz mazes with all K junctions`).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('mazes on Normal/Hard exit through a random column into a vestibule', () => {
    const cols = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const c = buildCourse(sel('normal', seed));
      for (const m of c.mazes) {
        cols.add(m.exitC);
        expect(m.depth).toBe(4 * m.rows + T.VESTIBULE);
      }
    }
    expect(cols.size).toBeGreaterThanOrEqual(4);
    for (const m of buildCourse(sel('easy', 3)).mazes) { expect(m.exitC).toBe(2); expect(m.depth).toBe(4 * m.rows); }
  });

  it('a Junction Hall has a door wall and two closed lane gates', () => {
    const c = buildCourse(sel('normal', 4));
    const hall = c.rooms.find((r) => r.kind === 'junctionHall')!;
    expect(hall.doorWalls[0].doors.length).toBeGreaterThanOrEqual(3);
    const gates = hall.laneGates!;
    expect(c.walls[gates.short].enabled && c.walls[gates.long].enabled).toBe(true);
    expect(c.scenicBoards?.roomId).toBe(hall.id);
    expect(c.signs.map((s) => s.subtitle).join(' ')).toContain('answer right');
  });
});
