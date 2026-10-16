import { questionSource } from '../content/source';
import { engine } from '../game/engine';
import { useUI } from './store';

function Squares({ placed, total }: { placed: number; total: number }) {
  return <span className="progress-squares" aria-label={`${placed} of ${total} placed`}>{'■'.repeat(placed)}{'□'.repeat(total - placed)}</span>;
}

export default function QuestionPanel() {
  const room = useUI((s) => s.room);
  const custom = useUI((s) => s.selection?.domainId === 'custom');
  if (!room) return null;
  const gen = custom && questionSource.hasCustomPack() ? questionSource.getPack('custom').generated : undefined;
  const t = room.timer;
  const frac = t && t.total > 0 ? Math.max(0, Math.min(1, t.remaining / t.total)) : 1;
  const color = frac > 0.5 ? '#3DDC84' : frac > 0.25 ? '#FFC93C' : '#FF5A6E';
  return (
    <div className="question card" role="region" aria-label="Question">
      <div className="head">
        <span className="title">{room.title}</span>
        <span className="sub">
          {room.subtitle.replace(' · THINK ZONE', '').replace(' · SLIME ×2', '')}
          {room.think && <span className="badge">THINK ZONE</span>}
          {room.boss && <span className="badge boss">SLIME ×2</span>}
          {gen && <span className="badge ai">{gen.model === 'hand-written' ? '✨ Example pack' : '✨ AI-made'}</span>}
        </span>
      </div>
      <div className="prompt">{room.prompt.replace(/`/g, '')}</div>
      {t && (
        <div className="timer-bar" aria-label="Time left"><div style={{ width: `${frac * 100}%`, background: color }} /></div>
      )}
      {room.steps && (
        <div className="working">
          <strong>Step {room.steps.index} of {room.steps.total}</strong>
          {room.steps.working.map((w, i) => <span key={i}><span className="step-pill">{w}</span>{i < room.steps!.working.length - 1 ? ' → ' : ''}</span>)}
        </div>
      )}
      {room.bridge && (
        <div className="working">
          <Squares placed={room.bridge.placed} total={room.bridge.total} />
          <span>{room.bridge.carrying ? `Carrying: ${room.bridge.carrying}` : 'Pick up a block'}</span>
        </div>
      )}
      {room.gold && (
        <div className="gold-options" role="group" aria-label="Answers">
          {room.gold.options.map((o, i) => (
            <button
              key={i} className={`btn gold-opt ${o.state}`} disabled={room.gold!.done}
              onClick={() => engine.answerGold(i)} aria-label={`Answer ${i + 1}: ${o.label}`}
            >
              <kbd>{i + 1}</kbd> {o.label}
            </button>
          ))}
        </div>
      )}
      {room.hint && <div className="hint">💡 {room.hint}</div>}
      {room.feedback && <div className={`feedback ${room.feedback.tone}`}>{room.feedback.tone === 'good' ? '✓ ' : '✗ '}{room.feedback.text}</div>}
      <div className="footer">{room.footer}</div>
    </div>
  );
}
