import { engine } from '../game/engine';
import { T } from '../game/tuning';
import { useUI } from './store';

export default function LifelineBar() {
  const room = useUI((s) => s.room);
  const coins = useUI((s) => s.hud.coins);
  const fiftyShake = useUI((s) => s.fiftyShake);
  const hintShake = useUI((s) => s.hintShake);
  const detour = useUI((s) => s.detour);
  const available = !!room && !detour;
  return (
    <div className="lifelines">
      <button
        key={`f${fiftyShake}`} className={`btn gold${fiftyShake ? ' shake' : ''}`} disabled={!available || !room.canFifty || room.fiftyUsed}
        onClick={() => engine.useLifeline('fifty')} aria-label={`50/50, key Q, costs ${T.COST_FIFTY} coins`}
      >
        50/50 (Q) · {T.COST_FIFTY}🪙
      </button>
      <button
        key={`h${hintShake}`} className={`btn gold${hintShake ? ' shake' : ''}`} disabled={!available || !room.canHint || room.hintUsed}
        onClick={() => engine.useLifeline('hint')} aria-label={`Hint, key E, costs ${T.COST_HINT} coins`}
      >
        Hint (E) · {T.COST_HINT}🪙
      </button>
      {coins < T.COST_HINT && available && <span className="stat-chip">Explore dead ends for coins!</span>}
    </div>
  );
}
