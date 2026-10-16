import type { Course } from '../types';
import type { RoomRuntime, RunState, TileRT } from '../runtime';
import { needRun } from '../state';
import { clearBanner, useUI } from '../../ui/store';
import { makeDoorWall } from '../rooms/doors';
import * as doorRush from '../rooms/doorRush';
import * as tileDrop from '../rooms/tileDrop';
import * as stepStones from '../rooms/stepStones';
import * as bridgeBuilder from '../rooms/bridgeBuilder';
import * as slimeGate from '../rooms/slimeGate';
import * as quizMaze from '../rooms/quizMaze';
import * as junctionHall from '../rooms/junctionHall';
import * as launchPads from '../rooms/launchPads';
import * as doorCarousel from '../rooms/doorCarousel';
import * as memoryFloor from '../rooms/memoryFloor';
import * as answerLifts from '../rooms/answerLifts';
import * as hexFinale from '../rooms/hexFinale';
import { makeGoldPanel } from '../rooms/goldDoor';
import * as ruleMinefield from '../rooms/ruleMinefield';
import * as keyHunt from '../rooms/keyHunt';
import * as boulderRun from '../rooms/boulderRun';
import * as shiftMaze from '../rooms/shiftMaze';
import { clearTip, syncRoomPanel } from './roomCommon';

function emptyTile(floorId: number, row: number, slot: number, cx: number, cz: number, sx: number, sz: number): TileRT {
  return { floorId, label: '', correct: false, state: 'solid', t: 0, glow: false, row, slot, cx, cz, sx, sz, visible: true, revealed: true };
}

