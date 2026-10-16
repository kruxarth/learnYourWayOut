import { useEffect, useMemo, useRef, useState } from 'react';
import type { DomainPack } from '../content/schema';
import { loadRecent } from '../content/customStore';
import { EXAMPLE_PACKS } from '../content/examples';
import { questionSource } from '../content/source';
import { engine } from '../game/engine';
import { T } from '../game/tuning';
import type { Difficulty, DomainId } from '../game/types';
import { net, useNet } from '../net/store';
import { CODE_LENGTH, MAX_ROOM_PLAYERS, normalizeCode } from '../net/protocol';
import { AvatarThumb } from '../render/avatar/Avatar';
import { useUI } from './store';

const LEVELS: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Easy' }, { id: 'normal', label: 'Normal' }, { id: 'hard', label: 'Hard' },
];

interface Choice { key: string; label: string; domainId: DomainId; pack?: DomainPack; level?: Difficulty }

/** What a host can race on: the built-in domains, plus recent and example Any Topic packs (they travel with the room). */
function choices(): Choice[] {
  const out: Choice[] = questionSource.listDomains().map((d) => ({ key: d.id, label: d.name, domainId: d.id }));
  const seen = new Set<string>();
  for (const pack of loadRecent()) {
    const k = pack.generated?.packKey ?? pack.name;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `r:${k}`, label: `${pack.name} (AI)`, domainId: 'custom', pack });
  }
  for (const ex of EXAMPLE_PACKS) {
    if (!seen.has(ex.pack.generated?.packKey ?? ex.label)) out.push({ key: `x:${ex.label}`, label: `${ex.label} (example)`, domainId: 'custom', pack: ex.pack, level: ex.level });
  }
  return out;
}

export default function Lobby() {
  const open = useUI((s) => s.lobbyOpen);
  if (!open) return null;
  return <LobbyPanel />;
}

function close(): void { useUI.setState({ lobbyOpen: false }); }

function LobbyPanel() {
  const status = useNet((s) => s.status);
  const serverUp = useNet((s) => s.serverUp);
  const room = useNet((s) => s.room);
  const error = useNet((s) => s.error);
  const playerName = useUI((s) => s.playerName);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void net.checkServer().then((up) => { if (live && up && useUI.getState().playerName) net.connect(); });
    return () => { live = false; };
  }, []);
  // a name chosen while the panel is open connects too
  useEffect(() => { if (playerName && serverUp && status === 'offline') net.connect(); }, [playerName, serverUp, status]);

  const noRoom = room === null;
  useEffect(() => { root.current?.querySelector<HTMLElement>('input, button.primary')?.focus(); }, [noRoom]);

  const body = (() => {
    if (serverUp === null) return <p role="status">Looking for the game server…</p>;
    if (serverUp === false) {
      return (
        <p className="topic-error" role="alert">
          Online races need the game server. Run <code>npm run server</code> on one laptop and open the game from there. Solo play works without it.
        </p>
      );
    }
    if (!playerName) {
      return (
        <>
          <p>Pick a name first, so your friends know who you are.</p>
          <div className="row"><button className="btn primary" onClick={() => useUI.setState({ namePromptOpen: true })}>Choose a name</button></div>
        </>
      );
    }
    if (status === 'failed' || status === 'lost') {
      return (
        <>
          <p className="topic-error" role="alert">{error ?? 'Could not connect.'}</p>
          <div className="row"><button className="btn primary" onClick={() => net.connect()}>Try again</button></div>
        </>
      );
    }
    if (status !== 'online' && status !== 'reconnecting') return <p role="status">Connecting…</p>;
    return room ? <RoomView /> : <StartView />;
  })();

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Play online" onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <div className="modal card lobby" ref={root}>
        <h2>Play online</h2>
        {status === 'reconnecting' && <div className="topic-error" role="status">Reconnecting…</div>}
        {body}
        {error && status === 'online' && <div className="topic-error" role="alert">{error}</div>}
        <div className="row">
          <button className="btn" onClick={close}>{room ? 'Close (stay in room)' : 'Close (Esc)'}</button>
        </div>
      </div>
    </div>
  );
}

function StartView() {
  const list = useMemo(() => choices(), []);
  const [pick, setPick] = useState(list[0].key);
  const [level, setLevel] = useState<Difficulty>('normal');
  const [code, setCode] = useState('');
  const chosen = list.find((c) => c.key === pick) ?? list[0];
  return (
    <>
      <h3>CREATE A RACE</h3>
      <div className="chips" role="radiogroup" aria-label="Topic">
        {list.map((c) => (
          <button key={c.key} type="button" className="chip" role="radio" aria-checked={pick === c.key}
            onClick={() => { setPick(c.key); if (c.level) setLevel(c.level); }}>{c.label}</button>
        ))}
      </div>
      <div className="chips lobby-levels" role="radiogroup" aria-label="Difficulty">
        {LEVELS.map((l) => (
          <button key={l.id} type="button" className="chip" role="radio" aria-checked={level === l.id} onClick={() => setLevel(l.id)}>{l.label}</button>
        ))}
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => net.createRace(chosen.domainId, level, chosen.pack)}>Create race</button>
      </div>

      <h3>JOIN A RACE</h3>
      <form className="row lobby-join" onSubmit={(e) => { e.preventDefault(); if (code.length === CODE_LENGTH) net.joinRace(code); }}>
        <input
          className="topic-input lobby-code" type="text" inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false}
          maxLength={CODE_LENGTH} value={code} placeholder="CODE" aria-label="Room code"
          onChange={(e) => setCode(normalizeCode(e.target.value))}
        />
        <button className="btn primary" type="submit" disabled={code.length !== CODE_LENGTH}>Join</button>
      </form>
    </>
  );
}

