import type { Question, QuestionType } from '../content/schema';

export type Screen = 'hub' | 'run' | 'results';
export type RunPhase = 'countdown' | 'playing' | 'transition' | 'won' | 'lost';
export type RoomState = 'idle' | 'active' | 'resolved';
export type RoomKind = 'doorRush' | 'tileDrop' | 'stepStones' | 'bridgeBuilder' | 'slimeGate' | 'quizMaze' | 'junctionHall' | 'launchPads' | 'ruleMinefield' | 'keyHunt' | 'doorCarousel' | 'memoryFloor' | 'answerLifts' | 'hexFinale' | 'boulderRun' | 'shiftMaze';
export type PowerKind = 'lantern' | 'compass' | 'freeze' | 'xray' | 'shield';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type DomainId = 'math' | 'science' | 'history' | 'programming' | 'custom';
export type Tier = 1 | 2 | 3;
export type Zone = 'normal' | 'think' | 'detour' | 'boss' | 'frozen';

export interface RunSelection {
  domainId: DomainId;
  difficulty: Difficulty;
  seed: number;
  focusConcepts?: string[]; // set for a weak-spot run
  /** Run mode. Absent means 'solo'. 'gauntlet' plays every room of the pool once. */
  mode?: 'solo' | 'online' | 'daily' | 'gauntlet';
  /** Last room: 'gate' (Slime Gate, the default) or 'hex' (Hex Finale). Absent means 'gate'. */
  finale?: 'gate' | 'hex';
}

export interface Vec3 { x: number; y: number; z: number }

// ───────────────────────── Course geometry (§9.1) ─────────────────────────

export type WallKind = 'hedge' | 'room' | 'doorWall' | 'detourHedge' | 'gate' | 'panel' | 'invisible';

export interface WallBox {
  id: number;
  minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number;
  kind: WallKind;
  enabled: boolean;
  isStatic: boolean;
  touchId?: string; // 'door:<roomId>:<wallIndex>:<panelIndex>' or 'detourDoor:<i>'
  colorSeed?: number;
}

export interface FloorRect {
  id: number; minX: number; maxX: number; minZ: number; maxZ: number; top: number;
  enabled: boolean; isStatic: boolean;
  tag?: string; // 'tile:<roomId>:<i>' or 'slab:<roomId>:<k>' ...
  color: string;
  /**
   * Moving floor (F4-8): a room changes `top` every step from the run clock or its own state. A grounded
   * player standing on it rides along (see `rideFloors` in navigation.ts). `prevTop` is the top the
   * controller last applied; only the controller writes it.
   */
  moving?: boolean;
  prevTop?: number;
}

export type TriggerKind = 'segmentEnter' | 'roomActivate' | 'bossWall' | 'laneChoice' | 'speedPad'
  | 'detourBoard' | 'detourRetry' | 'junction' | 'junctionPick';

export interface Trigger {
  id: number; minX: number; maxX: number; minZ: number; maxZ: number;
  kind: TriggerKind; data: Record<string, string | number>; once: boolean; fired: boolean;
}

export type SegmentKind = 'start' | 'maze' | 'corridor' | 'forkHall' | 'mergeHall' | RoomKind | 'exit';

export interface SegmentInfo {
  index: number; kind: SegmentKind; laneX: number; z0: number; depth: number; width: number;
  lane: 'main' | 'short' | 'long'; roomId?: string; checkpoint: { x: number; z: number };
}

export interface DoorLayout { wallId: number; cx: number; width: number }
export interface DoorWallLayout {
  wallIndex: number;
  z: number;          // world Z of the wall center
  doors: DoorLayout[];
}
export interface TileLayout { floorId: number; col: number; row: number; cx: number; cz: number; sx: number; sz: number }
export interface StepRowLayout { slotFloorIds: number[]; cz: number; z0: number; z1: number }
export interface SlabLayout { floorId: number; cx: number; cz: number; sx: number; sz: number }

/** One corridor leaving a quiz-maze junction. `dx, dz` point into the corridor (world). */
export interface BranchLayout {
  correct: boolean;
  size: number;           // cells in the branch (wrong branches only; 0 for the correct one)
  dx: number; dz: number;
  signX: number; signZ: number;
}

/** A crossroads inside a quiz maze: the junction cell and its labelled corridors. */
export interface JunctionLayout {
  index: number;
  cell: { c: number; r: number };
  x: number; z: number;
  branches: BranchLayout[];
}

/** Maze cell graph kept for the compass and tests. */
export interface MazeInfo {
  segIndex: number;
  laneX: number; z0: number; depth: number;
  rows: number;
  exitC: number;
  wallE: boolean[][];
  wallN: boolean[][];
  /** Quiz mazes: solution path from the entrance cell to the exit cell. */
  path: { c: number; r: number }[];
}

