import { engine } from '../game/engine';
import { roomIcon } from './roomInfo';
import { useUI } from './store';

/** "Up ahead" strip shown during the 3-2-1 countdown: one icon per room on the course. */
export default function UpAhead() {
  const banner = useUI((s) => s.banner);
  const runId = useUI((s) => s.runId);
  const run = engine.run;
  if (!run || !banner || run.phase !== 'countdown') return null;
  const lane = 'short';
  const icons = run.course.segments
    .filter((s) => s.roomId && (s.lane === 'main' || s.lane === lane))
    .map((s) => ({ icon: roomIcon(s.kind), kind: s.kind }))
    .filter((x): x is { icon: string; kind: typeof x.kind } => !!x.icon);
  return (
    <div className="up-ahead card" key={runId} role="status" aria-label="Rooms on this course">
      <span className="up-ahead-t">UP AHEAD</span>
      {icons.map((x, i) => <span key={i} className="up-ahead-i" title={x.kind}>{x.icon}</span>)}
    </div>
  );
}
