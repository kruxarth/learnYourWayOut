import { useState } from 'react';
import { customClient } from '../content/customClient';
import { excludeQuestion } from '../content/customStore';
import { questionSource } from '../content/source';

/**
 * "Looks wrong?" for Any Topic questions. Tells the server (best effort), and remembers the id locally,
 * so the question is left out the next time that pack is loaded.
 */
export default function ReportButton({ questionId }: { questionId: string }) {
  const [done, setDone] = useState(false);
  const report = () => {
    setDone(true);
    const gen = questionSource.hasCustomPack() ? questionSource.getPack('custom').generated : undefined;
    if (!gen) return;
    excludeQuestion(gen.packKey, questionId);
    // the hand-written examples are not on the server, so there is nobody to tell
    if (gen.model !== 'hand-written') void customClient.reportQuestion({ packKey: gen.packKey, questionId, reason: 'wrong' });
  };
  return (
    <button type="button" className="report-btn" disabled={done} onClick={report}>
      {done ? '⚑ Thanks! It will be left out next time.' : '⚑ Looks wrong?'}
    </button>
  );
}
