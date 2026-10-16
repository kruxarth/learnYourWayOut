import type { DomainPack, Question } from '../content/schema';
import type { Rng } from './rng';
import type {
  AnswerRecord, Course, PowerKind, RoomKind, RoomLayout, RoomState, RunPhase, RunSelection, Tier, Vec3, Zone,
} from './types';
import type { GoldState } from './rooms/goldDoor';
import type { LiftRT } from './rooms/answerLifts';
import type { HexRT } from './rooms/hexFinale';
import type { World } from './world';

// ───────────────────────── doors (Door Rush, Slime Gate, detour retry) ─────────────────────────

export type PanelState = 'closed' | 'burst' | 'swing' | 'smashed' | 'wrongX';

export interface Panel {
  index: number;
  gold?: boolean;       // the Gold Door star panel
  wallId: number;       // the dynamic WallBox
  label: string;
  isCorrect: boolean;
  state: PanelState;
  glow: boolean;
  anim: number;         // 0..1 animation progress
}

export interface DoorWall {
  roomId: string;
  wallIndex: number;
  panels: Panel[];
  questionId: string | null;
}

// ───────────────────────── tiles & blocks ─────────────────────────

export type TileState = 'solid' | 'locked' | 'shaking' | 'falling' | 'gone';

export interface TileRT {
  floorId: number;
  label: string;
  correct: boolean;
  state: TileState;
  t: number;            // time in the current state
  glow: boolean;
  row: number;
  slot: number;
  cx: number; cz: number; sx: number; sz: number;  // render rectangle (world)
  visible: boolean;     // false while the slot is unused
  revealed: boolean;    // Step Stones: label visible
  marked?: boolean;     // Rule Minefield: a wrong tile that fell and came back as a red X
}

export type BlockState = 'home' | 'carried' | 'placed' | 'falling';

export interface BlockRT {
  id: string;
  itemIndex: number;
  label: string;
  state: BlockState;
  home: { x: number; z: number };
  t: number;
  glow: boolean;
  cool: number;         // pickup cooldown after a drop
}

// ───────────────────────── quiz-maze junctions ─────────────────────────

export type BranchState = 'idle' | 'open' | 'right' | 'wrong' | 'crossed';

export interface BranchRT { label: string; correct: boolean; state: BranchState; glow: boolean }
export interface JunctionRT { branches: BranchRT[] }

/** Countdown for a door question (Hard). Starts when the player first moves after activation. */
export interface AnswerTimer { total: number; remaining: number; started: boolean; done: boolean }

// ───────────────────────── launch pads ─────────────────────────

export interface PadRT {
  x: number; z: number;
  label: string;
  correct: boolean;
  state: 'idle' | 'wrong';   // wrong = used or removed by a lifeline: red and disabled
  charge: number;            // 0..1, the ring fills while the player stands on it
}

// ───────────────────────── key hunt ─────────────────────────

export interface KeyRT {
  id: string;
  label: string;
  correct: boolean;
  /** home: lying in its dead end; carried; wrong: carried to the gate and zapped back (marked X); used: opened the gate. */
  state: 'home' | 'carried' | 'wrong' | 'used';
  home: { x: number; z: number };
  cool: number;          // pickup cooldown after a drop
}

// ───────────────────────── door carousel & memory floor ─────────────────────────

export interface CarouselRT {
  /** Train position (m): panel i is centred at wrap(offset + i x panelW). Advances every step while the room is live. */
  offset: number;
  /** Stopped (answered, or a wrong panel was hit): the train stays where it was aligned. */
  frozen: boolean;
}

export interface MemoryRT {
  phase: 'idle' | 'reveal' | 'ask' | 'done';
  /** Seconds in the current phase (reveal) or left in a re-flash. */
  t: number;
  /** Seconds the labels are still re-flashed after a wrong tile (0 = face down). */
  reflash: number;
  /** Which tiles carry an answer label (the others are blank decoys). */
  labelled: boolean[];
  /** Tile the player has been standing on, and for how long. */
  standIdx: number;
  stand: number;
  /** Tiles ruled out (a wrong pick or a 50/50): blank and inert, shown with an X. */
  dead: boolean[];
  /** The tile that was picked wrong and is dropping (-1 none). */
  dropIdx: number;
  /** A wrong tile is dropping: the next fall respawns the player at the room start. */
  pendingFall: boolean;
  /** 0..1, the bridge to the exit rising after a right answer. */
  bridge: number;
}

// ───────────────────────── boulder run ─────────────────────────

export interface AlcoveRT { slot: number; label: string; correct: boolean; state: 'open' | 'wrong' | 'right' }
export interface BoulderWaveRT {
  question: Question;
  alcoves: AlcoveRT[];
  passed: boolean;
  wrong: number;
  startMs: number;
  record: AnswerRecord | null;
}
export interface BoulderRT {
  waves: BoulderWaveRT[];
  wave: number;
  /** rumble: the question is up and the ground shakes; rolling; smash: hit the end wall; squash: the bean was flattened (fade and respawn); idle: done. */
  phase: 'rumble' | 'rolling' | 'smash' | 'squash' | 'idle';
  t: number;
  /** Boulder position along the corridor, in metres from the entrance (negative = still behind the wall). */
  d: number;
  /** A Shield already blocked this boulder: it does no more harm until it resets. */
  shielded: boolean;
  squashes: number;
}

// ───────────────────────── shifting maze ─────────────────────────

