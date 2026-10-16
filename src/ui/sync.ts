import { accuracy } from '../game/loop/evaluation';
import { POWER_KINDS, canUsePowerup, comboSpeedMult } from '../game/loop/powerups';
import { canFiftyRoom } from '../game/loop/progression';
import type { RunState } from '../game/runtime';
import type { PowerKind } from '../game/types';
import { useUI, type RoomPanel } from './store';

/** Write the HUD numbers to the store (called at 10 Hz and on discrete events). */
export function syncHud(run: RunState): void {
  const acc = accuracy(run.records);
  const room = run.activeRoomId ? run.roomMap.get(run.activeRoomId) : null;
  const fiftyOk = !!room && room.state === 'active' && !room.fiftyUsed && canFiftyRoom(room);
  const usable = {} as Record<PowerKind, boolean>;
  for (const k of POWER_KINDS) usable[k] = canUsePowerup(run, k, fiftyOk);
  useUI.setState({
    hud: {
      slime: run.slime, coins: run.coins, elapsedMs: run.elapsedMs, asked: acc.asked, correct: acc.correct,
      tier: run.tier, zone: run.zone,
      combo: run.combo, speedPct: Math.round((comboSpeedMult(run) - 1) * 100),
      powerups: { ...run.powerups }, usable, freezeT: run.freezeT, compassT: run.compassT,
      shield: run.shield,
      lantern: run.lanternSeg >= 0 && run.lanternSeg === run.segIndex,
    },
  });
}

export function setRoomPanel(panel: RoomPanel | null): void {
  useUI.setState({ room: panel });
}
