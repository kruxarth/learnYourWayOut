// ALL numeric constants live here (spec §7.4). Other files import T.
export const T = {
  // loop
  STEP: 1 / 120, MAX_STEPS: 12, HUD_SYNC_HZ: 10,

  // player
  PLAYER_RADIUS: 0.45, PLAYER_HEIGHT: 1.6,
  MAX_SPEED: 7, ACCEL_GROUND: 40, ACCEL_AIR: 18, DECEL_GROUND: 30, DECEL_AIR: 4,
  JUMP_VELOCITY: 8.5, GRAVITY: 30, MAX_FALL_SPEED: 40,
  COYOTE_TIME: 0.1, JUMP_BUFFER: 0.12, STEP_UP: 0.25, FALL_Y: -6, TURN_RATE: 12,
  SPEED_PAD_MULT: 1.6, SPEED_PAD_TIME: 1.5, CARRY_SPEED_MULT: 0.85,

  // camera
  CAM_DIST: 10, CAM_HEIGHT: 8, CAM_TARGET_Y: 1.0, CAM_FOV: 55, CAM_LERP: 10, CAM_YAW_SENS: 0.005,
  // low chase cam inside mazes: blends from the high follow view over CHASE_EASE (1/s)
  CHASE_DIST: 5.5, CHASE_HEIGHT: 2.9, CHASE_TARGET_Y: 1.3, CHASE_FOV: 68, CHASE_EASE: 3,
  // quiz mazes: how many path cells a junction whose right corridor runs north counts as farther from its target, so the answer is not always "up"
  QUIZ_NORTH_PENALTY: 2,

  // geometry
  CELL: 4, WALL_T: 0.6, OPENING_HALF: 1.7,
  LANE_W: 20, FORK_W: 46, LANE_OFFSET: 13,
  H_HEDGE: 1.8, H_ROOM: 2.2, H_DOOR_WALL: 2.8,
  PANEL_W: 3.0, PANEL_H: 2.6, PANEL_T: 0.3,
  STEP_ROW_DEPTH: 4.4, STEP_ROW_WIDTH: 12, SLAB_DEPTH: 3, SLAB_WIDTH: 4,

  // slime
  SLIME_RATE: { easy: 1 / 360, normal: 1 / 300, hard: 1 / 425 },
  SLIME_SURGE: { easy: 0.06, normal: 0.08, hard: 0.06 },
  ZONE_MULT: { normal: 1, think: 0.35, detour: 0.5, boss: 2, frozen: 0 },
  /** Slime removed by a first-try correct answer. */
  SLIME_PUSHBACK: { easy: 0.05, normal: 0.03, hard: 0.015 },
  /** Pushback cannot take the slime below this × rooms resolved so far. */
  SLIME_FLOOR_PER_ROOM: { easy: 0, normal: 0.02, hard: 0.08 },
  /** Rate × (1 + accel × course progress), so the slime speeds up late in the run. */
  SLIME_ACCEL: { easy: 0, normal: 0.5, hard: 0.7 },
  RETRY_WRONG_SURGE: 0.04,
  SLIME_Y_MIN: -1.2, SLIME_Y_MAX: 1.3, WADE_SLOW: 0.4, SLIME_DANGER: 0.8,

  // stars: par time (s) is the sum over the segments on the route, about 1.8x the perfect bot's time in each.
  // Calibrate with `CALIBRATE=1 npx vitest run src/tests/calibrate.test.ts --silent=false`. Unlisted kinds use PAR_DEFAULT_S.
  // Measured 2026-10-15 with CAL_N=40 (bot s, easy / normal / hard in the comments).
  PAR_S: {
    start: { easy: 3, normal: 3, hard: 3 },                  // 1.5
    maze: { easy: 8, normal: 16, hard: 24 },                 // 4.2 / 8.9 / 12.8 (with hazards, bot waits for a safe phase)
    corridor: { easy: 5, normal: 10, hard: 17 },             // 2.4 / 5.0 / 9.0 (with hazards)
    forkHall: { easy: 5, normal: 5, hard: 5 },               // 2.5
    junctionHall: { easy: 8, normal: 8, hard: 7 },           // 4.1 / 3.9
    mergeHall: { easy: 3, normal: 3, hard: 3 },              // 1.4
    quizMaze: { easy: 17, normal: 17, hard: 23 },            // 8.9 / 12.4
    doorRush: { easy: 7, normal: 7, hard: 7 },               // 3.7
    tileDrop: { easy: 29, normal: 24, hard: 21 },            // 15.8 / 13.3 / 11.3
    stepStones: { easy: 11, normal: 10, hard: 10 },          // 5.5
    bridgeBuilder: { easy: 25, normal: 24, hard: 24 },       // 13.4
    slimeGate: { easy: 11, normal: 15, hard: 16 },           // 5.9 / 8.3 / 8.4
    launchPads: { easy: 8, normal: 8, hard: 8 },             // 4.2 / 4.1 / 4.1
    keyHunt: { easy: 16, normal: 20, hard: 25 },             // 8.5 / 10.9 / 13.6
    ruleMinefield: { easy: 13, normal: 16, hard: 15 },       // 7.1 / 8.6 / 8.0
    doorCarousel: { easy: 19, normal: 13, hard: 10 },        // 10.5 / 7.1 / 5.5 (waits for its panel; CAL_N = 40)
    memoryFloor: { easy: 23, normal: 19, hard: 16 },         // 12.6 / 10.4 / 8.3 (includes the reveal)
    answerLifts: { easy: 13, normal: 13, hard: 14 },         // 7.1 / 7.5 (Normal and Hard only)
    hexFinale: { easy: 131, normal: 131, hard: 131 },        // 72.5 (5 rounds of 12..8 s plus the falls; same on every difficulty)
    boulderRun: { easy: 14, normal: 14, hard: 34 },          // - / 7.5 / 18.4 (Normal and up only)
    shiftMaze: { easy: 13, normal: 13, hard: 16 },           // - / 7.2 / 8.8 (Normal and up only)
    exit: { easy: 2, normal: 2, hard: 2 },                   // 0.7
  } as Partial<Record<string, { easy: number; normal: number; hard: number }>>,
  PAR_DEFAULT_S: 15,
  /** A person has to read each question; the bot does not. Added once per room on the route. */
  PAR_READ_S: 4,
  /** Gauntlet runs on Normal rules, but the run is long, so the slime is slower. */
  GAUNTLET_SLIME_MULT: 0.7,

  // mazes
  MAZE_ROWS: { easy: 4, normal: 6, hard: 8 },
  MAZE_BRAID: { easy: 0.5, normal: 0.2, hard: 0.05 },
  /** Exit in a random column, then a 4 m vestibule that funnels to the next segment. */
  MAZE_RANDOM_EXIT: { easy: false, normal: true, hard: true },
  VESTIBULE: 4,
  /** Crossroads quiz mazes: junctions per maze, and the smallest wrong branch (cells). */
  QUIZ_JUNCTIONS: { easy: 1, normal: 2, hard: 3 },
  QUIZ_MIN_BRANCH: 2, QUIZ_MAX_TRIES: 50,

  // visibility (m). 0 = off. Fragments fade to the horizon colour from 0.6 R to R around the player.
  VIS_RADIUS: { easy: 0, normal: 10, hard: 7 },
  VIS_OPEN: 400, VIS_EASE: 3,
  MINIMAP_REVEAL: { easy: 9, normal: 6, hard: 4 },
  MINIMAP_OFF_IN_QUIZ: { easy: false, normal: false, hard: true },

  // answer timers (s) for Door Rush, Slime Gate and the Junction Hall. 0 = none.
  DOOR_TIMER: { easy: 0, normal: 0, hard: 12 },
  RELAXED_TIMER_MULT: 2, TIMER_START_SPEED: 1,

  // crutches
  GLOW_AFTER_WRONG: { easy: 2, normal: 2, hard: Infinity },
  DETOUR_DOORS: { easy: 2, normal: 3, hard: 4 },
  DETOUR_GLOW_AFTER: { easy: 1, normal: 2, hard: Infinity },
  /** Hard: after this many misses the retry doors get a new question instead of a glow. */
  DETOUR_REQUESTION_AFTER: 2,
  DETOUR_W: 18,
  STEP_RESET_ON_WRONG: { easy: false, normal: false, hard: true },
  BRIDGE_RESET_ON_WRONG: { easy: false, normal: false, hard: true },
  SLIME_GATE_LAST_GLOW: { easy: true, normal: true, hard: false },
  GATE_LOCK_TIME: { easy: 0, normal: 0, hard: 3 },

  // junction hall (the fork as a question)
  JUNCTION_HALL: { easy: false, normal: true, hard: true },
  JUNCTION_HALL_DEPTH: 16, JUNCTION_DOOR_D: 9,

  // power-ups and combo
  COMBO_FOR_POWERUP: 3, POWERUP_MAX: 2,
  LANTERN_BONUS: 3, COMPASS_TIME: 15, FREEZE_TIME: 10,
  COMBO_SPEED_STEP: 0.05, COMBO_SPEED_MAX: 0.2,

  // hazards (F4-4): plain mazes and corridors only. Never lethal: knockback, a spin, a short stun and a small slime cost.
  HAZARDS_PER_MAZE: { easy: 0, normal: 2, hard: 4 },
  HAZARDS_PER_CORRIDOR: { easy: 0, normal: 1, hard: 2 },
  SWEEPER_LEN: 3.6, SWEEPER_THICK: 0.5, SWEEPER_H: 0.9,
  /** Sweeper spin (rad/s). */
  SWEEPER_OMEGA: { easy: 1.4, normal: 1.6, hard: 2.0 },
  /** Hammer: the head swings +-HAMMER_AMP along x inside a 3.4 m corridor cell; it never closes the passage. */
  HAMMER_AMP: 1.1, HAMMER_HW: 0.5, HAMMER_HD: 0.6, HAMMER_H: 1.6,
  HAMMER_PERIOD: { easy: 3, normal: 2.6, hard: 2.2 },
  /** Ice: friction (acceleration and braking) multiplier on a patch. */
  ICE_FRICTION: 0.2, ICE_CELL_HALF: 1.9, ICE_CORRIDOR_HW: 4, ICE_CORRIDOR_HD: 3,
  HAZARD_STUN: 0.4, HAZARD_KNOCK: 10, HAZARD_HOP: 4, HAZARD_IFRAMES: 1.2, HAZARD_SHIELD_IFRAMES: 0.8,
  HAZARD_SLIME: { easy: 0.01, normal: 0.01, hard: 0.01 },
  /** Hazards further than this from the player are skipped in the hit test. */
  HAZARD_NEAR: 6,

  // Gold Door (F4-G): an optional star door after a first-try Door Rush answer, one tier harder.
  GOLD_PUSHBACK_MULT: 2, GOLD_COINS: 2, GOLD_SURGE_MULT: 2, GOLD_RESULT_S: 2.5,
  /** Door Rush: the gold door stands at this lateral offset and depth (m), behind the answer doors. */
  GOLD_CX: 6.5, GOLD_D: 15.2,

  // question supply: seen in earlier runs → scored this much worse
  SEEN_PENALTY: 4, SEEN_MAX: 400,

  // economy
  COINS_START: 2, COST_FIFTY: 3, COST_HINT: 2, MAZE_COINS_MAX: 3, COIN_RADIUS: 1.0,

  // rooms
  TILE_TIMER: { easy: 10, normal: 8, hard: 6 },
  TILE_SHAKE_TIME: 0.5, STEP_SHAKE_TIME: 0.35, TILE_FALL_TIME: 1.2, STEP_RISE_TIME: 1.0,
  DOOR_TOUCH_MIN_SPEED: 1.0, TOUCH_DEBOUNCE: 0.3, PICKUP_RADIUS: 1.1,
  WRONG_DOOR_FALL_TIME: 0.6, PORTAL_RADIUS: 1.6,

  // launch pads (F4-1). Local depths d are metres from the room's entrance.
  LAUNCH_PAD_D: 8, LAUNCH_POND_FRONT: 14, LAUNCH_LAND_D: 9,
  /** Depth of the wade zone in front of the hedge. Hard: 8 m, split into a trap maze of two rows. */
  LAUNCH_POND_D: { easy: 4, normal: 4, hard: 8 },
  /** Answer pads for an mcq (a true/false question always gets 2). */
  LAUNCH_MCQ_PADS: { easy: 3, normal: 4, hard: 4 },
  H_LAUNCH_WALL: 4.5, LAUNCH_PAD_R: 1.2, LAUNCH_CHARGE_S: 0.5, LAUNCH_DECAY: 3,
  LAUNCH_DUR_OK: 1.7, LAUNCH_APEX_OK: 8, LAUNCH_DUR_WRONG: 1.3, LAUNCH_APEX_WRONG: 4,
  /** Extra speed factor inside the pond (on top of the slime wade). */
  POND_SLOW: 0.5,
  /** Hard trap maze: the divider's gap is this wide, on the right-hand side. */
  TRAP_GAP: 3.6,

  // rule minefield (F4-2). Local depths d are metres from the room's entrance.
  MINE_ENTRY_D: 4, MINE_ROW_D: 4.4, MINE_WALK_D: 2.6, MINE_END_D: 6, MINE_ROWS: 4, MINE_COLS: 3,
  /** Chance that a row has two safe tiles (otherwise one). */
  MINE_SAFE_TWO_P: { easy: 1, normal: 0.5, hard: 0.2 },
  /** A wrong tile shakes this long, then drops. */
  MINE_SHAKE_TIME: 0.4,
  /** After a wrong tile the player lands this many walkways back (0 = the start of the row they were in). */
  MINE_BACK_ROWS: { easy: 0, normal: 1, hard: 99 },

  // key hunt (F4-3): keys in dead ends, a locked gate at the maze exit
  HUNT_KEYS: { easy: 3, normal: 4, hard: 4 },
  HUNT_BRAID: { easy: 0.2, normal: 0.1, hard: 0 },
  HUNT_TRIES: 40,
  /** The gate stands this far (m) before the end of the maze, flush with the exit so no side opening can bypass it; a carried key is handed in within HUNT_GATE_R of it. */
  HUNT_GATE_D: 0.4, HUNT_GATE_R: 2.2,
  /** A wrong key zaps the player back: speed (m/s, about 3 m of travel) and how long input stays locked. */
  HUNT_ZAP_SPEED: 13, HUNT_ZAP_LOCK: 0.3,

  // Door Carousel (F4-5): one 4 m opening in a wall, the panels slide sideways behind it (m/s). Local depths d from the entrance.
  CAROUSEL_SPEED: { easy: 1, normal: 1.6, hard: 2.4 },
  CAROUSEL_DEPTH: 20, CAROUSEL_WALL_D: 10, CAROUSEL_OPEN_HALF: 2,
  /** Panel width: wider than the opening so one panel can fill it; the train is panels x width long. */
  CAROUSEL_PANEL_W: 4.4, CAROUSEL_EXIT_D: 14,
  CAROUSEL_GOLD_CX: 6.5, CAROUSEL_GOLD_D: 16.5,

  // Memory Floor (F4-7): 3x3 tiles, 4 carry answers. Labels show for MEMORY_REVEAL_S, then flip face down and the question appears.
  MEMORY_REVEAL_S: { easy: 7, normal: 5, hard: 3 },
  /** Stand on a tile (slower than MEMORY_STAND_SPEED m/s) this long to choose it. */
  MEMORY_STAND_S: 1, MEMORY_STAND_SPEED: 1.5,
  /** After a wrong tile the labels show again for this long (Hard: never). */
  MEMORY_REFLASH_S: { easy: 2, normal: 1, hard: 0 },
  MEMORY_BRIDGE_S: 1, MEMORY_LABELS: 4,

  // answer lifts (F4-8). Local depths d are metres from the room's entrance.
  /** Lifts per room (the answers). */
  LIFT_COUNT: { easy: 3, normal: 3, hard: 4 },
  LIFT_HALF: 1.7, LIFT_DOCK_D: 5, LIFT_SHAFT_D: 4, LIFT_LEDGE_D: 6, LIFT_LAND_D: 6,
  /** Ledge height, pond bottom and the stall height of a wrong lift (m). */
  LIFT_TOP: 6, LIFT_PIT: -0.8, LIFT_STALL_Y: 3,
  /** Seconds standing on a lift before it goes. */
  LIFT_BOARD_S: 0.5, LIFT_BOARD_DECAY: 3,
  /** Right lift: rise time. Wrong lift: rise to the stall height, hold, then sink to the pond bottom. */
  LIFT_RISE_S: 3, LIFT_STALL_RISE_S: 1.5, LIFT_HOLD_S: 0.6, LIFT_SINK_S: 1.4,
  /** A right lift whose rider stepped off lowers again over this time. */
  LIFT_LOWER_S: 1.5,
  H_LIFT_SIDE: 7.5,

  // hex finale (F4-X). Pointy-top cells; `HEX_RINGS` rings around the centre cell.
  /** An online race with at least this many racers ends in the Hex Finale. */
  HEX_MIN_PLAYERS: 3,
  HEX_RINGS: 3, HEX_SIZE: 1.55, HEX_ROUNDS: 5,
  /** Question time (s): the first round, minus HEX_TIMER_STEP each round, never below HEX_TIMER_MIN. */
  HEX_TIMER_S: 12, HEX_TIMER_STEP: 1, HEX_TIMER_MIN: 6,
  /** Answer clusters: 2 for true/false, this many for an mcq. */
  HEX_CLUSTERS: { easy: 3, normal: 3, hard: 4 },
  HEX_SHAKE_S: 0.6, HEX_SINK_S: 1.2, HEX_SINK_Y: 2.4, HEX_RISE_S: 1.0, HEX_REST_S: 0.8,
  /** The edge ring shakes this long (a warning) before it sinks for good. */
  HEX_EDGE_WARN_S: 1.8,
  /** The edge shrinks one ring after every this many rounds. */
  HEX_SHRINK_EVERY: 2,
  /** Slime added by a fall (a normal wrong answer is SLIME_SURGE). */
  HEX_FALL_SURGE: { easy: 0.12, normal: 0.14, hard: 0.12 },
  /** The doorstep sits this deep (m) before the arena begins; the exit platform this deep after it. */
  HEX_STEP_D: 0.7, HEX_EXIT_D: 4,

  // boulder run (F4-6): a 40 m corridor, a boulder released after a rumble, answer alcoves near the end.
  // Local depths d are metres from the room's entrance; the lane is 20 m wide.
  BOULDER_LEN: 40, BOULDER_HALL_D: 8.4,
  /** Corridor half width (inner faces), alcove length along the corridor and depth sideways, boulder radius. */
  BOULDER_CW: 1.75, BOULDER_ALC_LEN: 4, BOULDER_ALC_DEPTH: 4, BOULDER_R: 1.6,
  /** The boulder starts this far behind the entrance (hidden behind the south wall until it rolls in). */
  BOULDER_START: -12,
  /** Roll speed as a fraction of MAX_SPEED. It also follows the slime wade slow-down, so it stays slower than the player. */
  BOULDER_SPEED: { easy: 0.8, normal: 0.8, hard: 0.9 },
  /** Rumble (s) between the question appearing and the release; the re-arm after a wrong alcove or a squash. */
  BOULDER_RUMBLE_S: { easy: 3, normal: 3, hard: 2 },
  BOULDER_REARM_S: 1.5, BOULDER_SMASH_S: 1.0,
  BOULDER_WAVES: { easy: 1, normal: 1, hard: 2 },
  /** A player is in an alcove (and so out of the boulder's way) once this far from the corridor axis. */
  BOULDER_ENTER_X: 2.6, BOULDER_RUMBLE_SHAKE: 0.1,
  /** Squash: surge scale. */
  BOULDER_SQUASH_SURGE: 0.5,

  // shifting maze (F4-9): two switch shrines on the solution path, plates inside the shrine cell
  SHIFT_BRAID: { easy: 0.2, normal: 0.25, hard: 0.1 },
  SHIFT_MCQ_PLATES: 3,
  /** A shrine asks its question while the player is within SHIFT_CELL_R of its centre and pauses beyond SHIFT_LEAVE_R. */
  SHIFT_CELL_R: 1.9, SHIFT_LEAVE_R: 3.4,
  SHIFT_PLATE_R: 0.8, SHIFT_CHARGE_S: 0.5, SHIFT_DECAY: 3,
  /** A hedge only closes if it is at least this far (m) from the player. */
  SHIFT_MARGIN: 1.2,
  /** Right answer: at most this many hedges open, each saving at least SHIFT_MIN_SAVING cells. Wrong: the longer route may add at most SHIFT_MAX_DETOUR cells. */
  SHIFT_OPEN_MAX: 2, SHIFT_MIN_SAVING: 2, SHIFT_MAX_DETOUR: 14,
  /** Slide time of a hedge (render), and the wrong-answer surge scale. */
  SHIFT_ANIM_S: 0.7, SHIFT_WRONG_SURGE: 1,

  // hub
  HUB_RADIUS: 21, PAD_RADIUS: 1.0, PAD_HOLD_TIME: 1.0, BOOTH_HOLD_TIME: 0.5,

  // flow
  COUNTDOWN_STEP: 0.8, FADE_TIME: 0.3, RESULT_DELAY: 2.5, TOAST_TIME: 1.6, TIP_TIME: 6,

  // snapshots / ghost (F4-D, shared with F3)
  INTERP_DELAY_MS: 150, SNAP_DIST: 6, STALE_MS: 2000, GHOST_HZ: 10, GHOST_OPACITY: 0.45,

  // multiplayer client (F3)
  NET_SEND_MS: 100, NET_SYNC_PINGS: 5, NET_SYNC_GAP_MS: 150, NET_PING_MS: 5000, NET_SAMPLES: 9,
  NET_BACKOFF_MS: [500, 1000, 2000, 4000], NET_RECONNECT_TRIES: 12,
  /** Snapshots older than this are dropped from a remote's buffer. */
  NET_BUFFER_MS: 3000,
  /** The host may force-start after this long in the lobby. */
  NET_FORCE_START_MS: 20000,
  /** Remote players: ghost opacity, opacity when the connection is stale, emote icon time and the client cooldown. */
  REMOTE_OPACITY: 0.85, REMOTE_STALE_OPACITY: 0.4, EMOTE_SHOW_MS: 2000, EMOTE_COOLDOWN_MS: 3000,
  /** Awards: fewest questions for Brainiest, smallest combo for Hot Streak. */
  AWARD_MIN_ASKED: 5, AWARD_MIN_COMBO: 2,

  // adaptivity
  START_TIER: { easy: 1, normal: 2, hard: 3 }, STREAK_TO_LEVEL_UP: 2,
} as const;
