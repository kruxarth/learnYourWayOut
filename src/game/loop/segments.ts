import { T } from '../tuning';
import { shuffle, type Rng } from '../rng';
import { PAL } from '../palette';
import type {
  Coin, Difficulty, Hazard, DoorWallLayout, FloorRect, JunctionLayout, MazeInfo, RoomKind, RoomLayout, SegmentInfo, Sign, Trigger,
  TriggerKind, WallBox, WallKind, Vec3,
} from '../types';
import { placeCorridorHazards, placeMazeHazards } from './hazardPlace';
import { MAZE_COLS, cellCenter, generateMaze, generateQuizMaze, mazeRects, type Maze } from './maze';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

/** Segment-local (lx, d) → world. World mapping: x = laneX + lx, z = z0 − d. */
export function toWorld(seg: { laneX: number; z0: number }, lx: number, d: number): { x: number; z: number } {
  return { x: seg.laneX + lx, z: seg.z0 - d };
}
export function rectToWorld(seg: { laneX: number; z0: number }, lx0: number, lx1: number, d0: number, d1: number): Rect {
  return { minX: seg.laneX + lx0, maxX: seg.laneX + lx1, minZ: seg.z0 - d1, maxZ: seg.z0 - d0 };
}

export const H = T.WALL_T / 2;

/** Mutable accumulator for everything a course is made of. */
export class Gen {
  walls: WallBox[] = [];
  floors: FloorRect[] = [];
  triggers: Trigger[] = [];
  coins: Coin[] = [];
  signs: Sign[] = [];
  arches: { x: number; y: number; z: number; text: string }[] = [];
  rooms: RoomLayout[] = [];
  speedPads: { x: number; z: number }[] = [];
  mazes: MazeInfo[] = [];
  deadEnds = 0;
  floorFlip = false;
  difficulty: Difficulty;
  rng: Rng;
  /** Own stream for hazard placement, so hazards never shift the layout draws. */
  hazRng: Rng;
  hazards: Hazard[] = [];
  domainName: string;

  constructor(difficulty: Difficulty, rng: Rng, domainName: string, hazRng: Rng = rng) {
    this.hazRng = hazRng;
    this.difficulty = difficulty;
    this.rng = rng;
    this.domainName = domainName;
  }

  wall(kind: WallKind, r: Rect, height: number, o: { isStatic?: boolean; enabled?: boolean; touchId?: string } = {}): WallBox {
    const w: WallBox = {
      id: this.walls.length, minX: r.minX, minY: 0, minZ: r.minZ, maxX: r.maxX, maxY: height, maxZ: r.maxZ,
      kind, enabled: o.enabled ?? true, isStatic: o.isStatic ?? true,
    };
    if (o.touchId) w.touchId = o.touchId;
    this.walls.push(w);
    return w;
  }

  floor(r: Rect, color: string, o: { isStatic?: boolean; enabled?: boolean; tag?: string } = {}): FloorRect {
    const f: FloorRect = {
      id: this.floors.length, minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, top: 0,
      enabled: o.enabled ?? true, isStatic: o.isStatic ?? true, color,
    };
    if (o.tag) f.tag = o.tag;
    this.floors.push(f);
    return f;
  }

  trigger(r: Rect, kind: TriggerKind, data: Record<string, string | number>, once: boolean): Trigger {
    const t: Trigger = { id: this.triggers.length, ...r, kind, data, once, fired: false };
    this.triggers.push(t);
    return t;
  }

  coin(x: number, y: number, z: number): void {
    this.coins.push({ id: this.coins.length, x, y, z, taken: false });
  }

  nextFloorColor(): string {
    this.floorFlip = !this.floorFlip;
    return this.floorFlip ? PAL.floorMaze : PAL.floorAlt;
  }
}

// ───────────────────────── Shared wall helpers ─────────────────────────

