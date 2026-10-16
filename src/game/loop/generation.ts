import { questionSource } from '../../content/source';
import { T } from '../tuning';
import { stream } from '../rng';
import { CLASSIC_RECIPES, DEMO_RECIPE, TEMPLATES, applyFinale, gauntletRecipe, resolveRecipe, type Step } from './pool';
import { answerLiftsDepth, buildAnswerLifts, buildHexFinale, hexFinaleDepth } from './bigRoomsBuild';
import { PAL } from '../palette';
import { buildKeyHunt } from './huntBuild';
import { boulderDepth, buildBoulderRun } from './boulderBuild';
import { buildShiftMaze } from './shiftBuild';
import type {
  Course, Difficulty, DetourLayout, RunSelection, SegmentInfo, SegmentKind,
} from '../types';
import {
  Gen, buildBridgeBuilder, buildCorridor, buildDoorRush, buildDoorWall, buildExit, buildForkHall, buildJunctionHall, buildMaze,
  buildMergeHall, buildQuizMaze, buildSlimeGate, buildSouthWall, buildSideWalls, buildStart, buildStepStones,
  buildLaunchPads, buildRuleMinefield, buildTileDrop, doorCenters, launchPadsDepth, mazeDepth, rectToWorld, ruleMinefieldDepth, slimeGateWalls,
  toWorld,
} from './segments';
import { buildDoorCarousel, buildMemoryFloor } from './segmentsDoorMemory';

export type { Step } from './pool';

/**
 * Test hook: 'classic' builds the fixed pre-pool recipes, so older room tests keep their courses.
 * The game itself never sets it.
 */
export const recipeOverride: { mode: 'pool' | 'classic' } = { mode: 'pool' };

export interface BuildOptions {
  /** `?demo=1`: use the pinned DEMO_RECIPE (normal difficulty only). */
  demo?: boolean;
}

/** The steps a selection builds: pinned demo, Gauntlet, classic (tests) or the pool-resolved template. */
export function recipeFor(sel: RunSelection, opts: BuildOptions = {}): Step[] {
  const pack = questionSource.getPack(sel.domainId);
  const rng = stream(sel.seed, 'recipe');
  if (sel.mode === 'gauntlet') return gauntletRecipe(pack, rng);
  if (opts.demo && sel.difficulty === 'normal') return DEMO_RECIPE;
  if (recipeOverride.mode === 'classic') return applyFinale(CLASSIC_RECIPES[sel.difficulty], sel.finale);
  return applyFinale(resolveRecipe(TEMPLATES[sel.difficulty], sel, pack, rng), sel.finale);
}

const ROOM_KINDS: SegmentKind[] = ['doorRush', 'tileDrop', 'stepStones', 'bridgeBuilder', 'slimeGate', 'quizMaze', 'junctionHall', 'launchPads', 'ruleMinefield', 'keyHunt', 'doorCarousel', 'memoryFloor', 'answerLifts', 'hexFinale', 'boulderRun', 'shiftMaze'];

function stepDepth(step: Step, difficulty: Difficulty, extraRowsOverride = 0): number {
  switch (step.k) {
    case 'start': return 12;
    case 'exit': return 14;
    case 'maze': case 'quizMaze': case 'keyHunt': case 'shiftMaze': return mazeDepth(difficulty, T.MAZE_ROWS[difficulty] + (step.extraRows ?? 0) + extraRowsOverride);
    case 'doorRush': return 18;
    case 'tileDrop': return 22;
    case 'stepStones': return 27.6;
    case 'bridgeBuilder': return 28;
    case 'launchPads': return launchPadsDepth(difficulty);
    case 'ruleMinefield': return ruleMinefieldDepth();
    case 'doorCarousel': return T.CAROUSEL_DEPTH;
    case 'memoryFloor': return 22;
    case 'answerLifts': return answerLiftsDepth();
    case 'hexFinale': return hexFinaleDepth();
    case 'boulderRun': return boulderDepth();
    case 'slimeGate': return 10 * slimeGateWalls(difficulty).k + 8;
    case 'corridor': throw new Error('corridor depth is computed');
    case 'slot': case 'mazeSlot': throw new Error('slots are resolved before building');
    case 'fork': throw new Error('fork has no depth');
  }
}

const CHECKPOINT_D: Partial<Record<SegmentKind, number>> = { start: 3, exit: 3, mergeHall: 5 };

