import { useEffect, useMemo, useState } from 'react';
import { questionSource } from '../content/source';
import { dailySummary } from '../game/daily';
import { engine } from '../game/engine';
import { formatTime } from '../game/persistence';
import { net, useNet } from '../net/store';
import Lobby from './Lobby';
import QuickSelect from './QuickSelect';
import TopicPanel from './TopicPanel';
import Settings from './Settings';
import { useUI } from './store';
import Wardrobe, { NamePrompt } from './Wardrobe';

export default function HubOverlay() {
  const pad = useUI((s) => s.hubPad);
  const [hint, setHint] = useState(true);
  const [settings, setSettings] = useState(false);
  useEffect(() => { const id = setTimeout(() => setHint(false), 10000); return () => clearTimeout(id); }, []);
  // first launch: ask for a name once
  useEffect(() => { if (useUI.getState().playerName === null) useUI.setState({ namePromptOpen: true }); }, []);
  const serverUp = useNet((s) => s.serverUp);
  useEffect(() => { void net.checkServer(); }, []);
  const daily = useMemo(() => dailySummary(), []);
  const name = pad ? (pad.domainId === 'custom' ? 'Any Topic' : questionSource.getPack(pad.domainId).name) : '';
  return (
    <>
      <div className="hub-title big-title">LEARN YOUR WAY OUT</div>
      <div className="hub-sub">Walk onto a pad to start · Tab: Quick Select</div>
      <div className="hub-buttons">
        <button className="btn" onClick={() => useUI.setState({ quickSelectOpen: true, quickSelectGauntlet: false })}>Quick Select</button>
        <button className="btn" onClick={() => useUI.setState({ quickSelectOpen: true, quickSelectGauntlet: true })}>Gauntlet</button>
        <button className="btn" onClick={() => useUI.setState({ topicOpen: true })}>Any Topic</button>
        <button className="btn primary" onClick={() => engine.startDaily()} title="Same course for everyone today. Race your best-run ghost.">
          Daily · {questionSource.getPack(daily.domain).name}
          {daily.bestMs !== null && ` · best ${formatTime(daily.bestMs)}`}
          {daily.streak > 0 && ` · 🔥 ${daily.streak} day${daily.streak === 1 ? '' : 's'}`}
        </button>
        <button className="btn" onClick={() => useUI.setState({ wardrobeOpen: true })}>Wardrobe</button>
        <button className="btn" disabled={serverUp === false} onClick={() => useUI.setState({ lobbyOpen: true })}
          title={serverUp === false ? 'Online races need the game server (npm run server).' : 'Race friends on the same course'}>Play Online</button>
        <button className="btn" onClick={() => setSettings(true)}>Settings</button>
      </div>
      {hint && <div className="control-hint card">WASD / arrows to move · Space to jump · Drag mouse to look</div>}
      {pad && (
        <div className="pad-progress card" role="status">
          {name.toUpperCase()} · {pad.difficulty.toUpperCase()}
          <div className="bar"><div style={{ width: `${pad.progress * 100}%` }} /></div>
        </div>
      )}
      <QuickSelect />
      <Wardrobe />
      <NamePrompt />
      <TopicPanel />
      <Lobby />
      {settings && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label="Settings">
          <div className="modal card"><h2>Settings</h2><Settings onClose={() => setSettings(false)} /></div>
        </div>
      )}
    </>
  );
}