/** South wall at d = 0 across the full width, minus openings (lx ranges). */
export function buildSouthWall(g: Gen, seg: SegmentInfo, kind: WallKind, height: number, openings: [number, number][]): void {
  const half = seg.width / 2 + H;
  let cursor = -half;
  for (const [a, b] of [...openings].sort((p, q) => p[0] - q[0])) {
    if (a > cursor) g.wall(kind, rectToWorld(seg, cursor, a, -H, H), height);
    cursor = b;
  }
  if (cursor < half) g.wall(kind, rectToWorld(seg, cursor, half, -H, H), height);
}

export function buildSideWalls(g: Gen, seg: SegmentInfo, kind: WallKind, height: number): void {
  const w = seg.width / 2;
  g.wall(kind, rectToWorld(seg, -w - H, -w + H, H, seg.depth - H), height);
  g.wall(kind, rectToWorld(seg, w - H, w + H, H, seg.depth - H), height);
}

export function buildSegmentEnter(g: Gen, seg: SegmentInfo): void {
  const w = seg.width / 2;
  g.trigger(rectToWorld(seg, -w, w, 0, 1.5), 'segmentEnter', { segIndex: seg.index }, false);
}

const STD_OPENING: [number, number] = [-T.OPENING_HALF, T.OPENING_HALF];

// ───────────────────────── Door walls (Door Rush, Slime Gate) ─────────────────────────

export function doorCenters(n: number): number[] {
  if (n === 4) return [-6.75, -2.25, 2.25, 6.75];
  if (n === 3) return [-6, 0, 6];
  if (n === 2) return [-3, 3];
  throw new Error(`unsupported door count ${n}`);
}

/**
 * Builds one door wall: static wall pieces (kind doorWall, 2.8 m) and one dynamic panel per door.
 * `touchPrefix` yields the panel touchId `${touchPrefix}:${i}`.
 */
export function buildDoorWall(
  g: Gen, seg: SegmentInfo, d: number, centers: number[], halfW: number, wallKind: WallKind,
  touchPrefix: string, wallIndex: number,
): DoorWallLayout {
  const half = halfW;
  const openings = centers.map((c) => [c - T.PANEL_W / 2, c + T.PANEL_W / 2] as [number, number]);
  let cursor = -half;
  for (const [a, b] of openings) {
    if (a > cursor) g.wall(wallKind, rectToWorld(seg, cursor, a, d - H, d + H), T.H_DOOR_WALL);
    cursor = b;
  }
  if (cursor < half) g.wall(wallKind, rectToWorld(seg, cursor, half, d - H, d + H), T.H_DOOR_WALL);
  const zc = seg.z0 - d;
  const doors = centers.map((c, i) => {
    const r = rectToWorld(seg, c - T.PANEL_W / 2, c + T.PANEL_W / 2, d - T.PANEL_T / 2, d + T.PANEL_T / 2);
    const w = g.wall('panel', r, T.PANEL_H, { isStatic: false, touchId: `${touchPrefix}:${i}` });
    return { wallId: w.id, cx: seg.laneX + c, width: T.PANEL_W };
  });
  return { wallIndex, z: zc, doors };
}

// ───────────────────────── Segment builders ─────────────────────────

export function emptyRoom(id: string, kind: RoomKind, seg: SegmentInfo, tierMod: -1 | 0 | 1, gateWallId: number | null): RoomLayout {
  return {
    id, kind, segIndex: seg.index, laneX: seg.laneX, z0: seg.z0, depth: seg.depth, width: seg.width, tierMod,
    gateWallId, exitGateWallId: null, exitSpawn: { x: seg.laneX, y: 0, z: seg.z0 - seg.depth + 1 },
    doorWalls: [], tiles: [], stepRows: [], slabs: [], blockHomes: [], buildZone: null,
    startSpawn: { x: seg.laneX, y: 0, z: seg.z0 - 2 }, junctions: [], laneGates: null, launch: null, carousel: null, gold: null,
  };
}

