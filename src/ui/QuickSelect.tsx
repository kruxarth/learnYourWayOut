import { useRef, useState } from 'react';
import { questionSource } from '../content/source';
import { engine } from '../game/engine';
import { newSeed } from '../game/rng';
import type { Difficulty, DomainId } from '../game/types';
import { useUI } from './store';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

export default function QuickSelect() {
  const open = useUI((s) => s.quickSelectOpen);
  const [domain, setDomain] = useState<DomainId>('math');
  const [diff, setDiff] = useState<Difficulty>('normal');
  const gauntletPreset = useUI((s) => s.quickSelectGauntlet);
  const [gauntlet, setGauntlet] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  if (!open) return null;
  const isGauntlet = gauntlet || gauntletPreset;
  const domains = questionSource.listDomains();

  const onKey = (e: React.KeyboardEvent) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    const els = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : i + 1;
    els[(next + els.length) % els.length]?.focus();
  };
  const start = () => {
    useUI.setState({ quickSelectOpen: false, quickSelectGauntlet: false });
    setGauntlet(false);
    engine.startRun(isGauntlet
      ? { domainId: domain, difficulty: 'normal', seed: newSeed(), mode: 'gauntlet' }
      : { domainId: domain, difficulty: diff, seed: newSeed() });
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Quick Select">
      <div className="modal card" ref={root} onKeyDown={onKey}>
        <h2>Quick Select</h2>
        <h3>DOMAIN</h3>
        <div className="chips" role="radiogroup" aria-label="Domain">
          {domains.map((d, i) => (
            <button key={d.id} className="chip" role="radio" aria-checked={domain === d.id} autoFocus={i === 0} onClick={() => setDomain(d.id)}>{d.name}</button>
          ))}
        </div>
        <h3>MODE</h3>
        <div className="chips" role="radiogroup" aria-label="Mode">
          <button className="chip" role="radio" aria-checked={!isGauntlet} onClick={() => { setGauntlet(false); useUI.setState({ quickSelectGauntlet: false }); }}>STANDARD</button>
          <button className="chip" role="radio" aria-checked={isGauntlet} onClick={() => setGauntlet(true)}>GAUNTLET: EVERY ROOM</button>
        </div>
        <h3>DIFFICULTY</h3>
        <div className="chips" role="radiogroup" aria-label="Difficulty">
          {DIFFS.map((d) => (
            <button key={d} className="chip" role="radio" aria-checked={isGauntlet ? d === 'normal' : diff === d} disabled={isGauntlet} onClick={() => setDiff(d)}>{d.toUpperCase()}</button>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={start}>Start</button>
          <button className="btn" onClick={() => useUI.setState({ quickSelectOpen: false, quickSelectGauntlet: false })}>Cancel (Esc)</button>
        </div>
      </div>
    </div>
  );
}
