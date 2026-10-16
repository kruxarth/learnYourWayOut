import { dailyRun } from '../game/daily';
import { engine } from '../game/engine';
import type { SnapshotSource } from '../net/interp';
import { useUI } from '../ui/store';

/**
 * Today's best run as a snapshot source for `GhostPlayers` (F4-D). Plays back on the run's own clock, so it is
 * pure render: nothing here feeds the simulation.
 */
export const dailyGhostSource: SnapshotSource = {
  ids: () => (dailyRun.ghost.length ? ['ghost'] : []),
  buffer: () => dailyRun.ghost,
  renderTime: () => engine.run?.elapsedMs ?? 0,
  config: () => useUI.getState().avatar,
};