export function buildCourse(sel: RunSelection, opts: BuildOptions = {}): Course {
  const layout = stream(sel.seed, 'layout');
  const domainName = questionSource.getPack(sel.domainId).name;
  const g = new Gen(sel.difficulty, layout, domainName, stream(sel.seed, 'hazards'));
  const segments: SegmentInfo[] = [];
  let roomCounter = 0;
  let spawn = { x: 0, y: 0, z: 0 };
  let exitPortal = { x: 0, y: 2.2, z: 0 };
  let scenicBoards: Course['scenicBoards'] = null;

  function makeSeg(kind: SegmentKind, laneX: number, z0: number, depth: number, width: number, lane: SegmentInfo['lane']): SegmentInfo {
    const isRoom = ROOM_KINDS.includes(kind);
    const cd = CHECKPOINT_D[kind] ?? 2;
    const seg: SegmentInfo = {
      index: segments.length, kind, laneX, z0, depth, width, lane,
      checkpoint: { x: laneX, z: z0 - cd },
    };
    if (isRoom) seg.roomId = `r${roomCounter++}`;
    segments.push(seg);
    return seg;
  }

  /** Place one non-fork step. Returns the segment. */
  function placeStep(step: Step, laneX: number, z0: number, lane: SegmentInfo['lane'], depthOverride?: number, extraRows = 0): SegmentInfo {
    const depth = depthOverride ?? stepDepth(step, sel.difficulty, extraRows);
    const seg = makeSeg(step.k as SegmentKind, laneX, z0, depth, T.LANE_W, lane);
    const tierMod = ('tierMod' in step && step.tierMod) || 0;
    switch (step.k) {
      case 'start': buildStart(g, seg); spawn = { x: laneX, y: 0, z: z0 - 3 }; break;
      case 'maze': buildMaze(g, seg); break;
      case 'quizMaze': buildQuizMaze(g, seg); break;
      case 'corridor': buildCorridor(g, seg); break;
      case 'doorRush': buildDoorRush(g, seg, tierMod as -1 | 0 | 1); break;
      case 'tileDrop': buildTileDrop(g, seg, tierMod as -1 | 0 | 1); break;
      case 'stepStones': buildStepStones(g, seg); break;
      case 'bridgeBuilder': buildBridgeBuilder(g, seg); break;
      case 'launchPads': buildLaunchPads(g, seg); break;
      case 'ruleMinefield': buildRuleMinefield(g, seg); break;
      case 'keyHunt': buildKeyHunt(g, seg); break;
      case 'doorCarousel': buildDoorCarousel(g, seg); break;
      case 'memoryFloor': buildMemoryFloor(g, seg); break;
      case 'answerLifts': buildAnswerLifts(g, seg); break;
      case 'hexFinale': buildHexFinale(g, seg); break;
      case 'boulderRun': buildBoulderRun(g, seg); break;
      case 'shiftMaze': buildShiftMaze(g, seg); break;
      case 'slimeGate': buildSlimeGate(g, seg); break;
      case 'exit': exitPortal = buildExit(g, seg); break;
      default: throw new Error(`cannot place ${step.k}`);
    }
    return seg;
  }

  let z = 0;
  for (const step of recipeFor(sel, opts)) {
    if (step.k !== 'fork') {
      const seg = placeStep(step, 0, z, 'main');
      z -= seg.depth;
      continue;
    }

    // ── fork: a free choice (forkHall) or a question that picks the lane (junctionHall) ──
    const junction = T.JUNCTION_HALL[sel.difficulty];
    const hallDepth = junction ? T.JUNCTION_HALL_DEPTH : 10;
    const shortSide = layout() < 0.5 ? -1 : 1;
    const longX = -shortSide * T.LANE_OFFSET, shortX = shortSide * T.LANE_OFFSET;
    const hall = makeSeg(junction ? 'junctionHall' : 'forkHall', 0, z, hallDepth, T.FORK_W, 'main');
    if (junction) buildJunctionHall(g, hall, shortX, longX);
    else buildForkHall(g, hall);
    z -= hallDepth;

    // The long lane may need extra maze rows so the short lane's corridor is at least 6 m.
    let extra = 0;
    let longDepth = 0, corridorDepth = 0;
    for (;;) {
      let firstMaze = true;
      longDepth = step.long.reduce((n, s) => {
        const add = s.k === 'maze' && firstMaze ? extra : 0;
        if (s.k === 'maze') firstMaze = false;
        return n + stepDepth(s, sel.difficulty, add);
      }, 0);
      const shortRooms = step.short.filter((s) => s.k !== 'corridor').reduce((n, s) => n + stepDepth(s, sel.difficulty), 0);
      corridorDepth = longDepth - shortRooms;
      if (corridorDepth >= 6) break;
      extra++;
    }

    const laneStart = z;
    const laneSegs = (steps: Step[], laneX: number, lane: 'short' | 'long'): SegmentInfo[] => {
      const out: SegmentInfo[] = [];
      let zz = laneStart;
      let firstMaze = true;
      for (const s of steps) {
        const add = s.k === 'maze' && firstMaze ? extra : 0;
        if (s.k === 'maze') firstMaze = false;
        const seg = placeStep(s, laneX, zz, lane, s.k === 'corridor' ? corridorDepth : undefined, add);
        out.push(seg);
        zz -= seg.depth;
      }
      const first = out[0];
      g.trigger(rectToWorld(first, -10, 10, 0, 1.5), 'laneChoice', { lane }, true);
      return out;
    };
    const longSegs = laneSegs(step.long, longX, 'long');
    const shortSegs = laneSegs(step.short, shortX, 'short');

    const nLong = longSegs.filter((s) => s.roomId).length;
    const nShort = shortSegs.filter((s) => s.roomId).length;
    const signZ = hall.z0 - hallDepth + 1.5;
    const sy = junction ? 4.2 : 3.2;
    const how = (right: boolean) => (junction ? (right ? 'answer right · ' : 'answer wrong · ') : '');
    g.signs.push({ x: shortX, y: sy, z: signZ, title: 'SHORTCUT', subtitle: `${how(true)}${nShort} room${nShort === 1 ? '' : 's'} · harder` });
    g.signs.push({ x: longX, y: sy, z: signZ, title: 'SCENIC ROUTE', subtitle: `${how(false)}${nLong} room${nLong === 1 ? '' : 's'} · easier` });
    if (junction) {
      scenicBoards = {
        roomId: hall.roomId!,
        a: { x: longX - 6.2, y: 0, z: laneStart - 2.5 }, b: { x: longX + 6.2, y: 0, z: laneStart - 2.5 },
      };
    }

    z -= longDepth;
    const merge = makeSeg('mergeHall', 0, z, 10, T.FORK_W, 'main');
    buildMergeHall(g, merge);
    z -= 10;
  }

  const detour = buildDetour(g);

  // bounds over all main-course segments
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.laneX - s.width / 2); maxX = Math.max(maxX, s.laneX + s.width / 2);
    minZ = Math.min(minZ, s.z0 - s.depth); maxZ = Math.max(maxZ, s.z0);
  }

  return {
    seed: sel.seed, segments, walls: g.walls, floors: g.floors, triggers: g.triggers, rooms: g.rooms,
    coins: g.coins, speedPads: g.speedPads, signs: g.signs, spawn, exitPortal, detour,
    bounds: { minX, maxX, minZ, maxZ }, arches: g.arches, mazeDeadEnds: g.deadEnds, mazes: g.mazes, hazards: g.hazards, scenicBoards,
  };
}