/** Common to all room segments: south/side walls (room height), entrance gate, activation trigger. */
export function roomShell(g: Gen, seg: SegmentInfo, kind: RoomKind, tierMod: -1 | 0 | 1, activateTrigger: boolean): RoomLayout {
  const id = seg.roomId!;
  buildSouthWall(g, seg, 'room', T.H_ROOM, [STD_OPENING]);
  buildSideWalls(g, seg, 'room', T.H_ROOM);
  const gate = g.wall('gate', rectToWorld(seg, -T.OPENING_HALF, T.OPENING_HALF, -H, H), T.H_ROOM, { isStatic: false, enabled: false });
  const room = emptyRoom(id, kind, seg, tierMod, gate.id);
  if (activateTrigger) g.trigger(rectToWorld(seg, -10, 10, 0.8, 3), 'roomActivate', { roomId: id }, true);
  g.rooms.push(room);
  return room;
}

export function buildStart(g: Gen, seg: SegmentInfo): void {
  buildSouthWall(g, seg, 'hedge', T.H_HEDGE, []); // closed
  buildSideWalls(g, seg, 'hedge', T.H_HEDGE);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), PAL.floorAlt);
  const a = toWorld(seg, -6, 7), b = toWorld(seg, 6, 7);
  g.coin(a.x, 0.8, a.z); g.coin(b.x, 0.8, b.z);
  const arch = toWorld(seg, 0, 10);
  g.arches.push({ x: arch.x, y: 0, z: arch.z, text: `LEARN YOUR WAY OUT · ${g.domainName} · ${cap(g.difficulty)}` });
  buildSegmentEnter(g, seg);
}

/** Depth of a maze segment with `rows` rows (plus the vestibule when the exit column is random). */
export function mazeDepth(difficulty: Difficulty, rows: number): number {
  return 4 * rows + (T.MAZE_RANDOM_EXIT[difficulty] ? T.VESTIBULE : 0);
}

export function mazeRowsFor(difficulty: Difficulty, depth: number): number {
  return (depth - (T.MAZE_RANDOM_EXIT[difficulty] ? T.VESTIBULE : 0)) / 4;
}

/** Walls, floor, coins and minimap info shared by plain and quiz mazes. */
export function placeMaze(g: Gen, seg: SegmentInfo, m: Maze, path: { c: number; r: number }[]): void {
  buildSouthWall(g, seg, 'hedge', T.H_HEDGE, [STD_OPENING]);
  buildSideWalls(g, seg, 'hedge', T.H_HEDGE);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), g.nextFloorColor());
  for (const r of mazeRects(m)) g.wall('hedge', rectToWorld(seg, r.lx0, r.lx1, r.d0, r.d1), T.H_HEDGE);
  const top = 4 * m.rows;
  if (seg.depth > top + 1e-6) {
    // own north wall with the exit in column exitC; the vestibule behind it funnels to the next segment
    const a = -10 + 4 * m.exitC + H, b = -6 + 4 * m.exitC - H;
    if (a > -10 + H + 1e-6) g.wall('hedge', rectToWorld(seg, -10 + H, a, top - H, top + H), T.H_HEDGE);
    if (b < 10 - H - 1e-6) g.wall('hedge', rectToWorld(seg, b, 10 - H, top - H, top + H), T.H_HEDGE);
  }
  for (const cell of m.coins) {
    const { lx, d } = cellCenter(cell.c, cell.r);
    const p = toWorld(seg, lx, d);
    g.coin(p.x, 0.8, p.z);
  }
  g.deadEnds += m.deadEnds.length;
  g.mazes.push({
    segIndex: seg.index, laneX: seg.laneX, z0: seg.z0, depth: seg.depth, rows: m.rows, exitC: m.exitC,
    wallE: m.wallE, wallN: m.wallN, path,
  });
  buildSegmentEnter(g, seg);
}

