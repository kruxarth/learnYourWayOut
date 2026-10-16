import { questionSource } from '../../content/source';
import { useUI, showBanner } from '../../ui/store';
import { T } from '../tuning';
import { G, needRun } from '../state';
import type { RunState } from '../runtime';
import type { RunResult } from '../types';
import { finishDailyRun } from '../daily';
import { recordRun } from '../persistence';
import { answerText, computeMastery, computeStars, parTimeMs, weakConcepts } from './evaluation';

export function buildResult(run: RunState, outcome: 'qualified' | 'eliminated'): RunResult {
  const pack = questionSource.getPack(run.selection.domainId);
  const mastery = computeMastery(run.records, pack);
  const review = run.records
    .filter((r) => !r.isRetry && !r.correctFirstTry)
    .map((r) => pack.questions.find((q) => q.id === r.questionId))
    .filter((q): q is NonNullable<typeof q> => !!q)
    .map((q) => ({ prompt: q.prompt, answerText: answerText(q), explanation: q.explanation, questionId: q.id }));
  const parMs = parTimeMs(run.selection.difficulty, run.course.segments, run.route);
  const result: RunResult = {
    outcome, selection: run.selection, timeMs: Math.round(run.elapsedMs), route: run.route,
    coinsCollected: run.coinsCollected, slimeAtEnd: run.slime,
    stars: computeStars(outcome === 'qualified', run.records, run.elapsedMs, parMs),
    parMs, records: run.records.slice(), mastery, weakConcepts: weakConcepts(mastery), review,
  };
  if (run.selection.mode === 'gauntlet') result.breakdown = gauntletBreakdown(run);
  return result;
}

/** Gauntlet results card: time and first-try answers per room, in course order. */
function gauntletBreakdown(run: RunState): NonNullable<RunResult['breakdown']> {
  const route = run.route === 'short' ? 'short' : 'long';
  const rows: NonNullable<RunResult['breakdown']> = [];
  for (const seg of run.course.segments) {
    if (!seg.roomId || (seg.lane !== 'main' && seg.lane !== route)) continue;
    const room = run.roomMap.get(seg.roomId);
    if (!room || room.state === 'idle') continue;
    const end = room.state === 'resolved' ? room.resolvedAtMs : run.elapsedMs;
    const recs = run.records.filter((r) => !r.isRetry && r.roomKind === room.kind);
    rows.push({
      kind: room.kind, timeMs: Math.max(0, Math.round(end - room.activatedAtMs)), asked: recs.length,
      correct: recs.filter((r) => r.correctFirstTry).length,
    });
  }
  return rows;
}

export function win(): void {
  const run = needRun();
  if (run.phase === 'won' || run.phase === 'lost') return;
  run.phase = 'won';
  run.transition = null;
  G.player.inputLocked = true;
  run.endTimer = 0;
  useUI.setState({ fade: false, room: null, detour: null });
  showBanner('QUALIFIED!', 'good', 0);
  G.events.emit({ type: 'win' });
}

export function lose(): void {
  const run = needRun();
  if (run.phase === 'won' || run.phase === 'lost') return;
  run.phase = 'lost';
  run.transition = null;
  G.player.inputLocked = true;
  run.endTimer = 0;
  useUI.setState({ fade: false, lost: true, room: null, detour: null });
  showBanner('ELIMINATED', 'bad', 0);
  G.events.emit({ type: 'lose' });
}

/** Win/lose check (spec §14) and the delay before the results card. */
export function checkOutcome(run: RunState, h: number): void {
  if (run.phase === 'playing') {
    if (run.slime >= 1) { lose(); return; }
    const p = G.player.pos, portal = run.course.exitPortal;
    const dx = p.x - portal.x, dz = p.z - portal.z;
    if (!run.detour && dx * dx + dz * dz < T.PORTAL_RADIUS * T.PORTAL_RADIUS && p.y < 3) win();
    return;
  }
  if (run.phase === 'won' || run.phase === 'lost') {
    run.endTimer += h;
    if (run.endTimer >= T.RESULT_DELAY) {
      const result = buildResult(run, run.phase === 'won' ? 'qualified' : 'eliminated');
      run.endTimer = -1e9; // only once
      G.events.emit({ type: 'runResult', result });
      const newUnlocks = recordRun(result);
      const dailyOutcome = finishDailyRun(result.outcome === 'qualified', result.timeMs);
      useUI.setState({ results: result, screen: 'results', newUnlocks, dailyOutcome });
    }
  }
}