export interface PlateRT { x: number; z: number; label: string; correct: boolean; state: 'idle' | 'wrong' | 'right'; charge: number }
export interface ShrineRT {
  state: 'idle' | 'asking' | 'done';
  question: Question | null;
  plates: PlateRT[];
  /** The player answered right on the first plate. */
  right: boolean | null;
}
export interface ShiftRT {
  shrines: ShrineRT[];
  /** Hedges moved so far (for the toast and tests). */
  moves: number;
}

// ───────────────────────── rooms ─────────────────────────

export type RoomResult = 'correct' | 'remediated' | 'wrongCompleted';

export interface RoomRuntime {
  id: string;
  kind: RoomKind;
  layout: RoomLayout;
  state: RoomState;
  result: RoomResult | null;
  question: Question | null;
  tierAsked: Tier;
  activatedAtMs: number;
  resolvedAtMs: number;
  roomNumber: number;
  record: AnswerRecord | null;
  hintShown: string | null;
  fiftyUsed: boolean;
  hintUsed: boolean;
  wrongCount: number;
  feedback: { text: string; tone: 'good' | 'bad' } | null;

  // door rooms
  doorWalls: DoorWall[];
  currentWall: number;                          // Slime Gate: index of the active wall (−1 none yet)
  wallQuestions: (Question | null)[];
  wallWrong: number[];
  wallDone: boolean[];
  wallRecords: (AnswerRecord | null)[];
  wrongDoor: { t: number; panel: number } | null; // Door Rush: pending detour after the fall

  // Tile Drop
  tiles: TileRT[];
  timer: { started: boolean; remaining: number; total: number; ended: boolean; shakeT: number; evaluated: boolean; correct: boolean | null; pendingDetour: boolean };

  // Step Stones
  stepRows: TileRT[][];
  currentRow: number;
  rowWrong: number[];
  lastSafe: Vec3;
  working: string[];

  // Bridge Builder
  blocks: BlockRT[];
  nextIndex: number;
  wrongAt: number[];
  slabAnim: number[];
  bridgeBanner: boolean;

  // quiz maze
  junctions: JunctionRT[];

  // Launch Pads
  pads: PadRT[];
  launching: { right: boolean } | null;   // set from the launch until the landing

  // Door Carousel / Memory Floor
  carousel: CarouselRT | null;
  memory: MemoryRT | null;
  // Answer Lifts (F4-8) and Hex Finale (F4-X): set when the room is activated / created
  lifts?: LiftRT[];
  hex?: HexRT;

  // Gold Door: the host's golden panel (null when the room has none)
  gold: Panel | null;
  // Key Hunt
  keys: KeyRT[];
  // Boulder Run, Shifting Maze: created at activation
  boulder?: BoulderRT;
  shift?: ShiftRT;

  // Hard mode
  answerTimer: AnswerTimer | null;
  lockT: number;                 // Slime Gate: doors locked after a wrong answer
  resetT: number;                // Step Stones: countdown to the drop back to row 0 (−1 none)
}

// ───────────────────────── detour ─────────────────────────

export interface DetourRuntime {
  roomId: string;
  question: Question;
  retryQuestion: Question | null;
  retryWall: DoorWall;
  nearBoard: 'A' | 'B' | null;
  retryActive: boolean;
  retryFirstTry: boolean | null;   // null until the first retry door is touched
  retryWrong: number;
  wrongSinceRelabel: number;
  retryFeedback: string | null;
  solved: boolean;
  exiting: boolean;
  startMs: number;
}

// ───────────────────────── run ─────────────────────────

export interface Transition {
  t: number;
  midpointDone: boolean;
  onMidpoint: () => void;
  onEnd?: () => void;
}

export interface RunState {
  runId: number;
  selection: RunSelection;
  seed: number;
  course: Course;
  world: World;
  pack: DomainPack;
  phase: RunPhase;
  paused: boolean;
  countdown: { t: number; shown: number };
  /** Wall-clock ms the 3-2-1 starts at (F3 synced start). Undefined means start at once. */
  countdownAt?: number;
  rooms: RoomRuntime[];
  roomMap: Map<string, RoomRuntime>;
  activeRoomId: string | null;
  roomsActivated: number;
  slime: number;
  coins: number;
  coinsCollected: number;
  tier: Tier;
  streak: number;
  records: AnswerRecord[];
  usedQuestionIds: Set<string>;
  recentConcepts: string[];
  wrongConcepts: Set<string>;
  route: 'short' | 'long' | null;
  elapsedMs: number;
  checkpoint: Vec3;
  transition: Transition | null;
  detour: DetourRuntime | null;
  fx: { shake: number };
  godMode: boolean;
  qRng: Rng;
  endTimer: number;
  zone: Zone;
  segIndex: number;
  heartbeat: number;
  lastSlimeMsg: number;

  // power-ups (P2-A) and combo speed (P2-B)
  combo: number;
  powerups: Record<PowerKind, number>;
  puRng: Rng;
  freezeT: number;
  compassT: number;
  gold: GoldState | null;        // the open Gold Door follow-up question
  hazardMs: number;              // hazard clock (ms): the run clock minus time spent frozen
  hazardIFrames: number;         // seconds left of hit immunity
  hazardHits: number;
  shield: boolean;               // Shield power-up armed: blocks the next hazard hit
  lanternSeg: number;            // segment index lit by a lantern (−1 none)
  /** Question ids seen in earlier runs (scored lower). */
  seenIds: Set<string>;
}