/** The detour corridor (spec §11.1): far off to the side at laneX = 500. Wide enough for 4 retry doors. */
function buildDetour(g: Gen): DetourLayout {
  const w = T.DETOUR_W / 2;
  const seg: SegmentInfo = {
    index: -1, kind: 'corridor', laneX: 500, z0: 0, depth: 34, width: T.DETOUR_W, lane: 'main', checkpoint: { x: 500, z: -2 },
  };
  buildSouthWall(g, seg, 'detourHedge', T.H_HEDGE, []);
  buildSideWalls(g, seg, 'detourHedge', T.H_HEDGE);
  const h = T.WALL_T / 2;
  g.wall('detourHedge', rectToWorld(seg, -w - h, w + h, 34 - h, 34 + h), T.H_HEDGE);
  g.floor(rectToWorld(seg, -w, w, 0, 34), PAL.detourFloor);
  const spawn = toWorld(seg, 0, 2);
  const a = toWorld(seg, -3, 8), b = toWorld(seg, 3, 15);
  g.trigger(rectToWorld(seg, -w, w, 6, 9), 'detourBoard', { board: 'A' }, false);
  g.trigger(rectToWorld(seg, -w, w, 13, 16), 'detourBoard', { board: 'B' }, false);
  g.trigger(rectToWorld(seg, -w, w, 18, 20), 'detourRetry', {}, false);
  const retryWall = buildDoorWall(g, seg, 24, doorCenters(T.DETOUR_DOORS[g.difficulty]), w + h, 'detourHedge', 'detourDoor', 0);
  const portal = toWorld(seg, 0, 30);
  return {
    laneX: 500, z0: 0,
    spawn: { x: spawn.x, y: 0, z: spawn.z },
    boardA: { x: a.x, y: 0, z: a.z }, boardB: { x: b.x, y: 0, z: b.z },
    retryWall,
    portal: { x: portal.x, y: 1.6, z: portal.z },
    bounds: { minX: 500 - w, maxX: 500 + w, minZ: -34, maxZ: 0 },
  };
}
