import { engine } from '../game/engine';
import { POWER_KEYS, POWER_KINDS, POWER_NAMES } from '../game/loop/powerups';
import { T } from '../game/tuning';
import type { PowerKind } from '../game/types';
import { useUI } from './store';

const ICON: Record<PowerKind, string> = { lantern: '🏮', compass: '🧭', freeze: '❄️', xray: '🔍', shield: '🛡️' };
const HELP: Record<PowerKind, string> = {
  lantern: `see ${T.LANTERN_BONUS} m further in this maze`,
  compass: `arrow to the maze exit for ${T.COMPASS_TIME} s`,
  freeze: `stop the slime for ${T.FREEZE_TIME} s`,
  xray: 'free 50/50 on this question',
  shield: 'blocks the next hazard hit',
};

/** Knowledge Power-Ups (P2-A): earned every 3 first-try answers in a row; keys 1–5 or tap. */
export default function PowerBar() {
  const hud = useUI((s) => s.hud);
  const owned = POWER_KINDS.filter((k) => hud.powerups[k] > 0);
  const active: string[] = [];
  if (hud.freezeT > 0) active.push(`❄️ ${Math.ceil(hud.freezeT)} s`);
  if (hud.compassT > 0) active.push(`🧭 ${Math.ceil(hud.compassT)} s`);
  if (hud.lantern) active.push('🏮 lit');
  if (hud.shield) active.push('🛡️ armed');
  const next = T.COMBO_FOR_POWERUP - (hud.combo % T.COMBO_FOR_POWERUP);
  if (!owned.length && !active.length && hud.combo === 0) return null;
  return (
    <div className="powerbar" aria-label="Power-ups">
      {hud.combo > 0 && (
        <span className="stat-chip combo" title={`${next} more in a row for a power-up`}>
          🔥 {hud.combo} in a row{hud.speedPct > 0 ? ` · +${hud.speedPct}% speed` : ''}
        </span>
      )}
      {owned.map((k) => (
        <button
          key={k} className="btn gold power" disabled={!hud.usable[k]} onClick={() => engine.activatePowerup(k)}
          title={`${POWER_NAMES[k]}: ${HELP[k]}`} aria-label={`${POWER_NAMES[k]}, key ${POWER_KEYS[k]}: ${HELP[k]}`}
        >
          {ICON[k]} {POWER_NAMES[k]}{hud.powerups[k] > 1 ? ` ×${hud.powerups[k]}` : ''} <kbd>{POWER_KEYS[k]}</kbd>
        </button>
      ))}
      {active.map((a) => <span key={a} className="stat-chip active">{a}</span>)}
    </div>
  );
}