export function exitColumn(g: Gen): number {
  return T.MAZE_RANDOM_EXIT[g.difficulty] ? Math.floor(g.rng() * MAZE_COLS) : 2;
}

export function buildMaze(g: Gen, seg: SegmentInfo): void {
  const rows = mazeRowsFor(g.difficulty, seg.depth);
  const exitC = exitColumn(g);
  const maze = generateMaze(rows, T.MAZE_BRAID[g.difficulty], g.rng, exitC);
  placeMaze(g, seg, maze, []);
  placeMazeHazards(g, seg, maze);
}

/**
 * Crossroads quiz maze (P0-A). The answers label the corridors at K junctions on the solution
 * path; wrong corridors are real dead ends. One RoomRuntime per maze, one question per junction.
 */
export function buildQuizMaze(g: Gen, seg: SegmentInfo): void {
  const rows = mazeRowsFor(g.difficulty, seg.depth);
  const exitC = exitColumn(g);
  const qm = generateQuizMaze(rows, T.QUIZ_JUNCTIONS[g.difficulty], g.rng, exitC, T.QUIZ_MIN_BRANCH, T.QUIZ_MAX_TRIES);
  placeMaze(g, seg, qm.maze, qm.path);
  const room = emptyRoom(seg.roomId!, 'quizMaze', seg, 0, null);
  room.junctions = qm.junctions.map((j, index): JunctionLayout => {
    const { lx, d } = cellCenter(j.cell.c, j.cell.r);
    const center = toWorld(seg, lx, d);
    g.trigger(rectToWorld(seg, lx - 1.6, lx + 1.6, d - 1.6, d + 1.6), 'junction', { roomId: room.id, junction: index }, true);
    const sides = [{ dir: j.forward, correct: true, size: 0 }, ...j.wrong.map((w) => ({ dir: w.dir, correct: false, size: w.size }))];
    const branches = sides.map((sd, bi) => {
      const [dc, dr] = sd.dir;
      // world direction: lx → +x, d → −z
      const dx = dc, dz = -dr;
      // a strip 0.4–1.4 m inside the neighbouring cell fires the pick
      const mx = lx + dc * 2, md = d + dr * 2;
      const r = dc !== 0
        ? rectToWorld(seg, Math.min(mx + dc * 0.4, mx + dc * 1.4), Math.max(mx + dc * 0.4, mx + dc * 1.4), md - 1.6, md + 1.6)
        : rectToWorld(seg, mx - 1.6, mx + 1.6, Math.min(md + dr * 0.4, md + dr * 1.4), Math.max(md + dr * 0.4, md + dr * 1.4));
      g.trigger(r, 'junctionPick', { roomId: room.id, junction: index, branch: bi, dx, dz }, false);
      const sign = toWorld(seg, mx, md);
      return { correct: sd.correct, size: sd.size, dx, dz, signX: sign.x, signZ: sign.z };
    });
    return { index, cell: j.cell, x: center.x, z: center.z, branches };
  });
  g.rooms.push(room);
}

export function buildCorridor(g: Gen, seg: SegmentInfo): void {
  buildSouthWall(g, seg, 'hedge', T.H_HEDGE, [STD_OPENING]);
  buildSideWalls(g, seg, 'hedge', T.H_HEDGE);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), g.nextFloorColor());
  const a = toWorld(seg, -5, seg.depth / 2);
  g.coin(a.x, 0.8, a.z);
  if (seg.depth >= 12) { const b = toWorld(seg, 5, seg.depth / 2 + 3); g.coin(b.x, 0.8, b.z); }
  for (let d = 4; d <= seg.depth - 3; d += 8) {
    const p = toWorld(seg, 0, d);
    g.speedPads.push({ x: p.x, z: p.z });
    g.trigger({ minX: p.x - 1.5, maxX: p.x + 1.5, minZ: p.z - 1.5, maxZ: p.z + 1.5 }, 'speedPad', {}, false);
  }
  placeCorridorHazards(g, seg);
  buildSegmentEnter(g, seg);
}

