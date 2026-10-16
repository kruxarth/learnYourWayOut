import { T } from '../tuning';
import { PAL } from '../palette';
import type { Difficulty, SegmentInfo } from '../types';
import { H, buildSegmentEnter, rectToWorld, roomShell, toWorld, type Gen } from './segments';

/** Door Carousel (F4-5) and Memory Floor (F4-7) builders. Local depths d are metres from the room's entrance. */

/** Panels in the Door Carousel (the same count as Door Rush). */
export function carouselPanels(difficulty: Difficulty): number {
  return difficulty === 'easy' ? 3 : 4;
}

/** Centre of a train panel, wrapped into [-loop/2, loop/2). */
export function wrapX(x: number, loop: number): number {
  return ((((x + loop / 2) % loop) + loop) % loop) - loop / 2;
}

/**
 * Door Carousel: a wall across the room with one 4 m opening. Behind it a contiguous train of
 * labelled panels slides sideways in a loop (dynamic WallBoxes moved every step), so a different panel
 * fills the opening every few seconds. The train has no gaps between panels,
 * so the only way through is to burst the panel that is in the opening.
 */
export function buildDoorCarousel(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'doorCarousel', 0, true);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), PAL.floorRoom);
  const D = T.CAROUSEL_WALL_D, oh = T.CAROUSEL_OPEN_HALF;
  g.wall('doorWall', rectToWorld(seg, -10 - H, -oh, D - H, D + H), T.H_DOOR_WALL);
  g.wall('doorWall', rectToWorld(seg, oh, 10 + H, D - H, D + H), T.H_DOOR_WALL);
  const n = carouselPanels(g.difficulty);
  const w = T.CAROUSEL_PANEL_W, loop = w * n;
  const doors = Array.from({ length: n }, (_, i) => {
    const c = wrapX(i * w, loop);
    const r = rectToWorld(seg, c - w / 2, c + w / 2, D + H, D + H + T.PANEL_T);
    const wall = g.wall('panel', r, T.PANEL_H, { isStatic: false, touchId: `door:${room.id}:0:${i}` });
    return { wallId: wall.id, cx: seg.laneX + c, width: w };
  });
  const zr = rectToWorld(seg, 0, 0, D + H, D + H + T.PANEL_T);
  room.doorWalls.push({ wallIndex: 0, z: seg.z0 - D, doors });
  room.carousel = { panelW: w, loopLen: loop, minZ: zr.minZ, maxZ: zr.maxZ };
  // Gold Door (F4-G): a star panel beyond the train, off to one side
  const gr = rectToWorld(seg, T.CAROUSEL_GOLD_CX - T.PANEL_W / 2, T.CAROUSEL_GOLD_CX + T.PANEL_W / 2,
    T.CAROUSEL_GOLD_D - T.PANEL_T / 2, T.CAROUSEL_GOLD_D + T.PANEL_T / 2);
  const gw = g.wall('panel', gr, T.PANEL_H, { isStatic: false, enabled: false, touchId: `gold:${room.id}` });
  room.gold = { wallId: gw.id, cx: seg.laneX + T.CAROUSEL_GOLD_CX, z: seg.z0 - T.CAROUSEL_GOLD_D };
  const sp = toWorld(seg, 0, T.CAROUSEL_EXIT_D);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  buildSegmentEnter(g, seg);
}

/**
 * Memory Floor: a 3x3 field of big tiles (rows 4 m deep, 6.67 m wide) between the entrance and an
 * exit platform; a gate across the exit stays up until the bridge has risen. Tiles reuse Tile Drop's
 * tile states (solid, shaking, falling, gone).
 */
export function buildMemoryFloor(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'memoryFloor', 0, true);
  g.floor(rectToWorld(seg, -10, 10, 0, 4), PAL.floorRoom);
  g.floor(rectToWorld(seg, -10, 10, 16, 22), PAL.floorRoom);
  const xs = [-10, -10 / 3, 10 / 3, 10];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const i = row * 3 + col;
      const r = rectToWorld(seg, xs[col], xs[col + 1], 4 + 4 * row, 8 + 4 * row);
      const f = g.floor(r, PAL.tile, { isStatic: false, tag: `tile:${room.id}:${i}` });
      room.tiles.push({ floorId: f.id, col, row, cx: (r.minX + r.maxX) / 2, cz: (r.minZ + r.maxZ) / 2, sx: xs[col + 1] - xs[col], sz: 4 });
    }
  }
  const gate = g.wall('gate', rectToWorld(seg, -10, 10, 16 - H, 16 + H), T.H_ROOM, { isStatic: false, enabled: true });
  room.exitGateWallId = gate.id;
  const sp = toWorld(seg, 0, 19);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  buildSegmentEnter(g, seg);
}
