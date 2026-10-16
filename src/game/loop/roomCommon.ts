import { isSpeaking } from '../../audio/tts';
import { selectQuestion } from '../../content/select';
import type { Question } from '../../content/schema';
import { useUI, type RoomPanel } from '../../ui/store';
import { syncHud } from '../../ui/sync';
import type { AnswerRecord, RoomKind, Tier } from '../types';
import type { RoomRuntime } from '../runtime';
import { G, needRun } from '../state';
import { T } from '../tuning';
import { nextTier } from './evaluation';
import { onAnswered } from './powerups';
import { canFiftyRoom, pushback, questionPending } from './progression';
import { branchArrow } from '../rooms/quizMaze';

// ───────────────────────── question selection & records ─────────────────────────

export function clampTier(t: number): Tier {
  return Math.min(3, Math.max(1, Math.round(t))) as Tier;
}

export function pickQuestion(room: RoomRuntime, type: Question['type'] | Question['type'][], tierMod: number): Question {
  const run = needRun();
  const tier = clampTier(run.tier + tierMod);
  room.tierAsked = tier;
  return selectQuestion({
    pack: run.pack, type, tier, usedIds: run.usedQuestionIds, recentConcepts: run.recentConcepts,
    focusConcepts: run.selection.focusConcepts, wrongConceptsThisRun: run.wrongConcepts, rng: run.qRng, seenIds: run.seenIds,
  });
}

/**
 * Create a main AnswerRecord the first time the outcome of a question is known (first correct touch or
 * first wrong try). Updates the adaptive staircase and the concept bookkeeping (spec §12).
 */
export function startRecord(room: RoomRuntime, q: Question, firstTryCorrect: boolean, qStartMs: number): AnswerRecord {
  const run = needRun();
  const rec: AnswerRecord = {
    questionId: q.id, concept: q.concept, type: q.type, roomKind: room.kind, tierAsked: room.tierAsked,
    correctFirstTry: firstTryCorrect, wrongCount: firstTryCorrect ? 0 : 1, usedHint: room.hintUsed, usedFifty: room.fiftyUsed,
    remediated: false, isRetry: false, timeMs: Math.round(run.elapsedMs - qStartMs),
  };
  run.records.push(rec);
  const t = nextTier(run.tier, run.streak, firstTryCorrect);
  run.tier = t.tier; run.streak = t.streak;
  run.recentConcepts = [...run.recentConcepts, q.concept].slice(-2);
  if (!firstTryCorrect) run.wrongConcepts.add(q.concept);
  onAnswered(run, firstTryCorrect);
  syncHud(run);
  return rec;
}

/** Slime pushback and the `answer` event for a first-try correct answer. */
export function celebrate(room: RoomRuntime, at: { x: number; y: number; z: number }, firstTry: boolean): void {
  if (firstTry) pushback();
  G.events.emit({ type: 'answer', roomId: room.id, correct: true, firstTry, ...at });
}

// ───────────────────────── lifecycle ─────────────────────────

const TIPS: Record<RoomKind, string> = {
  doorRush: 'Run through the door with the right answer. A right answer opens a gold ★ door with a bonus question.',
  tileDrop: 'Stand on the right answer before the clock runs out.',
  stepStones: 'Step on the correct next step. Wrong steps drop!',
  bridgeBuilder: 'Carry each block to the glowing edge, in the right order.',
  slimeGate: 'Final gates. No detours. The slime rises fast!',
  quizMaze: 'Crossroads! Walk down the corridor with the right answer. Wrong ones are dead ends.',
  junctionHall: 'Right answer opens the SHORTCUT. Wrong opens the SCENIC ROUTE.',
  launchPads: 'Stand on a pad until the ring fills. The right pad launches you over the hedge!',
  ruleMinefield: 'Step only on tiles that fit the rule. A wrong tile drops you back!',
  keyHunt: 'Keys lie in the dead ends. Carry the key with the right answer to the gate. F drops a key.',
  doorCarousel: 'The doors slide past the opening. Run into the right one when it is in the gap!',
  memoryFloor: 'Remember the answers on the tiles! Then stand on the right tile for a second.',
  answerLifts: 'Stand on a lift. The right one rises to the ledge. A wrong one sinks into the slime pond!',
  hexFinale: 'Stand on the colour with the right answer. Every other tile falls when the clock runs out!',
  boulderRun: 'A boulder is coming! Run to the end and duck into the alcove with the right answer.',
  shiftMaze: 'Shrines ask a question. Stand on the right plate to slide the hedges open. A wrong plate closes your way!',
};

