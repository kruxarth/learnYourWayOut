import { useState } from 'react';
import { engine } from '../game/engine';
import Controls from './Controls';
import Settings from './Settings';
import { useUI } from './store';

export default function PauseMenu() {
  const paused = useUI((s) => s.paused);
  const [showSettings, setShowSettings] = useState(false);
  if (!paused) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Paused">
      <div className="modal card">
        <h2>Paused</h2>
        <div className="row" style={{ marginTop: 0 }}>
          <button className="btn primary" autoFocus onClick={() => engine.setPaused(false)}>Resume</button>
          <button className="btn" onClick={() => engine.restartRun()}>Restart run</button>
          <button className="btn" onClick={() => engine.startHub()}>Back to hub</button>
          <button className="btn" onClick={() => setShowSettings((v) => !v)}>Settings</button>
        </div>
        {showSettings ? <Settings onClose={() => setShowSettings(false)} /> : (<><h3>CONTROLS</h3><Controls /></>)}
      </div>
    </div>
  );
}
