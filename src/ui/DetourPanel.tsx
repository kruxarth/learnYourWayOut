import ReportButton from './ReportButton';
import { useUI } from './store';

export default function DetourPanel() {
  const d = useUI((s) => s.detour);
  const custom = useUI((s) => s.selection?.domainId === 'custom');
  if (!d) return null;
  return (
    <div className="detour-panel card" role="region" aria-label="Detour">
      <div className="title">DETOUR</div>
      <div className={`line${d.nearBoard === 'A' ? ' hl' : ''}`}><strong>The answer was:</strong> {d.correct}</div>
      <div className={`line${d.nearBoard === 'A' ? ' hl' : ''}`}>{d.explanation}</div>
      <div className={`line${d.nearBoard === 'B' ? ' hl' : ''}`}><strong>Worked example:</strong> {d.workedExample}</div>
      {d.retryPrompt && <div className="retry">Try this one: {d.retryPrompt.replace(/`/g, '')}</div>}
      {d.retryFeedback && <div className="wrong">✗ {d.retryFeedback}</div>}
      {custom && d.questionId && <ReportButton key={d.questionId} questionId={d.questionId} />}
    </div>
  );
}