/**
 * Junction Hall (P1-D): the fork as a question. A door wall stands across the hall; the right
 * answer opens the gate to the shortcut lane, a wrong one the gate to the scenic lane.
 */
export function buildJunctionHall(g: Gen, seg: SegmentInfo, shortX: number, longX: number): void {
  const id = seg.roomId!;
  const half = seg.width / 2;
  buildSouthWall(g, seg, 'hedge', T.H_HEDGE, [STD_OPENING]);
  buildSideWalls(g, seg, 'hedge', T.H_HEDGE);
  g.wall('hedge', rectToWorld(seg, -2.7, 2.7, seg.depth - H, seg.depth + H), T.H_HEDGE);
  g.floor(rectToWorld(seg, -half, half, 0, seg.depth), PAL.floorAlt);
  const gate = g.wall('gate', rectToWorld(seg, -T.OPENING_HALF, T.OPENING_HALF, -H, H), T.H_ROOM, { isStatic: false, enabled: false });
  const room = emptyRoom(id, 'junctionHall', seg, 0, gate.id);
  g.trigger(rectToWorld(seg, -half, half, 0.8, 3), 'roomActivate', { roomId: id }, true);
  const n = { easy: 3, normal: 4, hard: 4 }[g.difficulty];
  room.doorWalls.push(buildDoorWall(g, seg, T.JUNCTION_DOOR_D, doorCenters(n), half + H, 'doorWall', `door:${id}:0`, 0));
  const laneGate = (x: number) => {
    const lx = x - seg.laneX;
    return g.wall('gate', rectToWorld(seg, lx - T.OPENING_HALF, lx + T.OPENING_HALF, seg.depth - 3 * H, seg.depth - H), T.H_ROOM,
      { isStatic: false, enabled: true }).id;
  };
  room.laneGates = { short: laneGate(shortX), long: laneGate(longX) };
  const sp = toWorld(seg, 0, T.JUNCTION_DOOR_D + 3);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  g.rooms.push(room);
  buildSegmentEnter(g, seg);
}

export function buildForkHall(g: Gen, seg: SegmentInfo): void {
  buildSouthWall(g, seg, 'hedge', T.H_HEDGE, [STD_OPENING]);
  buildSideWalls(g, seg, 'hedge', T.H_HEDGE);
  // north filler between the two lane south walls
  g.wall('hedge', rectToWorld(seg, -2.7, 2.7, seg.depth - H, seg.depth + H), T.H_HEDGE);
  g.floor(rectToWorld(seg, -23, 23, 0, seg.depth), PAL.floorAlt);
  buildSegmentEnter(g, seg);
}

export function buildMergeHall(g: Gen, seg: SegmentInfo): void {
  const lanes = [-T.LANE_OFFSET, T.LANE_OFFSET];
  buildSouthWall(g, seg, 'hedge', T.H_HEDGE, lanes.map((x) => [x - T.OPENING_HALF, x + T.OPENING_HALF] as [number, number]));
  buildSideWalls(g, seg, 'hedge', T.H_HEDGE);
  g.wall('hedge', rectToWorld(seg, -23.3, -10.3, seg.depth - H, seg.depth + H), T.H_HEDGE);
  g.wall('hedge', rectToWorld(seg, 10.3, 23.3, seg.depth - H, seg.depth + H), T.H_HEDGE);
  g.floor(rectToWorld(seg, -23, 23, 0, seg.depth), PAL.floorAlt);
  buildSegmentEnter(g, seg);
}

