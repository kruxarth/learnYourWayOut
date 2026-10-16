import { questionSource } from '../content/source';
import { clearBanner, clearToasts, initialHud, pushToast, showBanner, useUI } from '../ui/store';
import { syncHud } from '../ui/sync';
import type { GameEvent } from './events';
import { input } from './input';
import {
  activateBossWall, activateJunction, activateRoom, clearRoomUI, createRooms, dropBlock as dropBlockImpl, handleRoomFall,
  handleRoomTouch, junctionPick, stepChallenge,
} from './loop/challenge';
import { moveHazards, onIce, stepHazards } from './loop/hazards';
import { POWER_KINDS, comboSpeedMult, emptyPowerups } from './loop/powerups';
import { buildCourse } from './loop/generation';
import { stepPlayer, teleport, type NavCtx, type NavWorld } from './loop/navigation';
import { checkOutcome, lose, win } from './loop/outcome';
import { inMazeSegment } from './loop/visibility';
import {
  respawnAtCheckpoint, setCheckpoint, stepCoins, stepSlime, stepTransition, useLifeline as spendLifeline, activatePowerup, wadeFactor,
} from './loop/progression';
import { beginDailyRun, dailyRun, dailySelection, tracksSeen } from './daily';
import { loadSeen, rememberSeen } from './persistence';
import { syncRoomPanel } from './loop/roomCommon';
import { buildHub, stepBooths, stepHub, type HubPad, type HubState } from './loop/selection';
import { onRetryDoorTouch, stepDetour, syncDetourPanel } from './rooms/detour';
import { parseDoorTouch } from './rooms/doors';
import { answerGold, stepGold, touchGold } from './rooms/goldDoor';
import { pondFactor } from './rooms/launchPads';
import { liftPondFactor } from './rooms/answerLifts';
import { newSeed, stream } from './rng';
import type { RunState } from './runtime';
import { G } from './state';
import { T } from './tuning';
import type { Difficulty, DomainId, FloorRect, RunSelection, WallBox } from './types';
import { makeWorld, type World } from './world';
import { params } from './urlParams';
import type { PlayerState } from '../net/protocol';
import { sfx } from '../audio/sfx';
import { readCurrent, tts } from '../audio/tts';

export type { World };

type Mode = 'none' | 'arena' | 'hub' | 'run';
let mode: Mode = 'none';
let world: World | null = null;
let hub: HubState | null = null;
let acc = 0;
let hudAcc = 0;
let runCounter = 0;
let trigInside = new Uint8Array(0);
let hubStartT = -1;
let hubStartPad: HubPad | null = null;
let inited = false;

const player = G.player;
const camera = G.camera;
const events = G.events;

const hooks = {
  onTouch(touchId: string): void {
    const run = G.run;
    if (!run || run.phase !== 'playing') return;
    if (touchId.startsWith('door:')) {
      const d = parseDoorTouch(touchId);
      if (d) handleRoomTouch(d.roomId, d.wallIndex, d.panelIndex);
    } else if (touchId.startsWith('gold:')) {
      touchGold(run, run.roomMap.get(touchId.slice(5)));
    } else if (touchId.startsWith('detourDoor:')) {
      onRetryDoorTouch(Number(touchId.split(':')[1]));
    }
  },
  onFall(): void {
    if (mode === 'hub' || mode === 'arena') {
      teleport(player, 0, 0.01, mode === 'hub' ? 5 : 5);
      camera.snapVersion++;
      return;
    }
    const run = G.run;
    if (!run || run.phase !== 'playing' || player.forcedFall) return;
    events.emit({ type: 'fall' });
    if (!handleRoomFall()) respawnAtCheckpoint();
  },
  emit(e: GameEvent): void { events.emit(e); },
};

const emptyNav: NavWorld = { wallHash: null!, floorHash: null!, dynWalls: [], dynFloors: [] };
const ctx: NavCtx = { world: emptyNav, yaw: 0, wade: 1, speedMult: 1, now: 0, hubRadius: null, hooks };

// ───────────────────────── worlds ─────────────────────────

