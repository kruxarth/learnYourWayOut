import { useEffect, useState } from 'react';
import { BODY_COLORS } from '../game/palette';
import { ordinal, rankRacers, type Racer } from '../net/race';
import { localProgress, remotes, useNet } from '../net/store';
import { useUI } from './store';

/** Everyone in the race as `Racer`s (read from the plain `remotes` map and `useNet`, not React state). */
function collect(myColor: string): Racer[] {
  const { finishes, meId } = useNet.getState();
  const out: Racer[] = [];
  if (meId) {
    const f = finishes[meId];
    out.push({
      id: meId, name: 'You', me: true, color: myColor, solved: localProgress.solved, seg: localProgress.seg,
      outcome: f?.outcome ?? null, finishMs: f?.timeMs ?? 0, connected: true,
    });
  }
  for (const r of remotes.values()) {
    const f = finishes[r.id];
    out.push({
      id: r.id, name: r.name, me: false, color: BODY_COLORS[r.avatar.body], solved: r.last?.solved ?? 0, seg: r.last?.seg ?? 0,
      outcome: f?.outcome ?? null, finishMs: f?.timeMs ?? 0, connected: r.connected,
    });
  }
  return rankRacers(out);
}

const sameRows = (a: Racer[], b: Racer[]): boolean => a.length === b.length
  && a.every((x, i) => { const y = b[i]; return x.id === y.id && x.solved === y.solved && x.seg === y.seg && x.outcome === y.outcome && x.connected === y.connected && x.name === y.name; });

/** Live standings during an online race: sorted by progress, collapsing to "You: 3rd / 6" on small screens (tap to expand). */
export default function RaceStrip() {
  const total = useNet((s) => s.totalRooms);
  const avatar = useUI((s) => s.avatar);
  const myColor = BODY_COLORS[avatar.body];
  const [rows, setRows] = useState<Racer[]>(() => collect(myColor));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const tick = () => setRows((prev) => { const next = collect(myColor); return sameRows(prev, next) ? prev : next; });
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [myColor]);
  if (rows.length < 2) return null;
  const place = rows.findIndex((r) => r.me) + 1;
  return (
    <button type="button" className={`race-strip card${open ? ' open' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}
      aria-label={`Race standings, you are ${ordinal(place)} of ${rows.length}`}>
      <div className="rs-sum">You: {ordinal(place)} / {rows.length}</div>
      <ol className="rs-rows">
        {rows.map((r, i) => (
          <li key={r.id} className={r.me ? 'me' : ''}>
            <span className="rs-place">{i + 1}</span>
            <span className="rs-dot" style={{ background: r.color }} />
            <span className="rs-name">{r.name}</span>
            <span className="rs-bar" aria-hidden="true"><span style={{ width: `${total > 0 ? Math.min(100, (r.solved / total) * 100) : 0}%`, background: r.color }} /></span>
            <span className="rs-icon">{r.outcome === 'qualified' ? '✓' : r.outcome === 'eliminated' ? '💀' : !r.connected ? '⏸' : ''}</span>
          </li>
        ))}
      </ol>
    </button>
  );
}
