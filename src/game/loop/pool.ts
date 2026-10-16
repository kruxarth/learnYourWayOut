import type { DomainPack } from '../../content/schema';
import { shuffle, type Rng } from '../rng';
import type { Difficulty, RoomKind, RunSelection } from '../types';

/**
 * Recipes, the room pool and the slot resolver (F4-0).
 *
 * A recipe is a list of steps. Anchors (start, first maze, quizMaze, the fork, slimeGate, exit) are
 * fixed; `slot` and `mazeSlot` steps are filled from the pool by `resolveRecipe`, using the named
 * stream `recipe` so the layout stream (and every anchor's layout) is untouched.
 */

export type Step =
  | { k: 'start' | 'exit' | 'stepStones' | 'bridgeBuilder' | 'slimeGate' | 'launchPads' | 'ruleMinefield' | 'answerLifts' | 'hexFinale' | 'boulderRun' }
  | { k: 'maze' | 'quizMaze' | 'keyHunt' | 'shiftMaze'; extraRows?: number }
  | { k: 'doorCarousel' | 'memoryFloor' }
  | { k: 'doorRush' | 'tileDrop'; tierMod?: -1 | 0 | 1 }
  | { k: 'corridor' }
  | { k: 'slot' | 'mazeSlot' }
  | { k: 'fork'; short: Step[]; long: Step[] };

export const FORK_EASY: Step = { k: 'fork',
  short: [{ k: 'corridor' }, { k: 'doorRush', tierMod: 1 }],
  long: [{ k: 'maze', extraRows: 2 }, { k: 'tileDrop', tierMod: -1 }] };

export const FORK_FULL: Step = { k: 'fork',
  short: [{ k: 'corridor' }, { k: 'doorRush', tierMod: 1 }],
  long: [{ k: 'maze', extraRows: 2 }, { k: 'tileDrop', tierMod: -1 }, { k: 'doorRush', tierMod: -1 }] };

const S = { k: 'slot' } as const;
const MS = { k: 'mazeSlot' } as const;

/** Recipes with slots. 3 / 4 / 5 slots, the same room count as before the pool existed. */
export const TEMPLATES: Record<Difficulty, Step[]> = {
  easy: [{ k: 'start' }, { k: 'maze' }, S, MS, S, FORK_EASY, S, { k: 'slimeGate' }, { k: 'exit' }],
  normal: [{ k: 'start' }, { k: 'maze' }, S, { k: 'quizMaze' }, S, FORK_FULL, S, MS, S, { k: 'slimeGate' }, { k: 'exit' }],
  hard: [{ k: 'start' }, { k: 'maze' }, S, { k: 'quizMaze' }, S, MS, S, FORK_FULL, S, { k: 'quizMaze' }, S, { k: 'slimeGate' }, { k: 'exit' }],
};

/** The recipes as they were before the pool. Tests use them to keep the older room tests on fixed courses. */
export const CLASSIC_RECIPES: Record<Difficulty, Step[]> = {
  easy: [{ k: 'start' }, { k: 'maze' }, { k: 'doorRush' }, { k: 'maze' }, { k: 'tileDrop' }, FORK_EASY,
    { k: 'stepStones' }, { k: 'slimeGate' }, { k: 'exit' }],
  normal: [{ k: 'start' }, { k: 'maze' }, { k: 'doorRush' }, { k: 'quizMaze' }, { k: 'tileDrop' }, FORK_FULL,
    { k: 'stepStones' }, { k: 'maze' }, { k: 'bridgeBuilder' }, { k: 'slimeGate' }, { k: 'exit' }],
  hard: [{ k: 'start' }, { k: 'maze' }, { k: 'doorRush' }, { k: 'quizMaze' }, { k: 'tileDrop' }, { k: 'maze' }, { k: 'doorRush' },
    FORK_FULL, { k: 'stepStones' }, { k: 'quizMaze' }, { k: 'bridgeBuilder' }, { k: 'slimeGate' }, { k: 'exit' }],
};

/**
 * `?demo=1` (math, normal, seed 4242): the same course every time, with the best-looking rooms pinned.
 * Pinned: Launch Pads (where Tile Drop used to be) and Rule Minefield (where Step Stones used to be).
 * Key Hunt is the second plain maze.
 */
export const DEMO_RECIPE: Step[] = [
  { k: 'start' }, { k: 'maze' }, { k: 'doorRush' }, { k: 'quizMaze' }, { k: 'launchPads' }, FORK_FULL,
  { k: 'ruleMinefield' }, { k: 'keyHunt' }, { k: 'bridgeBuilder' }, { k: 'slimeGate' }, { k: 'exit' },
];

// ───────────────────────── the pool ─────────────────────────

