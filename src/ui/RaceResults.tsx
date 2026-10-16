import { engine } from '../game/engine';
import { formatTime } from '../game/persistence';
import { BODY_COLORS } from '../game/palette';
import type { Standing } from '../net/protocol';
import { computeAwards, ordinal, sortStandings } from '../net/race';
import { net, useNet } from '../net/store';
import { AvatarThumb } from '../render/avatar/Avatar';

/** Connection state for an online race: shown while reconnecting, and when the connection is gone for good. */
export function NetBanner() {
  const status = useNet((s) => s.status);
  const error = useNet((s) => s.error);
  if (status === 'reconnecting') {
    return <div className="net-banner card" role="status">📶 Reconnecting… your run keeps going, and you will rejoin the race.</div>;
  }
  if (status === 'lost' || status === 'offline' || status === 'failed') {
    return (
      <div className="net-banner card lost" role="alert">
        <span>📶 Disconnected. {error ?? 'The race can no longer track you.'}</span>
        <button className="btn" onClick={() => { net.disconnect(); engine.startHub(); }}>Back to hub</button>
      </div>
    );
  }
  return null;
}

const outcomeText = (s: Standing): string => (s.outcome === 'qualified' ? formatTime(s.timeMs) : s.outcome === 'eliminated' ? 'Eliminated' : 'Did not finish');

/** Tabs on the results card for an online race: the race (default) or my own run. */
export function OnlineTabs({ tab, onTab }: { tab: 'race' | 'run'; onTab: (t: 'race' | 'run') => void }) {
  return (
    <div className="chips results-tabs" role="tablist" aria-label="Results">
      <button type="button" role="tab" className="chip" aria-selected={tab === 'race'} aria-checked={tab === 'race'} onClick={() => onTab('race')}>Race</button>
      <button type="button" role="tab" className="chip" aria-selected={tab === 'run'} aria-checked={tab === 'run'} onClick={() => onTab('run')}>My run</button>
    </div>
  );
}

/** Standings, podium and awards for the whole room. */
export default function RaceResults() {
  const standings = useNet((s) => s.standings);
  const stats = useNet((s) => s.stats);
  const finishes = useNet((s) => s.finishes);
  const room = useNet((s) => s.room);
  const meId = useNet((s) => s.meId);
  const sorted = standings ? sortStandings(standings) : null;
  const amHost = !!room && room.hostId === meId;
  const canAgain = room?.phase === 'over';

  if (!sorted) {
    const done = Object.entries(finishes).sort((a, b) => a[1].place - b[1].place);
    const players = room?.players ?? [];
    const name = (id: string) => (id === meId ? 'You' : players.find((p) => p.id === id)?.name ?? 'Player');
    return (
      <div className="race-results">
        <NetBanner />
        <h2 className="rr-wait">Waiting for the others…</h2>
        <ol className="rr-list">
          {done.map(([id, f]) => (
            <li key={id} className={id === meId ? 'me' : ''}>
              <span className="rr-place">{f.place}</span><span className="rr-name">{name(id)}</span>
              <span className="rr-time">{f.outcome === 'qualified' ? formatTime(f.timeMs) : 'Eliminated'}</span>
            </li>
          ))}
        </ol>
        <p className="topic-note">{players.length - done.length} still racing. The final standings appear when everyone is done.</p>
        <div className="row rr-actions"><button className="btn" onClick={() => { net.leaveRoom(); engine.startHub(); }}>Back to hub</button></div>
      </div>
    );
  }

  const awards = computeAwards(sorted, stats);
  const me = sorted.find((s) => s.id === meId);
  const podium = sorted.slice(0, 3);
  // classic podium order: 2nd, 1st, 3rd
  const slots = [podium[1], podium[0], podium[2]].filter((p): p is Standing => !!p);
  const nameOf = (id: string) => sorted.find((s) => s.id === id)?.name ?? '';
  return (
    <div className="race-results">
      <NetBanner />
      <h2 className="rr-title">{me ? (me.place === 1 && me.outcome === 'qualified' ? 'You won!' : `You finished ${ordinal(me.place)}`) : 'Race over'}</h2>
      <div className="podium" aria-label="Podium">
        {slots.map((p) => (
          <div key={p.id} className={`pod pod-${p.place}`}>
            <AvatarThumb config={p.avatar} size={p.place === 1 ? 92 : 76} spin={p.place === 1} />
            <div className="pod-name">{p.name}{p.id === meId ? ' (you)' : ''}</div>
            <div className="pod-block" style={{ background: BODY_COLORS[p.avatar.body] }}><span>{p.place}</span></div>
          </div>
        ))}
      </div>

      {awards.length > 0 && (
        <ul className="awards" aria-label="Awards">
          {awards.map((a) => (
            <li key={a.id} className="award">
              <span className="aw-icon" aria-hidden="true">{a.icon}</span>
              <span><b>{a.title}</b>: {nameOf(a.playerId)}{a.playerId === meId ? ' (you)' : ''}<br /><small>{a.note}</small></span>
            </li>
          ))}
        </ul>
      )}

      <ol className="rr-list" aria-label="Standings">
        {sorted.map((s) => (
          <li key={s.id} className={s.id === meId ? 'me' : ''}>
            <span className="rr-place">{s.place}</span>
            <span className="rr-dot" style={{ background: BODY_COLORS[s.avatar.body] }} />
            <span className="rr-name">{s.name}{s.id === meId ? ' (you)' : ''}</span>
            <span className="rr-acc">✓ {s.correct}/{s.asked}</span>
            <span className="rr-time">{outcomeText(s)}</span>
          </li>
        ))}
      </ol>

      <div className="row rr-actions">
        {amHost && <button className="btn primary" autoFocus disabled={!canAgain} onClick={() => net.startRace()}>Race again</button>}
        {!amHost && <span className="topic-note">{canAgain ? 'Waiting for the host to start another race…' : ''}</span>}
        <button className="btn" onClick={() => { net.leaveRoom(); engine.startHub(); }}>Back to hub</button>
      </div>
    </div>
  );
}
