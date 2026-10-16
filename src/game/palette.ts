// Shared color palette (spec §17.3). Used by both the engine (floor colors) and the renderer.
export const PAL = {
  skyTop: '#6EC6FF', skyHorizon: '#FFD9F0',
  hedge: '#4CC36A', hedgeTop: '#6BE07F', roomWall: '#B79CFF', doorWall: '#9C7BFF',
  panel: '#FFC93C', panelBorder: '#FF8A3D', gate: '#FF7AB6',
  floorMaze: '#FFF1D6', floorAlt: '#FFE6B8', floorRoom: '#D7F0FF', tile: '#8FD3FF',
  good: '#3DDC84', bad: '#FF5A6E', gold: '#FFD23F', slime: '#7CFF4F', bean: '#FF7AB6',
  detourFloor: '#E6D9FF', detourHedge: '#9B7BFF', uiText: '#2B2D42', uiAccent: '#FF4FA0',
  water: '#5CC8FF',
} as const;

import type { BodyColorId } from './avatar';

/** Avatar body colours. `pink` is the original bean; all differ from hedge green, the cream floor and the slime. */
export const BODY_COLORS: Record<BodyColorId, string> = {
  pink: PAL.bean, red: '#E8383D', orange: '#FF9F43', yellow: '#F5D000', lime: '#B8E636', teal: '#14B8A6',
  sky: '#5CC8FF', blue: '#3D5AFE', purple: '#9B5CFF', brown: '#8B5A2B', white: '#F2F6FF', black: '#2B2D42',
};