export type PoolKind = RoomKind | 'maze';

export interface PoolEntry {
  kind: PoolKind;
  slot: 'room' | 'maze';
  minDifficulty: Difficulty;
  weight: number;
  /** A big set piece: never two next to each other in slot order. */
  big: boolean;
  /** One of the original four rooms. Normal and Hard guarantee a share of non-classic rooms. */
  classic: boolean;
  /** Does the pack have enough questions of the types this room needs? */
  fits(pack: DomainPack): boolean;
}

function countType(pack: DomainPack, type: string): number {
  let n = 0;
  for (const q of pack.questions) if (q.type === type) n++;
  return n;
}

export const POOL: PoolEntry[] = [
  { kind: 'doorRush', slot: 'room', minDifficulty: 'easy', weight: 1, big: false, classic: true, fits: (p) => countType(p, 'mcq') >= 4 },
  { kind: 'tileDrop', slot: 'room', minDifficulty: 'easy', weight: 1, big: false, classic: true, fits: (p) => countType(p, 'truefalse') >= 4 },
  { kind: 'stepStones', slot: 'room', minDifficulty: 'easy', weight: 1, big: false, classic: true, fits: (p) => countType(p, 'steps') >= 2 },
  { kind: 'bridgeBuilder', slot: 'room', minDifficulty: 'easy', weight: 1, big: false, classic: true, fits: (p) => countType(p, 'order') >= 2 },
  { kind: 'launchPads', slot: 'room', minDifficulty: 'easy', weight: 1, big: true, classic: false,
    fits: (p) => countType(p, 'mcq') >= 4 && countType(p, 'truefalse') >= 4 },
  // needs at least 4 classify questions (hand packs have 4 per domain; generated packs may have fewer)
  { kind: 'ruleMinefield', slot: 'room', minDifficulty: 'easy', weight: 1, big: false, classic: false, fits: (p) => countType(p, 'classify') >= 4 },
  // a maze variant for the mazeSlot: needs mcq questions for the key labels
  { kind: 'keyHunt', slot: 'maze', minDifficulty: 'easy', weight: 1, big: false, classic: false, fits: (p) => countType(p, 'mcq') >= 4 },
  { kind: 'doorCarousel', slot: 'room', minDifficulty: 'easy', weight: 1, big: true, classic: false, fits: (p) => countType(p, 'mcq') >= 4 },
  { kind: 'memoryFloor', slot: 'room', minDifficulty: 'easy', weight: 1, big: false, classic: false, fits: (p) => countType(p, 'mcq') >= 4 },
  { kind: 'answerLifts', slot: 'room', minDifficulty: 'normal', weight: 1, big: true, classic: false, fits: (p) => countType(p, 'mcq') >= 4 },
  // a 40 m corridor with a boulder behind you: Normal and up, a big set piece; needs mcq questions for the alcoves
  { kind: 'boulderRun', slot: 'room', minDifficulty: 'normal', weight: 1, big: true, classic: false, fits: (p) => countType(p, 'mcq') >= 4 },
  // a maze variant with two switch shrines that move the hedges: Normal and up
  { kind: 'shiftMaze', slot: 'maze', minDifficulty: 'normal', weight: 1, big: false, classic: false, fits: (p) => countType(p, 'mcq') >= 4 },
  { kind: 'maze', slot: 'maze', minDifficulty: 'easy', weight: 1, big: false, classic: true, fits: () => true },
];

const RANK: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2 };

export function eligibleEntries(slot: PoolEntry['slot'], difficulty: Difficulty, pack: DomainPack): PoolEntry[] {
  return POOL.filter((e) => e.slot === slot && RANK[e.minDifficulty] <= RANK[difficulty] && e.fits(pack));
}

