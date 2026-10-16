import { useState } from 'react';
import type { AvatarConfig } from '../game/avatar';
import { dailySelection } from '../game/daily';
import { engine } from '../game/engine';
import { formatTime } from '../game/persistence';
import { newSeed } from '../game/rng';
import type { Difficulty } from '../game/types';
import { questionSource } from '../content/source';
import { net } from '../net/store';
import { AvatarThumb } from '../render/avatar/Avatar';
import { ROOM_INFO } from './roomInfo';
import RaceResults, { OnlineTabs } from './RaceResults';
import ReportButton from './ReportButton';
import { useUI } from './store';

const SLOT_WORD = { body: 'colour', eyes: 'eyes', mouth: 'mouth', hat: 'hat', extra: 'extra' } as const;

const NEXT: Record<Difficulty, Difficulty | null> = { easy: 'normal', normal: 'hard', hard: null };

/** Seconds the earlier best was ahead of this run, one decimal. */
function formatDelta(prevMs: number | null, timeMs: number): string {
  return prevMs === null ? '0.0' : ((timeMs - prevMs) / 1000).toFixed(1);
}

export default function ResultsCard() {
  const r = useUI((s) => s.results);
  const unlocks = useUI((s) => s.newUnlocks);
  const avatar = useUI((s) => s.avatar);
  const daily = useUI((s) => s.dailyOutcome);
  const [tab, setTab] = useState<'race' | 'run'>('race');
  if (!r) return null;
  const sel = r.selection;
  const pack = questionSource.getPack(sel.domainId);
  const asked = r.mastery.reduce((n, m) => n + m.asked, 0);
  const correct = r.mastery.reduce((n, m) => n + m.correct, 0);
  const route = r.route === 'short' ? 'Shortcut' : r.route === 'long' ? 'Scenic' : '—';
  const q = r.outcome === 'qualified';
  const isDaily = sel.mode === 'daily';
  const online = sel.mode === 'online';
  const harder = isDaily || online ? null : NEXT[sel.difficulty];

  const run = (patch: Partial<typeof sel>) => engine.startRun({ domainId: sel.domainId, difficulty: sel.difficulty, seed: newSeed(), ...(sel.mode ? { mode: sel.mode } : {}), ...patch });

  if (online && tab === 'race') {
    return (
      <div className="results-back" role="dialog" aria-modal="true" aria-label="Race results">
        <div className="results card">
          <OnlineTabs tab={tab} onTab={setTab} />
          <RaceResults />
        </div>
      </div>
    );
  }

  return (
    <div className="results-back" role="dialog" aria-modal="true" aria-label="Results">
      <div className="results card">
        {online && <OnlineTabs tab={tab} onTab={setTab} />}
        <h1 className={`banner-t big-title ${q ? 'q' : 'e'}`}>{q ? 'QUALIFIED!' : 'ELIMINATED'}</h1>
        <div className="stars" aria-label={`${r.stars} of 3 stars`}>
          {[1, 2, 3].map((i) => <span key={i} className={i <= r.stars ? 'on' : 'off'}>★</span>)}
        </div>
        <div className="statrow">
          <span className="stat-chip" title="Third star: qualify within par time">⏱ {formatTime(r.timeMs)} / par {formatTime(r.parMs)}</span>
          <span className="stat-chip">✓ {correct}/{asked}</span>
          <span className="stat-chip">🪙 {r.coinsCollected}</span>
          <span className="stat-chip">{route}</span>
          <span className="stat-chip domain" style={{ background: pack.color }}>{pack.name}</span>
          <span className="stat-chip">{sel.mode === 'gauntlet' ? 'GAUNTLET' : sel.difficulty.toUpperCase()}</span>
        </div>

        {isDaily && daily && q && (
          <div className="unlock-card" role="status">
            <span>
              {daily.newBest ? 'New daily best!' : `Ghost was ${((formatDelta(daily.previousBestMs, r.timeMs)))} s faster`}
              {daily.streak > 0 && ` · 🔥 ${daily.streak} day${daily.streak === 1 ? '' : 's'}`}
            </span>
          </div>
        )}

        {unlocks.slice(0, 3).map((u) => (
          <div className="unlock-card" key={`${u.slot}:${u.id}`} role="status">
            <AvatarThumb config={{ ...avatar, [u.slot]: u.id } as AvatarConfig} size={64} />
            <span>New {SLOT_WORD[u.slot]} unlocked: {u.name}!</span>
            <button className="btn" onClick={() => { engine.startHub(); useUI.setState({ wardrobeOpen: true }); }}>Try it on</button>
          </div>
        ))}
        {r.breakdown && r.breakdown.length > 0 && (
          <>
            <h3 style={{ margin: '8px 0 6px', fontSize: 14, letterSpacing: '0.08em', color: '#6a6e8f' }}>ROOMS</h3>
            <ul className="review">
              {r.breakdown.map((b, i) => (
                <li key={i}>
                  <div className="q">{ROOM_INFO[b.kind].icon} {ROOM_INFO[b.kind].name} · {formatTime(b.timeMs)} · ✓ {b.correct}/{b.asked}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {r.mastery.length > 0 && (
          <>
            <h3 style={{ margin: '8px 0 6px', fontSize: 14, letterSpacing: '0.08em', color: '#6a6e8f' }}>MASTERY</h3>
            <div className="mastery">
              {r.mastery.map((m) => {
                const frac = m.correct / m.asked;
                const color = frac < 0.5 ? '#FF5A6E' : frac < 1 ? '#FFC93C' : '#3DDC84';
                return (
                  <div key={m.conceptId}>
                    <div className="m-label"><span>{m.name}</span><span>{m.correct}/{m.asked}{frac === 1 ? ' ✓' : ''}</span></div>
                    <div className="m-bar"><div style={{ width: `${Math.max(4, frac * 100)}%`, background: color }} /></div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {r.review.length > 0 && (
          <>
            <h3 style={{ margin: '12px 0 6px', fontSize: 14, letterSpacing: '0.08em', color: '#6a6e8f' }}>REVIEW</h3>
            <ul className="review">
              {r.review.map((it, i) => (
                <li key={i}>
                  <div className="q">✗ {it.prompt.replace(/`/g, '')}</div>
                  <div className="a">✓ {it.answerText}</div>
                  <div className="x">{it.explanation}</div>
                  {sel.domainId === 'custom' && it.questionId && <ReportButton key={it.questionId} questionId={it.questionId} />}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="row" style={{ justifyContent: 'center' }}>
          {isDaily && (
            <button className="btn primary" autoFocus onClick={() => engine.startRun(dailySelection())}>Race your ghost</button>
          )}
          {!isDaily && !online && r.weakConcepts.length > 0 && (
            <button className="btn primary" autoFocus onClick={() => run({ focusConcepts: r.weakConcepts })}>Run my weak spots</button>
          )}
          {!isDaily && !online && r.weakConcepts.length === 0 && harder && (
            <button className="btn primary" autoFocus onClick={() => run({ difficulty: harder })}>Try a harder maze</button>
          )}
          {!isDaily && !online && <button className="btn" onClick={() => run({})}>Play again</button>}
          <button className="btn" onClick={() => { if (online) net.leaveRoom(); engine.startHub(); }}>Back to hub</button>
        </div>
      </div>
    </div>
  );
}
