import { selectQuestion } from '../../content/select';
import type { McqQuestion } from '../../content/schema';
import { pushToast, useUI, type RoomPanel } from '../../ui/store';
import { shuffle } from '../rng';
import type { Panel, RunState } from '../runtime';
import { G } from '../state';
import { T } from '../tuning';
import type { RoomKind, Tier } from '../types';
import { addCoins, surge } from '../loop/progression';
import { clampTier, syncRoomPanel } from '../loop/roomCommon';
import { setPanelState } from './doors';

/**
 * Gold Door (F4-G). A golden star door that a host room offers after a first-try correct answer.
 * Walking into it asks one follow-up question one tier harder than the host's. The follow-up is
 * answered in the room panel (click, or keys 1-4; 5 stays the Shield).
 *   right: double pushback and +2 coins      wrong: double surge
 *
 * Reusable: a host room only needs
 *   - a dynamic `panel` wall with touchId `gold:<roomId>`, kept disabled until offered,
 *   - `offerGold(run, room)` when its main answer was right the first time,
 *   - `touchGold(roomId)` is called by the engine when the player runs into that wall.
 * Door Rush uses it now; Door Carousel can pass its own host (`GoldHost`) unchanged.
 */

export interface GoldHost {
  id: string;
  kind: RoomKind;
  tierAsked: Tier;
  gold: Panel | null;
}

export interface GoldState {
  hostId: string;
  hostKind: RoomKind;
  question: McqQuestion;
  options: string[];
  correct: number;
  tier: Tier;
  phase: 'asking' | 'done';
  picked: number;
  right: boolean;
  startedMs: number;
  /** Seconds the result stays on screen. */
  t: number;
  panel: RoomPanel;
}

export const GOLD_LABEL = '★';

/** A hidden gold panel: burst and invisible, its wall disabled. */
export function makeGoldPanel(wallId: number): Panel {
  return { index: 0, wallId, label: GOLD_LABEL, isCorrect: true, state: 'burst', glow: false, anim: 1, gold: true };
}

/** The host answered right on the first try: show the golden door. */
export function offerGold(run: RunState, host: GoldHost): void {
  const p = host.gold;
  if (!p || p.state !== 'burst') return;
  setPanelState(run, p, 'closed');
  pushToast('★ A gold door opened. Run into it for a harder bonus question!', 'good', 3200);
}

function buildPanel(g: GoldState): RoomPanel {
  const done = g.phase === 'done';
  return {
    roomId: g.hostId, kind: g.hostKind, title: '★ GOLD DOOR', subtitle: `Bonus · Tier ${g.tier}`,
    prompt: g.question.prompt,
    footer: done ? '' : `Pick an answer (click or keys 1-${g.options.length}). Right: double pushback and +${T.GOLD_COINS} coins. Wrong: double slime surge.`,
    hint: null,
    feedback: done
      ? { text: g.right ? `Correct! Double pushback and +${T.GOLD_COINS} coins.` : `The answer was: ${g.question.answer}. Double surge!`, tone: g.right ? 'good' : 'bad' }
      : null,
    canFifty: false, canHint: false, fiftyUsed: false, hintUsed: false, think: !done, boss: false,
    gold: {
      done,
      options: g.options.map((label, i) => ({
        label, state: !done ? 'idle' : i === g.correct ? 'right' : i === g.picked ? 'wrong' : 'idle',
      })),
    },
  };
}

function publish(run: RunState): void {
  const g = run.gold;
  if (g) { g.panel = buildPanel(g); useUI.setState({ room: g.panel }); }
  else syncRoomPanel();
}

/** The engine calls this when the player runs into a gold wall (touchId `gold:<roomId>`). */
export function touchGold(run: RunState, host: GoldHost | undefined): void {
  if (!host || !host.gold || host.gold.state !== 'closed') return;
  if (run.phase !== 'playing' || run.gold || run.activeRoomId || run.detour) return;
  askGold(run, host);
}

/** Open the follow-up. Generic: any host that has a closed gold panel. */
export function askGold(run: RunState, host: GoldHost): void {
  const panel = host.gold!;
  const tier = clampTier(host.tierAsked + 1);
  const q = selectQuestion({
    pack: run.pack, type: 'mcq', tier, usedIds: run.usedQuestionIds, recentConcepts: run.recentConcepts,
    focusConcepts: run.selection.focusConcepts, wrongConceptsThisRun: run.wrongConcepts, rng: run.qRng, seenIds: run.seenIds,
  }) as McqQuestion;
  const options = shuffle([q.answer, ...shuffle(q.distractors, run.qRng).slice(0, 3)], run.qRng);
  setPanelState(run, panel, 'burst');
  const g: GoldState = {
    hostId: host.id, hostKind: host.kind, question: q, options, correct: options.indexOf(q.answer), tier,
    phase: 'asking', picked: -1, right: false, startedMs: run.elapsedMs, t: 0, panel: null!,
  };
  run.gold = g;
  G.events.emit({ type: 'doorBurst', x: G.player.pos.x, y: 1.2, z: G.player.pos.z });
  publish(run);
}

/** Answer the open follow-up with option `index`. Returns false when nothing is open. */
export function answerGold(index: number): boolean {
  const run = G.run;
  const g = run?.gold;
  if (!run || !g || g.phase !== 'asking' || index < 0 || index >= g.options.length) return false;
  const right = index === g.correct;
  g.phase = 'done';
  g.picked = index;
  g.right = right;
  g.t = 0;
  const q = g.question;
  run.records.push({
    questionId: q.id, concept: q.concept, type: 'mcq', roomKind: g.hostKind, tierAsked: g.tier, correctFirstTry: right,
    wrongCount: right ? 0 : 1, usedHint: false, usedFifty: false, remediated: false, isRetry: false,
    timeMs: Math.round(run.elapsedMs - g.startedMs),
  });
  const at = { x: G.player.pos.x, y: 1.2, z: G.player.pos.z };
  if (right) {
    // the bonus ignores the slime floor (the normal pushback already took the floor-limited part)
    run.slime = Math.max(0, run.slime - T.GOLD_PUSHBACK_MULT * T.SLIME_PUSHBACK[run.selection.difficulty]);
    addCoins(T.GOLD_COINS);
    pushToast(`★ Gold! +${T.GOLD_COINS} coins and double pushback`, 'good', 2400);
  } else {
    run.wrongConcepts.add(q.concept);
    surge(T.GOLD_SURGE_MULT);
    pushToast('★ Wrong: double surge', 'bad', 2400);
  }
  G.events.emit({ type: 'answer', roomId: g.hostId, correct: right, firstTry: true, ...at });
  publish(run);
  return true;
}

/** Clears the result after a moment; walking into the next room closes an unanswered follow-up. */
export function stepGold(run: RunState, h: number): void {
  const g = run.gold;
  if (!g) return;
  if (g.phase === 'asking') {
    if (run.activeRoomId) { run.gold = null; pushToast('The gold door closed', 'info'); publish(run); }
    return;
  }
  g.t += h;
  if (g.t >= T.GOLD_RESULT_S) { run.gold = null; publish(run); }
}