/** Weighted pick without replacement. */
function takeWeighted(list: PoolEntry[], n: number, rng: Rng): PoolEntry[] {
  const left = list.slice();
  const out: PoolEntry[] = [];
  while (out.length < n && left.length) {
    let total = 0;
    for (const e of left) total += e.weight;
    let x = rng() * total;
    let i = 0;
    for (; i < left.length - 1; i++) { x -= left[i].weight; if (x < 0) break; }
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

function noBigNeighbours(list: PoolEntry[]): boolean {
  for (let i = 1; i < list.length; i++) if (list[i].big && list[i - 1].big) return false;
  return true;
}

/** Choose `n` room entries obeying the pool rules (see plan/F4_NEW_MODES.md, F4-0). */
export function chooseRooms(n: number, difficulty: Difficulty, pack: DomainPack, rng: Rng): PoolEntry[] {
  const eligible = eligibleEntries('room', difficulty, pack);
  if (!eligible.length) throw new Error('room pool is empty');
  let picked: PoolEntry[];
  if (eligible.length <= n) {
    // pool smaller than the slot count: every kind once, then repeats
    picked = eligible.slice();
    while (picked.length < n) picked.push(takeWeighted(eligible, 1, rng)[0]);
  } else {
    const fresh = eligible.filter((e) => !e.classic);
    const want = difficulty === 'easy' ? 0 : Math.min(Math.ceil(n / 2), fresh.length);
    const first = takeWeighted(fresh, want, rng);
    const rest = takeWeighted(eligible.filter((e) => !first.includes(e)), n - first.length, rng);
    picked = [...first, ...rest];
    // more big rooms than every-other slot can hold: swap the extras for small ones (non-classic for non-classic)
    const maxBig = Math.ceil(n / 2);
    for (let bigs = picked.filter((e) => e.big); bigs.length > maxBig; bigs = picked.filter((e) => e.big)) {
      const drop = bigs[bigs.length - 1];
      const spare = eligible.filter((e) => !e.big && !picked.includes(e));
      if (!spare.length) break;
      const like = spare.filter((e) => e.classic === drop.classic);
      picked[picked.indexOf(drop)] = takeWeighted(like.length ? like : spare, 1, rng)[0];
    }
  }
  let order = shuffle(picked, rng);
  for (let tries = 0; tries < 30 && !noBigNeighbours(order); tries++) order = shuffle(picked, rng);
  if (!noBigNeighbours(order)) order = interleaveBig(order);
  return order;
}

/** Big rooms on every other slot, small ones in between (a fallback that always works when bigs <= ceil(n/2)). */
function interleaveBig(order: PoolEntry[]): PoolEntry[] {
  const big = order.filter((e) => e.big), small = order.filter((e) => !e.big);
  const out: PoolEntry[] = [];
  while (big.length || small.length) {
    if (big.length && (out.length === 0 || !out[out.length - 1].big)) out.push(big.shift()!);
    else if (small.length) out.push(small.shift()!);
    else out.push(big.shift()!);
  }
  return out;
}

function asStep(kind: PoolKind): Step {
  return { k: kind } as Step;
}

/** Fill the slots of a recipe. Pure: the same selection and pack give the same steps. */
export function resolveRecipe(recipe: Step[], sel: RunSelection, pack: DomainPack, rng: Rng): Step[] {
  const slots = recipe.filter((s) => s.k === 'slot').length;
  const rooms = chooseRooms(slots, sel.difficulty, pack, rng);
  const mazes = eligibleEntries('maze', sel.difficulty, pack);
  let ri = 0;
  return recipe.map((s): Step => {
    if (s.k === 'slot') return asStep(rooms[ri++].kind);
    if (s.k === 'mazeSlot') return asStep(takeWeighted(mazes, 1, rng)[0].kind);
    return s;
  });
}

/**
 * Gauntlet: every eligible pool room once, in seeded order, with plain mazes between big rooms.
 * The quiz maze and the Junction Hall stay, so the run still has crossroads and a fork.
 */
export function gauntletRecipe(pack: DomainPack, rng: Rng): Step[] {
  const rooms = shuffle(eligibleEntries('room', 'normal', pack), rng);
  const out: Step[] = [{ k: 'start' }, { k: 'maze' }, { k: 'quizMaze' }];
  const forkAt = Math.floor(rooms.length / 2);
  rooms.forEach((e, i) => {
    if (i === forkAt) out.push(FORK_FULL);
    const prev = i > 0 ? rooms[i - 1] : null;
    if (prev && (prev.big || e.big)) out.push({ k: 'maze' });
    out.push(asStep(e.kind));
  });
  if (forkAt >= rooms.length) out.push(FORK_FULL);
  // the last plain maze before the Slime Gate is the Key Hunt, when the pack has the questions
  const mazes = eligibleEntries('maze', 'normal', pack);
  if (mazes.some((e) => e.kind === 'shiftMaze')) out.push({ k: 'shiftMaze' });
  out.push(mazes.some((e) => e.kind === 'keyHunt') ? { k: 'keyHunt' } : { k: 'maze' }, { k: 'slimeGate' }, { k: 'exit' });
  return out;
}

/**
 * The last room (F4-X): `finale: 'hex'` swaps the Slime Gate for the Hex Finale. Pure: it returns the same
 * steps unless a Slime Gate is there to replace, so the pinned demo and the Gauntlet are never touched.
 */
export function applyFinale(steps: Step[], finale: RunSelection['finale']): Step[] {
  if (finale !== 'hex') return steps;
  return steps.map((s): Step => (s.k === 'slimeGate' ? { k: 'hexFinale' } : s));
}
