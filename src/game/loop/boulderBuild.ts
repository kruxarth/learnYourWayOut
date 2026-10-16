import { PAL } from '../palette';
import { T } from '../tuning';
import type { BoulderAlcove, SegmentInfo, WallBox } from '../types';
import { Gen, buildSideWalls, buildSegmentEnter, buildSouthWall, emptyRoom, rectToWorld, toWorld } from './segments';

const H = T.WALL_T / 2;
const WT = T.WALL_T;

/** Alcove slots by wave: side and the local depth d0 where the interior starts (it is BOULDER_ALC_LEN long). */
const END_SLOTS: { side: -1 | 1; d0: number }[] = [{ side: -1, d0: 27 }, { side: 1, d0: 29.5 }, { side: -1, d0: 31.6 }];
const MID_SLOTS: { side: -1 | 1; d0: number }[] = [{ side: -1, d0: 12 }, { side: 1, d0: 14.5 }];

/** Total depth of the room: the corridor, its end wall and the hall behind it. */
export function boulderDepth(): number {
  return T.BOULDER_LEN + WT + T.BOULDER_HALL_D;
}

/** The alcove slots of each wave: Normal has the end wave only, Hard a mid-run wave first. */
export function boulderWaveSlots(waves: number): { side: -1 | 1; d0: number; gate: boolean }[][] {
  const end = END_SLOTS.map((s) => ({ ...s, gate: true }));
  if (waves <= 1) return [end];
  return [MID_SLOTS.map((s) => ({ ...s, gate: false })), end];
}

/**
 * Boulder Run (F4-6). A 3.5 m corridor, `BOULDER_LEN` long, with an end wall. Alcoves open to both sides
 * near the end; the final wave's alcoves have a back wall with a dynamic gate behind which a channel leads
 * round the end wall into the exit hall. Only the right alcove's gate ever opens. Hard also has a mid-run
 * wave of plain pockets. All walls are 'room' walls (the boulder rolls over them in the picture, not in the sim).
 */
export function buildBoulderRun(g: Gen, seg: SegmentInfo): void {
  const id = seg.roomId!;
  const CW = T.BOULDER_CW, LEN = T.BOULDER_LEN, AL = T.BOULDER_ALC_LEN, AD = T.BOULDER_ALC_DEPTH;
  const BACK_IN = CW + AD, BACK_OUT = BACK_IN + WT, INNER = seg.width / 2 - H;
  const hh = T.H_ROOM;
  buildSouthWall(g, seg, 'room', hh, [[-T.OPENING_HALF, T.OPENING_HALF]]);
  buildSideWalls(g, seg, 'room', hh);
  const gate = g.wall('gate', rectToWorld(seg, -T.OPENING_HALF, T.OPENING_HALF, -H, H), hh, { isStatic: false, enabled: false });
  const room = emptyRoom(id, 'boulderRun', seg, 0, gate.id);
  g.trigger(rectToWorld(seg, -10, 10, 0.8, 3), 'roomActivate', { roomId: id }, true);
  g.floor(rectToWorld(seg, -10, 10, 0, seg.depth), PAL.floorRoom);

  const slots = boulderWaveSlots(T.BOULDER_WAVES[g.difficulty]);
  const alcoves: BoulderAlcove[] = [];
  const waves: number[][] = [];
  const seen = new Set<string>();
  /** A wall piece once per distinct box (neighbouring alcoves share a divider). */
  const piece = (lx0: number, lx1: number, d0: number, d1: number, o: { isStatic?: boolean } = {}): WallBox | null => {
    const r = rectToWorld(seg, lx0, lx1, d0, d1);
    const key = [r.minX, r.maxX, r.minZ, r.maxZ].map((v) => v.toFixed(3)).join(',');
    if (seen.has(key)) return null;
    seen.add(key);
    return g.wall('room', r, hh, o);
  };
  const mirror = (side: number, a: number, b: number): [number, number] => (side < 0 ? [-b, -a] : [a, b]);

  // alcove records and their dividers
  const ranges: Record<string, { d0: number; d1: number; gate: boolean; slot: number }[]> = { '-1': [], '1': [] };
  for (const wave of slots) {
    const idx: number[] = [];
    for (const s of wave) {
      const slot = alcoves.length;
      const d1 = s.d0 + AL;
      const mid = (s.d0 + d1) / 2;
      const w = toWorld(seg, s.side * (CW + AD / 2), mid);
      alcoves.push({ side: s.side, minZ: seg.z0 - d1, maxZ: seg.z0 - s.d0, gateWallId: null, cx: w.x, cz: w.z });
      idx.push(slot);
      ranges[String(s.side)].push({ d0: s.d0, d1, gate: s.gate, slot });
    }
    waves.push(idx);
  }

  for (const side of [-1, 1] as const) {
    const list = ranges[String(side)].sort((a, b) => a.d0 - b.d0);
    // corridor outer wall with a gap for every alcove (it starts after the south wall and ends at the end wall)
    let cursor = H;
    for (const a of list) {
      if (a.d0 > cursor) piece(...mirror(side, CW, CW + WT), cursor, a.d0);
      cursor = a.d1;
    }
    if (cursor < LEN) piece(...mirror(side, CW, CW + WT), cursor, LEN);
    // dividers on either side of every alcove, between the corridor wall and the back wall
    for (const a of list) {
      piece(...mirror(side, CW + WT, BACK_IN), a.d0 - WT, a.d0);
      piece(...mirror(side, CW + WT, BACK_IN), a.d1, a.d1 + WT);
    }
    // back walls: plain pockets, and (final wave) a run to the hall with a gate in every alcove's back
    const pockets = list.filter((a) => !a.gate);
    for (const a of pockets) piece(...mirror(side, BACK_IN, BACK_OUT), a.d0 - WT, a.d1 + WT);
    const gated = list.filter((a) => a.gate);
    if (gated.length) {
      const lo = gated[0].d0 - WT, hi = LEN + WT;
      let at = lo;
      for (const a of gated) {
        const mid = (a.d0 + a.d1) / 2, g0 = mid - 1.5, g1 = mid + 1.5;
        if (g0 > at) piece(...mirror(side, BACK_IN, BACK_OUT), at, g0);
        const r = rectToWorld(seg, ...mirror(side, BACK_IN, BACK_OUT), g0, g1);
        const gw = g.wall('room', r, hh, { isStatic: false, enabled: true });
        alcoves[a.slot].gateWallId = gw.id;
        at = g1;
      }
      if (at < hi) piece(...mirror(side, BACK_IN, BACK_OUT), at, hi);
      // the channel starts here: a cap across it
      piece(...mirror(side, BACK_OUT, INNER), lo, lo + WT);
    }
  }
  // the end wall closes the corridor and the pockets beside it; the channels run past it into the hall
  piece(-BACK_IN, BACK_IN, LEN, LEN + WT);

  const start = toWorld(seg, 0, 2);
  room.boulder = {
    axisX: seg.laneX, z0: seg.z0, endZ: seg.z0 - LEN, alcoves, waves, startSpawn: { x: start.x, y: 0, z: start.z },
  };
  const sp = toWorld(seg, 0, seg.depth - 2);
  room.exitSpawn = { x: sp.x, y: 0, z: sp.z };
  room.startSpawn = { x: start.x, y: 0, z: start.z };
  g.rooms.push(room);
  buildSegmentEnter(g, seg);
}
