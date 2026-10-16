import { PAL } from '../palette';
import { T } from '../tuning';
import type { HexCellLayout, SegmentInfo } from '../types';
import { liftXs } from '../rooms/answerLifts';
import { Gen, buildSegmentEnter, rectToWorld, roomShell, toWorld } from './segments';

/** Builders for Answer Lifts (F4-8) and the Hex Finale (F4-X). */

const H = T.WALL_T / 2;
const POND_COLOR = '#A8F28B';

// ───────────────────────── Answer Lifts ─────────────────────────

export function answerLiftsDepth(): number {
  return T.LIFT_DOCK_D + T.LIFT_SHAFT_D + T.LIFT_LEDGE_D + T.LIFT_LAND_D;
}

/**
 * Dock (ground) -> pond with the lifts -> ledge 6 m up -> landing. The ledge face is a dynamic wall
 * (so the static-wall path check still sees a way through) that the bean walks over at ledge height.
 * Between the lifts, three steps lead out of the pond.
 */
export function buildAnswerLifts(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'answerLifts', 0, true);
  const dock = T.LIFT_DOCK_D, ledge = dock + T.LIFT_SHAFT_D, end = ledge + T.LIFT_LEDGE_D, half = T.LIFT_HALF;
  const xs = liftXs(T.LIFT_COUNT[g.difficulty]);
  const w = seg.width / 2;
  g.floor(rectToWorld(seg, -10, 10, 0, dock), PAL.floorRoom);
  const pit = g.floor(rectToWorld(seg, -10, 10, dock, ledge), POND_COLOR);
  pit.top = T.LIFT_PIT;
  const floorIds = xs.map((x, i) => {
    const f = g.floor(rectToWorld(seg, x - half, x + half, dock, ledge), PAL.tile, { isStatic: false, tag: `lift:${room.id}:${i}` });
    f.moving = true; f.prevTop = 0;
    return f.id;
  });
  // steps out of the pond, in the gaps between the lifts: 0.2 m risers (a step must be a bit under STEP_UP: gravity dips the bean a hair below the floor each step)
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] + half, b = xs[i + 1] - half;
    for (const [k, top] of [[0, -0.2], [1, -0.4], [2, -0.6]] as const) {
      const f = g.floor(rectToWorld(seg, a, b, dock + 0.8 * k, dock + 0.8 * (k + 1)), '#DDF7C4');
      f.top = top;
    }
  }
  g.floor(rectToWorld(seg, -10, 10, ledge, end), PAL.floorAlt).top = T.LIFT_TOP;
  g.floor(rectToWorld(seg, -10, 10, end, seg.depth), PAL.floorRoom);
  // tall side walls round the pond and the ledge (a bean riding up must not step over the room wall)
  g.wall('room', rectToWorld(seg, -w - H, -w + H, dock, end), T.H_LIFT_SIDE);
  g.wall('room', rectToWorld(seg, w - H, w + H, dock, end), T.H_LIFT_SIDE);
  // the ledge face, and the dock face under each lift
  const face = g.wall('invisible', rectToWorld(seg, -10, 10, ledge, ledge + 0.6), T.LIFT_TOP, { isStatic: false });
  // (a dock-face wall whose top is below ground level: a bean down in the pit cannot walk off its south edge, but one on a step or a lift passes)
  g.wall('invisible', rectToWorld(seg, -10, 10, dock, dock + 0.3), -0.3, { isStatic: false });
  const z = seg.z0 - (dock + ledge) / 2;
  room.lifts = {
    xs: xs.map((x) => seg.laneX + x), z, half, floorIds,
    dockZ: seg.z0 - dock, ledgeZ: seg.z0 - ledge, ledgeEndZ: seg.z0 - end, ledgeWallId: face.id,
    pond: rectToWorld(seg, -10, 10, dock, ledge),
  };
  const sp = toWorld(seg, 0, end + 2);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  buildSegmentEnter(g, seg);
}

// ───────────────────────── Hex Finale ─────────────────────────

const SQ3 = Math.sqrt(3);

export function hexArenaDepth(): number {
  return (2 * T.HEX_RINGS + 1) * 1.5 * T.HEX_SIZE;
}

export function hexFinaleDepth(): number {
  return Math.ceil(T.HEX_STEP_D + hexArenaDepth() + T.HEX_EXIT_D);
}

/** The cells of a hex disc (axial coordinates), centre first, then ring by ring. */
export function hexCells(rings: number): { q: number; r: number; ring: number }[] {
  const out: { q: number; r: number; ring: number }[] = [];
  for (let r = -rings; r <= rings; r++) {
    for (let q = -rings; q <= rings; q++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      if (ring <= rings) out.push({ q, r, ring });
    }
  }
  return out.sort((a, b) => a.ring - b.ring || a.r - b.r || a.q - b.q);
}

/**
 * Hex Finale: a disc of pointy-top hex cells over the slime. Each cell is a dynamic floor rect of
 * sqrt(3)*s by 1.5*s (an axis-aligned approximation of the hex: these rects tile the plane with no gaps).
 * The doorstep (removed when the finale starts) and the exit platform (added when it is won) keep the
 * arena the only place to stand while the rounds run.
 */
export function buildHexFinale(g: Gen, seg: SegmentInfo): void {
  const room = roomShell(g, seg, 'hexFinale', 0, true);
  const s = T.HEX_SIZE;
  const arenaStart = T.HEX_STEP_D, arenaEnd = arenaStart + hexArenaDepth();
  const dc = arenaStart + hexArenaDepth() / 2;
  const step = g.floor(rectToWorld(seg, -10, 10, 0, arenaStart), PAL.floorRoom, { isStatic: false });
  const sx = SQ3 * s, sz = 1.5 * s;
  const cells: HexCellLayout[] = hexCells(T.HEX_RINGS).map(({ q, r, ring }) => {
    const lx = s * SQ3 * (q + r / 2), d = dc + sz * r;
    const rect = rectToWorld(seg, lx - sx / 2, lx + sx / 2, d - sz / 2, d + sz / 2);
    const f = g.floor(rect, PAL.tile, { isStatic: false, tag: `hex:${room.id}:${q}:${r}` });
    f.moving = true; f.prevTop = 0;
    const c = toWorld(seg, lx, d);
    return { floorId: f.id, q, r, ring, cx: c.x, cz: c.z, sx, sz, angle: ring === 0 ? 0 : Math.atan2(d - dc, lx) };
  });
  const exit = g.floor(rectToWorld(seg, -10, 10, arenaEnd, seg.depth), PAL.floorRoom, { isStatic: false, enabled: false });
  const center = toWorld(seg, 0, dc);
  room.hex = { cells, centerX: center.x, centerZ: center.z, size: s, rings: T.HEX_RINGS, doorstepFloorId: step.id, exitFloorId: exit.id };
  room.exitSpawn = { x: seg.laneX, y: 0, z: seg.z0 - (arenaEnd + 1.5) };
  buildSegmentEnter(g, seg);
}