export function buildDoorRush(g: Gen, seg: SegmentInfo, tierMod: -1 | 0 | 1): void {
  const room = roomShell(g, seg, 'doorRush', tierMod, true);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), PAL.floorRoom);
  const n = { easy: 3, normal: 4, hard: 4 }[g.difficulty];
  room.doorWalls.push(buildDoorWall(g, seg, 12, doorCenters(n), 10 + H, 'doorWall', `door:${room.id}:0`, 0));
  const sp = toWorld(seg, 0, 15.5);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  // Gold Door: a star panel behind the answer doors, off to one side. Solid only once it is offered (F4-G).
  const gr = rectToWorld(seg, T.GOLD_CX - T.PANEL_W / 2, T.GOLD_CX + T.PANEL_W / 2, T.GOLD_D - T.PANEL_T / 2, T.GOLD_D + T.PANEL_T / 2);
  const gw = g.wall('panel', gr, T.PANEL_H, { isStatic: false, enabled: false, touchId: `gold:${room.id}` });
  room.gold = { wallId: gw.id, cx: seg.laneX + T.GOLD_CX, z: seg.z0 - T.GOLD_D };
  buildSegmentEnter(g, seg);
}

export function buildTileDrop(g: Gen, seg: SegmentInfo, tierMod: -1 | 0 | 1): void {
  const room = roomShell(g, seg, 'tileDrop', tierMod, true);
  g.floor(rectToWorld(seg, -10, 10, 0, 4), PAL.floorRoom);
  g.floor(rectToWorld(seg, -10, 10, 16, 22), PAL.floorRoom);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const i = row * 2 + col;
      const lx0 = col === 0 ? -10 : 0, lx1 = col === 0 ? 0 : 10;
      const d0 = row === 0 ? 4 : 10, d1 = row === 0 ? 10 : 16;
      const r = rectToWorld(seg, lx0, lx1, d0, d1);
      const f = g.floor(r, PAL.tile, { isStatic: false, tag: `tile:${room.id}:${i}` });
      room.tiles.push({ floorId: f.id, col, row, cx: (r.minX + r.maxX) / 2, cz: (r.minZ + r.maxZ) / 2, sx: lx1 - lx0, sz: d1 - d0 });
    }
  }
  const gate = g.wall('gate', rectToWorld(seg, -10, 10, 16 - H, 16 + H), T.H_ROOM, { isStatic: false, enabled: true });
  room.exitGateWallId = gate.id;
  const sp = toWorld(seg, 0, 19);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  buildSegmentEnter(g, seg);
}

export function buildStepStones(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'stepStones', 0, true);
  g.floor(rectToWorld(seg, -10, 10, 0, 4), PAL.floorRoom);
  g.floor(rectToWorld(seg, -10, 10, 21.6, 27.6), PAL.floorRoom);
  for (let row = 0; row < 4; row++) {
    const d0 = 4 + T.STEP_ROW_DEPTH * row, d1 = d0 + T.STEP_ROW_DEPTH;
    const slotFloorIds: number[] = [];
    for (let s = 0; s < 3; s++) {
      const r = rectToWorld(seg, -6 + 4 * s, -2 + 4 * s, d0, d1);
      const f = g.floor(r, PAL.tile, { isStatic: false, enabled: false, tag: `step:${room.id}:${row}:${s}` });
      slotFloorIds.push(f.id);
    }
    const z = rectToWorld(seg, 0, 0, d0, d1);
    room.stepRows.push({ slotFloorIds, cz: (z.minZ + z.maxZ) / 2, z0: z.maxZ, z1: z.minZ });
  }
  const sp = toWorld(seg, 0, 24.6);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  buildSegmentEnter(g, seg);
}

