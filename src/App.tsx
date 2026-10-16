import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { validatePacks } from './content/validate';
import { questionSource } from './content/source';
import { engine } from './game/engine';
import { input } from './game/input';
import { saveSettings } from './game/persistence';
import { newSeed } from './game/rng';
import { T } from './game/tuning';
import { params } from './game/urlParams';
import { sfx } from './audio/sfx';
import Scene from './render/Scene';
import Banner from './ui/Banner';
import DebugOverlay from './ui/DebugOverlay';
import FadeLayer from './ui/FadeLayer';
import Hud from './ui/Hud';
import HubOverlay from './ui/HubOverlay';
import { LeaveRace } from './ui/Lobby';
import PauseMenu from './ui/PauseMenu';
import ResultsCard from './ui/ResultsCard';
import { useUI } from './ui/store';
import Toasts from './ui/Toasts';
import TouchControls from './ui/TouchControls';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function App() {
  const isTouch = useUI((s) => s.isTouch);
  const screen = useUI((s) => s.screen);
  const contentErrors = useUI((s) => s.contentErrors);
  const [ready, setReady] = useState(false);
  const [gl] = useState(webglAvailable);

  useEffect(() => {
    engine.init();
    if (import.meta.env.DEV) {
      const errs = validatePacks(questionSource.allPacks());
      if (errs.length) { console.error('Content errors:\n' + errs.join('\n')); useUI.setState({ contentErrors: errs.length }); }
    }
    if (params.arena) engine.startArena();
    else if (params.demo || params.domain || params.difficulty) {
      engine.startRun({
        domainId: params.domain ?? 'math',
        difficulty: params.difficulty ?? 'normal',
        seed: params.seed ?? (params.demo ? 4242 : newSeed()),
      });
    } else engine.startHub();
    // blur clicked buttons so Space keeps meaning "jump"
    const blur = (e: Event) => { if (e.target instanceof HTMLButtonElement && !e.target.closest('.modal')) e.target.blur(); };
    document.addEventListener('click', blur);
    setReady(true);
    return () => document.removeEventListener('click', blur);
  }, []);

  // apply and persist settings
  const settings = useUI((s) => s.settings);
  useEffect(() => {
    sfx.applySettings(settings.volume, settings.muted);
    input.setSensitivity(settings.camSens);
    saveSettings(settings);
  }, [settings]);

  if (!gl) return <div className="nogl">This game needs WebGL. Try Chrome or Edge.</div>;

  return (
    <>
      {ready && (
        <Canvas
          shadows={isTouch ? false : 'percentage'}
          flat
          dpr={isTouch ? [1, 1.25] : [1, 1.75]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: T.CAM_FOV, near: 0.1, far: 300, position: [0, 8, 10] }}
        >
          <Scene />
        </Canvas>
      )}
      <div className="ui">
        {screen === 'hub' && <HubOverlay />}
        {screen !== 'hub' && <Hud />}
        <Toasts />
        <Banner />
        {params.debug && <DebugOverlay />}
      </div>
      <PauseMenu />
      <LeaveRace />
      <FadeLayer />
      {screen === 'results' && <ResultsCard />}
      {isTouch && <TouchControls />}
      {contentErrors > 0 && <div className="content-errors">Content errors: {contentErrors} (see console)</div>}
    </>
  );
}