/** Build runtime state for every room of a course. */
export function createRooms(course: Course, run: Pick<RunState, 'world'>): RoomRuntime[] {
  return course.rooms.map((layout) => {
    // one question slot per door wall (Slime Gate) or per junction (quiz maze)
    const slots = layout.kind === 'quizMaze' ? layout.junctions : layout.doorWalls;
    const room: RoomRuntime = {
    id: layout.id, kind: layout.kind, layout, state: 'idle', result: null, question: null, tierAsked: 2,
    activatedAtMs: 0, resolvedAtMs: 0, roomNumber: 0, record: null, hintShown: null, fiftyUsed: false, hintUsed: false, wrongCount: 0,
    feedback: null,
    doorWalls: layout.doorWalls.map((dw) => makeDoorWall(layout.id, dw)),
    currentWall: -1, wallQuestions: slots.map(() => null), wallWrong: slots.map(() => 0),
    wallDone: slots.map(() => false), wallRecords: slots.map(() => null), wrongDoor: null,
    tiles: layout.tiles.map((t) => ({ ...emptyTile(t.floorId, t.row, t.col, t.cx, t.cz, t.sx, t.sz), label: '?' })),
    timer: { started: false, remaining: 0, total: 0, ended: false, shakeT: 0, evaluated: false, correct: null, pendingDetour: false },
    stepRows: layout.stepRows.map((row, ri) => row.slotFloorIds.map((fid, s) => {
      const f = run.world.floors[fid];
      const t = emptyTile(fid, ri, s, (f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2, f.maxX - f.minX, f.maxZ - f.minZ);
      t.label = '?'; t.visible = false; t.revealed = false;
      return t;
    })),
    currentRow: 0, rowWrong: [0, 0, 0, 0], lastSafe: { x: layout.laneX, y: 0, z: layout.z0 - 2 }, working: [],
    blocks: [], nextIndex: 0, wrongAt: [0, 0, 0, 0], slabAnim: [0, 0, 0, 0], bridgeBanner: false,
    junctions: [], pads: [], launching: null, keys: [], carousel: layout.carousel ? { offset: 0, frozen: false } : null, memory: null, gold: layout.gold ? makeGoldPanel(layout.gold.wallId) : null, answerTimer: null, lockT: 0, resetT: -1,
    };
    room.junctions = quizMaze.makeJunctions(room);
    room.hex = hexFinale.makeHex(room);
    return room;
  });
}

export function activateRoom(roomId: string): void {
  const run = needRun();
  const room = run.roomMap.get(roomId);
  if (!room || room.state !== 'idle') return;
  switch (room.kind) {
    case 'doorRush': doorRush.activate(room); break;
    case 'tileDrop': tileDrop.activate(room); break;
    case 'stepStones': stepStones.activate(room); break;
    case 'bridgeBuilder': bridgeBuilder.activate(room); break;
    case 'junctionHall': junctionHall.activate(room); break;
    case 'launchPads': launchPads.activate(room); break;
    case 'ruleMinefield': ruleMinefield.activate(room); break;
    case 'keyHunt': keyHunt.activate(room); break;
    case 'doorCarousel': doorCarousel.activate(room); break;
    case 'memoryFloor': memoryFloor.activate(room); break;
    case 'answerLifts': answerLifts.activate(room); break;
    case 'hexFinale': hexFinale.activate(room); break;
    case 'boulderRun': boulderRun.activate(room); break;
    case 'shiftMaze': shiftMaze.activate(room); break;
    case 'slimeGate': case 'quizMaze': break; // activated wall by wall / junction by junction
  }
  syncRoomPanel();
}

export function activateJunction(roomId: string, junction: number): void {
  const room = needRun().roomMap.get(roomId);
  if (!room || room.kind !== 'quizMaze') return;
  quizMaze.activateJunction(room, junction);
}

export function junctionPick(roomId: string, junction: number, branch: number): void {
  const room = needRun().roomMap.get(roomId);
  if (!room || room.kind !== 'quizMaze') return;
  quizMaze.onPick(room, junction, branch);
}

export function activateBossWall(roomId: string, wall: number): void {
  const room = needRun().roomMap.get(roomId);
  if (!room || room.kind !== 'slimeGate') return;
  slimeGate.activateWall(room, wall);
  syncRoomPanel();
}

/** Per-step room logic and entity animation (rooms keep animating after they resolve). */
export function stepChallenge(h: number): void {
  const run = needRun();
  if (run.paused) return;
  for (const room of run.rooms) {
    switch (room.kind) {
      case 'doorRush': doorRush.step(room, h); break;
      case 'tileDrop': tileDrop.step(room, h); break;
      case 'stepStones': stepStones.step(room, h); break;
      case 'bridgeBuilder': bridgeBuilder.step(room, h); break;
      case 'slimeGate': slimeGate.step(room, h); break;
      case 'junctionHall': junctionHall.step(room, h); break;
      case 'launchPads': launchPads.step(room, h); break;
      case 'ruleMinefield': ruleMinefield.step(room, h); break;
      case 'keyHunt': keyHunt.step(room, h); break;
      case 'doorCarousel': doorCarousel.step(room, h); break;
      case 'memoryFloor': memoryFloor.step(room, h); break;
      case 'answerLifts': answerLifts.step(room, h); break;
      case 'hexFinale': hexFinale.step(room, h); break;
      case 'boulderRun': boulderRun.step(room, h); break;
      case 'shiftMaze': shiftMaze.step(room, h); break;
      case 'quizMaze': break;
    }
  }
}

export function handleRoomTouch(roomId: string, wallIndex: number, panelIndex: number): void {
  const room = needRun().roomMap.get(roomId);
  if (!room || room.state === 'idle') return;
  if (room.kind === 'doorRush') doorRush.onTouch(room, panelIndex);
  else if (room.kind === 'doorCarousel') doorCarousel.onTouch(room, panelIndex);
  else if (room.kind === 'slimeGate') slimeGate.onTouch(room, wallIndex, panelIndex);
  else if (room.kind === 'junctionHall') junctionHall.onTouch(room, panelIndex);
  syncRoomPanel();
}

/** Fall handler (spec §8.7). Returns true when a room consumed the fall. */
export function handleRoomFall(): boolean {
  const run = needRun();
  for (const r of run.rooms) {
    if (r.kind === 'tileDrop' && r.timer.pendingDetour && tileDrop.onFall(r)) return true;
    if (r.kind === 'memoryFloor' && r.memory?.pendingFall && memoryFloor.onFall(r)) return true;
  }
  const room = run.activeRoomId ? run.roomMap.get(run.activeRoomId) : null;
  if (!room) return false;
  if (room.kind === 'stepStones') return stepStones.onFall(room);
  if (room.kind === 'ruleMinefield') return ruleMinefield.onFall(room);
  if (room.kind === 'bridgeBuilder') return bridgeBuilder.onFall(room);
  if (room.kind === 'hexFinale') return hexFinale.onFall(room);
  return false;
}

export function dropBlock(): void {
  const run = needRun();
  const room = run.activeRoomId ? run.roomMap.get(run.activeRoomId) : null;
  if (room && room.kind === 'bridgeBuilder') bridgeBuilder.drop(room);
  else if (room && room.kind === 'keyHunt') keyHunt.drop(room);
}

export function clearRoomUI(): void {
  useUI.setState({ room: null, detour: null });
  clearTip();
  clearBanner();
}