export function buildBridgeBuilder(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'bridgeBuilder', 0, true);
  g.floor(rectToWorld(seg, -10, 10, 0, 10), PAL.floorRoom);
  g.floor(rectToWorld(seg, -10, 10, 22, 28), PAL.floorRoom);
  for (let k = 0; k < 4; k++) {
    const r = rectToWorld(seg, -2, 2, 10 + 3 * k, 13 + 3 * k);
    const f = g.floor(r, PAL.tile, { isStatic: false, enabled: false, tag: `slab:${room.id}:${k}` });
    room.slabs.push({ floorId: f.id, cx: (r.minX + r.maxX) / 2, cz: (r.minZ + r.maxZ) / 2, sx: 4, sz: 3 });
  }
  const bz = rectToWorld(seg, -2.5, 2.5, 8.4, 10);
  room.buildZone = bz;
  const homes = [[-7, 2.5], [7, 2.5], [-7, 6.5], [7, 6.5], [-4, 4.5]].map(([lx, d]) => toWorld(seg, lx, d));
  room.blockHomes = shuffle(homes, g.rng).slice(0, 4);
  const start = toWorld(seg, 0, 7);
  room.startSpawn = { x: start.x, y: 0, z: start.z };
  const sp = toWorld(seg, 0, 25);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  buildSegmentEnter(g, seg);
}

/** Depth of the Launch Pads room: entrance and pads, the pond (or trap maze) in front of the hedge, the landing platform. */
export function launchPadsDepth(difficulty: Difficulty): number {
  return T.LAUNCH_POND_FRONT + T.LAUNCH_POND_D[difficulty] + T.LAUNCH_LAND_D;
}

/**
 * Launch Pads (F4-1): a tall hedge with no door across the room. The pads stand in front of it
 * (placed at activation, once the pad count is known). A right answer arcs over the hedge to the
 * landing platform; a wrong one lands in the pond (Hard: a two-row trap maze) in front of the hedge.
 * The hedge is a dynamic wall so the static-wall path check still sees a way through the room.
 */
export function buildLaunchPads(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'launchPads', 0, true);
  const front = T.LAUNCH_POND_FRONT, hedgeD = front + T.LAUNCH_POND_D[g.difficulty];
  const pondColor = '#A8F28B';
  g.floor(rectToWorld(seg, -10, 10, 0, front), PAL.floorRoom);
  const pond = [rectToWorld(seg, -10, 10, front, hedgeD)];
  g.floor(pond[0], pondColor);
  g.floor(rectToWorld(seg, -10, 10, hedgeD, seg.depth), PAL.floorRoom);
  const hedge = g.wall('hedge', rectToWorld(seg, -10, 10, hedgeD - H, hedgeD + H), T.H_LAUNCH_WALL, { isStatic: false });
  let trapLanding: { x: number; z: number } | null = null;
  if (g.difficulty === 'hard') {
    // trap maze: a divider across the pond with a gap on the right; you land in the far row on the left
    const mid = front + T.LAUNCH_POND_D.hard / 2;
    g.wall('hedge', rectToWorld(seg, -10, 10 - T.TRAP_GAP, mid - H, mid + H), T.H_HEDGE);
    trapLanding = { ...toWorld(seg, -7, mid + 2) };
  }
  room.launch = {
    padZ: seg.z0 - T.LAUNCH_PAD_D, hedgeZ: seg.z0 - hedgeD, hedgeWallId: hedge.id, hedgeH: T.H_LAUNCH_WALL,
    correctZ: seg.z0 - (hedgeD + 4), pondZ: seg.z0 - (front + T.LAUNCH_POND_D[g.difficulty] / 2), trapLanding, pond,
  };
  buildSegmentEnter(g, seg);
}

/** Depth of the Rule Minefield: entry platform, 4 rows of tiles with a walkway after each, and the exit platform. */
export function ruleMinefieldDepth(): number {
  return T.MINE_ENTRY_D + T.MINE_ROWS * T.MINE_ROW_D + (T.MINE_ROWS - 1) * T.MINE_WALK_D + T.MINE_END_D;
}

/**
 * Rule Minefield (F4-2): 4 rows x 3 tiles over the slime, with a solid walkway before, between and after
 * the rows (so you can always step sideways to any tile of the next row). The safe pattern is placed by
 * the layout rng: 1 or 2 safe tiles per row. Labels are dealt at activation, from the question.
 */