function arenaWorld(): World {
  const walls: WallBox[] = [];
  const add = (minX: number, minZ: number, maxX: number, maxZ: number) =>
    walls.push({ id: walls.length, minX, minY: 0, minZ, maxX, maxY: 1.8, maxZ, kind: 'hedge', enabled: true, isStatic: true });
  add(-6, -10.3, 6, -9.7); add(-6.3, -10, -5.7, 0); add(5.7, -10, 6.3, 0); add(-2, -5.3, 2, -4.7);
  const floors: FloorRect[] = [{ id: 0, minX: -30, maxX: 30, minZ: -30, maxZ: 30, top: 0, enabled: true, isStatic: true, color: '#FFF1D6' }];
  return makeWorld(walls, floors);
}

function resetPlayer(): void {
  player.carrying = null;
  player.forcedFall = false;
  player.inputLocked = false;
  player.speedBoost = 0;
  player.lastTouch = {};
  player.spin = 0;
  player.stun = 0;
  player.facing = 0;
}

function resetUiForWorld(screen: 'hub' | 'run'): void {
  clearToasts();
  clearBanner();
  clearRoomUI();
  useUI.setState((s) => ({
    screen, runId: s.runId + 1, hud: initialHud, room: null, detour: null, fade: false, paused: false, quickSelectOpen: false, wardrobeOpen: false, topicOpen: false, lobbyOpen: false, leaveMenuOpen: false,
    hubPad: null, results: null, lost: false, tip: null,
  }));
  input.setBlocked(false);
  input.clear();
}

function createRun(sel: RunSelection): RunState {
  const course = buildCourse(sel, { demo: params.demo });
  const w = makeWorld(course.walls, course.floors);
  for (const h of course.hazards) if (h.head) w.nav.dynWalls.push(h.head); // hammer heads collide but stay out of `world.walls`
  const pack = questionSource.getPack(sel.domainId);
  const run: RunState = {
    runId: ++runCounter, selection: sel, seed: sel.seed, course, world: w, pack, phase: 'countdown', paused: false,
    countdown: { t: 0, shown: -1 }, rooms: [], roomMap: new Map(), activeRoomId: null, roomsActivated: 0,
    slime: 0, coins: T.COINS_START, coinsCollected: 0, tier: T.START_TIER[sel.difficulty], streak: 0,
    records: [], usedQuestionIds: new Set(), recentConcepts: [], wrongConcepts: new Set(), route: null, elapsedMs: 0,
    checkpoint: { ...course.spawn }, transition: null, detour: null, fx: { shake: 0 }, godMode: false,
    qRng: stream(sel.seed, 'questions'), endTimer: 0, zone: 'normal', segIndex: 0, heartbeat: 0, lastSlimeMsg: 0,
    combo: 0, powerups: emptyPowerups(), puRng: stream(sel.seed, 'cosmetic'), freezeT: 0, compassT: 0, gold: null, hazardMs: 0, hazardIFrames: 0, hazardHits: 0, shield: false, lanternSeg: -1, iceSeen: false,
    seenIds: tracksSeen(sel) ? loadSeen() : new Set(),
  };
  run.rooms = createRooms(course, run);
  run.roomMap = new Map(run.rooms.map((r) => [r.id, r]));
  return run;
}

// ───────────────────────── triggers ─────────────────────────

function handleTrigger(run: RunState, t: RunState['course']['triggers'][number]): void {
  switch (t.kind) {
    case 'segmentEnter': {
      const seg = run.course.segments[t.data.segIndex as number];
      if (seg) { setCheckpoint(run, seg.checkpoint.x, seg.checkpoint.z); run.segIndex = seg.index; }
      break;
    }
    case 'roomActivate': activateRoom(t.data.roomId as string); break;
    case 'bossWall': activateBossWall(t.data.roomId as string, t.data.wall as number); break;
    case 'junction': activateJunction(t.data.roomId as string, t.data.junction as number); break;
    case 'junctionPick': {
      // only walking into the corridor counts, not walking back out of it
      const v = player.vel;
      if (v.x * (t.data.dx as number) + v.z * (t.data.dz as number) > 0) {
        junctionPick(t.data.roomId as string, t.data.junction as number, t.data.branch as number);
      }
      break;
    }
    case 'laneChoice':
      if (run.route === null) {
        run.route = t.data.lane as 'short' | 'long';
        pushToast(run.route === 'short' ? 'Shortcut chosen' : 'Scenic route chosen', 'info');
      }
      break;
    case 'speedPad':
      player.speedBoost = T.SPEED_PAD_TIME;
      events.emit({ type: 'speedPad' });
      break;
    default: break; // detour triggers are handled by stepDetour
  }
}

