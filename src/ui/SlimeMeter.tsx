import { T } from '../game/tuning';
import { useUI } from './store';

export default function SlimeMeter() {
  const slime = useUI((s) => s.hud.slime);
  const pct = Math.round(slime * 100);
  const danger = slime >= T.SLIME_DANGER;
  return (
    <div className={`slime-meter card${danger ? ' danger' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Slime level">
      <div className="label">SLIME</div>
      <div className="tube"><div className="fill" style={{ height: `${pct}%` }} /></div>
      <div className="pct">{pct}%{danger ? ' ⚠' : ''}</div>
    </div>
  );
}