let tipTimer: ReturnType<typeof setTimeout> | null = null;
function showTip(kind: RoomKind): void {
  if (G.tipsShown.has(kind)) return;
  G.tipsShown.add(kind);
  useUI.setState({ tip: TIPS[kind] });
  if (tipTimer) clearTimeout(tipTimer);
  tipTimer = setTimeout(() => { useUI.setState({ tip: null }); tipTimer = null; }, T.TIP_TIME * 1000);
}

export function clearTip(): void {
  if (tipTimer) clearTimeout(tipTimer);
  tipTimer = null;
  useUI.setState({ tip: null });
}

/** Common part of room activation: mark active, close the entrance gate, show the first-visit tip. */
export function beginRoom(room: RoomRuntime): void {
  const run = needRun();
  run.roomsActivated++;
  room.roomNumber = run.roomsActivated;
  room.state = 'active';
  room.activatedAtMs = run.elapsedMs;
  room.feedback = null;
  room.hintShown = null;
  room.fiftyUsed = false;
  room.hintUsed = false;
  run.activeRoomId = room.id;
  if (room.layout.gateWallId !== null) run.world.walls[room.layout.gateWallId].enabled = true;
  room.answerTimer = null;
  G.events.emit({ type: 'roomActivated', roomId: room.id, kind: room.kind });
  showTip(room.kind);
}

export function resolveRoom(room: RoomRuntime, result: NonNullable<RoomRuntime['result']>): void {
  const run = needRun();
  room.state = 'resolved';
  room.result = result;
  room.resolvedAtMs = run.elapsedMs;
  room.feedback = null;
  if (run.activeRoomId === room.id) run.activeRoomId = null;
  if (room.record) room.record.timeMs = Math.round(run.elapsedMs - room.activatedAtMs);
  syncRoomPanel();
  syncHud(run);
}

// ───────────────────────── panel (UI) ─────────────────────────

const TITLES: Record<RoomKind, string> = {
  doorRush: 'DOOR RUSH', tileDrop: 'TILE DROP', stepStones: 'STEP STONES', bridgeBuilder: 'BRIDGE BUILDER', slimeGate: 'SLIME GATE',
  quizMaze: 'CROSSROADS', junctionHall: 'JUNCTION HALL', launchPads: 'LAUNCH PADS', ruleMinefield: 'RULE MINEFIELD', keyHunt: 'KEY HUNT',
  doorCarousel: 'DOOR CAROUSEL', memoryFloor: 'MEMORY FLOOR',
  answerLifts: 'ANSWER LIFTS', hexFinale: 'HEX FINALE',
  boulderRun: 'BOULDER RUN', shiftMaze: 'SHIFTING MAZE',
};

function footerFor(room: RoomRuntime): string {
  switch (room.kind) {
    case 'doorRush': return 'Run through the right door.';
    case 'tileDrop': return room.timer.started ? 'Stand on the right answer!' : 'Step onto a tile to start the clock.';
    case 'stepStones': return 'Step on the correct next step.';
    case 'bridgeBuilder': return 'Carry blocks to the glowing edge in order. F drops a block.';
    case 'slimeGate': return room.lockT > 0 ? 'Gate locked!' : 'Run through the right door. Wrong doors bounce you back.';
    case 'quizMaze': return 'Walk down the corridor with the right answer.';
    case 'junctionHall': return 'Right door: shortcut. Wrong door: scenic route.';
    case 'launchPads': return 'Stand on the right answer until the ring fills.';
    case 'ruleMinefield': return 'Cross the grid. Step only on tiles that fit the rule.';
    case 'keyHunt': {
      const k = room.keys.find((x) => x.id === G.player.carrying);
      return k ? `Carrying "${k.label}". Take it to the gate! F drops it.` : 'Find the key with the right answer in a dead end.';
    }
    case 'doorCarousel': return 'Run into the right door while it is in the opening.';
    case 'memoryFloor': return 'Stand still on the tile that held the right answer for 1 second.';
    case 'answerLifts': return 'Stand on the lift with the right answer.';
    case 'hexFinale': return 'Be on the right colour when the clock hits zero.';
    case 'boulderRun': {
      const B = room.boulder;
      const wave = B && room.layout.boulder!.waves.length > 1 ? `Wave ${B.wave + 1} of ${room.layout.boulder!.waves.length}. ` : '';
      if (B?.phase === 'rolling') return `${wave}RUN! Duck into the alcove with the right answer.`;
      return `${wave}The ground shakes. Read, then run for the alcove with the right answer.`;
    }
    case 'shiftMaze': return 'Stand on a plate to answer. Right: a shortcut opens. Wrong: the way closes.';
  }
}

/** Seconds on the clock, scaled by the "Relaxed timers" setting. 0 = no timer. */
export function timerSeconds(base: number): number {
  return base * (useUI.getState().settings.relaxedTimers ? T.RELAXED_TIMER_MULT : 1);
}