function stepTriggers(run: RunState): void {
  const p = player.pos;
  const trigs = run.course.triggers;
  for (let i = 0; i < trigs.length; i++) {
    const t = trigs[i];
    if (t.kind === 'detourBoard' || t.kind === 'detourRetry') continue;
    const inside = p.x >= t.minX && p.x <= t.maxX && p.z >= t.minZ && p.z <= t.maxZ ? 1 : 0;
    if (inside && !trigInside[i] && !(t.once && t.fired)) {
      t.fired = true;
      handleTrigger(run, t);
    }
    trigInside[i] = inside;
  }
  // keep the current segment index fresh (used for the Slime Gate "boss" zone)
  if (!run.detour) {
    const segs = run.course.segments;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (p.x >= s.laneX - s.width / 2 && p.x <= s.laneX + s.width / 2 && p.z <= s.z0 && p.z >= s.z0 - s.depth) { run.segIndex = i; break; }
    }
  }
}

// ───────────────────────── run step ─────────────────────────

/** Wall clock in ms. Tests replace it (`engine.setWallClock`) so the synced countdown is deterministic. */
let wallNow: () => number = () => Date.now();

const isOnline = (run: RunState | null): boolean => run?.selection.mode === 'online';

function stepCountdown(run: RunState, h: number): void {
  const c = run.countdown;
  if (run.countdownAt !== undefined) {
    // synced start (F3): wait for the shared moment, then follow the wall clock so GO lands on time everywhere
    const waited = (wallNow() - run.countdownAt) / 1000;
    if (waited < 0) {
      if (c.shown !== -2) { c.shown = -2; showBanner('Get ready…', 'info', 0); }
      return;
    }
    c.t = waited;
  } else c.t += h;
  const idx = Math.min(3, Math.floor(c.t / T.COUNTDOWN_STEP + 1e-9)); // 0:3 1:2 2:1 3:GO
  if (idx !== c.shown) {
    c.shown = idx;
    if (idx < 3) {
      const n = (3 - idx) as 3 | 2 | 1;
      showBanner(String(n), 'info', 0);
      events.emit({ type: 'countdown', n });
    } else {
      showBanner('GO!', 'good', 700);
      events.emit({ type: 'countdown', n: 0 });
      run.phase = 'playing';
      player.inputLocked = false;
    }
  }
}

function runStep(run: RunState, mx: number, my: number, h: number): void {
  G.clock += h;
  ctx.world = run.world.nav;
  ctx.now = G.clock;
  ctx.wade = wadeFactor(run) * pondFactor(run) * liftPondFactor(run);
  ctx.speedMult = comboSpeedMult(run);
  ctx.hubRadius = null;
  ctx.ice = onIce(run, player.pos.x, player.pos.z);
  if (ctx.ice && !run.iceSeen) { run.iceSeen = true; pushToast('Ice! Slippery floor', 'info'); }
  const steer = inMazeSegment(run);
  if (ctx.steer && !steer) camera.yaw = 0; // out of a maze: swing back to looking up the course (touch has no other way to turn it)
  ctx.steer = steer;
  moveHazards(run);
  stepPlayer(player, ctx, mx, my, h);
  if (ctx.steer) camera.yaw = player.facing; // the chase cam sits behind the bean's heading
  stepHazards(run, player, h);
  if (run.phase === 'countdown') { stepCountdown(run, h); return; }
  if (run.phase === 'playing' || run.phase === 'transition') {
    run.elapsedMs += h * 1000;
    dailyRun.recorder?.tick(run.elapsedMs, player); // write-only: the ghost never feeds back into the sim
  }
  if (run.phase === 'playing') {
    stepTriggers(run);
    stepCoins(run);
  }
  stepChallenge(h);
  stepGold(run, h);
  if (run.phase === 'playing') stepDetour();
  stepTransition(run, h);
  if (run.compassT > 0 && run.phase === 'playing') run.compassT = Math.max(0, run.compassT - h);
  stepSlime(run, h);
  checkOutcome(run, h);
}

