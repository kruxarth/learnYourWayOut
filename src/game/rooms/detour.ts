import { selectRetryQuestion } from '../../content/select';
import type { McqQuestion, Question } from '../../content/schema';
import { shuffle } from '../rng';
import { clearBanner, pushToast, showBanner, useUI } from '../../ui/store';
import { syncHud } from '../../ui/sync';
import { T } from '../tuning';
import { G, needRun } from '../state';
import type { AnswerRecord } from '../types';
import type { DetourRuntime, RoomRuntime } from '../runtime';
import { startTransition, surgeAmount, teleportPlayer } from '../loop/progression';
import { clearTip, syncRoomPanel } from '../loop/roomCommon';
import { labelDoors, makeDoorWall, resetDoorWall, setPanelState } from './doors';

/** Return actions registered by the rooms that can start a detour (avoids import cycles). */
const returnActions: Record<string, (room: RoomRuntime, remediated: boolean) => void> = {};
export function registerReturnAction(kind: string, fn: (room: RoomRuntime, remediated: boolean) => void): void {
  returnActions[kind] = fn;
}

function retryLabels(q: Question, n: number, rng: () => number): { labels: string[]; correctIndex: number } {
  if (q.type === 'mcq') {
    const wrong = shuffle((q as McqQuestion).distractors, rng).slice(0, n - 1);
    const labels = shuffle([q.answer, ...wrong], rng);
    return { labels, correctIndex: labels.indexOf(q.answer) };
  }
  if (q.type === 'truefalse') {
    const labels = shuffle(['TRUE', 'FALSE'], rng);
    return { labels, correctIndex: labels.indexOf(q.answer ? 'TRUE' : 'FALSE') };
  }
  return { labels: ['?', '?'], correctIndex: 0 };
}

export function correctText(q: Question): string {
  if (q.type === 'mcq') return q.answer;
  if (q.type === 'truefalse') return q.answer ? 'TRUE' : 'FALSE';
  if (q.type === 'steps') return q.steps.map((s) => s.correct).join(' → ');
  if (q.type === 'classify') return q.items.filter((i) => i.fits).map((i) => i.label).join(', ');
  return q.items.join(' → ');
}

/** Start the detour for a room (spec §11.2). Idempotent while a transition or detour is running. */
export function startDetour(room: RoomRuntime): void {
  const run = needRun();
  if (run.detour || run.phase !== 'playing' || !room.question) return;
  const question = room.question;
  startTransition(() => {
    const dl = run.course.detour;
    const retry = selectRetryQuestion(run.pack, question, run.usedQuestionIds, run.qRng, dl.retryWall.doors.length > 2);
    const wall = makeDoorWall(room.id, dl.retryWall);
    // the retry wall panels are dynamic walls shared with the course; reset their state
    resetDoorWall(run, wall);
    const detour: DetourRuntime = {
      roomId: room.id, question, retryQuestion: retry, retryWall: wall, nearBoard: null, retryActive: false,
      retryFirstTry: null, retryWrong: 0, wrongSinceRelabel: 0, retryFeedback: null, solved: false, exiting: false, startMs: run.elapsedMs,
    };
    if (retry) {
      labelRetry(run, wall, retry);
    } else {
      for (const p of wall.panels) setPanelState(run, p, 'burst');
      detour.solved = true;
    }
    run.detour = detour;
    G.player.forcedFall = false;
    teleportPlayer(dl.spawn);
    useUI.setState({ room: null });
    clearTip();
    syncDetourPanel();
  });
  showBanner('DETOUR!', 'info', 1200);
  pushToast('Learn it, then get back on track.', 'info');
  G.events.emit({ type: 'detourEnter' });
}

/** Label the retry doors. A true/false retry uses two doors; the rest are crossed out. */
function labelRetry(run: ReturnType<typeof needRun>, wall: DetourRuntime['retryWall'], q: Question): void {
  const n = wall.panels.length;
  const { labels, correctIndex } = retryLabels(q, n, run.qRng);
  labelDoors(run, wall, labels, correctIndex, q.id);
  for (let i = labels.length; i < n; i++) setPanelState(run, wall.panels[i], 'smashed');
}

export function syncDetourPanel(): void {
  const run = G.run;
  if (!run || !run.detour) { useUI.setState({ detour: null }); return; }
  const d = run.detour;
  const q = d.question;
  useUI.setState({
    detour: {
      questionId: q.id,
      correct: correctText(q),
      explanation: q.explanation,
      workedExample: q.workedExample ?? `Remember: ${q.hint}`,
      nearBoard: d.nearBoard,
      retryPrompt: d.retryActive && d.retryQuestion ? d.retryQuestion.prompt : null,
      retryFeedback: d.retryFeedback,
    },
  });
}

