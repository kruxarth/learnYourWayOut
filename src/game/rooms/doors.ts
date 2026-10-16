import type { DoorWallLayout } from '../types';
import type { DoorWall, Panel, PanelState } from '../runtime';
import type { RunState } from '../runtime';

/** Shared door-wall logic (Door Rush, Slime Gate, detour retry wall). Spec §10.8. */

export function makeDoorWall(roomId: string, layout: DoorWallLayout): DoorWall {
  return {
    roomId,
    wallIndex: layout.wallIndex,
    questionId: null,
    panels: layout.doors.map((d, i) => ({
      index: i, wallId: d.wallId, label: '?', isCorrect: false, state: 'closed' as PanelState, glow: false, anim: 0,
    })),
  };
}

/** Collision follows the state: only closed, smashed and wrongX panels are solid. */
export function setPanelState(run: RunState, panel: Panel, state: PanelState): void {
  panel.state = state;
  panel.anim = 0;
  run.world.walls[panel.wallId].enabled = state === 'closed' || state === 'smashed' || state === 'wrongX';
}

export function resetDoorWall(run: RunState, dw: DoorWall): void {
  for (const p of dw.panels) {
    p.glow = false;
    p.isCorrect = false;
    p.label = '?';
    setPanelState(run, p, 'closed');
  }
  dw.questionId = null;
}

export function labelDoors(run: RunState, dw: DoorWall, labels: string[], correctIndex: number, questionId: string): void {
  dw.questionId = questionId;
  dw.panels.forEach((p, i) => {
    p.label = labels[i] ?? '?';
    p.isCorrect = i === correctIndex;
    p.glow = false;
    setPanelState(run, p, 'closed');
  });
}

export function usableDoors(dw: DoorWall): Panel[] {
  return dw.panels.filter((p) => p.state === 'closed');
}

export function stepPanel(p: Panel, h: number): void {
  if (p.state === 'burst') p.anim = Math.min(1, p.anim + h / 0.8);
  else if (p.state === 'swing') p.anim = Math.min(1, p.anim + h / 0.25);
  else p.anim = Math.min(1, p.anim + h / 0.3);
}

export function stepDoorWall(dw: DoorWall, h: number): void {
  for (const p of dw.panels) stepPanel(p, h);
}

/** Parse 'door:<roomId>:<wallIndex>:<panelIndex>'. */
export function parseDoorTouch(touchId: string): { roomId: string; wallIndex: number; panelIndex: number } | null {
  const parts = touchId.split(':');
  if (parts[0] !== 'door' || parts.length !== 4) return null;
  return { roomId: parts[1], wallIndex: Number(parts[2]), panelIndex: Number(parts[3]) };
}
