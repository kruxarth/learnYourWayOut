import { questionSource } from '../content/source';
import { formatTime } from '../game/persistence';
import { useUI } from './store';

export default function StatsBar() {
  const sel = useUI((s) => s.selection);
  const hud = useUI((s) => s.hud);
  if (!sel) return null;
  const pack = questionSource.getPack(sel.domainId);
  const weak = sel.focusConcepts?.map((id) => pack.concepts.find((c) => c.id === id)?.name ?? id);
  return (
    <div className="stats" role="status" aria-label="Run stats">
      <span className="stat-chip domain" style={{ background: pack.color }}>{pack.name}</span>
      <span className="stat-chip">{sel.difficulty.toUpperCase()}</span>
      <span className="stat-chip" aria-label="Time">⏱ {formatTime(hud.elapsedMs)}</span>
      <span className="stat-chip" aria-label="Coins">🪙 {hud.coins}</span>
      <span className="stat-chip" aria-label="Accuracy">✓ {hud.correct}/{hud.asked}</span>
      <span className="stat-chip">Tier {hud.tier}</span>
      {hud.combo >= 2 && <span className="stat-chip combo" aria-label="Combo">🔥 ×{hud.combo}</span>}
      {weak && weak.length > 0 && <span className="stat-chip weak">Weak-spot run: {weak.join(', ')}</span>}
    </div>
  );
}