function hubStep(mx: number, my: number, h: number): void {
  if (!hub || !world) return;
  G.clock += h;
  ctx.world = world.nav;
  ctx.now = G.clock;
  ctx.wade = 1;
  ctx.speedMult = 1;
  ctx.ice = false;
  ctx.steer = false;
  ctx.hubRadius = T.HUB_RADIUS;
  stepPlayer(player, ctx, mx, my, h);
  if (hubStartT >= 0) {
    hubStartT += h;
    if (hubStartT >= T.FADE_TIME && hubStartPad) {
      const pad = hubStartPad;
      hubStartT = -1; hubStartPad = null;
      engine.startRun({ domainId: pad.domainId, difficulty: pad.difficulty, seed: newSeed() });
    }
    return;
  }
  const booth = stepBooths(hub, player.pos.x, player.pos.z, player.grounded, h);
  if (booth?.id === 'wardrobe') { useUI.setState({ wardrobeOpen: true }); sfx.click(); }
  if (booth?.id === 'online') { useUI.setState({ lobbyOpen: true }); sfx.click(); }
  const pad = stepHub(hub, player.pos.x, player.pos.z, player.grounded, h);
  if (pad && pad.domainId === 'custom') {
    // the Any Topic pad opens the Topic panel instead of starting a run
    hub.starting = false; hub.lockedPad = pad; hub.activePad = null; hub.hold = 0;
    input.clear();
    sfx.click();
    useUI.setState({ topicOpen: true, topicLevel: pad.difficulty });
    return;
  }
  if (pad) {
    hubStartT = 0; hubStartPad = pad;
    player.inputLocked = true;
    useUI.setState({ fade: true });
    sfx.click();
  }
}

// ───────────────────────── HUD sync & debug ─────────────────────────

function syncUi(): void {
  const run = G.run;
  if (mode === 'run' && run) {
    syncHud(run);
    if (run.activeRoomId) syncRoomPanel();
    if (run.slime >= T.SLIME_DANGER && run.phase === 'playing') sfx.heartbeat();
  } else if (mode === 'hub' && hub) {
    const pad = hub.activePad;
    useUI.setState({
      hubPad: pad ? { domainId: pad.domainId, difficulty: pad.difficulty, progress: Math.min(1, hub.hold / T.PAD_HOLD_TIME) } : null,
    });
  }
}

function debugKey(code: string): void {
  const run = G.run;
  switch (code) {
    case 'KeyB': useUI.setState((s) => ({ debugBoxes: !s.debugBoxes })); break;
    case 'KeyG': if (run) { run.godMode = !run.godMode; pushToast(run.godMode ? 'God mode ON' : 'God mode OFF', 'info'); } break;
    case 'KeyK': if (run) { run.slime = 1; } break;
    case 'KeyL': if (run) win(); break;
    case 'KeyC': if (run) { run.coins += 5; syncHud(run); } break;
    case 'KeyN': engine.debug.nextRoom(); break;
    case 'KeyO': if (run) console.log('[course]', run.course.segments.map((s) => `${s.index}:${s.kind}@${s.laneX},${s.z0.toFixed(1)}`).join('\n')); break;
    default: break;
  }
}

const netSnap: PlayerState = {
  seq: 0, x: 0, y: 0, z: 0, f: 0, sp: 0, g: true, spin: 0, seg: 0, slime: 0, solved: 0, asked: 0, correct: 0, detour: false, bc: 0,
};

/** Power-up keys 1-5 (Shield is 5). Emote keys (F3) are 6-9. */
const POWER_KEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

/** Remember the questions of the run being left (cross-run variety). */
function leaveRun(): void {
  const run = G.run;
  if (run && tracksSeen(run.selection)) rememberSeen(run.usedQuestionIds);
}

function setPaused(run: RunState, p: boolean): void {
  run.paused = p;
  useUI.setState({ paused: p });
  if (p) input.clear();
}

// ───────────────────────── public API ─────────────────────────

