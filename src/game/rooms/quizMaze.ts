import type { McqQuestion, TfQuestion } from '../../content/schema';
import { pushToast } from '../../ui/store';
import { shuffle } from '../rng';
import { G, needRun } from '../state';
import { T } from '../tuning';
import type { JunctionRT, RoomRuntime } from '../runtime';
import { surge } from '../loop/progression';
import { beginRoom, celebrate, pickQuestion, resolveRoom, startRecord, syncRoomPanel } from '../loop/roomCommon';

/**
 * Crossroads quiz maze (P0-A). Each junction is a question; its corridors carry the answers.
 * The right corridor leads on; wrong ones are dead ends that cost a surge and the walk back.
 * No teleport, no detour.
 */

export type PathArrow = '←' | '↑' | '→' | '↓';

/** Which way a corridor (world direction dx, dz) lies for a view facing `yaw` (forward = (−sin yaw, −cos yaw)). */
export function branchArrow(dx: number, dz: number, yaw: number): PathArrow {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const ahead = dx * fx + dz * fz, right = -dx * fz + dz * fx;
  if (Math.abs(ahead) >= Math.abs(right)) return ahead >= 0 ? '↑' : '↓';
  return right > 0 ? '→' : '←';
}

export function makeJunctions(room: RoomRuntime): JunctionRT[] {
  return room.layout.junctions.map((j) => ({
    branches: j.branches.map((b) => ({ label: '?', correct: b.correct, state: 'idle' as const, glow: false })),
  }));
}

export function activateJunction(room: RoomRuntime, j: number): void {
  const run = needRun();
  const jl = room.layout.junctions[j];
  if (!jl || room.wallQuestions[j]) return;
  if (room.state === 'idle') beginRoom(room);
  else if (room.state === 'active') {
    room.fiftyUsed = false; room.hintUsed = false; room.hintShown = null; room.feedback = null;
    room.activatedAtMs = run.elapsedMs;
  } else return;
  room.currentWall = j;
  const jr = room.junctions[j];
  const n = jl.branches.length;
  // two corridors: true/false or an mcq with one distractor (true/false questions are scarce)
  const q = pickQuestion(room, n === 2 ? ['mcq', 'truefalse'] : 'mcq', 0) as McqQuestion | TfQuestion;
  room.question = q;
  room.wallQuestions[j] = q;
  if (q.type === 'truefalse') {
    for (const b of jr.branches) b.label = b.correct === q.answer ? 'TRUE' : 'FALSE';
  } else {
    const wrong = shuffle(q.distractors, run.qRng).slice(0, n - 1);
    let w = 0;
    for (const b of jr.branches) b.label = b.correct ? q.answer : wrong[w++];
  }
  for (const b of jr.branches) { b.state = 'open'; b.glow = false; }
  syncRoomPanel();
}

/** The player walked into corridor `bi` of junction `j` (direction already checked by the trigger). */
export function onPick(room: RoomRuntime, j: number, bi: number): void {
  const run = needRun();
  if (room.state !== 'active' || run.phase !== 'playing') return;
  const q = room.wallQuestions[j];
  const b = room.junctions[j]?.branches[bi];
  if (!q || !b || room.wallDone[j] || b.state !== 'open') return; // known-wrong corridors are free to revisit
  const pl = G.player.pos;
  const at = { x: pl.x, y: 1.2, z: pl.z };
  if (b.correct) {
    b.state = 'right';
    b.glow = false;
    const firstTry = room.wallWrong[j] === 0;
    if (firstTry) room.wallRecords[j] = startRecord(room, q, true, room.activatedAtMs);
    else if (room.wallRecords[j]) room.wallRecords[j]!.remediated = true;
    room.wallDone[j] = true;
    room.feedback = null;
    celebrate(room, at, firstTry);
    pushToast(firstTry ? 'Correct! Keep going.' : 'That way!', 'good');
    if (room.wallDone.every(Boolean)) resolveRoom(room, room.wrongCount === 0 ? 'correct' : 'remediated');
  } else {
    b.state = 'wrong';
    if (room.wallWrong[j] === 0) {
      room.wallRecords[j] = startRecord(room, q, false, room.activatedAtMs);
      surge(1);
    } else {
      room.wallRecords[j]!.wrongCount++;
      surge(0.5);
    }
    room.wallWrong[j]++;
    room.wrongCount++;
    room.feedback = { text: `Not "${b.label}" — dead end! ${q.explanation}`, tone: 'bad' };
    G.events.emit({ type: 'answer', roomId: room.id, correct: false, firstTry: room.wallWrong[j] === 1, ...at });
    if (room.wallWrong[j] >= T.GLOW_AFTER_WRONG[run.selection.difficulty]) {
      for (const x of room.junctions[j].branches) if (x.correct) x.glow = true;
    }
  }
  syncRoomPanel();
}