/** Per-step detour logic: boards, retry zone, return portal. */
export function stepDetour(): void {
  const run = needRun();
  const d = run.detour;
  if (!d || run.phase !== 'playing') return;
  const p = G.player.pos;
  let near: 'A' | 'B' | null = null;
  for (const t of run.course.triggers) {
    if (t.kind === 'detourBoard' && p.x >= t.minX && p.x <= t.maxX && p.z >= t.minZ && p.z <= t.maxZ) near = t.data.board as 'A' | 'B';
    if (t.kind === 'detourRetry' && !d.retryActive && p.x >= t.minX && p.x <= t.maxX && p.z >= t.minZ && p.z <= t.maxZ) {
      d.retryActive = true;
      syncDetourPanel();
    }
  }
  if (near !== d.nearBoard) { d.nearBoard = near; syncDetourPanel(); }

  // return portal
  const portal = run.course.detour.portal;
  const dx = p.x - portal.x, dz = p.z - portal.z;
  if (d.solved && !d.exiting && dx * dx + dz * dz < 1.4 * 1.4) exitDetour();
}

export function onRetryDoorTouch(panelIndex: number): void {
  const run = needRun();
  const d = run.detour;
  if (!d || !d.retryQuestion) return;
  const panel = d.retryWall.panels[panelIndex];
  if (!panel || d.solved) return;
  if (panel.state === 'smashed' || panel.state === 'wrongX') {
    G.player.vel.y = 3; G.player.vel.z = 4;
    return;
  }
  const rq = d.retryQuestion;
  if (panel.isCorrect) {
    setPanelState(run, panel, 'burst');
    G.events.emit({ type: 'doorBurst', x: G.player.pos.x, y: 1.2, z: G.player.pos.z });
    if (d.retryFirstTry === null) d.retryFirstTry = true;
    d.solved = true;
    d.retryFeedback = null;
    pushToast('CORRECT! Back on track.', 'good');
    const rec: AnswerRecord = {
      questionId: rq.id, concept: rq.concept, type: rq.type, roomKind: 'detour', tierAsked: rq.tier,
      correctFirstTry: d.retryFirstTry === true, wrongCount: d.retryWrong, usedHint: false, usedFifty: false,
      remediated: false, isRetry: true, timeMs: Math.round(run.elapsedMs - d.startMs),
    };
    run.records.push(rec);
    G.events.emit({ type: 'answer', roomId: d.roomId, correct: true, firstTry: d.retryFirstTry === true, x: G.player.pos.x, y: 1.2, z: G.player.pos.z });
  } else {
    setPanelState(run, panel, 'wrongX');
    G.player.vel.y = 5; G.player.vel.z = 7;
    G.player.spin = 0.5;
    G.events.emit({ type: 'bounce' });
    d.retryWrong++;
    d.wrongSinceRelabel++;
    if (d.retryFirstTry === null) d.retryFirstTry = false;
    d.retryFeedback = rq.explanation;
    surgeAmount(T.RETRY_WRONG_SURGE);
    const diff = run.selection.difficulty;
    const right = d.retryWall.panels.find((p) => p.isCorrect);
    if (right && d.wrongSinceRelabel >= T.DETOUR_GLOW_AFTER[diff]) right.glow = true;
    else if (d.wrongSinceRelabel >= T.DETOUR_REQUESTION_AFTER && !Number.isFinite(T.DETOUR_GLOW_AFTER[diff])) {
      // Hard: no glowing door — a second retry question instead
      const next = selectRetryQuestion(run.pack, d.question, run.usedQuestionIds, run.qRng, d.retryWall.panels.length > 2);
      if (next && next.id !== rq.id) {
        d.retryQuestion = next;
        d.wrongSinceRelabel = 0;
        d.retryFeedback = `${rq.explanation} Try this one instead.`;
        labelRetry(run, d.retryWall, next);
        pushToast('New question on the doors!', 'info');
      } else if (right) right.glow = true;
    }
    syncHud(run);
  }
  syncDetourPanel();
}

function exitDetour(): void {
  const run = needRun();
  const d = run.detour;
  if (!d) return;
  d.exiting = true;
  const room = run.roomMap.get(d.roomId)!;
  const remediated = d.retryFirstTry === true;
  startTransition(() => {
    teleportPlayer(room.layout.exitSpawn);
    returnActions[room.kind]?.(room, remediated);
    run.detour = null;
    useUI.setState({ detour: null });
    clearBanner();
    G.events.emit({ type: 'detourExit' });
    syncRoomPanel();
  });
}
