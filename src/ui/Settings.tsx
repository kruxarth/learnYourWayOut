import { T } from '../game/tuning';
import { useUI } from './store';

export default function Settings({ onClose }: { onClose?: () => void }) {
  const s = useUI((st) => st.settings);
  const set = (patch: Partial<typeof s>) => useUI.setState({ settings: { ...s, ...patch } });
  return (
    <div>
      <h3>SETTINGS</h3>
      <label className="setting">Volume
        <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => set({ volume: Number(e.target.value) })} aria-label="Volume" />
      </label>
      <label className="setting">Mute (M)
        <input type="checkbox" checked={s.muted} onChange={(e) => set({ muted: e.target.checked })} />
      </label>
      <label className="setting">Read questions aloud
        <input type="checkbox" checked={s.readAloud} onChange={(e) => set({ readAloud: e.target.checked })} />
      </label>
      <label className="setting">Relaxed timers (×{T.RELAXED_TIMER_MULT})
        <input type="checkbox" checked={s.relaxedTimers} onChange={(e) => set({ relaxedTimers: e.target.checked })} />
      </label>
      <label className="setting">Hex Finale as the last room
        <input type="checkbox" checked={s.finale === 'hex'} onChange={(e) => set({ finale: e.target.checked ? 'hex' : 'gate' })} />
      </label>
      <label className="setting">Reduced motion
        <input type="checkbox" checked={s.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} />
      </label>
      <label className="setting">Show minimap
        <input type="checkbox" checked={s.showMinimap} onChange={(e) => set({ showMinimap: e.target.checked })} />
      </label>
      <label className="setting">Camera sensitivity
        <input type="range" min={0.4} max={2} step={0.1} value={s.camSens} onChange={(e) => set({ camSens: Number(e.target.value) })} aria-label="Camera sensitivity" />
      </label>
      {onClose && <div className="row"><button className="btn" onClick={onClose}>Done</button></div>}
    </div>
  );
}
