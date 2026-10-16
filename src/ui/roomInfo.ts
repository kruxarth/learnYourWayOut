import type { RoomKind, SegmentKind } from '../game/types';

/** Display info per room kind: the "Up ahead" strip, the results breakdown and the minimap. */
export const ROOM_INFO: Record<RoomKind, { icon: string; name: string; letter: string }> = {
  doorRush: { icon: '🚪', name: 'Door Rush', letter: 'D' },
  tileDrop: { icon: '🟦', name: 'Tile Drop', letter: 'T' },
  stepStones: { icon: '🪨', name: 'Step Stones', letter: 'S' },
  bridgeBuilder: { icon: '🌉', name: 'Bridge Builder', letter: 'B' },
  slimeGate: { icon: '🟢', name: 'Slime Gate', letter: 'G' },
  quizMaze: { icon: '🧭', name: 'Crossroads', letter: 'Q' },
  junctionHall: { icon: '🔀', name: 'Junction Hall', letter: 'J' },
  launchPads: { icon: '🚀', name: 'Launch Pads', letter: 'L' },
  keyHunt: { icon: '🗝️', name: 'Key Hunt', letter: 'K' },
  ruleMinefield: { icon: '🧩', name: 'Rule Minefield', letter: 'M' },
  doorCarousel: { icon: '🎠', name: 'Door Carousel', letter: 'C' },
  memoryFloor: { icon: '🧠', name: 'Memory Floor', letter: 'F' },
  answerLifts: { icon: '🛗', name: 'Answer Lifts', letter: 'A' },
  hexFinale: { icon: '⬡', name: 'Hex Finale', letter: 'H' },
  boulderRun: { icon: '🪨', name: 'Boulder Run', letter: 'R' },
  shiftMaze: { icon: '🌀', name: 'Shifting Maze', letter: 'W' },
};

export function roomIcon(kind: SegmentKind): string | null {
  return kind in ROOM_INFO ? ROOM_INFO[kind as RoomKind].icon : null;
}