/** Launch Pads geometry in world coordinates (the pad row is placed at activation, once the pad count is known). */
export interface LaunchLayout {
  padZ: number;                 // world Z of the pad row
  hedgeZ: number;               // world Z of the centre of the tall hedge
  hedgeWallId: number;
  hedgeH: number;
  correctZ: number;             // world Z of the landing platform beyond the hedge
  pondZ: number;                // world Z of the pond landing (easy / normal)
  trapLanding: { x: number; z: number } | null; // Hard: the trap maze landing
  pond: { minX: number; maxX: number; minZ: number; maxZ: number }[]; // wade zones
}

/** Rule Minefield geometry: 4 rows of 3 tiles, with a safe walkway before, between and after the rows. */
export interface MineLayout {
  /** World Z range of walkway k (0 = entry platform, 4 = exit platform): [minZ, maxZ]. */
  walks: { minZ: number; maxZ: number; cz: number }[];
  /** Tile column centres (world X). */
  colX: number[];
  /** safe[row][col]: which tiles fit the rule. Placed by the layout rng; labels are dealt at activation. */
  safe: boolean[][];
}

/** Key Hunt: a maze whose exit is a locked gate. Keys lie in dead ends. */
export interface HuntLayout {
  gateWallId: number;
  /** Centre of the gate (world). */
  gate: { x: number; z: number };
  /** Dead-end cells that hold a key (world centre and maze cell). */
  spots: { x: number; z: number; c: number; r: number }[];
}

/** Door Carousel (F4-5): a train of door panels slides sideways behind one opening in the wall. */
export interface CarouselLayout {
  /** Panel width (m): the loop is panels x width long, contiguous, so there is never a gap to slip through. */
  panelW: number;
  /** Length of the loop (m). */
  loopLen: number;
  /** Panel box z range (world), just behind the wall. */
  minZ: number; maxZ: number;
}