export function buildRoomPanel(room: RoomRuntime): RoomPanel | null {
  const run = needRun();
  const q = room.question;
  if (!q || room.state !== 'active' || !questionPending(room)) return null;
  const boss = room.kind === 'slimeGate';
  const total = room.doorWalls.length;
  const title = boss ? `SLIME GATE · Gate ${room.currentWall + 1} of ${total}`
    : room.kind === 'quizMaze' ? `CROSSROADS · Junction ${room.currentWall + 1} of ${room.junctions.length}` : TITLES[room.kind];
  const hexRound = room.kind === 'hexFinale' && room.hex ? room.hex.round : 0;
  const panel: RoomPanel = {
    roomId: room.id, kind: room.kind, title: hexRound ? `HEX FINALE · Round ${hexRound} of ${T.HEX_ROUNDS}` : title,
    subtitle: `Room ${room.roomNumber} · Tier ${room.tierAsked} · ${boss ? 'SLIME ×2' : 'THINK ZONE'}`,
    prompt: q.type === 'truefalse' ? `${q.prompt} True or false?` : q.prompt,
    footer: footerFor(room),
    hint: room.hintShown, feedback: room.feedback,
    canFifty: canFiftyRoom(room) && !room.fiftyUsed && run.phase === 'playing',
    canHint: !room.hintUsed && run.phase === 'playing',
    fiftyUsed: room.fiftyUsed, hintUsed: room.hintUsed,
    think: !boss, boss,
  };
  if (room.kind === 'tileDrop') {
    panel.timer = { remaining: room.timer.remaining, total: room.timer.total, started: room.timer.started };
  } else if (room.kind === 'hexFinale' && room.hex) {
    const hx = room.hex;
    panel.timer = { remaining: hx.phase === 'ask' ? hx.remaining : 0, total: hx.total, started: true };
  } else if (room.answerTimer) {
    const t = room.answerTimer;
    panel.timer = { remaining: t.remaining, total: t.total, started: t.started };
    if (!t.started) panel.footer = `${panel.footer} The clock starts when you move.`;
  }
  if (room.kind === 'quizMaze') {
    // the corridors as answer chips with an arrow from the camera's heading (the panel syncs at HUD rate, so they follow turns)
    const jl = room.layout.junctions[room.currentWall], jr = room.junctions[room.currentWall];
    if (jl && jr) {
      panel.paths = jr.branches.map((b, i) => ({
        label: b.label, arrow: branchArrow(jl.branches[i].dx, jl.branches[i].dz, G.camera.yaw),
        state: b.state === 'open' && b.glow ? 'glow' : b.state,
      }));
    }
  }
  if (room.kind === 'stepStones') {
    panel.steps = { index: Math.min(room.currentRow + 1, 4), total: 4, working: room.working.slice() };
  } else if (room.kind === 'bridgeBuilder') {
    const carrying = room.blocks.find((b) => b.id === G.player.carrying);
    panel.bridge = { placed: room.nextIndex, total: 4, carrying: carrying ? carrying.label : null };
  }
  return panel;
}

export function syncRoomPanel(): void {
  const run = G.run;
  if (!run) return;
  const room = run.activeRoomId ? run.roomMap.get(run.activeRoomId) : null;
  // an open Gold Door follow-up owns the panel (it carries its own cached panel)
  const panel = run.gold ? run.gold.panel : room ? buildRoomPanel(room) : null;
  useUI.setState({ room: run.detour ? null : panel });
}

// ───────────────────────── answer timers (P1-B) ─────────────────────────

/** Arm the door-question countdown for this difficulty (none on Easy/Normal by default). */
export function armAnswerTimer(room: RoomRuntime): void {
  const s = timerSeconds(T.DOOR_TIMER[needRun().selection.difficulty]);
  room.answerTimer = s > 0 ? { total: s, remaining: s, started: false, done: false } : null;
}

/**
 * Advance the countdown. It starts when the player first moves after activation (and after
 * read-aloud has finished). Returns true on the step it runs out.
 */
export function stepAnswerTimer(room: RoomRuntime, h: number): boolean {
  const t = room.answerTimer;
  const run = needRun();
  if (!t || t.done || room.state !== 'active' || run.phase !== 'playing' || run.detour) return false;
  if (!t.started) {
    const v = G.player.vel;
    if (Math.hypot(v.x, v.z) < T.TIMER_START_SPEED || isSpeaking()) return false;
    t.started = true;
  }
  t.remaining = Math.max(0, t.remaining - h);
  if (t.remaining > 0) return false;
  t.done = true;
  return true;
}