export function buildRuleMinefield(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'ruleMinefield', 0, true);
  const cols = T.MINE_COLS, tileW = 20 / cols;
  const walks: { minZ: number; maxZ: number; cz: number }[] = [];
  const addWalk = (d0: number, d1: number) => {
    const r = rectToWorld(seg, -10, 10, d0, d1);
    g.floor(r, PAL.floorRoom);
    walks.push({ minZ: r.minZ, maxZ: r.maxZ, cz: (r.minZ + r.maxZ) / 2 });
  };
  addWalk(0, T.MINE_ENTRY_D);
  const safe: boolean[][] = [];
  let d = T.MINE_ENTRY_D;
  for (let row = 0; row < T.MINE_ROWS; row++) {
    const slotFloorIds: number[] = [];
    for (let s = 0; s < cols; s++) {
      const r = rectToWorld(seg, -10 + tileW * s, -10 + tileW * (s + 1), d, d + T.MINE_ROW_D);
      const f = g.floor(r, PAL.tile, { isStatic: false, tag: `mine:${room.id}:${row}:${s}` });
      slotFloorIds.push(f.id);
    }
    const z = rectToWorld(seg, 0, 0, d, d + T.MINE_ROW_D);
    room.stepRows.push({ slotFloorIds, cz: (z.minZ + z.maxZ) / 2, z0: z.maxZ, z1: z.minZ });
    // 1 or 2 safe tiles in this row
    const two = g.rng() < T.MINE_SAFE_TWO_P[g.difficulty];
    const free = shuffle([0, 1, 2], g.rng);
    const mask = [false, false, false];
    for (let k = 0; k < (two ? 2 : 1); k++) mask[free[k]] = true;
    safe.push(mask);
    d += T.MINE_ROW_D;
    const last = row === T.MINE_ROWS - 1;
    addWalk(d, d + (last ? T.MINE_END_D : T.MINE_WALK_D));
    d += last ? T.MINE_END_D : T.MINE_WALK_D;
  }
  room.mine = { walks, colX: Array.from({ length: cols }, (_, s) => seg.laneX - 10 + tileW * (s + 0.5)), safe };
  const sp = toWorld(seg, 0, seg.depth - 2);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  buildSegmentEnter(g, seg);
}

export function slimeGateWalls(difficulty: Difficulty): { k: number; doors: number } {
  return { easy: { k: 2, doors: 3 }, normal: { k: 3, doors: 3 }, hard: { k: 3, doors: 4 } }[difficulty];
}

export function buildSlimeGate(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'slimeGate', 0, false);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), PAL.floorRoom);
  const { k, doors } = slimeGateWalls(g.difficulty);
  for (let i = 1; i <= k; i++) {
    room.doorWalls.push(buildDoorWall(g, seg, 10 * i, doorCenters(doors), 10 + H, 'doorWall', `door:${room.id}:${i - 1}`, i - 1));
    g.trigger(rectToWorld(seg, -10, 10, 10 * i - 8, 10 * i - 6), 'bossWall', { roomId: room.id, wall: i - 1 }, true);
  }
  buildSegmentEnter(g, seg);
}

export function buildExit(g: Gen, seg: SegmentInfo): Vec3 {
  buildSouthWall(g, seg, 'hedge', T.H_HEDGE, [STD_OPENING]);
  buildSideWalls(g, seg, 'hedge', T.H_HEDGE);
  g.wall('hedge', rectToWorld(seg, -10 - H, 10 + H, seg.depth - H, seg.depth + H), T.H_HEDGE);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), PAL.floorAlt);
  const arch = toWorld(seg, 0, 7);
  g.arches.push({ x: arch.x, y: 0, z: arch.z, text: 'FINISH' });
  const p = toWorld(seg, 0, 9);
  buildSegmentEnter(g, seg);
  return { x: p.x, y: 2.2, z: p.z };
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