/** Answer Lifts geometry (F4-8). Local depths d are metres from the room's entrance. */
export interface LiftLayout {
  xs: number[];                 // world X of each lift centre
  z: number;                    // world Z of the lift centres
  half: number;                 // half width / depth of a lift
  floorIds: number[];           // the dynamic floor of each lift
  dockZ: number;                // world Z of the dock edge (the dock is south of it)
  ledgeZ: number;               // world Z of the ledge's south face
  ledgeEndZ: number;            // world Z of the ledge's north edge
  ledgeWallId: number;
  pond: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Hex Finale geometry (F4-X). The arena is a disc of pointy-top hex cells; each cell is a dynamic floor rect. */
export interface HexCellLayout { floorId: number; q: number; r: number; ring: number; cx: number; cz: number; sx: number; sz: number; angle: number }
export interface HexLayout {
  cells: HexCellLayout[];
  centerX: number; centerZ: number;
  size: number;                 // hex circumradius
  rings: number;
  doorstepFloorId: number;      // the entrance step, removed once the finale starts
  exitFloorId: number;          // the exit platform, enabled once the finale is won
}

/** Boulder Run geometry (F4-6). `alcoves` are all answer pockets; `waves[k]` lists the alcove slots of wave k. */
export interface BoulderAlcove {
  side: -1 | 1;
  /** World Z range of the alcove interior, and its mouth x (the corridor face) and back x. */
  minZ: number; maxZ: number;
  /** Final-wave alcoves: the dynamic gate in the back wall that opens when the alcove is right. Null for mid-run pockets. */
  gateWallId: number | null;
  /** World x of the middle of the alcove and z of its centre (label spot). */
  cx: number; cz: number;
}
export interface BoulderLayout {
  /** World x of the corridor axis, world z of the entrance and of the end wall. */
  axisX: number; z0: number; endZ: number;
  alcoves: BoulderAlcove[];
  waves: number[][];
  startSpawn: Vec3;
}

/** Shifting Maze geometry (F4-9): a dynamic wall box for every interior edge, and the shrine cells. */
export interface ShiftLayout {
  rows: number; exitC: number;
  /** Wall ids by edge: edgesE[r][c] sits between (c, r) and (c + 1, r); edgesN[r][c] between (c, r) and (c, r + 1). */
  edgesE: number[][]; edgesN: number[][];
  shrines: { c: number; r: number; x: number; z: number }[];
}

export interface RoomLayout {
  id: string;
  kind: RoomKind;
  segIndex: number;
  laneX: number; z0: number; depth: number; width: number;
  tierMod: -1 | 0 | 1;
  gateWallId: number | null;       // entrance gate (dynamic wall); quiz mazes have none
  exitGateWallId: number | null;   // Tile Drop exit gate
  exitSpawn: Vec3;                 // return point after a detour
  doorWalls: DoorWallLayout[];     // Door Rush (1), Slime Gate (K)
  tiles: TileLayout[];             // Tile Drop (4)
  stepRows: StepRowLayout[];       // Step Stones (4)
  slabs: SlabLayout[];             // Bridge Builder (4)
  blockHomes: { x: number; z: number }[]; // Bridge Builder, 4 assigned
  buildZone: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  startSpawn: Vec3;                // bridge respawn
  junctions: JunctionLayout[];     // quiz maze
  laneGates: { short: number; long: number } | null; // junction hall: gate wall ids
  launch: LaunchLayout | null;     // launch pads
  carousel: CarouselLayout | null; // door carousel
  gold: { wallId: number; cx: number; z: number } | null; // Gold Door (Door Rush): the wall and its centre
  mine?: MineLayout;               // rule minefield
  hunt?: HuntLayout;               // key hunt
  lifts?: LiftLayout;              // Answer Lifts
  hex?: HexLayout;                 // Hex Finale
  boulder?: BoulderLayout;         // boulder run
  shift?: ShiftLayout;             // shifting maze
}

export interface DetourLayout {
  laneX: number; z0: number;
  spawn: Vec3;
  boardA: Vec3; boardB: Vec3;
  retryWall: DoorWallLayout;
  portal: Vec3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Maze hazards (F4-4). Motion is a pure function of the hazard clock, so every player sees the same thing. */
export type HazardKind = 'sweeper' | 'hammer' | 'ice';
export interface Hazard {
  id: number;
  kind: HazardKind;
  segIndex: number;
  /** Centre in world coordinates (sweeper pivot, hammer rest position, ice patch centre). */
  x: number; z: number;
  /** Half extents: ice patch = hw x hd; sweeper = hw is half the bar length; hammer = hw is the swing amplitude along x. */
  hw: number; hd: number;
  phase: number;
  dir: 1 | -1;
  /** Hammer head. Lives in the run's dynamic walls only (not in `Course.walls`), so static path checks ignore it. */
  head: WallBox | null;
}

export interface Coin { id: number; x: number; y: number; z: number; taken: boolean }
export interface Sign { x: number; y: number; z: number; title: string; subtitle: string }

export interface Course {
  seed: number;
  segments: SegmentInfo[];
  walls: WallBox[];
  floors: FloorRect[];
  triggers: Trigger[];
  rooms: RoomLayout[];
  coins: Coin[];
  speedPads: { x: number; z: number }[];
  signs: Sign[];
  spawn: Vec3;
  exitPortal: Vec3;
  detour: DetourLayout;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Arches / banners: start & exit. */
  arches: { x: number; y: number; z: number; text: string }[];
  /** Decorative hedge-top-free info for the minimap. */
  mazeDeadEnds: number;
  mazes: MazeInfo[];
  /** Sweepers, hammers and ice patches in plain mazes and corridors (empty on Easy). */
  hazards: Hazard[];
  /** Junction Hall: remediation boards at the start of the scenic lane. */
  scenicBoards: { roomId: string; a: Vec3; b: Vec3 } | null;
}

// ───────────────────────── Player / camera ─────────────────────────

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  facing: number;
  speedBoost: number;
  carrying: string | null;
  forcedFall: boolean;
  inputLocked: boolean;
  lastTouch: Record<string, number>;
  /** Bean visuals read these. */
  spin: number; // fake ragdoll timer 0..0.5
  /** Seconds of hazard stun left: input is ignored (the player is not `inputLocked`). */
  stun: number;
  /** Launch Pads: a scripted arc. While set, the controller only advances the arc (no input, no collision). */
  flight: { t: number; dur: number; from: Vec3; to: Vec3; apex: number } | null;
}

export interface CameraState { yaw: number; snapVersion: number; shake: number }

// ───────────────────────── Evaluation ─────────────────────────

export interface AnswerRecord {
  questionId: string;
  concept: string;
  type: QuestionType;
  roomKind: RoomKind | 'detour';
  tierAsked: Tier;
  correctFirstTry: boolean;
  wrongCount: number;
  usedHint: boolean;
  usedFifty: boolean;
  remediated: boolean;
  isRetry: boolean;
  timeMs: number;
}

export interface MasteryEntry { conceptId: string; name: string; asked: number; correct: number }

export interface RunResult {
  outcome: 'qualified' | 'eliminated';
  selection: RunSelection;
  timeMs: number;
  route: 'short' | 'long' | null;
  coinsCollected: number;
  slimeAtEnd: number;
  stars: 0 | 1 | 2 | 3;
  records: AnswerRecord[];
  mastery: MasteryEntry[];
  weakConcepts: string[];
  /** Par time of this course for the route taken (ms). */
  parMs: number;
  /** Gauntlet only: one row per room, in course order. */
  breakdown?: { kind: RoomKind; timeMs: number; asked: number; correct: number }[];
  /** Questions answered wrong on the first try, for the review list. */
  review: { prompt: string; answerText: string; explanation: string; questionId?: string }[];
}

export type { Question };