export const engine = {
  events,
  player,
  camera,
  get world(): World | null { return world; },
  get hub(): HubState | null { return hub; },
  get run(): RunState | null { return G.run; },
  get mode(): Mode { return mode; },

  init(): void {
    if (inited) return;
    inited = true;
    G.debug = params.debug;
    input.init();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const run = G.run;
        if (document.hidden && mode === 'run' && run && !isOnline(run) && !run.paused && run.phase !== 'won' && run.phase !== 'lost') setPaused(run, true);
      });
    }
    sfx.attach(events);
    tts.attach(events);
    if (G.debug && typeof window !== 'undefined') (window as unknown as { __lywo: unknown }).__lywo = { engine, G, useUI };
  },

  startArena(): void {
    leaveRun();
    mode = 'arena'; G.run = null;
    world = arenaWorld();
    resetPlayer();
    teleport(player, 0, 0, 5);
    camera.yaw = 0; camera.snapVersion++;
    resetUiForWorld('hub');
  },

  startHub(): void {
    leaveRun();
    mode = 'hub'; G.run = null;
    hub = buildHub();
    world = hub.world;
    hubStartT = -1; hubStartPad = null;
    resetPlayer();
    teleport(player, 0, 0, 5);
    camera.yaw = 0; camera.snapVersion++;
    resetUiForWorld('hub');
  },

  /** `opts.countdownAt` (wall-clock ms) holds the run in its countdown until then; online runs use it for the synced start. */
  startRun(sel: RunSelection, opts: { countdownAt?: number } = {}): void {
    // the solo setting picks the last room; online races (decided by the player count) and the daily course (the same for everyone) never read it
    if (!sel.finale && (!sel.mode || sel.mode === 'solo') && useUI.getState().settings.finale === 'hex') sel = { ...sel, finale: 'hex' };
    leaveRun();
    mode = 'run';
    hub = null;
    const run = createRun(sel);
    beginDailyRun(sel);
    if (opts.countdownAt !== undefined) run.countdownAt = opts.countdownAt;
    G.run = run;
    world = run.world;
    trigInside = new Uint8Array(run.course.triggers.length);
    resetPlayer();
    teleport(player, run.course.spawn.x, run.course.spawn.y, run.course.spawn.z);
    player.inputLocked = true;
    camera.yaw = 0; camera.snapVersion++;
    resetUiForWorld('run');
    useUI.setState({ selection: sel, hud: { ...initialHud, coins: run.coins, tier: run.tier } });
    acc = 0;
  },

  /** Start today's Daily Challenge (same course for everyone; your best attempt becomes a ghost). */
  startDaily(): void { engine.startRun(dailySelection()); },

  restartRun(): void {
    const run = G.run;
    if (run && isOnline(run)) { engine.startHub(); return; } // a race restarts from the lobby, never alone
    if (run) engine.startRun({ ...run.selection });
  },

  setPaused(p: boolean): void {
    const run = G.run;
    if (run && mode === 'run' && !isOnline(run)) setPaused(run, p); // online races never pause
  },

  /** Replace the wall clock used by the synced countdown (tests). */
  setWallClock(fn: () => number): void { wallNow = fn; },

  /**
   * The player's state for the `state` message. Returns one shared object (no allocation), or null outside an online run.
   * Callers must copy what they keep.
   */
  netSnapshot(): PlayerState | null {
    const run = G.run;
    if (mode !== 'run' || !run || !isOnline(run)) return null;
    const s = netSnap;
    s.seq++;
    s.x = player.pos.x; s.y = player.pos.y; s.z = player.pos.z;
    s.f = player.facing;
    s.sp = Math.hypot(player.vel.x, player.vel.z);
    s.g = player.grounded;
    s.spin = player.spin > 0 ? 1 - player.spin / 0.5 : 0;
    s.seg = run.segIndex;
    s.slime = run.slime;
    let solved = 0;
    for (let i = 0; i < run.rooms.length; i++) if (run.rooms[i].state === 'resolved') solved++;
    s.solved = solved;
    let asked = 0, correct = 0;
    for (let i = 0; i < run.records.length; i++) {
      const r = run.records[i];
      if (r.isRetry) continue;
      asked++;
      if (r.correctFirstTry) correct++;
    }
    s.asked = asked; s.correct = correct;
    s.detour = run.detour !== null;
    s.bc = run.combo;
    return s;
  },

  useLifeline: spendLifeline,

  activatePowerup,

  dropBlock(): void { dropBlockImpl(); },

  /** Answer the open Gold Door follow-up (panel buttons). */
  answerGold,

  readAloud(): void { readCurrent(); },

  update(dt: number): void {
    const inp = input.poll();
    if (!world) return;
    const ui = useUI.getState();
    const panelOpen = ui.quickSelectOpen || ui.wardrobeOpen || ui.namePromptOpen || ui.topicOpen || ui.lobbyOpen;
    input.setBlocked(panelOpen || ui.screen === 'results');
    if (inp.mutePressed) sfx.toggleMute();
    if (inp.readPressed && mode === 'run') readCurrent();
    if (inp.quickSelectPressed && mode === 'hub' && hubStartT < 0 && !ui.wardrobeOpen && !ui.namePromptOpen && !ui.lobbyOpen) useUI.setState((s) => ({ quickSelectOpen: !s.quickSelectOpen }));
    const run = G.run;
    if (inp.pausePressed) {
      if (mode === 'hub' && ui.wardrobeOpen) useUI.setState({ wardrobeOpen: false });
      else if (mode === 'hub' && ui.quickSelectOpen) useUI.setState({ quickSelectOpen: false });
      else if (mode === 'hub' && ui.topicOpen) useUI.setState({ topicOpen: false });
      else if (mode === 'hub' && ui.lobbyOpen) useUI.setState({ lobbyOpen: false });
      else if (mode === 'run' && isOnline(run) && run && run.phase !== 'won' && run.phase !== 'lost' && ui.screen === 'run') useUI.setState((s) => ({ leaveMenuOpen: !s.leaveMenuOpen }));
      else if (mode === 'run' && run && run.phase !== 'won' && run.phase !== 'lost' && ui.screen === 'run') setPaused(run, !run.paused);
    }
    if (G.debug && inp.keys.length && !isOnline(run)) for (const k of inp.keys) debugKey(k);
    if (mode === 'run' && run?.paused) return;
    if (panelOpen) return;

    if (!(mode === 'run' && run && inMazeSegment(run))) camera.yaw += inp.yawDelta; // mazes: the yaw follows the heading
    ctx.yaw = camera.yaw;
    if (inp.jumpPressed) player.jumpBuffer = T.JUMP_BUFFER;
    if (mode === 'run' && run) {
      if (inp.fiftyPressed) spendLifeline('fifty');
      if (inp.hintPressed) spendLifeline('hint');
      if (inp.dropPressed) dropBlockImpl();
      for (const k of inp.keys) {
        const i = POWER_KEY_CODES.indexOf(k);
        if (i < 0) continue;
        // while a Gold Door question is open, keys 1-4 pick its answers instead of using power-ups
        if (run.gold?.phase === 'asking') answerGold(i);
        else activatePowerup(POWER_KINDS[i]);
      }
    }

    acc += dt;
    let steps = 0;
    while (acc >= T.STEP && steps < T.MAX_STEPS) {
      if (mode === 'run' && G.run) runStep(G.run, inp.moveX, inp.moveY, T.STEP);
      else if (mode === 'hub') hubStep(inp.moveX, inp.moveY, T.STEP);
      else {
        G.clock += T.STEP;
        ctx.world = world.nav; ctx.now = G.clock; ctx.wade = 1; ctx.speedMult = 1; ctx.hubRadius = null; ctx.ice = false; ctx.steer = false;
        stepPlayer(player, ctx, inp.moveX, inp.moveY, T.STEP);
      }
      acc -= T.STEP; steps++;
    }
    if (steps === T.MAX_STEPS) acc = 0;

    hudAcc += dt;
    if (hudAcc >= 1 / T.HUD_SYNC_HZ) { hudAcc = 0; syncUi(); }
  },

  debug: {
    toggleGod(): void { debugKey('KeyG'); },
    nextRoom(): void {
      const run = G.run;
      if (!run) return;
      const room = run.rooms.find((r) => r.state !== 'resolved');
      if (!room) return;
      const seg = run.course.segments[room.layout.segIndex];
      teleport(player, seg.checkpoint.x, 0, seg.checkpoint.z);
      camera.snapVersion++;
    },
    win(): void { if (G.run) win(); },
    lose(): void { if (G.run) lose(); },
    addCoins(n: number): void { const run = G.run; if (run) { run.coins += n; syncHud(run); } },
  },
};

export type { DomainId, Difficulty };
export { syncDetourPanel };