function RoomView() {
  const room = useNet((s) => s.room)!;
  const meId = useNet((s) => s.meId);
  const lan = useNet((s) => s.lanUrls);
  const standings = useNet((s) => s.standings);
  const amHost = room.hostId === meId;
  const me = room.players.find((p) => p.id === meId);
  const everyoneReady = room.players.length >= 2 && room.players.every((p) => p.ready || !p.connected);
  // the host may start anyway once the lobby has been open for a while (the key makes the timer start over for a new race)
  const forceKey = `${room.code}:${room.phase}`;
  const [forceFor, setForceFor] = useState('');
  const forceOk = forceFor === forceKey;
  useEffect(() => {
    if (!amHost || room.phase !== 'lobby') return;
    const id = setTimeout(() => setForceFor(forceKey), T.NET_FORCE_START_MS);
    return () => clearTimeout(id);
  }, [amHost, room.phase, forceKey]);
  const here = typeof location !== 'undefined' ? location.origin : '';
  const urls = lan.length ? lan : [here];

  return (
    <>
      <div className="lobby-code-big" aria-label={`Room code ${room.code.split('').join(' ')}`}>{room.code}</div>
      <div className="topic-note">
        {room.domainId === 'custom' ? room.packName : questionSource.getPack(room.domainId).name} · {room.difficulty} · {room.players.length}/{MAX_ROOM_PLAYERS} players
      </div>
      <div className="topic-note">Friends on the same Wi-Fi open: {urls.join('  or  ')}</div>

      <ul className="lobby-players">
        {room.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'away'}>
            <AvatarThumb config={p.avatar} size={52} />
            <span className="name">{p.name}{p.id === meId ? ' (you)' : ''}{p.id === room.hostId ? ' 👑' : ''}</span>
            <span className="tick" aria-label={p.ready ? 'ready' : 'not ready'}>{!p.connected ? '📶' : p.ready ? '✓' : '…'}</span>
          </li>
        ))}
      </ul>

      {room.phase === 'lobby' && (
        <div className="row">
          <button className={`btn${me?.ready ? '' : ' primary'}`} onClick={() => net.setReady(!me?.ready)}>{me?.ready ? 'Not ready' : 'Ready!'}</button>
          {amHost && (
            <button className="btn primary" disabled={!everyoneReady && !forceOk} onClick={() => net.startRace()}
              title={everyoneReady ? '' : 'Needs 2 or more players, all ready'}>
              {everyoneReady || !forceOk ? 'Start race' : 'Start anyway'}
            </button>
          )}
          <button className="btn" onClick={() => net.leaveRoom()}>Leave</button>
        </div>
      )}
      {room.phase === 'over' && (
        <>
          <ol className="lobby-standings">
            {(standings ?? []).map((s) => (
              <li key={s.id}>{s.name} · {s.outcome === 'qualified' ? `qualified in ${(s.timeMs / 1000).toFixed(1)} s` : s.outcome === 'eliminated' ? 'eliminated' : 'did not finish'}</li>
            ))}
          </ol>
          <div className="row">
            {amHost && <button className="btn primary" onClick={() => net.startRace()}>Race again</button>}
            <button className="btn" onClick={() => net.leaveRoom()}>Leave</button>
          </div>
        </>
      )}
      {(room.phase === 'countdown' || room.phase === 'racing') && (
        <div className="row">
          <span className="topic-note">The race is on!</span>
          <button className="btn" onClick={() => { net.leaveRoom(); close(); }}>Leave</button>
        </div>
      )}
    </>
  );
}

/** The "Leave race?" menu. Online races cannot pause, so Esc opens this and the game keeps running behind it. */
export function LeaveRace() {
  const open = useUI((s) => s.leaveMenuOpen);
  if (!open) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Leave race?">
      <div className="modal card" style={{ width: 'min(420px, 100%)' }}>
        <h2>Leave race?</h2>
        <p>The race keeps going without you, and you will not finish.</p>
        <div className="row">
          <button className="btn primary" autoFocus onClick={() => useUI.setState({ leaveMenuOpen: false })}>Keep racing</button>
          <button className="btn" onClick={() => { useUI.setState({ leaveMenuOpen: false }); net.leaveRoom(); engine.startHub(); }}>Leave</button>
        </div>
      </div>
    </div>
  );
}
