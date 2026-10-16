import { Emitter, type GameEvent } from './events';
import { createPlayer } from './loop/navigation';
import type { RunState } from './runtime';
import type { CameraState } from './types';

/** Process-wide game singleton shared by the loop modules (no React, no three.js objects). */
export const G = {
  events: new Emitter<GameEvent>(),
  player: createPlayer(),
  camera: { yaw: 0, snapVersion: 0, shake: 0 } as CameraState,
  run: null as RunState | null,
  /** Seconds of simulated time. Used for touch debounce. */
  clock: 0,
  debug: false,
  /** Room kinds whose tip has been shown this session. */
  tipsShown: new Set<string>(),
};

export function needRun(): RunState {
  if (!G.run) throw new Error('no active run');
  return G.run;
}
