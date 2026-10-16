import { T } from '../tuning';
import type { RunState } from '../runtime';
import type { SegmentInfo, SegmentKind, WallBox } from '../types';

export function isMazeKind(k: SegmentKind): boolean {
  return k === 'maze' || k === 'quizMaze' || k === 'keyHunt' || k === 'shiftMaze';
}

/** True while the player is inside a maze segment (chase cam and steering). */
export function inMazeSegment(run: RunState): boolean {
  if (run.detour) return false;
  const seg = run.course.segments[run.segIndex];
  return !!seg && isMazeKind(seg.kind);
}

/** True for a hedge whose centre lies in a maze segment: the renderer draws it `T.MAZE_WALL_VIS_H` tall. */
export function isMazeHedge(w: WallBox, segments: SegmentInfo[]): boolean {
  if (w.kind !== 'hedge') return false;
  const x = (w.minX + w.maxX) / 2, z = (w.minZ + w.maxZ) / 2;
  return segments.some((s) => isMazeKind(s.kind) && x >= s.laneX - s.width / 2 && x <= s.laneX + s.width / 2 && z <= s.z0 && z >= s.z0 - s.depth);
}

/**
 * Visibility radius (P0-B) for the current position: small inside mazes on Normal/Hard so the
 * solution can't be read from above, open everywhere else. The renderer eases toward it.
 */
export function visibilityRadius(run: RunState): number {
  const r = T.VIS_RADIUS[run.selection.difficulty];
  if (r <= 0 || run.detour) return T.VIS_OPEN;
  const seg = run.course.segments[run.segIndex];
  if (!seg || !isMazeKind(seg.kind)) return T.VIS_OPEN;
  return r + (run.lanternSeg === seg.index ? T.LANTERN_BONUS : 0);
}
