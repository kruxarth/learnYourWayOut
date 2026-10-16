import { T } from '../tuning';
import type { RunState } from '../runtime';

/**
 * Visibility radius (P0-B) for the current position: small inside mazes on Normal/Hard so the
 * solution can't be read from above, open everywhere else. The renderer eases toward it.
 */
/** True while the player is inside a maze segment (the camera drops to the low chase view). */
export function inMazeSegment(run: RunState): boolean {
  if (run.detour) return false;
  const seg = run.course.segments[run.segIndex];
  return !!seg && (seg.kind === 'maze' || seg.kind === 'quizMaze' || seg.kind === 'keyHunt' || seg.kind === 'shiftMaze');
}

export function visibilityRadius(run: RunState): number {
  const r = T.VIS_RADIUS[run.selection.difficulty];
  if (r <= 0 || run.detour) return T.VIS_OPEN;
  const seg = run.course.segments[run.segIndex];
  if (!seg || (seg.kind !== 'maze' && seg.kind !== 'quizMaze' && seg.kind !== 'keyHunt' && seg.kind !== 'shiftMaze')) return T.VIS_OPEN;
  return r + (run.lanternSeg === seg.index ? T.LANTERN_BONUS : 0);
}
