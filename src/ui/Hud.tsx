import { useUI } from './store';
import DetourPanel from './DetourPanel';
import LifelineBar from './LifelineBar';
import PowerBar from './PowerBar';
import Minimap from './Minimap';
import QuestionPanel from './QuestionPanel';
import SlimeMeter from './SlimeMeter';
import StatsBar from './StatsBar';
import UpAhead from './UpAhead';
import { engine } from '../game/engine';
import EmoteBar from './EmoteBar';
import { NetBanner } from './RaceResults';
import RaceStrip from './RaceStrip';

/** In-run HUD (spec §18.2). */
export default function Hud() {
  const showMinimap = useUI((s) => s.settings.showMinimap);
  const runId = useUI((s) => s.runId);
  const tip = useUI((s) => s.tip);
  const isTouch = useUI((s) => s.isTouch);
  const online = engine.run?.selection.mode === 'online' && runId >= 0;
  return (
    <>
      <StatsBar />
      <UpAhead />
      <SlimeMeter />
      <QuestionPanel />
      <DetourPanel />
      {showMinimap && <Minimap key={runId} />}
      {online && <NetBanner />}
      {online && <RaceStrip />}
      {online && <EmoteBar />}
      <button className="btn pause-btn" aria-label="Pause" onClick={() => (online ? useUI.setState({ leaveMenuOpen: true }) : engine.setPaused(true))}>⏸</button>
      {!isTouch && <LifelineBar />}
      <PowerBar />
      {tip && <div className="tip card">💡 {tip}</div>}
    </>
  );
}
